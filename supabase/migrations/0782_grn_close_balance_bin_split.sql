-- 0782 · GRN: close a short balance, split a line across bins (user 2026-10-31).
--
-- CLOSE THE BALANCE. 49 of 50 kg arrives and the vendor will not send the last 1 kg: the
-- line's "Close balance" tick closes it on post (grn_line_items.close_balance ->
-- po_line_items.balance_closed_qty), so it stops showing as pending and the PO can read
-- Received. Kept apart from closed_qty on purpose: that one is a REJECTION short-close and
-- reopens the requirement (0780); a balance the vendor never sent does not.
-- Left unticked, the balance stays open on the PO (unchanged).
--
-- SPLIT ACROSS BINS. grn_line_bins holds a line's accepted qty bin by bin (30 kg in one,
-- 20 in another); grn_post writes one stock row per bin and refuses a split that does not
-- add up to the accepted qty. A line with no split keeps its one bin_id.

alter table public.grn_line_items
  add column if not exists close_balance boolean not null default false;
alter table public.po_line_items
  add column if not exists balance_closed_qty numeric not null default 0;

create table if not exists public.grn_line_bins (
  id uuid primary key default gen_random_uuid(),
  grn_line_id uuid not null references public.grn_line_items(id) on delete cascade,
  bin_id uuid not null references public.bins(id),
  qty numeric not null check (qty > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_grn_line_bins_line on public.grn_line_bins(grn_line_id);
create index if not exists idx_grn_line_bins_bin on public.grn_line_bins(bin_id);

-- A detail table follows its document (AGENTS.md "Locations"): the GRN's unit, via its line.
alter table public.grn_line_bins enable row level security;
create policy grn_line_bins_read on public.grn_line_bins for select to authenticated
  using (public.has_permission('materials_purchase', 'view')
         and exists (select 1 from public.grn_line_items gl where gl.id = grn_line_id and public.lv_grns(gl.grn_id)));
create policy grn_line_bins_insert on public.grn_line_bins for insert to authenticated
  with check (public.has_permission('materials_purchase', 'create')
              and exists (select 1 from public.grn_line_items gl where gl.id = grn_line_id and public.lv_grns(gl.grn_id)));
create policy grn_line_bins_update on public.grn_line_bins for update to authenticated
  using (public.has_permission('materials_purchase', 'edit')
         and exists (select 1 from public.grn_line_items gl where gl.id = grn_line_id and public.lv_grns(gl.grn_id)))
  with check (public.has_permission('materials_purchase', 'edit')
              and exists (select 1 from public.grn_line_items gl where gl.id = grn_line_id and public.lv_grns(gl.grn_id)));
create policy grn_line_bins_delete on public.grn_line_bins for delete to authenticated
  using ((public.has_permission('materials_purchase', 'edit') or public.has_permission('materials_purchase', 'delete'))
         and exists (select 1 from public.grn_line_items gl where gl.id = grn_line_id and public.lv_grns(gl.grn_id)));

-- ---------- tolerance counts against what is still ordered, net of a closed balance ----------
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
         pl.quantity - coalesce(pl.closed_qty, 0) - coalesce(pl.balance_closed_qty, 0),
         coalesce(pl.received_qty, 0),
         m.qty,
         po.over_receipt_tolerance_pct,
         round((pl.quantity - coalesce(pl.closed_qty, 0) - coalesce(pl.balance_closed_qty, 0)) * (1 + po.over_receipt_tolerance_pct / 100.0), 3)
  from mine m
  join public.po_line_items pl on pl.id = m.po_line_item_id
  join public.purchase_orders po on po.id = pl.purchase_order_id
  where coalesce(pl.received_qty, 0) + m.qty
        > round((pl.quantity - coalesce(pl.closed_qty, 0) - coalesce(pl.balance_closed_qty, 0)) * (1 + po.over_receipt_tolerance_pct / 100.0), 3);
$$;

-- ---------- the Receiving screen ----------
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
    greatest(coalesce(l.quantity, 0) - coalesce(l.closed_qty, 0) - coalesce(l.balance_closed_qty, 0), 0),
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

revoke all on function public.grn_post(uuid) from public, anon;
grant execute on function public.grn_post(uuid) to authenticated;
revoke all on function public.grn_open_po_lines() from public, anon;
grant execute on function public.grn_open_po_lines() to authenticated;
revoke all on function public.grn_over_tolerance_lines__all_units(uuid) from public, anon;
