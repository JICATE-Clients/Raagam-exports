-- 0791 · GRN PENDING QC — held out of stock until an inspector decides (user 2026-11-02).
--
-- "Pending QC" = delivered at the gate, not yet inspected. Before this, grn_post treated a
-- Pending line exactly like a Passed one: stock into the bin, a bill, done. Now:
--
--   grn_post        a Pending line counts against its PO (received_qty), and nothing else —
--                   no stock, no bin, no bill, no close-balance. Every other line posts as
--                   before. Body copied from 0782 (the latest definition); the only changes
--                   are the QC HOLD branch and the bill's received_value skipping Pending.
--   grn_qc_decide   the inspector's decision on ONE held line (Stores ▸ Pending QC):
--                   Passed qty → the store and bin(s) chosen THERE (user: bin is chosen on
--                   the QC screen), a draft bill for the ACCEPTED value only (user: billed
--                   at QC Passed, failed qty never billed). Failed qty → comes back off the
--                   PO, into the Rejection store, onto a Rejection DC (return: the PO line
--                   closes it) or a Replacement DC (the vendor resends) — the same two
--                   routes grn_post gives a failure at the gate. No debit note: what was
--                   never billed is not debited.
--
-- One transaction each; a refusal leaves everything as it was.

alter table public.grn_line_items
  add column if not exists qc_decided_at timestamptz,
  add column if not exists qc_decided_by uuid references public.profiles(id);

comment on column public.grn_line_items.qc_decided_at is
  'When a Pending-QC line was decided on Stores ▸ Pending QC (0791). Null = decided at the gate, or still pending.';

create index if not exists idx_grn_line_items_qc_pending on public.grn_line_items(grn_id) where qc_status = 'pending';

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
        v_store := coalesce(l.store_id, v_mat);
        if v_store is null then
          raise exception '% has no Material store — set one up under Stores before posting', coalesce(v_unit, 'This unit')
            using errcode = 'P0001';
        end if;
        -- SPLIT ACROSS BINS (0782): one stock row per bin, and the split must hold exactly
        -- the accepted qty. No split = the line's one bin (or none), as before.
        select coalesce(sum(qty), 0) into v_split from public.grn_line_bins where grn_line_id = l.id;
        if v_split > 0 then
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
            (v_store, l.bin_id, l.po_item_id, 'receipt', l.accepted_qty, g.grn_date, l.unit_price, g.location_id, 'grn', p_grn_id,
             case when g.kind = 'replacement' then 'Replacement GRN stock-in' else 'GRN stock-in (material)' end);
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
      if v_action = 'return' then
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
           sum(case when gl.qc_status = 'pending' then 0 else gl.received_qty * coalesce(pl.unit_price, 0) end) as received_value
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


