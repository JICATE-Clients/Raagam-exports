-- 0830 (was 0827 until 2026-11-11; renumbered beside 0827_delete_draft_order_without_number) · KNITTING RECEIPT, YARN RETURN AND CLOSE — Knitting Hub Phase 3
-- (doc/process/knitting-plan.md §2.4, decisions D1 and D3, user 2026-11-11).
--
-- WHY NOT 0787's PROCESS RECEIPT. That is one DC line in, one item out: grey fabric to the
-- dyer, dyed fabric back. A knitter takes SEVERAL yarns and returns ONE fabric, across
-- several DCs. So a knitting receipt is its own document, against the KNITTING ORDER:
--
--   knitting_receipts          header — knitter's DC no / date, vehicle, the draft bill
--   knitting_receipt_fabrics   per fabric: rolls, net / gross kg, received dia, store, bin, lot
--   knitting_receipt_yarns     THE ALLOCATION: which DC line each kilo of yarn came off, and
--                              whether it was USED (knitted into the fabric), RETURNED to the
--                              shelf, or WRITTEN OFF at close
--
-- `knitting_receipt_post(order, header, fabrics, returns)` — SECURITY DEFINER, all or nothing:
--   * yarn USED per yarn = fabric net kg × that yarn's blend % — never typed;
--   * it is drawn from the yarn still at the knitter on THIS order's DC lines, oldest DC
--     first, each chunk in its own lot (0826 put the lot there), as an ISSUE from the
--     unit's Processing store; `dc_line_items.returned_qty` += the chunk (0787's meaning:
--     accounted for). More yarn than is at the knitter is refused, naming the yarn;
--   * the fabric enters the chosen store and bin as a RECEIPT;
--   * returned yarn TRANSFERS from Processing back to the store and bin picked, same lot;
--   * every row carries the order's owner (RE / IWO) explicitly — `stamp_stock_owner`
--     cannot resolve a 'knitting_receipt' reference on its own;
--   * D3: one DRAFT payable = Σ fabric net kg × that fabric's rate per kg.
--
-- CLOSE (D1, user: "warn; MD approves Close"). `knitting_order_close(order, reason)`:
--   balance at knitter = Σ (sent − accounted − written off) on the order's DC lines;
--   loss % = balance ÷ yarn sent.
--   * within the order's Allowed Loss % → closed now: the balance is written off
--     (`adjust_out` from Processing, lot by lot, the reason on each DC line's
--     `shortage_qty / shortage_reason`), every DC closes, the order reads `closed`;
--   * over it, or no limit set → `close_pending`; the app starts a `knitting_close` run
--     (Managing Director, editable on Approvals ▸ Flows) and the MD's approve performs the
--     same close (`knitting_close_apply_decision`). Reject / withdraw clears the pending
--     flag; the order stays open.
-- A loss past the limit never blocks a RECEIPT — only the close waits (the 10-31 rule for
-- every process receipt, kept).

-- ---------------------------------------------------------------------------
-- 1. Documents
-- ---------------------------------------------------------------------------
-- D4: the receipt shares the Process Receipt series (PRC-…), so there is one register.
create table if not exists public.knitting_receipts (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,
  process_order_id uuid not null references public.process_orders(id),
  location_id      uuid not null references public.locations(id),
  receipt_date     date not null default current_date,
  vendor_dc_no     text,
  vendor_dc_date   date,
  vehicle_no       text,
  notes            text,
  payable_id       uuid references public.payables(id),
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now()
);
create index if not exists idx_krc_order on public.knitting_receipts(process_order_id);
drop trigger if exists trg_krc_code on public.knitting_receipts;
create trigger trg_krc_code before insert on public.knitting_receipts
  for each row execute function public.assign_code('PRC', 'public.seq_dc_receipt');

create table if not exists public.knitting_receipt_fabrics (
  id             uuid primary key default gen_random_uuid(),
  receipt_id     uuid not null references public.knitting_receipts(id) on delete cascade,
  knit_fabric_id uuid not null references public.process_order_knit_fabrics(id),
  fabric_item_id uuid not null references public.items(id),
  rolls          integer check (rolls is null or rolls >= 0),
  net_kg         numeric(14,3) not null check (net_kg > 0),
  gross_kg       numeric(14,3) check (gross_kg is null or gross_kg >= 0),
  received_dia   text,
  store_id       uuid not null references public.stores(id),
  bin_id         uuid references public.bins(id),
  lot_no         text,
  sort_order     integer not null default 0
);
create index if not exists idx_krcf_receipt on public.knitting_receipt_fabrics(receipt_id);
create index if not exists idx_krcf_fabric on public.knitting_receipt_fabrics(knit_fabric_id);

