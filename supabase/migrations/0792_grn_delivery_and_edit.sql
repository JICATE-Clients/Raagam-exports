-- 0792 · GRN: PLACE OF DELIVERY (direct to processor) + EDIT A POSTED GRN (user 2026-11-02).
--
-- PLACE OF DELIVERY. A GRN is still received by the working unit (unit isolation); what is
-- new is WHERE the goods physically landed: our store (as before) or straight at a knitter /
-- dyer. Direct needs the processor and its open Process Order (user's choice); on post the
-- goods go into the unit's Processing store and an ISSUED Process DC is raised against that
-- order (source_grn_id), so 0786's "sent" sum and 0787's receipt both see them. A direct
-- line must be QC Passed — it is inspected at the processor, not at our gate.
--
-- EDIT A POSTED GRN (guarded, user's choice). Paper only (Invoice / DC No, dates, vehicle)
-- is a plain update — the draft bills' No / date follow. Changing quantities, lots or bins
-- UNDOES what grn_post did and runs grn_post again:
--   stock   → `adjust_out` rows mirroring the GRN's NET rows per store·bin·item·lot (the
--             balance table is kept by an INSERT trigger, so rows are never deleted);
--   PO      → received / closed qty taken back the way the post (and grn_qc_decide) put them;
--   paper   → its draft bills, draft debit note and draft Rejection / Replacement DCs go.
-- Refused, with the reason, when that cannot be undone cleanly: a replacement or direct GRN,
-- a line that closed its PO balance, a bill / debit note no longer draft, a DC already back
-- with the vendor or replaced, or stock from it already issued (the balance would go < 0).
--
-- grn_post body copied from 0791 (latest); changes are the DIRECT branches, and a line
-- decided on Stores ▸ Pending QC keeps 0791's terms when an edit re-posts it (billed at
-- its accepted value, no debit note).

alter table public.grns
  add column if not exists delivery_kind text not null default 'store',
  add column if not exists delivery_vendor_id uuid references public.master_vendors(id),
  add column if not exists process_order_id uuid references public.process_orders(id),
  add column if not exists vehicle_ref text;
alter table public.grns drop constraint if exists grns_delivery_kind_check;
alter table public.grns add constraint grns_delivery_kind_check check (delivery_kind in ('store', 'direct'));

alter table public.delivery_challans
  add column if not exists source_grn_id uuid references public.grns(id);
create index if not exists idx_delivery_challans_source_grn on public.delivery_challans(source_grn_id) where source_grn_id is not null;

