-- 0835 · KNITTING ORDER CORRECTIONS (doc/process/knitting update.md, client 2026-11-12).
--
-- The spec's own SQL names `knitting_programs` / `knitting_program_items`, which do not exist
-- (a Knitting Order is a `process_orders` row of type knitting + process_order_knit_fabrics /
-- _yarns, 0825). This is that spec mapped onto the real schema. ADDITIVE ONLY — nothing dropped:
--
-- 1. KNITTING GSM. `process_order_knit_fabrics.knit_gsm` — the GSM the knitter is asked to
--    knit to, beside `gsm` (now labelled "Finishing GSM", the BOM's). Blank defaults to the
--    finishing GSM, both in the backfill and in the save.
--    `loop_length_ref` and the generated `expected_rolls` STAY: the screen no longer shows or
--    sends them (spec §2.2 "removed from the data entry table"), but rows already hold values
--    and receipts may read the rolls.
--
-- 2. ONE PROGRAM PER FABRIC (spec §2.1, narrowed by the user 2026-11-12: "block per FABRIC,
--    not per RE"). A knitting order is PLACED once it leaves draft (and is not cancelled). A
--    Fabric BOM slice of an RE — fabric × finished dia × width form, the `source_key` the
--    screen picks by — that is already on a placed knitting order cannot be programmed on
--    another one. The RE itself stays open: two knitters may each take different fabrics.
--      - the screen greys the fabric "(Program Placed — KO/..)";
--      - `knitting_order_save` refuses a fabric line already placed elsewhere;
--      - trigger `trg_proc_k_one_program` runs the same check over the order's fabric lines
--        on the move OUT of draft (the issue) — so two drafts holding one fabric, or a stale
--        tab, can never both be issued. A draft does not block.
--    The slice key is `source_key`, or for a line saved without one the same shape built from
--    the line's own fabric, finished dia and width form (`knit_fabric_key`).
--    The trigger fires only on the transition INTO placed (or a changed RE), so orders already
--    issued keep moving through receipt; live data had no fabric placed twice when this was
--    written (checked 2026-11-12). An advisory lock per RE serialises two issues racing.
--
-- The save function is re-created from its ONLY prior body (0825), every line kept.

alter table public.process_order_knit_fabrics
  add column if not exists knit_gsm numeric(10,2) check (knit_gsm is null or knit_gsm > 0);

update public.process_order_knit_fabrics set knit_gsm = gsm where knit_gsm is null and gsm > 0;

-- ---------------------------------------------------------------------------
-- The slice key — `knitSourceKey` in lib/production/knitting-types.ts, written twice on purpose.
-- ---------------------------------------------------------------------------
create or replace function public.knit_fabric_key(p_fabric uuid, p_source_key text, p_finished_dia text, p_width_form text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(p_source_key, ''),
                  p_fabric::text || '|' || upper(trim(coalesce(p_finished_dia, ''))) || '|' || coalesce(p_width_form, ''))
$$;
revoke all on function public.knit_fabric_key(uuid, text, text, text) from public, anon;
grant execute on function public.knit_fabric_key(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The one question both guards ask: which placed knitting order of this RE holds this fabric
-- slice? Returns the refusal sentence, or NULL when it is free. SECURITY DEFINER so the answer
-- covers every unit, and it returns nothing but that sentence.
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
   where po.sales_order_id = p_sales_order_id
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
  f        record;
begin
  if new.process_type <> 'knitting' or new.sales_order_id is null
     or new.status in ('draft', 'cancelled') then
    return new;
  end if;
  -- Only the move INTO placed (leaving draft / cancelled, or an insert straight to placed) and a
  -- changed RE are checked, so orders placed before 0835 keep moving through receipt.
  if tg_op = 'UPDATE' and old.status not in ('draft', 'cancelled')
     and old.sales_order_id is not distinct from new.sales_order_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('knit_program:' || new.sales_order_id::text));
  for f in
    select fabric_item_id, source_key, finished_dia, width_form
      from public.process_order_knit_fabrics where process_order_id = new.id order by sno
  loop
    v_placed := public.knitting_fabric_placed_by(
      new.sales_order_id, public.knit_fabric_key(f.fabric_item_id, f.source_key, f.finished_dia, f.width_form), new.id);
    if v_placed is not null then
      raise exception '%', v_placed using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.process_order_one_knit_program() from public, anon;

drop trigger if exists trg_proc_k_one_program on public.process_orders;
create trigger trg_proc_k_one_program
  before insert or update of status, sales_order_id on public.process_orders
  for each row execute function public.process_order_one_knit_program();

-- ---------------------------------------------------------------------------
-- The one writer — 0825's body, plus knit_gsm and the fabric guard.
-- payload: as 0825; each fabric may also carry `knit_gsm` (blank = its gsm).
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
    select name into v_fname from public.items where id = nullif(f->>'fabric_item_id', '')::uuid;
    if v_fname is null then
      raise exception 'Fabric line %: pick the fabric', v_fi using errcode = 'P0001';
    end if;
    if v_prog is null or v_prog <= 0 then
      raise exception '%: enter the Program Qty (kg)', v_fname using errcode = 'P0001';
    end if;
    if coalesce(f->>'source_key', '') <> '' then
      if f->>'source_key' = any (v_seen) then
        raise exception '% is on this knitting order twice at the same dia', v_fname using errcode = 'P0001';
      end if;
      v_seen := v_seen || (f->>'source_key');
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
    -- slice of this RE already on another PLACED knitting order cannot be programmed again.
    if v_so is not null then
      v_placed := public.knitting_fabric_placed_by(
        v_so,
        public.knit_fabric_key(nullif(f->>'fabric_item_id', '')::uuid, f->>'source_key', f->>'finished_dia', f->>'width_form'),
        v_id);
      if v_placed is not null then
        raise exception '%', v_placed using errcode = 'P0001';
      end if;
    end if;

    insert into public.process_order_knit_fabrics
      (process_order_id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm, knit_gsm,
       loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, rate_per_kg)
    values
      (v_id, v_fi, (f->>'fabric_item_id')::uuid, nullif(f->>'source_key', ''),
       nullif(f->>'width_form', ''), nullif(trim(f->>'knit_dia'), ''), nullif(trim(f->>'finished_dia'), ''),
       nullif(f->>'gsm', '')::numeric,
       -- Knitting GSM defaults to the finishing GSM when left blank (0835).
       nullif(coalesce(nullif(f->>'knit_gsm', '')::numeric, nullif(f->>'gsm', '')::numeric), 0),
       nullif(f->>'loop_length', '')::numeric,
       nullif(f->>'loop_length_ref', '')::numeric, nullif(f->>'gauge_id', '')::uuid,
       nullif(trim(f->>'ply'), ''), v_prog, nullif(f->>'roll_weight_kg', '')::numeric,
       coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0))
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
declare
  v_def text := pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure);
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'process_order_knit_fabrics'
                    and column_name = 'knit_gsm') then
    raise exception '0835: knit_gsm was not added';
  end if;
  if position('knit_gsm' in v_def) = 0 or position('knitting_fabric_placed_by' in v_def) = 0 then
    raise exception '0835: knitting_order_save was not replaced';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_proc_k_one_program' and tgrelid = 'public.process_orders'::regclass) then
    raise exception '0835: trg_proc_k_one_program is missing';
  end if;
end $$;
