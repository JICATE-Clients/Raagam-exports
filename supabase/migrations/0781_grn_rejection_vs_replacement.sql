-- 0781 · QC Failed → Rejection OR Replacement (user 2026-10-31, doc/purchase/grn.md §2B–C).
--
-- 0780 raised ONE Rejection DC per GRN and debited EVERY rejected line, then reduced the
-- debit note as replacements arrived. The spec separates the two outright:
--   Rejection   ('return')  — Debit Note against the invoice + a REJECTION DC; the PO line
--                             is short-closed and the requirement reopens (unchanged).
--   Replacement ('replace') — a REPLACEMENT DC and NO debit note: the vendor's invoice
--                             stands and the resend (Replacement GRN, no bill) fills it.
-- So a GRN with both now raises two DCs, `vendor_returns.dc_kind` says which, and only the
-- Rejection DC carries `debit_note_id`. No GRN had been posted when this was written.

alter table public.vendor_returns
  add column if not exists dc_kind text check (dc_kind in ('rejection', 'replacement'));

update public.vendor_returns vr
   set dc_kind = case when exists (select 1 from public.vendor_return_lines x
                                    where x.vendor_return_id = vr.id and x.rejection_action = 'return')
                      then 'rejection' else 'replacement' end
 where vr.grn_id is not null and vr.dc_kind is null;