create table if not exists public.knitting_receipt_yarns (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid references public.knitting_receipts(id) on delete cascade,
  process_order_id uuid not null references public.process_orders(id),
  knit_yarn_id     uuid not null references public.process_order_knit_yarns(id),
  yarn_item_id     uuid not null references public.items(id),
  dc_line_id       uuid not null references public.dc_line_items(id),
  kind             text not null check (kind in ('used', 'returned', 'written_off')),
  qty_kg           numeric(14,3) not null check (qty_kg > 0),
  bags             integer check (bags is null or bags >= 0),
  lot_no           text,
  store_id         uuid references public.stores(id),
  bin_id           uuid references public.bins(id),
  reason           text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_krcy_receipt on public.knitting_receipt_yarns(receipt_id);
create index if not exists idx_krcy_order on public.knitting_receipt_yarns(process_order_id);
create index if not exists idx_krcy_yarn on public.knitting_receipt_yarns(knit_yarn_id);

-- The close's state on the order.
alter table public.process_orders
  add column if not exists close_pending   boolean not null default false,
  add column if not exists close_reason    text,
  add column if not exists close_loss_pct  numeric,
  add column if not exists close_remark    text;

-- READ-ONLY to the client: written only by the functions below.
alter table public.knitting_receipts enable row level security;
alter table public.knitting_receipt_fabrics enable row level security;
alter table public.knitting_receipt_yarns enable row level security;
drop policy if exists knitting_receipts_read on public.knitting_receipts;
create policy knitting_receipts_read on public.knitting_receipts for select to authenticated
  using (public.has_permission('stores', 'view') and public.is_current_location(location_id));
drop policy if exists knitting_receipt_fabrics_read on public.knitting_receipt_fabrics;
create policy knitting_receipt_fabrics_read on public.knitting_receipt_fabrics for select to authenticated
  using (public.has_permission('stores', 'view') and exists (
    select 1 from public.knitting_receipts r where r.id = receipt_id and public.is_current_location(r.location_id)));
drop policy if exists knitting_receipt_yarns_read on public.knitting_receipt_yarns;
create policy knitting_receipt_yarns_read on public.knitting_receipt_yarns for select to authenticated
  using (public.has_permission('stores', 'view') and public.lv_process_orders(process_order_id));

-- ---------------------------------------------------------------------------
-- 2. Drawing yarn off the order's DC lines (internal)
-- ---------------------------------------------------------------------------
-- Takes p_qty of one yarn row's order line from what is still at the knitter, oldest DC
-- first, marking each DC line accounted for. Returns the chunks (line, qty, lot) so the
-- caller can move the stock lot by lot. Refuses when the knitter does not hold that much.
create or replace function public.knitting_take_from_dc(p_pol uuid, p_qty numeric, p_label text)
returns table (dc_line_id uuid, qty numeric, lot_no text)
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  v_left numeric := round(p_qty, 3);
  v_have numeric;
  v_take numeric;
begin
  if v_left <= 0 then
    return;
  end if;
  select coalesce(sum(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0)), 0) into v_have
    from public.dc_line_items x
    join public.delivery_challans d on d.id = x.delivery_challan_id
   where x.process_order_line_id = p_pol and d.status in ('issued', 'partially_returned');
  if v_left > v_have + 0.0005 then
    raise exception '%: needs % kg but only % kg is at the knitter — send more yarn first, or check the fabric weight',
      p_label, v_left, round(v_have, 3) using errcode = 'P0001';
  end if;
  for l in
    select x.id, x.lot_no, x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0) as rem
      from public.dc_line_items x
      join public.delivery_challans d on d.id = x.delivery_challan_id
     where x.process_order_line_id = p_pol and d.status in ('issued', 'partially_returned')
       and x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0) > 0.0005
     order by d.dc_date, d.created_at, x.sort_order
     for update of x
  loop
    exit when v_left <= 0.0005;
    v_take := least(v_left, l.rem);
    update public.dc_line_items set returned_qty = coalesce(returned_qty, 0) + v_take, returned_on = current_date where id = l.id;
    dc_line_id := l.id; qty := round(v_take, 3); lot_no := nullif(upper(btrim(coalesce(l.lot_no, ''))), '');
    return next;
    v_left := v_left - v_take;
  end loop;
