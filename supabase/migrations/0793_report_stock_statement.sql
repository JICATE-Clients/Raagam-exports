-- 0793 · STOCK STATEMENT · STOCK STATEMENT WITH VALUE (client brief 2026-11-02;
-- plan doc/reports/stock-statement-plan.md).
--
-- What is on hand NOW (or on a past date), one row per RECEIPT LAYER still holding stock, so
-- every remaining kg carries the GRN it came in on, the day it came in (its age) and that
-- GRN's own approved PO rate. `stock_lot_balances` (0790) cannot answer any of the three:
-- it groups the GRN away, dates a lot from its FIRST receipt, and nets in-value against
-- out-value at whatever rate each row carried.
--
-- FIFO, per store · item — the grain the ledger's own balance is kept at, so the layers
-- only PARTITION that balance and can never disagree with it:
--   * an inflow (receipt / return / transfer_in / adjust_in) opens a layer;
--   * an outflow first consumes layers in its OWN bin and lot (when it names them), oldest
--     first, then any layer of that store · item, oldest first;
--   * an outflow larger than everything on hand (a back-dated document) is carried as a
--     debt that the next inflow pays before it becomes a layer.
--
-- Three functions reach `authenticated`, each gated twice (reports:view inside, and the
-- caller's CURRENT unit, never a unit the screen passes — AGENTS.md "Locations"):
--   report_stock_statement(p_as_of)         quantities only — no rate, no value column
--   report_stock_statement_value(p_as_of)   + rate and value; also needs the Value report
--                                           SCREEN (permission tree, 0658), so a role can
--                                           be given the Stock Statement and not the money
--   report_stock_pending_qc()               lines held at Pending QC (0791) — not stock yet

-- ---------- the FIFO engine (unit-agnostic; never granted) ----------
create or replace function public.report_stock_layers__all_units(p_as_of date, p_location uuid)
returns table (ledger_id uuid, qty_on_hand numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  k_store uuid;
  k_item uuid;
  l_id uuid[] := '{}';
  l_bin uuid[] := '{}';
  l_lot text[] := '{}';
  l_rem numeric[] := '{}';
  v_debt numeric := 0;
  v_need numeric;
  v_take numeric;
  i int;
  pass int;
begin
  for r in
    select sl.id, sl.store_id, sl.item_id, sl.bin_id, sl.lot_no, sl.quantity,
           sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') as is_in
      from public.stock_ledger sl
     where sl.txn_date <= p_as_of
       and (p_location is null or sl.location_id = p_location)
     order by sl.store_id, sl.item_id, sl.txn_date, sl.created_at, sl.id
  loop
    if k_store is distinct from r.store_id or k_item is distinct from r.item_id then
      -- flush the finished store · item
      for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
        if l_rem[i] > 0 then
          ledger_id := l_id[i]; qty_on_hand := l_rem[i]; return next;
        end if;
      end loop;
      k_store := r.store_id; k_item := r.item_id;
      l_id := '{}'; l_bin := '{}'; l_lot := '{}'; l_rem := '{}'; v_debt := 0;
    end if;

    if r.is_in then
      v_take := least(v_debt, r.quantity);
      v_debt := v_debt - v_take;
      l_id := l_id || r.id; l_bin := l_bin || r.bin_id; l_lot := l_lot || r.lot_no;
      l_rem := l_rem || (r.quantity - v_take);
    else
      v_need := r.quantity;
      for pass in 1 .. 2 loop
        exit when v_need <= 0;
        -- pass 1 only when the outflow names a bin or a lot: its own layers first
        continue when pass = 1 and r.bin_id is null and r.lot_no is null;
        for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
          exit when v_need <= 0;
          if l_rem[i] > 0
             and (pass = 2 or ((r.bin_id is null or l_bin[i] is not distinct from r.bin_id)
                               and (r.lot_no is null or l_lot[i] is not distinct from r.lot_no))) then
            v_take := least(l_rem[i], v_need);
            l_rem[i] := l_rem[i] - v_take;
            v_need := v_need - v_take;
          end if;
        end loop;
      end loop;
      v_debt := v_debt + greatest(v_need, 0);
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(l_id, 1), 0) loop
    if l_rem[i] > 0 then
      ledger_id := l_id[i]; qty_on_hand := l_rem[i]; return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.report_stock_layers__all_units(date, uuid) from public, anon, authenticated;

-- ---------- one layer → its document, PO, group, status (never granted) ----------
-- The group CASE is the same one grn_open_po_lines() (0778) uses for the Receiving screen.
create or replace function public.report_stock_statement__all_units(p_as_of date, p_location uuid)
returns table (
  layer_id uuid, location_id uuid, unit_name text,
  store_id uuid, store_name text, store_type text, bin_id uuid, bin_code text,
  item_id uuid, item_name text, item_class_id uuid, item_class text, uom_code text,
  lot_no text, source_type text, grn_id uuid, grn_code text, in_date date, age_days int,
  po_id uuid, po_code text, vendor_id uuid, vendor_name text,
  group_kind text, order_id uuid, order_no text, customer_id uuid, customer_name text,
  stock_status text, qty_on_hand numeric, rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sl.id, sl.location_id, loc.name,
    sl.store_id, st.name, st.store_type, sl.bin_id, b.bin_code,
    sl.item_id, it.name, it.item_class_id, cls.name, u.code,
    sl.lot_no,
    case
      when sl.reference_type = 'grn' then 'grn'
      when sl.reference_type = 'opening_stock' then 'opening'
      when sl.movement_type = 'transfer_in' or sl.reference_type = 'delivery_challan' then 'transfer'
      when sl.reference_type = 'dc_receipt' then 'process_receipt'
      when sl.movement_type = 'adjust_in' then 'adjust'
      when sl.movement_type = 'return' then 'return'
      else 'other'
    end,
    g.id, g.code, sl.txn_date, (p_as_of - sl.txn_date)::int,
    po.id, po.code, coalesce(po.master_vendor_id, g.master_vendor_id), mv.name,
    case
      when pl.id is null then 'general'
      when pl.garment_order_id is not null then 're'
      when pl.iwo_id is not null and sg.id is not null then 'swo'
      when pl.iwo_id is not null then 'iwo'
      else 'general'
    end,
    coalesce(pl.garment_order_id, pl.iwo_id),
    case
      when pl.garment_order_id is not null then so.order_number
      when sg.id is not null then sg.group_code || ' · ' || w.code
      else w.code
    end,
    ga.customer_id,
    case
      when pl.garment_order_id is not null then cu.name
      when sg.id is not null then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample')
    end,
    case
      when st.store_type = 'rejection' and coalesce(gl.rejection_action, 'replace') = 'return' then 'rejected'
      when st.store_type = 'rejection' then 'replacement'
      when st.store_type = 'processing' then 'processing'
      when st.store_type = 'transit' then 'transit'
      else 'accepted'
    end,
    lay.qty_on_hand,
    coalesce(sl.rate, pl.unit_price, public.resolve_item_rate(sl.item_id, p_as_of))
  from public.report_stock_layers__all_units(p_as_of, p_location) lay
  join public.stock_ledger sl on sl.id = lay.ledger_id
  join public.stores st on st.id = sl.store_id
  left join public.locations loc on loc.id = sl.location_id
  left join public.bins b on b.id = sl.bin_id
  left join public.items it on it.id = sl.item_id
  left join public.config_lookups cls on cls.id = it.item_class_id
  left join public.uoms u on u.id = coalesce(sl.uom_id, it.uom_id)
  left join public.grns g on sl.reference_type = 'grn' and g.id = sl.reference_id
  -- the GRN line this row was posted from: same item, the rejected line for a
  -- rejection-store row, the line's own bin for a bin row
  left join lateral (
    select gl.*
      from public.grn_line_items gl
      left join public.po_line_items p2 on p2.id = gl.po_line_item_id
     where gl.grn_id = g.id
       and coalesce(gl.item_id, p2.item_id) = sl.item_id
     order by ((st.store_type = 'rejection') = (coalesce(gl.rejected_qty, 0) > 0)) desc,
              (gl.bin_id is not distinct from sl.bin_id) desc,
              gl.sort_order
     limit 1
  ) gl on true
  left join public.po_line_items pl on pl.id = gl.po_line_item_id
  left join public.purchase_orders po on po.id = pl.purchase_order_id
  left join public.master_vendors mv on mv.id = coalesce(po.master_vendor_id, g.master_vendor_id)
  left join public.garment_order_amendments ga on ga.id = pl.garment_order_id
  left join public.sales_orders so on so.id = coalesce(pl.sales_order_id, ga.sales_order_id)
  left join public.customers cu on cu.id = ga.customer_id
  left join public.internal_work_orders w on w.id = pl.iwo_id
  left join public.sample_product_groups sg on sg.accessories_iwo_id = pl.iwo_id
$$;
revoke all on function public.report_stock_statement__all_units(date, uuid) from public, anon, authenticated;

-- ---------- may the caller open this report screen? (mirror of hasPermission + 0658) ----------
-- Module mode (a reports:view grant with no screen rows) opens every report; screen mode
-- opens only the screens ticked. my_screen_permissions() already resolves which mode applies.
create or replace function public.can_view_report_screen(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin(auth.uid()) or exists (
    select 1 from public.my_screen_permissions() m
     where (m.kind = 'module' and m.key = 'reports:view')
        or (m.kind = 'screen' and m.key = p_key || '|view')
  );
$$;
revoke all on function public.can_view_report_screen(text) from public, anon;
grant execute on function public.can_view_report_screen(text) to authenticated;

-- ---------- Stock Statement: quantities, NO rate ----------
create or replace function public.report_stock_statement(p_as_of date default current_date)
returns table (
  layer_id uuid, unit_name text, store_id uuid, store_name text, store_type text, bin_code text,
  item_id uuid, item_name text, item_class_id uuid, item_class text, uom_code text,
  lot_no text, source_type text, grn_id uuid, grn_code text, in_date date, age_days int,
  po_id uuid, po_code text, vendor_id uuid, vendor_name text,
  group_kind text, order_id uuid, order_no text, customer_id uuid, customer_name text,
  stock_status text, qty_on_hand numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.current_location() is null then
    return;
  end if;
  return query
    select r.layer_id, r.unit_name, r.store_id, r.store_name, r.store_type, r.bin_code,
           r.item_id, r.item_name, r.item_class_id, r.item_class, r.uom_code,
           r.lot_no, r.source_type, r.grn_id, r.grn_code, r.in_date, r.age_days,
           r.po_id, r.po_code, r.vendor_id, r.vendor_name,
           r.group_kind, r.order_id, r.order_no, r.customer_id, r.customer_name,
           r.stock_status, r.qty_on_hand
      from public.report_stock_statement__all_units(coalesce(p_as_of, current_date), public.current_location()) r;
end;
$$;
revoke all on function public.report_stock_statement(date) from public, anon;
grant execute on function public.report_stock_statement(date) to authenticated;

-- ---------- Stock Statement with Value: + rate and value ----------
create or replace function public.report_stock_statement_value(p_as_of date default current_date)
returns table (
  layer_id uuid, unit_name text, store_id uuid, store_name text, store_type text, bin_code text,
  item_id uuid, item_name text, item_class_id uuid, item_class text, uom_code text,
  lot_no text, source_type text, grn_id uuid, grn_code text, in_date date, age_days int,
  po_id uuid, po_code text, vendor_id uuid, vendor_name text,
  group_kind text, order_id uuid, order_no text, customer_id uuid, customer_name text,
  stock_status text, qty_on_hand numeric, rate numeric, value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('reports', 'view')
     or not public.can_view_report_screen('/reports/stock-statement-value') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if public.current_location() is null then
    return;
  end if;
  return query
    select r.layer_id, r.unit_name, r.store_id, r.store_name, r.store_type, r.bin_code,
           r.item_id, r.item_name, r.item_class_id, r.item_class, r.uom_code,
           r.lot_no, r.source_type, r.grn_id, r.grn_code, r.in_date, r.age_days,
           r.po_id, r.po_code, r.vendor_id, r.vendor_name,
           r.group_kind, r.order_id, r.order_no, r.customer_id, r.customer_name,
           r.stock_status, r.qty_on_hand, r.rate, round(r.qty_on_hand * r.rate, 2)
      from public.report_stock_statement__all_units(coalesce(p_as_of, current_date), public.current_location()) r;
end;
$$;
revoke all on function public.report_stock_statement_value(date) from public, anon;
grant execute on function public.report_stock_statement_value(date) to authenticated;

-- ---------- Pending QC: delivered, not yet stock (0791) ----------
create or replace function public.report_stock_pending_qc()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v int;
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*)::int into v
    from public.grn_line_items gl
    join public.grns g on g.id = gl.grn_id
   where gl.qc_status = 'pending'
     and g.status = 'posted'
     and g.location_id = public.current_location();
  return coalesce(v, 0);
end;
$$;
revoke all on function public.report_stock_pending_qc() from public, anon;
grant execute on function public.report_stock_pending_qc() to authenticated;