comment on column public.grns.delivery_kind is 'Place of Delivery (0792): store = our unit''s store; direct = delivered straight to a processor (delivery_vendor_id, process_order_id).';
comment on column public.delivery_challans.source_grn_id is 'A Process DC raised by a direct-to-processor GRN (0792) — the goods never left our store; the supplier delivered them.';

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
  v_split numeric;
  v_bin record;
  v_owed numeric;
  v_dn_amount numeric := 0;
  v_first_po uuid;
  v_cur text;
  v_reasons text;
  v_sort integer := 0;
  v_direct boolean;
  v_proc uuid;
  v_order record;
  v_dc_proc uuid;
  v_pol uuid;
  v_ordered numeric;
  v_sent numeric;
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

  -- DIRECT TO PROCESSOR (0792): the supplier delivered straight to our knitter / dyer.
  -- The goods land in the unit's Processing store ("at vendor") and count as SENT on the
  -- knitter's Process Order through an issued Process DC raised here — so the knitting
  -- receipt (0787) consumes them exactly as if a DC had carried them out.
  v_direct := coalesce(g.delivery_kind, 'store') = 'direct';
  if v_direct then
    if g.kind <> 'regular' then
      raise exception 'A replacement is received into our store, not direct to a processor' using errcode = 'P0001';
    end if;
    if g.delivery_vendor_id is null or g.process_order_id is null then
      raise exception 'Direct to processor names the processor and its Process Order' using errcode = 'P0001';
    end if;
    select * into v_order from public.process_orders where id = g.process_order_id for update;
    if not found then
      raise exception 'The Process Order on this GRN no longer exists' using errcode = 'P0001';
    end if;
    if v_order.status not in ('issued', 'in_process', 'partially_received') then
      raise exception 'Process Order % is not open — issue it first', coalesce(v_order.code, '') using errcode = 'P0001';
    end if;
    if v_order.vendor_id is distinct from g.delivery_vendor_id then
      raise exception 'Process Order % is with a different processor', coalesce(v_order.code, '') using errcode = 'P0001';
    end if;
    if v_order.location_id is not null and v_order.location_id <> g.location_id then
      raise exception 'Process Order % belongs to another unit', coalesce(v_order.code, '') using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.grn_line_items
       where grn_id = p_grn_id and (qc_status <> 'passed' or coalesce(rejected_qty, 0) > 0)
    ) then
      raise exception 'Goods delivered straight to the processor are inspected there — every line is QC Passed'
        using errcode = 'P0001';
    end if;
    select id into v_proc from public.stores
     where location_id = g.location_id and store_type = 'processing' and is_active order by code limit 1;
    if v_proc is null then
      raise exception 'This unit has no Processing store — set one up under Stores first' using errcode = 'P0001';
    end if;
    insert into public.delivery_challans
      (vendor_id, location_id, dc_date, purpose, status, notes, dc_kind, process_order_id, process_type,
       dispatched_at, dispatched_by, stock_posted_at, source_grn_id)
    values
      (g.delivery_vendor_id, g.location_id, g.grn_date, 'Direct delivery', 'issued',
       'Delivered direct by the supplier on GRN ' || coalesce(g.code, ''), 'process', v_order.id, v_order.process_type,
       now(), auth.uid(), now(), p_grn_id)
    returning id into v_dc_proc;
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

    -- QC HOLD (0791). A Pending-QC line counts against its PO now — so the same goods
    -- cannot be received twice while they wait — but enters NO stock, NO bin, NO bill and
    -- closes nothing: `grn_qc_decide` does all of that when the inspector decides.
    if l.qc_status = 'pending' then
      update public.po_line_items
         set received_qty = coalesce(received_qty, 0) + coalesce(l.received_qty, 0)
       where id = l.po_line_item_id;
      continue;
    end if;

    if coalesce(l.accepted_qty, 0) > 0 then
      update public.po_line_items
         set received_qty = coalesce(received_qty, 0) + l.accepted_qty
       where id = l.po_line_item_id;

      if l.po_item_id is not null then
        v_store := case when v_direct then v_proc else coalesce(l.store_id, v_mat) end;
        if v_store is null then
          raise exception '% has no Material store — set one up under Stores before posting', coalesce(v_unit, 'This unit')
            using errcode = 'P0001';
        end if;
        -- SPLIT ACROSS BINS (0782): one stock row per bin, and the split must hold exactly
        -- the accepted qty. No split = the line's one bin (or none), as before.
        select coalesce(sum(qty), 0) into v_split from public.grn_line_bins where grn_line_id = l.id;
        if v_split > 0 and not v_direct then
          if round(v_split, 3) <> round(l.accepted_qty, 3) then
            raise exception '%: the bins hold %, the accepted qty is %', l.description, v_split, l.accepted_qty
              using errcode = 'P0001';
          end if;
          for v_bin in select bin_id, qty from public.grn_line_bins where grn_line_id = l.id order by sort_order loop
            insert into public.stock_ledger
              (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
            values
              (v_store, v_bin.bin_id, l.po_item_id, 'receipt', v_bin.qty, g.grn_date, l.unit_price, g.location_id, 'grn', p_grn_id,
               case when g.kind = 'replacement' then 'Replacement GRN stock-in' else 'GRN stock-in (material)' end);
          end loop;
        else
          insert into public.stock_ledger
            (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
          values
            (v_store, case when v_direct then null else l.bin_id end, l.po_item_id, 'receipt', l.accepted_qty, g.grn_date,
             l.unit_price, g.location_id, 'grn', p_grn_id,
             case when v_direct then 'GRN direct to processor (at vendor)'
                  when g.kind = 'replacement' then 'Replacement GRN stock-in' else 'GRN stock-in (material)' end);
        end if;

        -- DIRECT: the line counts as sent on the knitter's Process Order (0786's cap).
        if v_direct then
          select id, sent_qty into v_pol, v_ordered from public.process_order_lines
           where process_order_id = v_order.id and item_id = l.po_item_id order by sort_order limit 1;
          if v_pol is null then
            raise exception '%: not on Process Order %', l.description, coalesce(v_order.code, '') using errcode = 'P0001';
          end if;
          select coalesce(sum(x.sent_qty), 0) into v_sent
            from public.dc_line_items x
            join public.delivery_challans y on y.id = x.delivery_challan_id
           where x.process_order_line_id = v_pol and y.status not in ('draft', 'cancelled');
          if l.accepted_qty > coalesce(v_ordered, 0) - v_sent + 0.0005 then
            raise exception '%: only % is left to send on Process Order %', l.description,
              greatest(coalesce(v_ordered, 0) - v_sent, 0), coalesce(v_order.code, '') using errcode = 'P0001';
          end if;
          insert into public.dc_line_items
            (delivery_challan_id, item_id, description, sent_qty, uom_id, sort_order, lot_no, process_order_line_id, to_store_id)
          values
            (v_dc_proc, l.po_item_id, l.description, l.accepted_qty,
             (select uom_id from public.po_line_items where id = l.po_line_item_id), coalesce(l.sort_order, 0),
             nullif(upper(btrim(l.roll_batch_no)), ''), v_pol, v_proc);
        end if;
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
      -- Decided on Stores ▸ Pending QC (0791): never billed, so never debited — kept on re-post (0792).
      if v_action = 'return' and l.qc_decided_at is null then
        v_dn_amount := v_dn_amount + round(l.rejected_qty * coalesce(l.unit_price, 0) * (1 + l.gst_pct / 100.0), 2);
        v_first_po := coalesce(v_first_po, l.po_id);
        v_reasons := concat_ws('; ', v_reasons, btrim(l.rejection_reason));
      end if;
    end if;

    -- CLOSE THE BALANCE (0782, "vendor will not send the rest"): whatever is still open on
    -- the line after this GRN is closed short, EXCEPT qty owed back on an open Replacement
    -- DC, which the vendor still sends. Not a rejection, so the requirement does NOT reopen
    -- (po_line_rejected_qty reads closed_qty only).
    if g.kind = 'regular' and coalesce(l.close_balance, false) then
      select coalesce(sum(greatest(x.return_qty - coalesce(x.replacement_qty, 0), 0)), 0) into v_owed
        from public.vendor_return_lines x
        join public.vendor_returns vr on vr.id = x.vendor_return_id
       where x.po_line_item_id = l.po_line_item_id
         and coalesce(x.rejection_action, 'replace') = 'replace'
         and vr.status in ('draft', 'returned');
      update public.po_line_items
         set balance_closed_qty = coalesce(balance_closed_qty, 0) + greatest(
               coalesce(quantity, 0) - coalesce(closed_qty, 0) - coalesce(balance_closed_qty, 0)
               - coalesce(received_qty, 0) - v_owed, 0)
       where id = l.po_line_item_id;
    end if;
  end loop;

  if v_direct then
    update public.process_orders set status = 'in_process' where id = v_order.id and status = 'issued';
  end if;

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
           sum(case when gl.qc_status = 'pending' then 0
                    when gl.qc_decided_at is not null then gl.accepted_qty * coalesce(pl.unit_price, 0)
                    else gl.received_qty * coalesce(pl.unit_price, 0) end) as received_value
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
                                   and coalesce(x.received_qty, 0) < coalesce(x.quantity, 0) - coalesce(x.closed_qty, 0) - coalesce(x.balance_closed_qty, 0)) then 'received'
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