create or replace function public.grn_qc_decide(
  p_line_id uuid,
  p_failed numeric,
  p_reason text,
  p_action text,
  p_store_id uuid,
  p_bin_id uuid,
  p_bins jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  l record;
  g record;
  pl record;
  v_failed numeric := coalesce(p_failed, 0);
  v_acc numeric;
  v_action text;
  v_store uuid;
  v_rej uuid;
  v_unit text;
  v_split numeric := 0;
  v_bins jsonb := coalesce(p_bins, '[]'::jsonb);
  v_bin record;
  v_dc uuid;
  v_sort integer;
  v_owed numeric;
  v_value numeric;
begin
  select * into l from public.grn_line_items where id = p_line_id for update;
  if not found then
    raise exception 'GRN line not found' using errcode = 'P0002';
  end if;
  select * into g from public.grns where id = l.grn_id;
  if not (public.has_permission('stores', 'edit') or public.has_permission('materials_purchase', 'edit')) then
    raise exception 'You do not have permission to decide QC' using errcode = '42501';
  end if;
  if not public.is_current_location(g.location_id) then
    raise exception 'QC is decided in the unit the goods were received into — switch unit in the top bar first'
      using errcode = '42501';
  end if;
  if g.status <> 'posted' then
    raise exception 'QC is decided on a posted GRN' using errcode = 'P0001';
  end if;
  if l.qc_status <> 'pending' then
    raise exception 'This line''s QC is already decided' using errcode = 'P0001';
  end if;
  if v_failed < 0 or v_failed > coalesce(l.received_qty, 0) + 1e-9 then
    raise exception 'Failed qty must be between 0 and the % received', l.received_qty using errcode = 'P0001';
  end if;
  if v_failed > 0 and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required for the failed qty' using errcode = 'P0001';
  end if;
  v_action := case when g.kind = 'replacement' then 'replace' else coalesce(nullif(p_action, ''), 'replace') end;
  if v_action not in ('replace', 'return') then
    raise exception 'Failed goods go back for Rejection or Replacement' using errcode = 'P0001';
  end if;
  v_acc := round(coalesce(l.received_qty, 0) - v_failed, 3);

  select p.item_id, p.unit_price, coalesce(p.gst_pct, 0) as gst_pct, p.purchase_order_id
    into pl from public.po_line_items p where p.id = l.po_line_item_id;

  select coalesce(name, code) into v_unit from public.locations where id = g.location_id;

  -- The line, as decided.
  update public.grn_line_items
     set rejected_qty = v_failed,
         accepted_qty = v_acc,
         qc_status = case when v_failed = 0 then 'passed' when v_acc = 0 then 'failed' else 'partial' end,
         rejection_reason = case when v_failed > 0 then btrim(p_reason) end,
         rejection_action = case when v_failed > 0 then v_action end,
         store_id = coalesce(p_store_id, store_id),
         bin_id = case when jsonb_array_length(v_bins) > 0 then null else p_bin_id end,
         qc_decided_at = now(),
         qc_decided_by = auth.uid()
   where id = l.id;

  -- PASSED: into the store and bin(s) chosen on the QC screen.
  if v_acc > 0 and pl.item_id is not null then
    v_store := coalesce(p_store_id, l.store_id, (
      select id from public.stores
       where location_id = g.location_id and store_type = 'material' and is_active order by code limit 1));
    if v_store is null then
      raise exception '% has no Material store — set one up under Stores first', coalesce(v_unit, 'This unit')
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.stores where id = v_store and location_id = g.location_id) then
      raise exception 'Pick one of this unit''s stores' using errcode = 'P0001';
    end if;
    delete from public.grn_line_bins where grn_line_id = l.id;
    if jsonb_array_length(v_bins) > 0 then
      insert into public.grn_line_bins (grn_line_id, bin_id, qty, sort_order)
      select l.id, (e ->> 'bin_id')::uuid, (e ->> 'qty')::numeric, (ord - 1)::integer
        from jsonb_array_elements(v_bins) with ordinality as t(e, ord);
      select coalesce(sum(qty), 0) into v_split from public.grn_line_bins where grn_line_id = l.id;
      if round(v_split, 3) <> round(v_acc, 3) then
        raise exception '%: the bins hold %, the accepted qty is %', l.description, v_split, v_acc using errcode = 'P0001';
      end if;
      for v_bin in select bin_id, qty from public.grn_line_bins where grn_line_id = l.id order by sort_order loop
        insert into public.stock_ledger
          (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
        values
          (v_store, v_bin.bin_id, pl.item_id, 'receipt', v_bin.qty, current_date, pl.unit_price, g.location_id, 'grn', g.id,
           'GRN stock-in after QC');
      end loop;
    else
      insert into public.stock_ledger
        (store_id, bin_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
      values
        (v_store, p_bin_id, pl.item_id, 'receipt', v_acc, current_date, pl.unit_price, g.location_id, 'grn', g.id,
         'GRN stock-in after QC');
    end if;

    if g.kind = 'replacement' then
      update public.vendor_return_lines
         set replacement_qty = coalesce(replacement_qty, 0) + v_acc
       where vendor_return_id = g.vendor_return_id
         and po_line_item_id = l.po_line_item_id
         and coalesce(rejection_action, 'replace') = 'replace';
      if not exists (
        select 1 from public.vendor_return_lines
         where vendor_return_id = g.vendor_return_id
           and coalesce(rejection_action, 'replace') = 'replace'
           and coalesce(replacement_qty, 0) < return_qty
      ) then
        update public.vendor_returns set status = 'replaced' where id = g.vendor_return_id and status = 'returned';
      end if;
    end if;
  end if;

  -- FAILED: off the PO, into the Rejection store, onto a Rejection or Replacement DC.
  if v_failed > 0 and pl.item_id is not null then
    update public.po_line_items
       set received_qty = greatest(coalesce(received_qty, 0) - v_failed, 0),
           closed_qty = coalesce(closed_qty, 0) + case when v_action = 'return' then v_failed else 0 end
     where id = l.po_line_item_id;

    select id into v_rej from public.stores
     where location_id = g.location_id and store_type = 'rejection' and is_active order by code limit 1;
    if v_rej is null then
      raise exception '% has no Rejection store — set one up under Stores before failing goods', coalesce(v_unit, 'This unit')
        using errcode = 'P0001';
    end if;
    insert into public.stock_ledger
      (store_id, item_id, movement_type, quantity, txn_date, rate, location_id, reference_type, reference_id, note)
    values
      (v_rej, pl.item_id, 'receipt', v_failed, current_date, pl.unit_price, g.location_id, 'grn', g.id, 'GRN stock-in (QC rejection)');

    -- One open DC of each kind per GRN, as grn_post raises them.
    select id into v_dc from public.vendor_returns
     where grn_id = g.id and status = 'draft' and dc_kind = case when v_action = 'return' then 'rejection' else 'replacement' end
     order by created_at limit 1;
    if v_dc is null then
      insert into public.vendor_returns (store_id, master_vendor_id, grn_id, reason, return_date, status, notes, dc_kind)
      values (v_rej, g.master_vendor_id, g.id,
              case when v_action = 'return' then 'Rejected at QC — GRN ' else 'For replacement (QC) — GRN ' end || coalesce(g.code, ''),
              current_date, 'draft',
              case when g.kind = 'replacement' then 'Failed replacement — the vendor is to send it again' end,
              case when v_action = 'return' then 'rejection' else 'replacement' end)
      returning id into v_dc;
    end if;
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.vendor_return_lines where vendor_return_id = v_dc;
    insert into public.vendor_return_lines
      (vendor_return_id, item_id, return_qty, replacement_qty, sort_order, grn_line_id, po_line_item_id, rejection_action)
    values
      (v_dc, pl.item_id, v_failed, 0, v_sort, l.id, l.po_line_item_id, v_action);
  end if;

  -- CLOSE BALANCE, held from post until now (0782's rule).
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

  -- The PO's receipt status — a failure can move it back from Received.
  update public.purchase_orders po
     set status = case
           when not exists (select 1 from public.po_line_items x
                             where x.purchase_order_id = po.id
                               and coalesce(x.received_qty, 0) < coalesce(x.quantity, 0) - coalesce(x.closed_qty, 0) - coalesce(x.balance_closed_qty, 0)) then 'received'
           when exists (select 1 from public.po_line_items x
                         where x.purchase_order_id = po.id and coalesce(x.received_qty, 0) > 0) then 'partially_received'
           else 'approved'
         end
   where po.id = pl.purchase_order_id
     and po.status in ('approved', 'partially_received', 'received');

  -- THE BILL: the accepted value only, as a draft beside the GRN's own.
  v_value := round(v_acc * coalesce(pl.unit_price, 0), 2);
  if g.kind = 'regular' and v_value > 0 then
    insert into public.payables
      (vendor_id, master_vendor_id, purchase_order_id, grn_id, bill_no, bill_date, currency_code, amount, tax_amount,
       total_amount, match_status, status, location_id)
    select p.vendor_id, p.master_vendor_id, p.id, g.id, g.invoice_no, g.invoice_date, p.currency_code,
           v_value, 0, v_value, 'unmatched', 'draft', coalesce(p.location_id, g.location_id)
      from public.purchase_orders p where p.id = pl.purchase_order_id;
  end if;
end;
$$;

comment on function public.grn_qc_decide(uuid, numeric, text, text, uuid, uuid, jsonb) is
  'Stores ▸ Pending QC (0791): decide one held GRN line — passed qty into the chosen store/bins and billed, failed qty off the PO onto a Rejection or Replacement DC.';

revoke all on function public.grn_post(uuid) from public, anon;
grant execute on function public.grn_post(uuid) to authenticated;
revoke all on function public.grn_qc_decide(uuid, numeric, text, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.grn_qc_decide(uuid, numeric, text, text, uuid, uuid, jsonb) to authenticated;
