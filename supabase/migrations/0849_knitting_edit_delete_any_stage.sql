-- 0849 — A KNITTING ORDER IS EDITABLE AND DELETABLE AT ANY STAGE (user 2026-11-14:
-- "allow user edit and delete forever"; chose "Everything, safely" and "Any stage, reverse all").
--
-- EDIT. knitting_order_save refused every order past draft, because its update branch deletes
-- every fabric and yarn line and inserts them again — and once issued, the yarn DCs
-- (dc_line_items.process_order_line_id) and the receipts (knitting_receipt_fabrics /
-- knitting_receipt_yarns) point at those very rows. So an issued order now goes to
-- knitting_order_save_issued, which UPDATES lines in place by id. Line by line it refuses only
-- what would falsify history:
--   * the knitter, once yarn is at them;
--   * swapping the fabric / its RE, or a yarn for another, on a line with a DC or a receipt;
--   * a Program Qty / DC Cap below what has already been sent on that yarn;
--   * removing a fabric or yarn line that has a DC or a receipt;
--   * a Net Rate raised above the approved budget (the MD approved the old one — 0845).
-- A cancelled order stays read-only. The draft path is untouched.
--
-- DELETE. knitting_order_delete stopped at Partly Received / Received / Completed. It now
-- reverses the order whole, newest first, in ONE transaction, using the reversals that already
-- exist rather than new copies of them:
--   1. a Close (knitting_close_write_off): its adjust_out rows mirrored back, its written_off
--      rows and the DC shortage they posted taken off, the order reopened;
--   2. every Fabric Receipt / Yarn Return through knitting_receipt_delete (0839) — stock out,
--      DC returned qty back, draft bill dropped — and any knitting GRN (0846) left empty;
--   3. every sent yarn DC through knitting_dc_undo (0841) — yarn back to its bin;
--   4. the order.
-- What cannot be reversed honestly still refuses, through those functions' own sentences: a bill
-- already passed in Payables, fabric already issued onward, and yarn moved between two knitting
-- orders at the knitter (0833 — that move has no undo).
--
-- knitting_order_save is PATCHED IN PLACE from its live body (0845 rule): only the "Only a draft"
-- refusal is replaced. knitting_order_delete is re-created from its live body (0843) plus the
-- reversal prelude.

