-- 0831 Knitting: Fabric Receipt and Yarn Return are separate documents (client 2026-11-11,
-- record-1794389607184: "maintain distinct screens for Fabric Receipts and Yarn Returns").
--
--   * knitting_receipts.kind  'fabric' | 'yarn_return' — one document is one or the other;
--     knitting_receipt_post refuses a call carrying both.
--   * Numbering: a fabric receipt keeps PRC-n (seq_dc_receipt, D4); a yarn return is KYR-n
--     on its own sequence, so the two registers number independently.
--   * Both stay tied to the Knitting Order (process_order_id), so the reconciliation
--     (knitting_order_balance, the analysis report) reads exactly as before.
-- No knitting receipt existed when this was written (0 rows), so nothing is backfilled.

alter table public.knitting_receipts
  add column if not exists kind text not null default 'fabric'
  check (kind in ('fabric', 'yarn_return'));

create sequence if not exists public.seq_knit_yarn_return;

create or replace function public.knitting_receipt_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is null or new.code = '' then
    if new.kind = 'yarn_return' then
      new.code := 'KYR-' || lpad(nextval('public.seq_knit_yarn_return')::text, 4, '0');
    else
      new.code := 'PRC-' || lpad(nextval('public.seq_dc_receipt')::text, 4, '0');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.knitting_receipt_code() from public, anon;

drop trigger if exists trg_krc_code on public.knitting_receipts;
create trigger trg_krc_code before insert on public.knitting_receipts
  for each row execute function public.knitting_receipt_code();

-- knitting_receipt_post: 0830's body, plus the kind (one document, one kind).
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
  v_kind text;
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
  -- 0831 (client 2026-11-11): a Fabric Receipt and a Yarn Return are separate documents.
  if jsonb_array_length(coalesce(p_fabrics, '[]'::jsonb)) > 0 and jsonb_array_length(coalesce(p_returns, '[]'::jsonb)) > 0 then
    raise exception 'A fabric receipt and a yarn return are posted separately — post the fabric first, then the return' using errcode = 'P0001';
  end if;
  v_kind := case when jsonb_array_length(coalesce(p_fabrics, '[]'::jsonb)) > 0 then 'fabric' else 'yarn_return' end;
  select id into v_proc from public.stores
   where location_id = o.location_id and store_type = 'processing' and is_active order by code limit 1;
  if v_proc is null then
    raise exception 'This unit has no Processing store' using errcode = 'P0001';
  end if;
  select x.garment_order_id, x.iwo_id into v_re, v_iwo from public.stock_owner_for('process_order', o.id, null) x;

  insert into public.knitting_receipts (kind, process_order_id, location_id, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes)
  values (v_kind, o.id, o.location_id, v_date, nullif(upper(btrim(coalesce(p_header->>'vendor_dc_no', ''))), ''),
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