create or replace function public.grn_edit_posted(p_grn_id uuid, p_header jsonb, p_lines jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  l record;
  r record;
  e jsonb;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  v_h jsonb := coalesce(p_header, '{}'::jsonb);
  v_recd numeric;
  v_store uuid;
  v_items uuid[];
begin
  select * into g from public.grns where id = p_grn_id for update;
  if not found then
    raise exception 'GRN not found' using errcode = 'P0002';
  end if;
  if not public.has_permission('materials_purchase', 'edit') then
    raise exception 'You do not have permission to edit a GRN' using errcode = '42501';
  end if;
  if not public.is_current_location(g.location_id) then
    raise exception 'A GRN is edited in the unit it was received into — switch unit in the top bar first' using errcode = '42501';
  end if;
  if g.status <> 'posted' then
    raise exception 'Only a posted GRN is edited here — a draft is changed before posting' using errcode = 'P0001';
  end if;

  -- THE PAPER: always editable; the draft bills carry the vendor's invoice No / date.
  update public.grns
     set invoice_no = case when v_h ? 'invoice_no' then nullif(upper(btrim(v_h ->> 'invoice_no')), '') else invoice_no end,
         invoice_date = case when v_h ? 'invoice_date' then nullif(v_h ->> 'invoice_date', '')::date else invoice_date end,
         dc_no = case when v_h ? 'dc_no' then nullif(upper(btrim(v_h ->> 'dc_no')), '') else dc_no end,
         vehicle_ref = case when v_h ? 'vehicle_ref' then nullif(upper(btrim(v_h ->> 'vehicle_ref')), '') else vehicle_ref end
   where id = p_grn_id
  returning * into g;
  update public.payables set bill_no = g.invoice_no, bill_date = g.invoice_date
   where grn_id = p_grn_id and status = 'draft';

  if jsonb_array_length(v_lines) = 0 then
    return;
  end if;

  -- QUANTITIES, LOTS, BINS: only what can be undone cleanly.
  if g.kind <> 'regular' then
    raise exception 'A Replacement GRN''s quantities cannot be edited — it has already filled its Replacement DC' using errcode = 'P0001';
  end if;
  if coalesce(g.delivery_kind, 'store') = 'direct' then
    raise exception 'A GRN delivered direct to a processor cannot change quantities — its Process DC is already with the processor'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.grn_line_items where grn_id = p_grn_id and coalesce(close_balance, false)) then
    raise exception 'A line on this GRN closed its PO balance — that cannot be undone by an edit' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payables where grn_id = p_grn_id and status <> 'draft') then
    raise exception 'Its bill is no longer a draft in Payables — quantities are locked' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.finance_notes where grn_id = p_grn_id and status <> 'draft') then
    raise exception 'Its debit note is no longer a draft — quantities are locked' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.vendor_returns where grn_id = p_grn_id and status <> 'draft') then
    raise exception 'Its Rejection / Replacement DC has already gone back to the vendor — quantities are locked' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.vendor_return_lines x join public.vendor_returns v on v.id = x.vendor_return_id
     where v.grn_id = p_grn_id and coalesce(x.replacement_qty, 0) > 0
  ) or exists (
    select 1 from public.grns x join public.vendor_returns v on v.id = x.vendor_return_id where v.grn_id = p_grn_id
  ) then
    raise exception 'A replacement has already been received against this GRN — quantities are locked' using errcode = 'P0001';
  end if;

  select array_agg(distinct item_id) into v_items
    from public.stock_ledger where reference_type = 'grn' and reference_id = p_grn_id;

  -- 1. STOCK BACK OUT — the GRN's net rows, store·bin·item·lot, as adjust_out.
  begin
    for r in
      select store_id, bin_id, item_id, lot_no, location_id, max(rate) as rate,
             sum(case when movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then quantity else -quantity end) as q
        from public.stock_ledger
       where reference_type = 'grn' and reference_id = p_grn_id
       group by store_id, bin_id, item_id, lot_no, location_id
    loop
      if r.q > 0.0005 then
        insert into public.stock_ledger
          (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note, lot_no)
        values
          (r.store_id, r.bin_id, r.item_id, 'adjust_out', r.q, current_date, r.rate, r.location_id, 'grn', p_grn_id,
           'GRN edit — reversed for re-posting', r.lot_no);
      end if;
    end loop;
  exception when check_violation then
    raise exception 'Stock from this GRN has already been issued out — its quantities can no longer be edited'
      using errcode = 'P0001';
  end;

  -- 2. THE PO, taken back the way grn_post / grn_qc_decide put it.
  for l in select * from public.grn_line_items where grn_id = p_grn_id loop
    if l.po_line_item_id is null then
      continue;
    end if;
    update public.po_line_items
       set received_qty = greatest(coalesce(received_qty, 0)
             - case when l.qc_status = 'pending' then coalesce(l.received_qty, 0) else coalesce(l.accepted_qty, 0) end, 0),
           closed_qty = greatest(coalesce(closed_qty, 0)
             - case when l.qc_status <> 'pending' and coalesce(l.rejected_qty, 0) > 0
                         and coalesce(l.rejection_action, 'replace') = 'return' then l.rejected_qty else 0 end, 0)
     where id = l.po_line_item_id;
  end loop;

  -- 3. THE PAPER THE POST RAISED (all still draft — checked above).
  update public.vendor_returns set debit_note_id = null where grn_id = p_grn_id;
  delete from public.vendor_returns where grn_id = p_grn_id;
  delete from public.finance_notes where grn_id = p_grn_id;
  delete from public.payables where grn_id = p_grn_id;

  -- 4. THE CORRECTIONS.
  for e in select * from jsonb_array_elements(v_lines) loop
    select * into l from public.grn_line_items where id = (e ->> 'id')::uuid and grn_id = p_grn_id;
    if not found then
      raise exception 'A line is not on this GRN' using errcode = 'P0001';
    end if;
    v_recd := coalesce((e ->> 'received_qty')::numeric, l.received_qty);
    if v_recd < 0 then
      raise exception '%: received cannot be negative', l.description using errcode = 'P0001';
    end if;
    if l.qc_status <> 'pending' and v_recd < coalesce(l.rejected_qty, 0) then
      raise exception '%: received cannot be less than the % that failed QC', l.description, l.rejected_qty using errcode = 'P0001';
    end if;
    v_store := nullif(e ->> 'store_id', '')::uuid;
    if v_store is not null and not exists (select 1 from public.stores where id = v_store and location_id = g.location_id) then
      raise exception '%: pick one of this unit''s stores', l.description using errcode = 'P0001';
    end if;
    update public.grn_line_items
       set received_qty = v_recd,
           accepted_qty = case when qc_status = 'pending' then v_recd else round(v_recd - coalesce(rejected_qty, 0), 3) end,
           roll_batch_no = case when e ? 'roll_batch_no' then nullif(upper(btrim(e ->> 'roll_batch_no')), '') else roll_batch_no end,
           store_id = case when qc_status = 'pending' then null else coalesce(v_store, store_id) end,
           bin_id = case when qc_status = 'pending' or jsonb_array_length(coalesce(e -> 'bins', '[]'::jsonb)) > 0 then null
                         when e ? 'bin_id' then nullif(e ->> 'bin_id', '')::uuid else bin_id end
     where id = l.id;
    delete from public.grn_line_bins where grn_line_id = l.id;
    if l.qc_status <> 'pending' and jsonb_array_length(coalesce(e -> 'bins', '[]'::jsonb)) > 0 then
      insert into public.grn_line_bins (grn_line_id, bin_id, qty, sort_order)
      select l.id, (b ->> 'bin_id')::uuid, (b ->> 'qty')::numeric, (ord - 1)::integer
        from jsonb_array_elements(e -> 'bins') with ordinality as t(b, ord);
    end if;
  end loop;

  -- 5. POST IT AGAIN — the one set of rules, not a second copy.
  update public.grns set status = 'draft' where id = p_grn_id;
  perform public.grn_post(p_grn_id);

  -- 6. No bin left below zero by what was already issued from it.
  if exists (
    select 1 from public.stock_lot_balances b
     where b.location_id = g.location_id and b.item_id = any (v_items) and b.quantity < -0.0005
  ) then
    raise exception 'Stock from this GRN has already been issued out of a bin — its quantities can no longer be lowered'
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.grn_edit_posted(uuid, jsonb, jsonb) is
  'Edit a posted GRN (0792): paper always; quantities / lots / bins by reversing grn_post and posting again, refused when that cannot be undone cleanly.';

revoke all on function public.grn_post(uuid) from public, anon;
grant execute on function public.grn_post(uuid) to authenticated;
revoke all on function public.grn_edit_posted(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.grn_edit_posted(uuid, jsonb, jsonb) to authenticated;