create or replace function public.grn_post(p_grn_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  l record;
  v_mat uuid;
  v_rej uuid;
  v_store uuid;
  v_po record;
  v_unit text;
  v_dn uuid;
  v_dc_rej uuid;
  v_dc_rep uuid;
  v_dc uuid;
  v_action text;
  v_dn_amount numeric := 0;
  v_first_po uuid;
  v_cur text;
  v_reasons text;
  v_replaced numeric;
  v_sort integer := 0;
begin
  select * into g from public.grns where id = p_grn_id for update;
  if not found then
    raise exception 'GRN not found' using errcode = 'P0002';
  end if;
  if not public.has_permission('materials_purchase', 'edit') then
    raise exception 'You do not have permission to post a GRN' using errcode = '42501';
  end if;
  if not public.is_current_location(g.location_id) then
    raise exception 'A GRN is posted in the unit it was received into — switch unit in the top bar first'
      using errcode = '42501';
  end if;
  if g.status <> 'draft' then
    raise exception 'This GRN is already posted' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.grn_line_items
     where grn_id = p_grn_id and coalesce(rejected_qty, 0) > 0 and coalesce(btrim(rejection_reason), '') = ''
  ) then
    raise exception 'Rejection reason is required for all lines with rejected quantity' using errcode = 'P0001';
  end if;
  if g.kind = 'replacement' and g.vendor_return_id is null then
    raise exception 'A replacement GRN names the Rejection DC it replaces' using errcode = 'P0001';
  end if;

  -- The status change runs the 0620 tolerance guard; a raise there undoes everything.
  update public.grns set status = 'posted' where id = p_grn_id;

  select coalesce(name, code) into v_unit from public.locations where id = g.location_id;
  select id into v_mat from public.stores
   where location_id = g.location_id and store_type = 'material' and is_active order by code limit 1;
  select id into v_rej from public.stores
   where location_id = g.location_id and store_type = 'rejection' and is_active order by code limit 1;

  for l in
    select gl.*, pl.item_id as po_item_id, pl.unit_price, coalesce(pl.gst_pct, 0) as gst_pct,
           pl.purchase_order_id as po_id
      from public.grn_line_items gl
      left join public.po_line_items pl on pl.id = gl.po_line_item_id
     where gl.grn_id = p_grn_id
     order by gl.sort_order
  loop
    if l.po_line_item_id is null then
      continue; -- a PO-less (FOC) line names no item yet — see grnLineInput's note
    end if;

    if coalesce(l.accepted_qty, 0) > 0 then
      update public.po_line_items
         set received_qty = coalesce(received_qty, 0) + l.accepted_qty
       where id = l.po_line_item_id;

      if l.po_item_id is not null then
        v_store := coalesce(l.store_id, v_mat);
        if v_store is null then
          raise exception '% has no Material store — set one up under Stores before posting', coalesce(v_unit, 'This unit')
            using errcode = 'P0001';
        end if;
        insert into public.stock_ledger
          (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
        values
          (v_store, l.bin_id, l.po_item_id, 'receipt', l.accepted_qty, g.grn_date, l.unit_price, g.location_id, 'grn', p_grn_id,
           case when g.kind = 'replacement' then 'Replacement GRN stock-in' else 'GRN stock-in (material)' end);
      end if;

      -- A REPLACEMENT fills its Rejection DC's "replace" line for this PO line.
      if g.kind = 'replacement' then
        update public.vendor_return_lines
           set replacement_qty = coalesce(replacement_qty, 0) + l.accepted_qty
         where vendor_return_id = g.vendor_return_id
           and po_line_item_id = l.po_line_item_id
           and coalesce(rejection_action, 'replace') = 'replace';
      end if;
    end if;

    if coalesce(l.rejected_qty, 0) > 0 and l.po_item_id is not null then
      if v_rej is null then
        raise exception '% has no Rejection store — set one up under Stores before posting a rejection', coalesce(v_unit, 'This unit')
          using errcode = 'P0001';
      end if;
      insert into public.stock_ledger
        (store_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
      values
        (v_rej, l.po_item_id, 'receipt', l.rejected_qty, g.grn_date, l.unit_price, g.location_id, 'grn', p_grn_id, 'GRN stock-in (rejection)');

      -- RETURN & RE-BUY: short-close the PO line, which reopens the requirement.
      -- (A replacement GRN's rejection is always "replace": it is still owed.)
      v_action := case when g.kind = 'replacement' then 'replace' else coalesce(l.rejection_action, 'replace') end;
      if v_action = 'return' then
        update public.po_line_items
           set closed_qty = coalesce(closed_qty, 0) + l.rejected_qty
         where id = l.po_line_item_id;
      end if;

      -- ONE DC PER CHOICE (0781): a Rejection DC for the "return" lines (with the debit
      -- note), a Replacement DC for the "replace" lines (no debit note), each created on its
      -- first line.
      if v_action = 'return' then
        if v_dc_rej is null then
          insert into public.vendor_returns (store_id, master_vendor_id, grn_id, reason, return_date, status, dc_kind)
          values (v_rej, g.master_vendor_id, p_grn_id, 'Rejected on GRN ' || coalesce(g.code, ''), g.grn_date, 'draft', 'rejection')
          returning id into v_dc_rej;
        end if;
        v_dc := v_dc_rej;
      else
        if v_dc_rep is null then
          insert into public.vendor_returns (store_id, master_vendor_id, grn_id, reason, return_date, status, notes, dc_kind)
          values (v_rej, g.master_vendor_id, p_grn_id, 'For replacement — GRN ' || coalesce(g.code, ''), g.grn_date, 'draft',
                  case when g.kind = 'replacement' then 'Failed replacement — the vendor is to send it again' end, 'replacement')
          returning id into v_dc_rep;
        end if;
        v_dc := v_dc_rep;
      end if;
      v_sort := v_sort + 1;
      insert into public.vendor_return_lines
        (vendor_return_id, item_id, return_qty, replacement_qty, sort_order, grn_line_id, po_line_item_id, rejection_action)
      values
        (v_dc, l.po_item_id, l.rejected_qty, 0, v_sort, l.id, l.po_line_item_id,
         v_action);

      -- ONLY A REJECTION IS DEBITED (0781). A replacement leaves the invoice standing: the
      -- vendor's resend fills it, so there is nothing to credit.
      if v_action = 'return' then
        v_dn_amount := v_dn_amount + round(l.rejected_qty * coalesce(l.unit_price, 0) * (1 + l.gst_pct / 100.0), 2);
        v_first_po := coalesce(v_first_po, l.po_id);
        v_reasons := concat_ws('; ', v_reasons, btrim(l.rejection_reason));
      end if;
    end if;
  end loop;

  -- THE DEBIT NOTE for a regular GRN's rejections, tied to the vendor's invoice.
  if v_dn_amount > 0 then
    select currency_code into v_cur from public.purchase_orders where id = v_first_po;
    insert into public.finance_notes
      (note_type, party_type, master_vendor_id, grn_id, purchase_order_id, currency_code, amount, note_date,
       reference, reason, status)
    values
      ('debit', 'vendor', g.master_vendor_id, p_grn_id, v_first_po, v_cur, v_dn_amount, g.grn_date,
       concat_ws(' · ', 'GRN ' || g.code, nullif('Inv ' || coalesce(g.invoice_no, ''), 'Inv '), nullif('DC ' || coalesce(g.dc_no, ''), 'DC ')),
       'Rejected on receipt: ' || coalesce(v_reasons, ''), 'draft')
    returning id into v_dn;
    update public.vendor_returns set debit_note_id = v_dn where id = v_dc_rej;
  end if;

  -- A REPLACEMENT marks its Replacement DC replaced once every line is filled. (Before
  -- 0781 it also reduced a debit note; a Replacement DC no longer carries one.)
  if g.kind = 'replacement' then
    if not exists (
      select 1 from public.vendor_return_lines
       where vendor_return_id = g.vendor_return_id
         and coalesce(rejection_action, 'replace') = 'replace'
         and coalesce(replacement_qty, 0) < return_qty
    ) then
      update public.vendor_returns set status = 'replaced'
       where id = g.vendor_return_id and status = 'returned';
    end if;
  end if;

  -- Each PO this GRN touched: its receipt status against what is still ORDERED, and — for
  -- a regular GRN only — one draft bill for the RECEIVED value (the vendor's invoice).
  for v_po in
    select p.id, p.status, p.vendor_id, p.master_vendor_id, p.currency_code, p.total_amount,
           coalesce(p.location_id, g.location_id) as location_id,
           sum(gl.received_qty * coalesce(pl.unit_price, 0)) as received_value
      from public.grn_line_items gl
      join public.po_line_items pl on pl.id = gl.po_line_item_id
      join public.purchase_orders p on p.id = pl.purchase_order_id
     where gl.grn_id = p_grn_id
     group by p.id
  loop
    if v_po.status in ('approved', 'partially_received', 'received') then
      update public.purchase_orders po
         set status = case
               when not exists (select 1 from public.po_line_items x
                                 where x.purchase_order_id = po.id
                                   and coalesce(x.received_qty, 0) < coalesce(x.quantity, 0) - coalesce(x.closed_qty, 0)) then 'received'
               when exists (select 1 from public.po_line_items x
                             where x.purchase_order_id = po.id and coalesce(x.received_qty, 0) > 0) then 'partially_received'
               else 'approved'
             end
       where po.id = v_po.id;
    end if;

    if g.kind = 'regular' and v_po.received_value > 0 then
      insert into public.payables
        (vendor_id, master_vendor_id, purchase_order_id, grn_id, bill_no, bill_date, currency_code, amount, tax_amount,
         total_amount, match_status, status, location_id)
      values
        (v_po.vendor_id, v_po.master_vendor_id, v_po.id, p_grn_id, g.invoice_no, g.invoice_date, v_po.currency_code,
         v_po.received_value, 0, v_po.received_value,
         case
           when v_po.total_amount is null then 'unmatched'
           when abs(v_po.received_value - v_po.total_amount) <= greatest(0.01, abs(v_po.total_amount) * 0.01) then 'matched'
           else 'exception'
         end,
         'draft', v_po.location_id);
    end if;
  end loop;
end;
$$;

revoke all on function public.grn_post(uuid) from public, anon;
grant execute on function public.grn_post(uuid) to authenticated;
