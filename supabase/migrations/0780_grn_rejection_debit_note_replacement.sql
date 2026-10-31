-- 0780 · GRN Phase 4 (doc/purchase/grn.md §2B–C, grn-plan.md): rejection → Debit Note +
-- Rejection DC, and the Replacement GRN.
--
-- A REJECTED QUANTITY GOES ONE OF TWO WAYS, chosen on the GRN line (`rejection_action`):
--   replace — the vendor sends it again on the SAME PO. The PO line stays open for it and
--             the requirement does NOT reopen. It arrives as a Replacement GRN.
--   return  — the PO line is short-closed by that qty (`po_line_items.closed_qty`) and the
--             requirement reopens, so a fresh PO can be raised for it.
-- Before this, EVERY posted rejection reopened the requirement (0740) while the same qty
-- also stayed open on the old PO — so it could be bought twice (grn-plan.md §1.4).
-- `po_line_rejected_qty()` — read by po_requirement_lines and the requirement cap — now
-- answers the short-closed qty, so only a "return" reopens a requirement.
--
-- MONEY. The draft bill a GRN raises is now the RECEIVED value (what the vendor invoiced:
-- accepted + rejected), and the rejected value is a DEBIT NOTE against it (with GST), so
-- bill − debit note = what was accepted. A replacement that arrives reduces the debit note
-- by what it replaced (to nothing → cancelled) and raises NO new bill: the vendor's
-- invoice already covered those goods (spec §2C "without duplicate financial entries").
--
-- PAPER. Every regular GRN with a rejection raises, on post:
--   * a Debit Note (finance_notes, draft — Finance issues it), and
--   * a Rejection DC (vendor_returns, draft — the store dispatches it on Stores ▸ Vendor
--     Returns, which issues the stock out of the Rejection store).
-- A Replacement GRN's own rejection raises a Rejection DC only — the goods go back again,
-- and the original debit note still holds whatever has not been replaced.

-- ---------- columns ----------
alter table public.grn_line_items
  add column if not exists rejection_action text not null default 'replace'
    check (rejection_action in ('replace', 'return'));

alter table public.grns
  add column if not exists kind text not null default 'regular'
    check (kind in ('regular', 'replacement')),
  add column if not exists vendor_return_id uuid references public.vendor_returns(id);

alter table public.po_line_items
  add column if not exists closed_qty numeric not null default 0;

alter table public.finance_notes
  add column if not exists master_vendor_id uuid references public.master_vendors(id),
  add column if not exists grn_id uuid references public.grns(id),
  add column if not exists purchase_order_id uuid references public.purchase_orders(id);

alter table public.vendor_returns
  add column if not exists master_vendor_id uuid references public.master_vendors(id),
  add column if not exists grn_id uuid references public.grns(id),
  add column if not exists debit_note_id uuid references public.finance_notes(id);

alter table public.vendor_return_lines
  add column if not exists grn_line_id uuid references public.grn_line_items(id),
  add column if not exists po_line_item_id uuid references public.po_line_items(id),
  add column if not exists rejection_action text
    check (rejection_action in ('replace', 'return'));

create index if not exists idx_finance_notes_grn on public.finance_notes(grn_id);
create index if not exists idx_vendor_returns_grn on public.vendor_returns(grn_id);
create index if not exists idx_vrl_po_line on public.vendor_return_lines(po_line_item_id);

