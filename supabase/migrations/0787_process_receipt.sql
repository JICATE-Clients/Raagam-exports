-- 0787 · PROCESS RECEIPT — job work coming back (doc/stores/dc-plan.md Phase 3, user
-- 2026-10-31: allowed loss % = soft warning + the excess flagged on the draft bill).
--
-- One receipt against one Process DC. Per DC line the keeper says:
--   * what came back — the OUTPUT item (grey out, dyed back: a different item) and its qty,
--     into a store and bin of this unit;
--   * how much of what was sent it used up (input used) — loss = input used − received;
--   * or, ticking Close balance, that nothing more is coming: everything still at the vendor
--     on that line is used up, the rest counting as loss.
--
-- `process_receipt_post(dc_id, lines jsonb, header jsonb)` does it all in one transaction:
--   stock   — the input used leaves the Processing store as an ISSUE (the grey is consumed
--             by the process); the output enters the chosen store as a RECEIPT;
--   the DC  — `dc_line_items.returned_qty` += input used; status partially_returned / closed;
--   the PO  — `process_order_lines.received_qty` += received; order partially_received /
--             received once every line is sent in full and nothing is left at the vendor;
--   loss    — loss % against the order's `allowed_loss_pct`; the qty beyond it is EXCESS LOSS;
--   bill    — one draft payable = the order line's rate × input used (the process is charged
--             on what was processed), linked to the order and the receipt. Excess loss marks
--             it `exception` and says so in its notes, so it is checked before it is paid.
-- A loss past the limit never blocks the post — it is a warning and a flag (the user's rule).

create table if not exists public.dc_receipts (
  id uuid primary key default gen_random_uuid(),
  code text,
  delivery_challan_id uuid not null references public.delivery_challans(id),
  process_order_id uuid references public.process_orders(id),
  location_id uuid not null default public.current_location() references public.locations(id),
  receipt_date date not null default current_date,
  vendor_dc_no text,
  notes text,
  payable_id uuid references public.payables(id),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_dc_receipts_dc on public.dc_receipts(delivery_challan_id);
create sequence if not exists public.seq_dc_receipt;
drop trigger if exists trg_dc_receipt_code on public.dc_receipts;
create trigger trg_dc_receipt_code before insert on public.dc_receipts
  for each row execute function public.assign_code('PRC', 'public.seq_dc_receipt');

create table if not exists public.dc_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.dc_receipts(id) on delete cascade,
  dc_line_id uuid not null references public.dc_line_items(id),
  process_order_line_id uuid references public.process_order_lines(id),
  input_item_id uuid references public.items(id),
  output_item_id uuid references public.items(id),
  received_qty numeric not null default 0 check (received_qty >= 0),
  input_used_qty numeric not null default 0 check (input_used_qty >= 0),
  loss_qty numeric not null default 0,
  loss_pct numeric,
  allowed_loss_pct numeric,
  excess_loss_qty numeric not null default 0,
  close_balance boolean not null default false,
  store_id uuid references public.stores(id),
  bin_id uuid references public.bins(id),
  lot_no text,
  sort_order integer not null default 0
);
create index if not exists idx_dc_receipt_lines_receipt on public.dc_receipt_lines(receipt_id);

alter table public.payables
  add column if not exists process_order_id uuid references public.process_orders(id),
  add column if not exists dc_receipt_id uuid references public.dc_receipts(id);

-- Read-only to the screen; written only by process_receipt_post.
alter table public.dc_receipts enable row level security;
alter table public.dc_receipt_lines enable row level security;
create policy dc_receipts_read on public.dc_receipts for select to authenticated
  using ((public.has_permission('stores', 'view') or public.has_permission('materials_purchase', 'view'))
         and public.is_current_location(location_id));
create policy dc_receipt_lines_read on public.dc_receipt_lines for select to authenticated
  using ((public.has_permission('stores', 'view') or public.has_permission('materials_purchase', 'view'))
         and exists (select 1 from public.dc_receipts r where r.id = receipt_id and public.is_current_location(r.location_id)));

-- p_lines: [{ dc_line_id, output_item_id, received_qty, input_used_qty, close_balance, store_id, bin_id, lot_no }]
-- p_header: { receipt_date, vendor_dc_no, notes }
create or replace function public.process_receipt_post(p_dc_id uuid, p_lines jsonb, p_header jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  o record;
  l record;
  ol record;
  j jsonb;
  v_proc uuid;
  v_receipt uuid;
  v_left numeric;
  v_recv numeric;
  v_used numeric;
  v_loss numeric;
  v_pct numeric;
  v_excess numeric;
  v_out uuid;
  v_store uuid;
  v_bin uuid;
  v_bill numeric := 0;
  v_excess_note text;
  v_n integer := 0;
  v_pay uuid;
  v_date date := coalesce(nullif(p_header->>'receipt_date', '')::date, current_date);
begin
  select * into d from public.delivery_challans where id = p_dc_id for update;
  if not found or d.dc_kind <> 'process' then
    raise exception 'Process DC not found' using errcode = 'P0002';
  end if;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to receive job work' using errcode = '42501';
  end if;
  if not public.is_current_location(d.location_id) then
    raise exception 'Job work comes back to the unit that sent it — switch unit in the top bar' using errcode = '42501';
  end if;
  if d.status not in ('issued', 'partially_returned') then
    raise exception 'This DC is not out at a processor' using errcode = 'P0001';
  end if;
  if d.process_order_id is null then
    raise exception 'This DC has no Process Order — receive it on Purchase ▸ Delivery Challans' using errcode = 'P0001';
  end if;
  select * into o from public.process_orders where id = d.process_order_id for update;

  select id into v_proc from public.stores
   where location_id = d.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store' using errcode = 'P0001';
  end if;

  insert into public.dc_receipts (delivery_challan_id, process_order_id, location_id, receipt_date, vendor_dc_no, notes)
  values (p_dc_id, o.id, d.location_id, v_date, nullif(btrim(coalesce(p_header->>'vendor_dc_no', '')), ''),
          nullif(btrim(coalesce(p_header->>'notes', '')), ''))
  returning id into v_receipt;

  for l in select * from public.dc_line_items where delivery_challan_id = p_dc_id order by sort_order loop
    j := null;
    select e.value into j from jsonb_array_elements(p_lines) e where e.value->>'dc_line_id' = l.id::text limit 1;
    continue when j is null;
    v_left := coalesce(l.sent_qty, 0) - coalesce(l.returned_qty, 0);
    continue when v_left <= 0;
    v_recv := coalesce(nullif(j->>'received_qty', '')::numeric, 0);
    v_used := case when coalesce((j->>'close_balance')::boolean, false) then v_left
                   else coalesce(nullif(j->>'input_used_qty', '')::numeric, 0) end;
    continue when v_recv <= 0 and v_used <= 0;
    if v_used <= 0 then
      raise exception '%: say how much of what was sent this used', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    if v_used > v_left + 0.0005 then
      raise exception '%: only % is still at the processor', coalesce(l.description, 'A line'), v_left using errcode = 'P0001';
    end if;
    if v_recv < 0 then
      raise exception '%: received cannot be negative', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;
    select * into ol from public.process_order_lines where id = l.process_order_line_id;
    v_out := coalesce(nullif(j->>'output_item_id', '')::uuid, ol.output_item_id, l.item_id);
    v_store := nullif(j->>'store_id', '')::uuid;
    v_bin := nullif(j->>'bin_id', '')::uuid;
    if v_recv > 0 and (v_store is null or not exists (
      select 1 from public.stores s where s.id = v_store and s.location_id = d.location_id and s.store_type not in ('transit', 'processing'))) then
      raise exception '%: pick a store of this unit to receive into', coalesce(l.description, 'A line') using errcode = 'P0001';
    end if;

    v_loss := v_used - v_recv;
    v_pct := case when v_used > 0 then round(v_loss / v_used * 100, 2) end;
    v_excess := case when o.allowed_loss_pct is null then 0
                     else greatest(round(v_loss - v_used * o.allowed_loss_pct / 100, 3), 0) end;

    -- The input is consumed by the process, at the vendor.
    insert into public.stock_ledger
      (store_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id, note)
    values
      (v_proc, l.item_id, 'issue', v_used, v_date, d.location_id, 'dc_receipt', v_receipt,
       'Used in ' || coalesce(o.process_type, 'processing') || ' on ' || coalesce(d.code, '')
         || case when v_loss > 0 then ' (loss ' || v_loss || ')' else '' end);
    -- What came back.
    if v_recv > 0 then
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, location_id, reference_type, reference_id, note)
      values
        (v_store, v_bin, v_out, 'receipt', v_recv, v_date, d.location_id, 'dc_receipt', v_receipt,
         'Back from ' || coalesce(o.process_type, 'processing') || ' on ' || coalesce(d.code, ''));
    end if;

    insert into public.dc_receipt_lines
      (receipt_id, dc_line_id, process_order_line_id, input_item_id, output_item_id, received_qty, input_used_qty,
       loss_qty, loss_pct, allowed_loss_pct, excess_loss_qty, close_balance, store_id, bin_id, lot_no, sort_order)
    values
      (v_receipt, l.id, l.process_order_line_id, l.item_id, v_out, v_recv, v_used,
       v_loss, v_pct, o.allowed_loss_pct, v_excess, coalesce((j->>'close_balance')::boolean, false), v_store, v_bin,
       nullif(upper(btrim(coalesce(j->>'lot_no', ''))), ''), v_n);

    update public.dc_line_items set returned_qty = coalesce(returned_qty, 0) + v_used, returned_on = v_date where id = l.id;
    if l.process_order_line_id is not null then
      update public.process_order_lines set received_qty = coalesce(received_qty, 0) + v_recv where id = l.process_order_line_id;
      v_bill := v_bill + round(v_used * coalesce(ol.rate, 0), 2);
    end if;
    if v_excess > 0 then
      v_excess_note := concat_ws('; ', v_excess_note,
        coalesce(l.description, 'line') || ': loss ' || v_pct || '% vs allowed ' || o.allowed_loss_pct || '% — excess ' || v_excess);
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Enter what came back on at least one line' using errcode = 'P0001';
  end if;

  update public.delivery_challans dc
     set status = case when not exists (select 1 from public.dc_line_items x
                                         where x.delivery_challan_id = dc.id and coalesce(x.returned_qty, 0) < coalesce(x.sent_qty, 0))
                       then 'closed' else 'partially_returned' end
   where dc.id = p_dc_id;

  -- The order is RECEIVED once every line has been sent in full and nothing is still out.
  update public.process_orders po
     set status = case
           when not exists (
             select 1 from public.process_order_lines x
              where x.process_order_id = po.id
                and coalesce((select sum(y.sent_qty) from public.dc_line_items y
                                join public.delivery_challans z on z.id = y.delivery_challan_id
                               where y.process_order_line_id = x.id and z.status not in ('draft', 'cancelled')), 0) < coalesce(x.sent_qty, 0))
            and not exists (
             select 1 from public.delivery_challans z where z.process_order_id = po.id and z.status in ('issued', 'partially_returned'))
           then 'received' else 'partially_received' end
   where po.id = o.id;

  if v_bill > 0 then
    insert into public.payables
      (master_vendor_id, process_order_id, dc_receipt_id, bill_no, bill_date, currency_code, amount, tax_amount, total_amount,
       match_status, status, location_id, notes)
    values
      (o.vendor_id, o.id, v_receipt, nullif(btrim(coalesce(p_header->>'vendor_dc_no', '')), ''), v_date,
       coalesce(o.currency_code, 'INR'), v_bill, 0, v_bill,
       case when v_excess_note is null then 'matched' else 'exception' end, 'draft', d.location_id,
       'Job work ' || coalesce(o.process_type, '') || ' · ' || coalesce(o.code, '') || ' · DC ' || coalesce(d.code, '')
         || case when v_excess_note is null then '' else ' · EXCESS PROCESS LOSS — check before paying: ' || v_excess_note end)
    returning id into v_pay;
    update public.dc_receipts set payable_id = v_pay where id = v_receipt;
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.process_receipt_post(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.process_receipt_post(uuid, jsonb, jsonb) to authenticated;
