-- 0836 · ONE KNITTING ORDER, SEVERAL REs (client 2026-11-12, user go-ahead the same day).
--
-- Until now a Knitting Order (a `process_orders` row of type knitting, 0825) was for ONE RE:
-- `process_orders.sales_order_id`. The client allots one knitter fabrics from several REs on a
-- single KO, so the RE moves DOWN to the fabric line:
--
-- 1. `process_order_knit_fabrics.sales_order_id` — the RE this fabric is knitted for.
--    Backfilled from the order's RE. The header's `sales_order_id` STAYS and holds the FIRST
--    RE of the order, so every list, report and filter that reads it keeps working.
--
-- 2. STOCK OWNER PER LINE. The yarn sent out, the yarn knitted in, the yarn returned, the loss
--    written off, the yarn moved between orders at the knitter and the fabric received each
--    belong to the RE of THEIR fabric line — never one owner for the whole order.
--    `knit_line_owner(process_order_line)` and `knit_fabric_owner(knit_fabric)` answer it,
--    with the same "first garment order of the RE" rule `stock_owner_for` (0802) uses, and fall
--    back to `stock_owner_for('process_order', …)` for a line that is not a knitting line.
--
--    The four posting functions each read the owner ONCE per order today. Each is re-created
--    from its LIVE body (pg_get_functiondef) with that one statement replaced or added, and
--    every replacement must match exactly once or the migration aborts — so no other line of
--    the latest body (0831 / 0832 / 0833) can be lost:
--      process_dc_dispatch          — per DC line            (was per order, 0832)
--      knitting_receipt_post        — per fabric / per yarn  (was per order, 0831)
--      knitting_close_write_off     — per DC line            (was per order, 0832)
--      knitting_transfer_at_knitter — per from / to line     (was per order, 0833)
--
-- 3. ONE PROGRAM PER FABRIC (0835) is now per FABRIC LINE'S RE: `knitting_fabric_placed_by`
--    matches `coalesce(f.sales_order_id, po.sales_order_id)`, and the issue trigger checks
--    each line against its own RE (an advisory lock per RE, taken in RE order).
--
-- 4. `knitting_order_save` (0835's body, every line kept) takes `sales_order_id` per fabric;
--    a fabric without one falls back to the header's, so an older client still saves.

alter table public.process_order_knit_fabrics
  add column if not exists sales_order_id uuid references public.sales_orders(id);

update public.process_order_knit_fabrics f
   set sales_order_id = po.sales_order_id
  from public.process_orders po
 where po.id = f.process_order_id and f.sales_order_id is null and po.sales_order_id is not null;

create index if not exists process_order_knit_fabrics_sales_order_idx
  on public.process_order_knit_fabrics (sales_order_id);

-- ---------------------------------------------------------------------------
-- Stock owner of one knitting line / fabric
-- ---------------------------------------------------------------------------
create or replace function public.knit_owner_of_re(p_sales_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select goa.id from public.garment_order_amendments goa
   where goa.sales_order_id = p_sales_order_id
   order by goa.created_at, goa.id limit 1
$$;
revoke all on function public.knit_owner_of_re(uuid) from public, anon;

create or replace function public.knit_line_owner(p_line uuid)
returns table (garment_order_id uuid, iwo_id uuid)
language plpgsql
stable
-- DEFINER for stock_owner_for's reason (0802): the poster may not see the order behind it.
security definer
set search_path = ''
as $$
declare
  v_so uuid;
  v_po uuid;
begin
  select pol.process_order_id into v_po from public.process_order_lines pol where pol.id = p_line;
  select pf.sales_order_id into v_so
    from public.process_order_knit_yarns py
    join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
   where py.process_order_line_id = p_line
   limit 1;
  if v_so is not null then
    return query select public.knit_owner_of_re(v_so), null::uuid;
    return;
  end if;
  return query select x.garment_order_id, x.iwo_id from public.stock_owner_for('process_order', v_po, null) x;
end;
$$;
revoke all on function public.knit_line_owner(uuid) from public, anon;

create or replace function public.knit_fabric_owner(p_knit_fabric uuid)
returns table (garment_order_id uuid, iwo_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_so uuid;
  v_po uuid;
begin
  select pf.sales_order_id, pf.process_order_id into v_so, v_po
    from public.process_order_knit_fabrics pf where pf.id = p_knit_fabric;
  if v_so is not null then
    return query select public.knit_owner_of_re(v_so), null::uuid;
    return;
  end if;
  return query select x.garment_order_id, x.iwo_id from public.stock_owner_for('process_order', v_po, null) x;
end;
$$;
revoke all on function public.knit_fabric_owner(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- The four posting functions: live body, one statement changed, each match exactly once.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_old text;
  v_new text;
  r record;
begin
  for r in
    select * from (values
      -- process_dc_dispatch: the owner of THIS DC line.
      ('public.process_dc_dispatch(uuid)',
       'select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for(''process_order'', lo.id, null) x;',
       'select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.knit_line_owner(l.process_order_line_id) x;'),
      -- knitting_close_write_off: the owner of THIS DC line, before its ledger row.
      ('public.knitting_close_write_off(uuid,text)',
       E'    v_lot := nullif(upper(btrim(coalesce(l.lot_no, \'\'))), \'\');\n    update public.dc_line_items',
       E'    v_lot := nullif(upper(btrim(coalesce(l.lot_no, \'\'))), \'\');\n    select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.knit_line_owner(l.process_order_line_id) x;\n    update public.dc_line_items'),
      -- knitting_transfer_at_knitter: the from line's owner and the to line's owner.
      ('public.knitting_transfer_at_knitter(uuid,uuid,numeric,text)',
       'select x.garment_order_id, x.iwo_id into v_fre, v_fiwo from public.stock_owner_for(''process_order'', fo.id, null) x;',
       'select x.garment_order_id, x.iwo_id into v_fre, v_fiwo from public.knit_line_owner(fy.process_order_line_id) x;'),
      ('public.knitting_transfer_at_knitter(uuid,uuid,numeric,text)',
       'select x.garment_order_id, x.iwo_id into v_tre, v_tiwo from public.stock_owner_for(''process_order'', tor.id, null) x;',
       'select x.garment_order_id, x.iwo_id into v_tre, v_tiwo from public.knit_line_owner(ty.process_order_line_id) x;'),
      -- knitting_receipt_post: the received fabric's owner (its yarn used follows it) …
      ('public.knitting_receipt_post(uuid,jsonb,jsonb,jsonb)',
       E'      raise exception \'A fabric line is not on this knitting order\' using errcode = \'P0001\';\n    end if;',
       E'      raise exception \'A fabric line is not on this knitting order\' using errcode = \'P0001\';\n    end if;\n    select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.knit_fabric_owner(kf.id) x;'),
      -- … and a returned yarn's owner.
      ('public.knitting_receipt_post(uuid,jsonb,jsonb,jsonb)',
       E'      raise exception \'A returned yarn is not on this knitting order\' using errcode = \'P0001\';\n    end if;',
       E'      raise exception \'A returned yarn is not on this knitting order\' using errcode = \'P0001\';\n    end if;\n    select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.knit_fabric_owner(ky.knit_fabric_id) x;')
    ) t(sig, old_s, new_s)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    v_old := r.old_s;
    v_new := r.new_s;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '0836: % — the statement to replace was found % times, expected once: %',
        r.sig, (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old), v_old;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ONE PROGRAM PER FABRIC, per the fabric line's RE (0835 bodies, the RE test widened)
-- ---------------------------------------------------------------------------
create or replace function public.knitting_fabric_placed_by(p_sales_order_id uuid, p_key text, p_except uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select format('%s already has a knitting program placed on %s for this RE',
                coalesce(i.name, 'This fabric'), coalesce(po.code, 'another knitting order'))
    from public.process_order_knit_fabrics f
    join public.process_orders po on po.id = f.process_order_id
    left join public.items i on i.id = f.fabric_item_id
   where coalesce(f.sales_order_id, po.sales_order_id) = p_sales_order_id
     and po.process_type = 'knitting'
     and po.status not in ('draft', 'cancelled')
     and po.id is distinct from p_except
     and public.knit_fabric_key(f.fabric_item_id, f.source_key, f.finished_dia, f.width_form) = p_key
   order by po.created_at
   limit 1
$$;
revoke all on function public.knitting_fabric_placed_by(uuid, text, uuid) from public, anon;
grant execute on function public.knitting_fabric_placed_by(uuid, text, uuid) to authenticated;

create or replace function public.process_order_one_knit_program()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placed text;
  v_so     uuid;
  f        record;
begin
  if new.process_type <> 'knitting' or new.status in ('draft', 'cancelled') then
    return new;
  end if;
  -- Only the move INTO placed (leaving draft / cancelled, or an insert straight to placed) and a
  -- changed RE are checked, so orders placed before 0835 keep moving through receipt.
  if tg_op = 'UPDATE' and old.status not in ('draft', 'cancelled')
     and old.sales_order_id is not distinct from new.sales_order_id then
    return new;
  end if;
  -- One advisory lock per RE on the order, taken in RE order so two issues cannot deadlock.
  for v_so in
    select distinct coalesce(kf.sales_order_id, new.sales_order_id) as so
      from public.process_order_knit_fabrics kf
     where kf.process_order_id = new.id and coalesce(kf.sales_order_id, new.sales_order_id) is not null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('knit_program:' || v_so::text));
  end loop;
  for f in
    select fabric_item_id, source_key, finished_dia, width_form, coalesce(sales_order_id, new.sales_order_id) as so
      from public.process_order_knit_fabrics where process_order_id = new.id order by sno
  loop
    continue when f.so is null;
    v_placed := public.knitting_fabric_placed_by(
      f.so, public.knit_fabric_key(f.fabric_item_id, f.source_key, f.finished_dia, f.width_form), new.id);
    if v_placed is not null then
      raise exception '%', v_placed using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.process_order_one_knit_program() from public, anon;

-- ---------------------------------------------------------------------------
-- The one writer — 0835's body, every line kept, plus the RE per fabric.
-- payload: as 0835; each fabric may also carry `sales_order_id` (blank = the header's).
-- ---------------------------------------------------------------------------
create or replace function public.knitting_order_save(p_order_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc  uuid := public.current_location();
  v_id   uuid := p_order_id;
  v_kg   uuid;
  v_row  record;
  f      jsonb;
  y      jsonb;
  v_fab  uuid;
  v_line uuid;
  v_fi   integer := 0;
  v_yi   integer;
  v_sum  numeric;
  v_prog numeric;
  v_req  numeric;
  v_bag  numeric;
  v_cap  numeric;
  v_allow numeric;
  v_name text;
  v_fname text;
  v_total numeric := 0;
  v_seen text[] := '{}';
  v_so   uuid := nullif(p->>'sales_order_id', '')::uuid;
  v_fso  uuid;
  v_placed text;
begin
  if v_id is null then
    if not public.has_permission('stores', 'create') then
      raise exception 'You do not have permission to raise a knitting order' using errcode = '42501';
    end if;
  elsif not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to change a knitting order' using errcode = '42501';
  end if;
  if v_loc is null then
    raise exception 'Pick your working unit in the top bar first' using errcode = 'P0001';
  end if;
  if nullif(p->>'vendor_id', '') is null then
    raise exception 'Pick the knitter' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p->'fabrics', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one fabric to knit' using errcode = 'P0001';
  end if;

  select id into v_kg from public.uoms where lower(code) = 'kg' order by is_active desc limit 1;

  if v_id is null then
    insert into public.process_orders
      (vendor_id, location_id, process_type, status, sales_order_id, order_date, expected_date,
       allowed_loss_pct, notes, total_amount)
    values
      ((p->>'vendor_id')::uuid, v_loc, 'knitting', 'draft', nullif(p->>'sales_order_id', '')::uuid,
       coalesce(nullif(p->>'order_date', '')::date, current_date), nullif(p->>'expected_date', '')::date,
       nullif(p->>'allowed_loss_pct', '')::numeric, nullif(p->>'notes', ''), 0)
    returning id into v_id;
  else
    select id, status, process_type, location_id into v_row from public.process_orders where id = v_id for update;
    if v_row.id is null or v_row.process_type <> 'knitting' or not public.is_current_location(v_row.location_id) then
      raise exception 'That knitting order is not in your unit' using errcode = 'P0001';
    end if;
    if v_row.status <> 'draft' then
      raise exception 'Only a draft knitting order can be changed — this one is already issued' using errcode = 'P0001';
    end if;
    update public.process_orders set
      vendor_id        = (p->>'vendor_id')::uuid,
      sales_order_id   = nullif(p->>'sales_order_id', '')::uuid,
      order_date       = coalesce(nullif(p->>'order_date', '')::date, order_date),
      expected_date    = nullif(p->>'expected_date', '')::date,
      allowed_loss_pct = nullif(p->>'allowed_loss_pct', '')::numeric,
      notes            = nullif(p->>'notes', '')
     where id = v_id;
    -- A draft has no DC (a Process DC needs an issued order), so its lines can be rewritten.
    delete from public.process_order_knit_fabrics where process_order_id = v_id;
    delete from public.process_order_lines where process_order_id = v_id;
  end if;

  for f in select * from jsonb_array_elements(p->'fabrics') loop
    v_fi := v_fi + 1;
    v_prog := nullif(f->>'programmed_kg', '')::numeric;
    -- THE FABRIC'S OWN RE (0836); an older client sends none and the header's is used.
    v_fso := coalesce(nullif(f->>'sales_order_id', '')::uuid, v_so);
    select name into v_fname from public.items where id = nullif(f->>'fabric_item_id', '')::uuid;
    if v_fname is null then
      raise exception 'Fabric line %: pick the fabric', v_fi using errcode = 'P0001';
    end if;
    if v_prog is null or v_prog <= 0 then
      raise exception '%: enter the Program Qty (kg)', v_fname using errcode = 'P0001';
    end if;
    if coalesce(f->>'source_key', '') <> '' then
      -- The same BOM slice twice is a duplicate only within ONE RE (0836).
      if (coalesce(v_fso::text, '') || '#' || (f->>'source_key')) = any (v_seen) then
        raise exception '% is on this knitting order twice at the same dia', v_fname using errcode = 'P0001';
      end if;
      v_seen := v_seen || (coalesce(v_fso::text, '') || '#' || (f->>'source_key'));
    end if;
    if jsonb_array_length(coalesce(f->'yarns', '[]'::jsonb)) = 0 then
      raise exception '%: no yarns — its fabric master has no composition', v_fname using errcode = 'P0001';
    end if;
    select coalesce(sum(nullif(x->>'blend_pct', '')::numeric), 0) into v_sum
      from jsonb_array_elements(f->'yarns') x;
    if abs(v_sum - 100) > 0.01 then
      raise exception '%: the yarn blend adds up to % %%, not 100 %%', v_fname, round(v_sum, 3) using errcode = 'P0001';
    end if;

    -- ONE PROGRAM PER FABRIC (0835, doc/process/knitting update.md 2.1, user 2026-11-12): a BOM
    -- slice of this fabric's RE already on another PLACED knitting order cannot be programmed again.
    if v_fso is not null then
      v_placed := public.knitting_fabric_placed_by(
        v_fso,
        public.knit_fabric_key(nullif(f->>'fabric_item_id', '')::uuid, f->>'source_key', f->>'finished_dia', f->>'width_form'),
        v_id);
      if v_placed is not null then
        raise exception '%', v_placed using errcode = 'P0001';
      end if;
    end if;

    insert into public.process_order_knit_fabrics
      (process_order_id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm, knit_gsm,
       loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, rate_per_kg, sales_order_id)
    values
      (v_id, v_fi, (f->>'fabric_item_id')::uuid, nullif(f->>'source_key', ''),
       nullif(f->>'width_form', ''), nullif(trim(f->>'knit_dia'), ''), nullif(trim(f->>'finished_dia'), ''),
       nullif(f->>'gsm', '')::numeric,
       -- Knitting GSM defaults to the finishing GSM when left blank (0835).
       nullif(coalesce(nullif(f->>'knit_gsm', '')::numeric, nullif(f->>'gsm', '')::numeric), 0),
       nullif(f->>'loop_length', '')::numeric,
       nullif(f->>'loop_length_ref', '')::numeric, nullif(f->>'gauge_id', '')::uuid,
       nullif(trim(f->>'ply'), ''), v_prog, nullif(f->>'roll_weight_kg', '')::numeric,
       coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0), v_fso)
    returning id into v_fab;
    v_total := v_total + v_prog * coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0);

    v_yi := 0;
    for y in select * from jsonb_array_elements(f->'yarns') loop
      v_yi := v_yi + 1;
      select name into v_name from public.items where id = nullif(y->>'yarn_item_id', '')::uuid;
      if v_name is null then
        raise exception '%: yarn line % names no yarn', v_fname, v_yi using errcode = 'P0001';
      end if;
      v_allow := coalesce(nullif(y->>'allowance_pct', '')::numeric, 0);
      v_bag   := nullif(y->>'bag_weight_kg', '')::numeric;
      v_req   := round(v_prog * (y->>'blend_pct')::numeric / 100 * (1 + v_allow / 100), 3);
      v_cap   := case when v_bag > 0 then ceil(v_req / v_bag) * v_bag else v_req end;

      insert into public.process_order_lines
        (process_order_id, item_id, description, sent_qty, received_qty, uom_id, rate, amount,
         sort_order, output_item_id)
      values
        (v_id, (y->>'yarn_item_id')::uuid, v_name || ' — for ' || v_fname, v_cap, 0, v_kg, 0, 0,
         v_fi * 100 + v_yi, (f->>'fabric_item_id')::uuid)
      returning id into v_line;

      insert into public.process_order_knit_yarns
        (knit_fabric_id, sno, yarn_item_id, blend_pct, allowance_pct, required_kg, bag_weight_kg,
         process_order_line_id)
      values
        (v_fab, v_yi, (y->>'yarn_item_id')::uuid, (y->>'blend_pct')::numeric, v_allow, v_req, v_bag, v_line);
    end loop;
  end loop;

  update public.process_orders set total_amount = round(v_total, 2) where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.knitting_order_save(uuid, jsonb) from public, anon;
grant execute on function public.knitting_order_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.process_order_knit_fabrics f join public.process_orders po on po.id = f.process_order_id
              where f.sales_order_id is null and po.sales_order_id is not null) then
    raise exception '0836: a knitting fabric line was not given its RE';
  end if;
  if position('knit_line_owner' in pg_get_functiondef('public.process_dc_dispatch(uuid)'::regprocedure)) = 0
     or position('knit_line_owner' in pg_get_functiondef('public.knitting_close_write_off(uuid,text)'::regprocedure)) = 0
     or position('knit_line_owner(ty.' in pg_get_functiondef('public.knitting_transfer_at_knitter(uuid,uuid,numeric,text)'::regprocedure)) = 0
     or position('knit_fabric_owner(ky.' in pg_get_functiondef('public.knitting_receipt_post(uuid,jsonb,jsonb,jsonb)'::regprocedure)) = 0
     or position('v_fso' in pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure)) = 0
     or position('kf.sales_order_id' in pg_get_functiondef('public.process_order_one_knit_program()'::regprocedure)) = 0 then
    raise exception '0836: a function was not replaced';
  end if;
end $$;