-- ---------- the requirement reopens only for "return" ----------
create or replace function public.po_line_rejected_qty(p_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  -- The qty short-closed on this PO line by "Return & re-buy" rejections (0780). A
  -- "replace" rejection is still owed on the same PO, so it does not reopen anything.
  select coalesce((select closed_qty from public.po_line_items where id = p_line_id), 0)
$$;

-- ---------- tolerance counts against what is still ordered ----------
create or replace function public.grn_over_tolerance_lines__all_units(p_grn_id uuid)
returns table (po_line_item_id uuid, ordered_qty numeric, received_so_far numeric, this_grn_qty numeric, tolerance_pct numeric, allowed_qty numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select gli.po_line_item_id, sum(greatest(gli.accepted_qty, 0)) as qty
    from public.grn_line_items gli
    where gli.grn_id = p_grn_id and gli.po_line_item_id is not null
    group by gli.po_line_item_id
  )
  select pl.id,
         pl.quantity - coalesce(pl.closed_qty, 0),
         coalesce(pl.received_qty, 0),
         m.qty,
         po.over_receipt_tolerance_pct,
         round((pl.quantity - coalesce(pl.closed_qty, 0)) * (1 + po.over_receipt_tolerance_pct / 100.0), 3)
  from mine m
  join public.po_line_items pl on pl.id = m.po_line_item_id
  join public.purchase_orders po on po.id = pl.purchase_order_id
  where coalesce(pl.received_qty, 0) + m.qty
        > round((pl.quantity - coalesce(pl.closed_qty, 0)) * (1 + po.over_receipt_tolerance_pct / 100.0), 3);
$$;

-- ---------- the Receiving screen reads the still-ordered qty ----------
create or replace function public.grn_open_po_lines()
returns table (
  id uuid, purchase_order_id uuid, po_code text, po_date date, master_vendor_id uuid, vendor_name text,
  tolerance_pct numeric, item_id uuid, description text, quantity numeric, received_qty numeric,
  uom_id uuid, uom_code text, sort_order integer, delivery_date date, group_kind text, order_id uuid,
  order_no text, buyer text, item_class_id uuid, item_class text, category text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id, l.purchase_order_id, p.code, p.order_date, p.master_vendor_id, mv.name,
    coalesce(p.over_receipt_tolerance_pct, 3), l.item_id, l.description,
    -- What is still ORDERED: a "return" rejection short-closed part of the line (0780).
    greatest(coalesce(l.quantity, 0) - coalesce(l.closed_qty, 0), 0),
    coalesce(l.received_qty, 0), l.uom_id, u.code, coalesce(l.sort_order, 0),
    coalesce(l.delivery_date, p.expected_date),
    case
      when l.garment_order_id is not null then 're'
      when l.iwo_id is not null and sg.id is not null then 'swo'
      when l.iwo_id is not null then 'iwo'
      else 'general'
    end,
    coalesce(l.garment_order_id, l.iwo_id),
    case
      when l.garment_order_id is not null then so.order_number
      when sg.id is not null then sg.group_code || ' · ' || w.code
      else w.code
    end,
    case
      when l.garment_order_id is not null then cu.name
      when sg.id is not null then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample')
      else null
    end,
    i.item_class_id,
    coalesce(cls.name, nullif(l.item_class, '')),
    coalesce(cat.name, nullif(l.category, ''))
  from public.po_line_items l
  join public.purchase_orders p on p.id = l.purchase_order_id
  left join public.master_vendors mv on mv.id = p.master_vendor_id
  left join public.uoms u on u.id = l.uom_id
  left join public.items i on i.id = l.item_id
  left join public.config_lookups cls on cls.id = i.item_class_id
  left join public.categories cat on cat.id = i.category_id
  left join public.garment_order_amendments g on g.id = l.garment_order_id
  left join public.sales_orders so on so.id = coalesce(l.sales_order_id, g.sales_order_id)
  left join public.customers cu on cu.id = g.customer_id
  left join public.internal_work_orders w on w.id = l.iwo_id
  left join public.sample_product_groups sg on sg.accessories_iwo_id = l.iwo_id
  where p.status in ('approved', 'partially_received')
  order by p.created_at, l.sort_order
$$;

-- ---------- post ----------
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
  v_dc uuid;
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
      if g.kind = 'regular' and l.rejection_action = 'return' then
        update public.po_line_items
           set closed_qty = coalesce(closed_qty, 0) + l.rejected_qty
         where id = l.po_line_item_id;
      end if;

      -- The Rejection DC — one per GRN, created on the first rejected line.
      if v_dc is null then
        insert into public.vendor_returns (store_id, master_vendor_id, grn_id, reason, return_date, status, notes)
        values (v_rej, g.master_vendor_id, p_grn_id, 'Rejected on GRN ' || coalesce(g.code, ''), g.grn_date, 'draft',
                case when g.kind = 'replacement' then 'Rejected replacement — still owed on the original Rejection DC' end)
        returning id into v_dc;
      end if;
      v_sort := v_sort + 1;
      insert into public.vendor_return_lines
        (vendor_return_id, item_id, return_qty, replacement_qty, sort_order, grn_line_id, po_line_item_id, rejection_action)
      values
        (v_dc, l.po_item_id, l.rejected_qty, 0, v_sort, l.id, l.po_line_item_id,
         case when g.kind = 'replacement' then 'replace' else l.rejection_action end);

      if g.kind = 'regular' then
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
    update public.vendor_returns set debit_note_id = v_dn where id = v_dc;
  end if;

  -- A REPLACEMENT reduces the original debit note by what it replaced (to nothing →
  -- cancelled), and marks its Rejection DC replaced once every "replace" line is filled.
  if g.kind = 'replacement' then
    select coalesce(sum(gl.accepted_qty * coalesce(pl.unit_price, 0) * (1 + coalesce(pl.gst_pct, 0) / 100.0)), 0)
      into v_replaced
      from public.grn_line_items gl
      join public.po_line_items pl on pl.id = gl.po_line_item_id
     where gl.grn_id = p_grn_id;
    update public.finance_notes fn
       set amount = greatest(round(fn.amount - v_replaced, 2), 0),
           status = case when round(fn.amount - v_replaced, 2) <= 0 then 'cancelled' else fn.status end,
           reason = concat_ws(' · ', fn.reason, 'Replaced on GRN ' || g.code)
      from public.vendor_returns vr
     where vr.id = g.vendor_return_id and fn.id = vr.debit_note_id;
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
revoke all on function public.grn_open_po_lines() from public, anon;
grant execute on function public.grn_open_po_lines() to authenticated;