-- 1. The in-place save for an order past draft ------------------------------------------------
create or replace function public.knitting_order_save_issued(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o       record;
  ef      record;
  ey      record;
  f       jsonb;
  y       jsonb;
  v_kg    uuid;
  v_fab   uuid;
  v_line  uuid;
  v_yid   uuid;
  v_fi    integer := 0;
  v_yi    integer;
  v_sum   numeric;
  v_prog  numeric;
  v_req   numeric;
  v_bag   numeric;
  v_cap   numeric;
  v_allow numeric;
  v_rate  numeric;
  v_sent  numeric;
  v_name  text;
  v_fname text;
  v_total numeric := 0;
  v_seen  text[] := '{}';
  v_so    uuid := nullif(p->>'sales_order_id', '')::uuid;
  v_fso   uuid;
  v_placed text;
  v_own   boolean := coalesce((p->>'is_by_vendor')::boolean, false);
  v_out   boolean;
  v_rate_up boolean := false;
  v_keep_fab  uuid[] := '{}';
  v_keep_yarn uuid[] := '{}';
  v_lines uuid[];
begin
  select * into o from public.process_orders where id = p_id for update;
  if o.status = 'cancelled' then
    raise exception '% is cancelled — it can no longer be changed', coalesce(o.code, 'This order') using errcode = 'P0001';
  end if;

  -- Yarn already at the knitter (any DC that went out).
  v_out := exists (
    select 1 from public.dc_line_items x
      join public.delivery_challans d on d.id = x.delivery_challan_id
      join public.process_order_lines pol on pol.id = x.process_order_line_id
     where pol.process_order_id = p_id and d.status not in ('draft', 'cancelled'));
  if v_out and (p->>'vendor_id')::uuid is distinct from o.vendor_id then
    raise exception '% already has yarn at its knitter — the knitter cannot be changed', coalesce(o.code, 'This order')
      using errcode = 'P0001';
  end if;
  if v_out and v_own and not coalesce(o.is_by_vendor, false) then
    raise exception 'Yarn has already been sent on % — it cannot switch to the knitter''s own yarn', coalesce(o.code, 'this order')
      using errcode = 'P0001';
  end if;

  select id into v_kg from public.uoms where lower(code) = 'kg' order by is_active desc limit 1;

  update public.process_orders set
    vendor_id        = (p->>'vendor_id')::uuid,
    sales_order_id   = nullif(p->>'sales_order_id', '')::uuid,
    order_date       = coalesce(nullif(p->>'order_date', '')::date, order_date),
    expected_date    = nullif(p->>'expected_date', '')::date,
    allowed_loss_pct = nullif(p->>'allowed_loss_pct', '')::numeric,
    notes            = nullif(p->>'notes', '')
   where id = p_id;

  for f in select * from jsonb_array_elements(p->'fabrics') loop
    v_fi := v_fi + 1;
    v_prog := nullif(f->>'programmed_kg', '')::numeric;
    v_rate := coalesce(nullif(f->>'rate_per_kg', '')::numeric, 0);
    v_fso := coalesce(nullif(f->>'sales_order_id', '')::uuid, v_so);
    select name into v_fname from public.items where id = nullif(f->>'fabric_item_id', '')::uuid;
    if v_fname is null then
      raise exception 'Fabric line %: pick the fabric', v_fi using errcode = 'P0001';
    end if;
    if v_prog is null or v_prog <= 0 then
      raise exception '%: enter the Program Qty (kg)', v_fname using errcode = 'P0001';
    end if;
    if coalesce(f->>'source_key', '') <> '' then
      if (coalesce(v_fso::text, '') || '#' || (f->>'source_key')) = any (v_seen) then
        raise exception '% is on this knitting order twice at the same dia', v_fname using errcode = 'P0001';
      end if;
      v_seen := v_seen || (coalesce(v_fso::text, '') || '#' || (f->>'source_key'));
    end if;
    if not v_own and jsonb_array_length(coalesce(f->'yarns', '[]'::jsonb)) = 0 then
      raise exception '%: no yarns — its fabric master has no composition', v_fname using errcode = 'P0001';
    end if;
    select coalesce(sum(nullif(x->>'blend_pct', '')::numeric), 0) into v_sum from jsonb_array_elements(f->'yarns') x;
    if not v_own and abs(v_sum - 100) > 0.01 then
      raise exception '%: the yarn blend adds up to % %%, not 100 %%', v_fname, round(v_sum, 3) using errcode = 'P0001';
    end if;
    if v_fso is not null then
      v_placed := public.knitting_fabric_placed_by(
        v_fso,
        public.knit_fabric_key(nullif(f->>'fabric_item_id', '')::uuid, f->>'source_key', f->>'finished_dia', f->>'width_form'),
        p_id);
      if v_placed is not null then
        raise exception '%', v_placed using errcode = 'P0001';
      end if;
    end if;

    select * into ef from public.process_order_knit_fabrics
     where id = nullif(f->>'id', '')::uuid and process_order_id = p_id;
    if ef.id is not null then
      v_fab := ef.id;
      if (ef.fabric_item_id <> (f->>'fabric_item_id')::uuid or ef.sales_order_id is distinct from v_fso)
         and (exists (select 1 from public.knitting_receipt_fabrics where knit_fabric_id = v_fab)
              or exists (select 1 from public.dc_line_items x join public.process_order_knit_yarns ky on ky.process_order_line_id = x.process_order_line_id
                          where ky.knit_fabric_id = v_fab)) then
        raise exception '%: yarn has gone out or fabric has come back on it — its fabric and RE can no longer be changed', v_fname
          using errcode = 'P0001';
      end if;
      if v_rate > coalesce(ef.rate_per_kg, 0) + 0.00001 then
        v_rate_up := true;
      end if;
      update public.process_order_knit_fabrics set
        sno = v_fi, fabric_item_id = (f->>'fabric_item_id')::uuid, source_key = nullif(f->>'source_key', ''),
        width_form = nullif(f->>'width_form', ''), knit_dia = nullif(trim(f->>'knit_dia'), ''),
        finished_dia = nullif(trim(f->>'finished_dia'), ''), gsm = nullif(f->>'gsm', '')::numeric,
        knit_gsm = nullif(coalesce(nullif(f->>'knit_gsm', '')::numeric, nullif(f->>'gsm', '')::numeric), 0),
        loop_length = nullif(f->>'loop_length', '')::numeric, loop_length_ref = nullif(f->>'loop_length_ref', '')::numeric,
        gauge_id = nullif(f->>'gauge_id', '')::uuid, ply = nullif(trim(f->>'ply'), ''), programmed_kg = v_prog,
        roll_weight_kg = nullif(f->>'roll_weight_kg', '')::numeric, rate_per_kg = v_rate, sales_order_id = v_fso
       where id = v_fab;
    else
      if v_rate > 0 then
        v_rate_up := true;
      end if;
      insert into public.process_order_knit_fabrics
        (process_order_id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm, knit_gsm,
         loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, rate_per_kg, sales_order_id)
      values
        (p_id, v_fi, (f->>'fabric_item_id')::uuid, nullif(f->>'source_key', ''),
         nullif(f->>'width_form', ''), nullif(trim(f->>'knit_dia'), ''), nullif(trim(f->>'finished_dia'), ''),
         nullif(f->>'gsm', '')::numeric,
         nullif(coalesce(nullif(f->>'knit_gsm', '')::numeric, nullif(f->>'gsm', '')::numeric), 0),
         nullif(f->>'loop_length', '')::numeric, nullif(f->>'loop_length_ref', '')::numeric, nullif(f->>'gauge_id', '')::uuid,
         nullif(trim(f->>'ply'), ''), v_prog, nullif(f->>'roll_weight_kg', '')::numeric, v_rate, v_fso)
      returning id into v_fab;
    end if;
    v_keep_fab := v_keep_fab || v_fab;
    v_total := v_total + v_prog * v_rate;

    v_yi := 0;
    for y in select * from jsonb_array_elements(case when v_own then '[]'::jsonb else coalesce(f->'yarns', '[]'::jsonb) end) loop
      v_yi := v_yi + 1;
      select name into v_name from public.items where id = nullif(y->>'yarn_item_id', '')::uuid;
      if v_name is null then
        raise exception '%: yarn line % names no yarn', v_fname, v_yi using errcode = 'P0001';
      end if;
      v_allow := coalesce(nullif(y->>'allowance_pct', '')::numeric, 0);
      v_bag   := nullif(y->>'bag_weight_kg', '')::numeric;
      v_req   := round(v_prog * (y->>'blend_pct')::numeric / 100 * (1 + v_allow / 100), 3);
      v_cap   := case when v_bag > 0 then ceil(v_req / v_bag) * v_bag else v_req end;
      if nullif(y->>'dc_cap_kg', '')::numeric <= 0 then
        raise exception '%: the DC Cap must be more than 0 kg, or left blank', v_name using errcode = 'P0001';
      end if;
      v_cap   := coalesce(round(nullif(y->>'dc_cap_kg', '')::numeric, 3), v_cap);

      select * into ey from public.process_order_knit_yarns
       where id = nullif(y->>'id', '')::uuid and knit_fabric_id = v_fab;
      if ey.id is not null then
        v_yid := ey.id;
        v_line := ey.process_order_line_id;
        select coalesce(sum(x.sent_qty), 0) into v_sent
          from public.dc_line_items x join public.delivery_challans d on d.id = x.delivery_challan_id
         where x.process_order_line_id = v_line and d.status not in ('draft', 'cancelled');
        if ey.yarn_item_id <> (y->>'yarn_item_id')::uuid
           and (v_sent > 0 or exists (select 1 from public.knitting_receipt_yarns where knit_yarn_id = ey.id)) then
          raise exception '%: yarn has gone out on this line — it cannot be swapped for another yarn', v_fname using errcode = 'P0001';
        end if;
        if v_cap < v_sent - 0.0005 then
          raise exception '% (%): % kg has already gone to the knitter — its Program Qty / DC Cap cannot go below that',
            v_name, v_fname, round(v_sent, 3) using errcode = 'P0001';
        end if;
        if v_line is null then
          insert into public.process_order_lines
            (process_order_id, item_id, description, sent_qty, received_qty, uom_id, rate, amount, sort_order, output_item_id)
          values
            (p_id, (y->>'yarn_item_id')::uuid, v_name || ' — for ' || v_fname, v_cap, 0, v_kg, 0, 0, v_fi * 100 + v_yi,
             (f->>'fabric_item_id')::uuid)
          returning id into v_line;
        else
          update public.process_order_lines set
            item_id = (y->>'yarn_item_id')::uuid, description = v_name || ' — for ' || v_fname, sent_qty = v_cap,
            sort_order = v_fi * 100 + v_yi, output_item_id = (f->>'fabric_item_id')::uuid
           where id = v_line;
        end if;
        update public.process_order_knit_yarns set
          sno = v_yi, yarn_item_id = (y->>'yarn_item_id')::uuid, blend_pct = (y->>'blend_pct')::numeric,
          allowance_pct = v_allow, required_kg = v_req, bag_weight_kg = v_bag, process_order_line_id = v_line,
          dc_cap_override_kg = round(nullif(y->>'dc_cap_kg', '')::numeric, 3)
         where id = v_yid;
      else
        insert into public.process_order_lines
          (process_order_id, item_id, description, sent_qty, received_qty, uom_id, rate, amount, sort_order, output_item_id)
        values
          (p_id, (y->>'yarn_item_id')::uuid, v_name || ' — for ' || v_fname, v_cap, 0, v_kg, 0, 0, v_fi * 100 + v_yi,
           (f->>'fabric_item_id')::uuid)
        returning id into v_line;
        insert into public.process_order_knit_yarns
          (knit_fabric_id, sno, yarn_item_id, blend_pct, allowance_pct, required_kg, bag_weight_kg, process_order_line_id,
           dc_cap_override_kg)
        values
          (v_fab, v_yi, (y->>'yarn_item_id')::uuid, (y->>'blend_pct')::numeric, v_allow, v_req, v_bag, v_line,
           round(nullif(y->>'dc_cap_kg', '')::numeric, 3))
        returning id into v_yid;
      end if;
      v_keep_yarn := v_keep_yarn || v_yid;
    end loop;
  end loop;

  -- REMOVED LINES: only while nothing has happened on them.
  for ey in
    select ky.*, kf.process_order_id, i.name as yarn_name
      from public.process_order_knit_yarns ky
      join public.process_order_knit_fabrics kf on kf.id = ky.knit_fabric_id
      left join public.items i on i.id = ky.yarn_item_id
     where kf.process_order_id = p_id and not (ky.id = any (v_keep_yarn))
  loop
    if exists (select 1 from public.knitting_receipt_yarns where knit_yarn_id = ey.id)
       or exists (select 1 from public.dc_line_items where process_order_line_id = ey.process_order_line_id) then
      raise exception '%: yarn has gone out or come back on this line — it cannot be removed (set its Send Qty to 0 instead)',
        coalesce(ey.yarn_name, 'A yarn') using errcode = 'P0001';
    end if;
  end loop;
  for ef in
    select kf.*, i.name as fabric_name from public.process_order_knit_fabrics kf left join public.items i on i.id = kf.fabric_item_id
     where kf.process_order_id = p_id and not (kf.id = any (v_keep_fab))
  loop
    if exists (select 1 from public.knitting_receipt_fabrics where knit_fabric_id = ef.id) then
      raise exception '%: fabric has come back on it — the line cannot be removed', coalesce(ef.fabric_name, 'A fabric')
        using errcode = 'P0001';
    end if;
  end loop;

  select array_agg(ky.process_order_line_id) into v_lines
    from public.process_order_knit_yarns ky
    join public.process_order_knit_fabrics kf on kf.id = ky.knit_fabric_id
   where kf.process_order_id = p_id and not (ky.id = any (v_keep_yarn)) and ky.process_order_line_id is not null;
  delete from public.process_order_knit_yarns ky
   using public.process_order_knit_fabrics kf
   where kf.id = ky.knit_fabric_id and kf.process_order_id = p_id and not (ky.id = any (v_keep_yarn));
  delete from public.process_order_knit_fabrics where process_order_id = p_id and not (id = any (v_keep_fab));
  if v_lines is not null then
    delete from public.process_order_lines where id = any (v_lines);
  end if;

  -- A RAISED Net Rate needs the MD again (0845). An unchanged or lowered rate saves freely.
  if v_rate_up and public.knitting_rate_needs_approval(p_id) then
    raise exception 'A Net Rate on % is now above the approved budget — after issue it cannot be raised without the MD. Keep the rate, or cancel and raise a new order',
      coalesce(o.code, 'this order') using errcode = 'P0001';
  end if;

  update public.process_orders set total_amount = round(v_total, 2),
         gst_rate_pct = nullif(p->>'gst_rate_pct', '')::numeric,
         is_by_vendor = v_own
   where id = p_id;
  return p_id;
end;
$function$;

revoke all on function public.knitting_order_save_issued(uuid, jsonb) from public, anon, authenticated;

-- 2. knitting_order_save — live body, patched: past draft goes to the in-place save ------------
do $patch$
declare
  v_def  text := pg_get_functiondef('public.knitting_order_save(uuid,jsonb)'::regprocedure);
  v_old  text := E'    if v_row.status <> ''draft'' then\n      raise exception ''Only a draft knitting order can be changed — this one is already issued'' using errcode = ''P0001'';\n    end if;';
  v_new  text := E'    if v_row.status <> ''draft'' then\n      -- 0849: past draft, the lines are updated in place (DCs and receipts point at them).\n      return public.knitting_order_save_issued(v_id, p);\n    end if;';
  v_n    integer;
begin
  v_def := replace(v_def, E'\r\n', E'\n');
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception '0849: knitting_order_save — the "Only a draft" refusal was found % times, expected once', v_n;
  end if;
  execute replace(v_def, v_old, v_new);
end
$patch$;

-- 3. knitting_order_delete — live body (0843) with the reversal prelude ------------------------
create or replace function public.knitting_order_delete(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o record;
  r record;
  v_dcs uuid[];
  v_dc uuid;
  v_grns uuid[];
begin
  if not public.has_permission('stores', 'delete') then
    raise exception 'You do not have permission to delete a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(o.location_id) then
    raise exception 'A knitting order is deleted in its own unit — switch unit in the top bar' using errcode = '42501';
  end if;

  -- 0849: yarn moved between knitting orders at the knitter (0833) has no undo.
  if exists (select 1 from public.knitting_receipt_yarns where process_order_id = o.id and kind = 'transferred') then
    raise exception 'Yarn on % was moved to another knitting order at the knitter — that move cannot be reversed, so the order cannot be deleted',
      coalesce(o.code, 'this order') using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dc_line_items x
               join public.delivery_challans d on d.id = x.delivery_challan_id
               join public.process_order_lines pol on pol.id = x.process_order_line_id
              where pol.process_order_id = o.id and d.knit_transfer_from is not null and d.status <> 'cancelled') then
    raise exception '% holds yarn moved to it from another knitting order — that move cannot be reversed, so the order cannot be deleted',
      coalesce(o.code, 'This order') using errcode = 'P0001';
  end if;

  -- 0849 step 1: a CLOSE is reversed — the write-off's stock back, its rows and DC shortage gone.
  if o.status in ('closed', 'received') or coalesce(o.close_pending, false) then
    for r in
      select * from public.stock_ledger
       where reference_type = 'process_order' and reference_id = o.id
         and movement_type = 'adjust_out' and note like 'Knitting loss written off%'
    loop
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id,
         note, lot_no, garment_order_id, iwo_id)
      values (r.store_id, r.bin_id, r.item_id, 'adjust_in', r.quantity, current_date, r.location_id, 'process_order', o.id,
              'Knitting order ' || coalesce(o.code, '') || ' deleted — write-off reversed', r.lot_no, r.garment_order_id, r.iwo_id);
    end loop;
    for r in
      select dc_line_id, sum(qty_kg) as q from public.knitting_receipt_yarns
       where process_order_id = o.id and kind = 'written_off' and receipt_id is null and dc_line_id is not null
       group by 1
    loop
      update public.dc_line_items
         set shortage_qty = greatest(coalesce(shortage_qty, 0) - r.q, 0),
             shortage_reason = case when coalesce(shortage_qty, 0) - r.q > 0.0005 then shortage_reason end
       where id = r.dc_line_id;
    end loop;
    delete from public.knitting_receipt_yarns where process_order_id = o.id and kind = 'written_off' and receipt_id is null;
    update public.delivery_challans dc
       set status = case
             when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                               and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) > 0.0005) then 'issued'
             when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                               and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) < x.sent_qty - 0.0005) then 'closed'
             else 'partially_returned' end
     where dc.id in (select x.delivery_challan_id from public.dc_line_items x
                       join public.process_order_lines pol on pol.id = x.process_order_line_id
                      where pol.process_order_id = o.id)
       and dc.status in ('issued', 'partially_returned', 'closed');
    update public.process_orders
       set status = case when exists (select 1 from public.knitting_receipts k where k.process_order_id = o.id)
                         then 'partially_received' else 'in_process' end,
           close_pending = false
     where id = o.id;
  end if;

  -- 0849 step 2: every Fabric Receipt / Yarn Return, newest first (0839 reverses each whole).
  select array_agg(distinct grn_id) filter (where grn_id is not null) into v_grns
    from public.knitting_receipts where process_order_id = o.id;
  for r in select id from public.knitting_receipts where process_order_id = o.id order by created_at desc loop
    perform public.knitting_receipt_delete(r.id);
  end loop;
  if v_grns is not null then
    delete from public.knitting_grns g
     where g.id = any (v_grns) and not exists (select 1 from public.knitting_receipts k where k.grn_id = g.id);
  end if;
  select * into o from public.process_orders where id = p_order_id;

  -- 0843: yarn at the knitter, nothing back — undo each sent DC first (yarn back to its bin).
  if o.status in ('in_process', 'partially_received') then
    for v_dc in
      select distinct x.delivery_challan_id
        from public.dc_line_items x
        join public.process_order_lines pol on pol.id = x.process_order_line_id
        join public.delivery_challans d on d.id = x.delivery_challan_id
       where pol.process_order_id = o.id and d.status = 'issued'
    loop
      perform public.knitting_dc_undo(v_dc);
    end loop;
    select * into o from public.process_orders where id = p_order_id;
  end if;

  select array_agg(distinct x.delivery_challan_id) into v_dcs
    from public.dc_line_items x join public.process_order_lines pol on pol.id = x.process_order_line_id
   where pol.process_order_id = o.id;
  if v_dcs is not null then
    if exists (select 1 from public.delivery_challans where id = any (v_dcs) and status not in ('draft', 'cancelled')) then
      raise exception 'A yarn DC on % could not be taken back — undo it from the order first', coalesce(o.code, 'this order') using errcode = 'P0001';
    end if;
    if exists (select 1 from public.dc_line_items x
                where x.delivery_challan_id = any (v_dcs)
                  and (x.process_order_line_id is null
                       or x.process_order_line_id not in (select id from public.process_order_lines where process_order_id = o.id))) then
      raise exception 'A DC on % also carries another knitting order''s yarn — cancel this order instead', coalesce(o.code, 'this order')
        using errcode = 'P0001';
    end if;
    delete from public.delivery_challans where id = any (v_dcs);   -- lines cascade
  end if;

  delete from public.process_orders where id = o.id;   -- fabric and yarn lines cascade
  return o.code;
end;
$function$;

revoke all on function public.knitting_order_delete(uuid) from public, anon;