end;
$$;
revoke all on function public.knitting_take_from_dc(uuid, numeric, text) from public, anon, authenticated;

-- A DC whose every line is accounted for (used, returned or written off) reads closed.
create or replace function public.knitting_refresh_dc_status(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.delivery_challans dc
     set status = case
           when not exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                             and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) < x.sent_qty - 0.0005)
           then 'closed' else 'partially_returned' end
   where dc.process_order_id = p_order_id
     and dc.status in ('issued', 'partially_returned')
     and exists (select 1 from public.dc_line_items x where x.delivery_challan_id = dc.id
                  and coalesce(x.returned_qty, 0) + coalesce(x.shortage_qty, 0) > 0);
$$;
revoke all on function public.knitting_refresh_dc_status(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The receipt
-- ---------------------------------------------------------------------------
-- p_header:  { receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes }
-- p_fabrics: [ { knit_fabric_id, rolls, net_kg, gross_kg, received_dia, store_id, bin_id, lot_no } ]
-- p_returns: [ { knit_yarn_id, kg, bags, store_id, bin_id } ]
create or replace function public.knitting_receipt_post(p_order_id uuid, p_header jsonb, p_fabrics jsonb, p_returns jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  f jsonb;
  y record;
  c record;
  kf record;
  ky record;
  v_proc uuid;
  v_rcpt uuid;
  v_code text;
  v_date date := coalesce(nullif(p_header->>'receipt_date', '')::date, current_date);
  v_re uuid;
  v_iwo uuid;
  v_net numeric;
  v_need numeric;
  v_store uuid;
  v_bin uuid;
  v_lot text;
  v_bill numeric := 0;
  v_pay uuid;
  v_n integer := 0;
  v_kg numeric;
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to receive knitted fabric' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(o.location_id) then
    raise exception 'A knitting order is received in the unit that raised it — switch unit in the top bar' using errcode = '42501';
  end if;
  if o.status not in ('in_process', 'partially_received') then
    raise exception 'Knitting order % is %: fabric is received once yarn has gone out', coalesce(o.code, ''), o.status using errcode = 'P0001';
  end if;
  if o.close_pending then
    raise exception 'Knitting order % is waiting for the MD to approve its close — nothing more can be received', coalesce(o.code, '') using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_fabrics, '[]'::jsonb)) = 0 and jsonb_array_length(coalesce(p_returns, '[]'::jsonb)) = 0 then
    raise exception 'Enter the fabric received, or the yarn returned' using errcode = 'P0001';
  end if;
  select id into v_proc from public.stores
   where location_id = o.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store' using errcode = 'P0001';
  end if;
  select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for('process_order', o.id, null) x;

  insert into public.knitting_receipts (process_order_id, location_id, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes)
  values (o.id, o.location_id, v_date, nullif(upper(btrim(coalesce(p_header->>'vendor_dc_no', ''))), ''),
          nullif(p_header->>'vendor_dc_date', '')::date, nullif(upper(btrim(coalesce(p_header->>'vehicle_no', ''))), ''),
          nullif(upper(btrim(coalesce(p_header->>'notes', ''))), ''))
  returning id, code into v_rcpt, v_code;

  -- ---- fabric in, yarn used ----
  for f in select * from jsonb_array_elements(coalesce(p_fabrics, '[]'::jsonb)) loop
    v_net := nullif(f->>'net_kg', '')::numeric;
    if v_net is null or v_net <= 0 then
      continue;
    end if;
    select pf.*, i.name as fabric_name into kf
      from public.process_order_knit_fabrics pf join public.items i on i.id = pf.fabric_item_id
     where pf.id = nullif(f->>'knit_fabric_id', '')::uuid and pf.process_order_id = o.id;
    if kf.id is null then
      raise exception 'A fabric line is not on this knitting order' using errcode = 'P0001';
    end if;
    v_store := nullif(f->>'store_id', '')::uuid;
    if v_store is null or not exists (select 1 from public.stores s where s.id = v_store and s.location_id = o.location_id
                                       and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick a store of this unit to receive into', kf.fabric_name using errcode = 'P0001';
    end if;
    v_bin := nullif(f->>'bin_id', '')::uuid;
    if v_bin is not null and not exists (select 1 from public.bins b where b.id = v_bin and (b.store_id is null or b.store_id = v_store)) then
      raise exception '%: that bin is not in the chosen store', kf.fabric_name using errcode = 'P0001';
    end if;
    v_lot := coalesce(nullif(upper(btrim(coalesce(f->>'lot_no', ''))), ''), v_code);
    v_n := v_n + 1;

    insert into public.knitting_receipt_fabrics
      (receipt_id, knit_fabric_id, fabric_item_id, rolls, net_kg, gross_kg, received_dia, store_id, bin_id, lot_no, sort_order)
    values (v_rcpt, kf.id, kf.fabric_item_id, nullif(f->>'rolls', '')::integer, v_net, nullif(f->>'gross_kg', '')::numeric,
            nullif(upper(btrim(coalesce(f->>'received_dia', ''))), ''), v_store, v_bin, v_lot, v_n);

    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id,
       note, lot_no, garment_order_id, iwo_id)
    values (v_store, v_bin, kf.fabric_item_id, 'receipt', v_net, v_date, o.location_id, 'knitting_receipt', v_rcpt,
            'Knitted fabric from ' || coalesce(o.code, ''), v_lot, v_re, v_iwo);
    v_bill := v_bill + v_net * coalesce(kf.rate_per_kg, 0);

    for ky in select py.*, i.name as yarn_name from public.process_order_knit_yarns py join public.items i on i.id = py.yarn_item_id
               where py.knit_fabric_id = kf.id order by py.sno loop
      v_need := round(v_net * ky.blend_pct / 100, 3);
      continue when v_need <= 0;
      for c in select * from public.knitting_take_from_dc(ky.process_order_line_id, v_need, ky.yarn_name || ' for ' || kf.fabric_name) loop
        insert into public.stock_ledger
          (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id,
           note, lot_no, garment_order_id, iwo_id)
        values (v_proc, null, ky.yarn_item_id, 'issue', c.qty, v_date, o.location_id, 'knitting_receipt', v_rcpt,
                'Knitted into ' || kf.fabric_name || ' on ' || coalesce(o.code, ''), c.lot_no, v_re, v_iwo);
        insert into public.knitting_receipt_yarns (receipt_id, process_order_id, knit_yarn_id, yarn_item_id, dc_line_id, kind, qty_kg, lot_no)
        values (v_rcpt, o.id, ky.id, ky.yarn_item_id, c.dc_line_id, 'used', c.qty, c.lot_no);
      end loop;
    end loop;
  end loop;

  -- ---- yarn returned to the shelf ----
  for f in select * from jsonb_array_elements(coalesce(p_returns, '[]'::jsonb)) loop
    v_kg := nullif(f->>'kg', '')::numeric;
    continue when v_kg is null or v_kg <= 0;
    select py.*, i.name as yarn_name into ky
      from public.process_order_knit_yarns py
      join public.process_order_knit_fabrics pf on pf.id = py.knit_fabric_id
      join public.items i on i.id = py.yarn_item_id
     where py.id = nullif(f->>'knit_yarn_id', '')::uuid and pf.process_order_id = o.id;
    if ky.id is null then
      raise exception 'A returned yarn is not on this knitting order' using errcode = 'P0001';
    end if;
    v_store := nullif(f->>'store_id', '')::uuid;
    if v_store is null or not exists (select 1 from public.stores s where s.id = v_store and s.location_id = o.location_id
                                       and s.store_type not in ('transit', 'processing')) then
      raise exception '%: pick the store the returned yarn goes back to', ky.yarn_name using errcode = 'P0001';
    end if;
    v_bin := nullif(f->>'bin_id', '')::uuid;
    v_n := v_n + 1;
    for c in select * from public.knitting_take_from_dc(ky.process_order_line_id, v_kg, ky.yarn_name || ' returned') loop
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, counterparty_store_id, txn_date, location_id,
         reference_type, reference_id, note, lot_no, garment_order_id, iwo_id)
      values
        (v_proc, null, ky.yarn_item_id, 'transfer_out', c.qty, v_store, v_date, o.location_id, 'knitting_receipt', v_rcpt,
         'Yarn returned by the knitter on ' || coalesce(o.code, ''), c.lot_no, v_re, v_iwo),
        (v_store, v_bin, ky.yarn_item_id, 'transfer_in', c.qty, v_proc, v_date, o.location_id, 'knitting_receipt', v_rcpt,
         'Yarn returned by the knitter on ' || coalesce(o.code, ''), c.lot_no, v_re, v_iwo);
      insert into public.knitting_receipt_yarns
        (receipt_id, process_order_id, knit_yarn_id, yarn_item_id, dc_line_id, kind, qty_kg, bags, lot_no, store_id, bin_id)
      values (v_rcpt, o.id, ky.id, ky.yarn_item_id, c.dc_line_id, 'returned', c.qty, nullif(f->>'bags', '')::integer, c.lot_no, v_store, v_bin);
    end loop;
  end loop;

  if v_n = 0 then
    raise exception 'Enter the fabric received, or the yarn returned' using errcode = 'P0001';
  end if;

  perform public.knitting_refresh_dc_status(o.id);
  update public.process_orders set status = 'partially_received' where id = o.id and status = 'in_process';

  -- D3: the knitter is paid on the fabric delivered.
  if v_bill > 0 then
    insert into public.payables
      (master_vendor_id, process_order_id, bill_no, bill_date, currency_code, amount, tax_amount, total_amount,
       match_status, status, location_id, notes)
    values
      (o.vendor_id, o.id, nullif(upper(btrim(coalesce(p_header->>'vendor_dc_no', ''))), ''), v_date,
       coalesce(o.currency_code, 'INR'), round(v_bill, 2), 0, round(v_bill, 2), 'matched', 'draft', o.location_id,
       'Knitting ' || coalesce(o.code, '') || ' · receipt ' || coalesce(v_code, '') || ' · fabric kg × rate')
    returning id into v_pay;
    update public.knitting_receipts set payable_id = v_pay where id = v_rcpt;
  end if;

  return v_rcpt;
end;
$$;
revoke all on function public.knitting_receipt_post(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.knitting_receipt_post(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The close
-- ---------------------------------------------------------------------------
-- What the knitter still holds, as a fraction of what was sent.
create or replace function public.knitting_order_balance(p_order_id uuid)
returns table (issued_kg numeric, balance_kg numeric, loss_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(x.sent_qty), 0),
         coalesce(sum(greatest(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0), 0)), 0),
         case when coalesce(sum(x.sent_qty), 0) > 0
              then round(coalesce(sum(greatest(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0), 0)), 0)
                         / sum(x.sent_qty) * 100, 3) end
    from public.dc_line_items x
    join public.delivery_challans d on d.id = x.delivery_challan_id
   where d.process_order_id = p_order_id and d.status not in ('draft', 'cancelled');
$$;
revoke all on function public.knitting_order_balance(uuid) from public, anon;
grant execute on function public.knitting_order_balance(uuid) to authenticated;

-- Writes off what is still at the knitter and closes. Internal: reached by an in-limit close
-- or by the MD's approve.
create or replace function public.knitting_close_write_off(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  l record;
  v_proc uuid;
  v_re uuid;
  v_iwo uuid;
  v_rem numeric;
  v_lot text;
begin
  select * into o from public.process_orders where id = p_order_id for update;
  select id into v_proc from public.stores
   where location_id = o.location_id and store_type = 'processing' and is_active order by code limit 1;
  select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for('process_order', o.id, null) x;
  for l in
    select x.*, py.id as knit_yarn_id
      from public.dc_line_items x
      join public.delivery_challans d on d.id = x.delivery_challan_id
      left join public.process_order_knit_yarns py on py.process_order_line_id = x.process_order_line_id
     where d.process_order_id = o.id and d.status in ('issued', 'partially_returned')
     for update of x
  loop
    v_rem := round(l.sent_qty - coalesce(l.returned_qty, 0) - coalesce(l.shortage_qty, 0), 3);
    continue when v_rem <= 0.0005;
    v_lot := nullif(upper(btrim(coalesce(l.lot_no, ''))), '');
    update public.dc_line_items
       set shortage_qty = coalesce(shortage_qty, 0) + v_rem, shortage_reason = p_reason
     where id = l.id;
    insert into public.stock_ledger
      (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id,
       note, lot_no, garment_order_id, iwo_id)
    values (v_proc, null, l.item_id, 'adjust_out', v_rem, current_date, o.location_id, 'process_order', o.id,
            'Knitting loss written off at close of ' || coalesce(o.code, '') || ': ' || coalesce(p_reason, ''), v_lot, v_re, v_iwo);
    if l.knit_yarn_id is not null then
      insert into public.knitting_receipt_yarns (process_order_id, knit_yarn_id, yarn_item_id, dc_line_id, kind, qty_kg, lot_no, reason)
      values (o.id, l.knit_yarn_id, l.item_id, l.id, 'written_off', v_rem, v_lot, p_reason);
    end if;
  end loop;
  update public.delivery_challans set status = 'closed'
   where process_order_id = o.id and status in ('issued', 'partially_returned');
  update public.process_orders
     set status = 'closed', close_pending = false, close_reason = p_reason
   where id = o.id;
end;
$$;
revoke all on function public.knitting_close_write_off(uuid, text) from public, anon, authenticated;

-- Returns 'closed' (done now) or 'pending' (the app starts the MD's `knitting_close` run).
create or replace function public.knitting_order_close(p_order_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  b record;
  v_reason text := nullif(upper(btrim(coalesce(p_reason, ''))), '');
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to close a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' or not public.is_current_location(o.location_id) then
    raise exception 'Knitting order not found in your unit' using errcode = 'P0002';
  end if;
  if o.status not in ('in_process', 'partially_received') then
    raise exception 'Knitting order % is %, not open to close', coalesce(o.code, ''), o.status using errcode = 'P0001';
  end if;
  if o.close_pending then
    raise exception 'The close is already with the MD' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.delivery_challans d where d.process_order_id = o.id and d.status = 'draft') then
    raise exception 'A yarn DC on this order is still a draft — dispatch or delete it first' using errcode = 'P0001';
  end if;
  select * into b from public.knitting_order_balance(o.id);
  if b.balance_kg > 0.0005 and v_reason is null then
    raise exception '% kg is still at the knitter — say why it is written off', round(b.balance_kg, 3) using errcode = 'P0001';
  end if;

  if b.balance_kg <= 0.0005 or (o.allowed_loss_pct is not null and coalesce(b.loss_pct, 0) <= o.allowed_loss_pct + 0.0005) then
    perform public.knitting_close_write_off(o.id, v_reason);
    return 'closed';
  end if;

  update public.process_orders
     set close_pending = true, close_reason = v_reason, close_loss_pct = b.loss_pct, close_remark = null
   where id = o.id;
  return 'pending';
end;
$$;
revoke all on function public.knitting_order_close(uuid, text) from public, anon;
grant execute on function public.knitting_order_close(uuid, text) to authenticated;

-- The app could not start the MD's run: undo the pending flag so the order is not stranded.
create or replace function public.knitting_order_close_withdraw(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.process_orders set close_pending = false
   where id = p_order_id and process_type = 'knitting' and close_pending
     and public.has_permission('stores', 'edit') and public.is_current_location(location_id);
$$;
revoke all on function public.knitting_order_close_withdraw(uuid) from public, anon;
grant execute on function public.knitting_order_close_withdraw(uuid) to authenticated;

create or replace function public.knitting_close_apply_decision(p_id uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
begin
  select * into o from public.process_orders where id = p_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order % not found', p_id using errcode = '55000';
  end if;
  if p_run_status in ('cancelled', 'rejected') then
    update public.process_orders set close_pending = false, close_remark = p_remark where id = p_id;
    return;
  end if;
  if p_run_status <> 'completed' then
    return;
  end if;
  if not o.close_pending then
    raise exception 'Knitting order % is not waiting for a close decision — reload it', coalesce(o.code, '') using errcode = '55000';
  end if;
  perform public.knitting_close_write_off(p_id, o.close_reason);
  update public.process_orders set close_remark = p_remark where id = p_id;
end;
$$;
revoke all on function public.knitting_close_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

-- approval_apply_terminal: one branch added to the LIVE body (the 0764 / 0785 idiom).
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''process_orders'' then\n'
                || E'        perform public.knitting_close_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('knitting_close_apply_decision' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0830: approval_apply_terminal final refusal not found — add the branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- The flow — Managing Director, catch-all, editable on Approvals ▸ Flows (0785's shape).
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'knitting_close',
       'Knitting Close — default',
       'Catch-all. A knitting order whose yarn loss is past its Allowed Loss %; the final approve writes the balance off and closes it.',
       '{}'::jsonb, f.steps, 900, true
  from public.approval_flows f
 where f.workflow_key = 'purchase_order' and f.flow_name = 'Purchase Order — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'knitting_close');
