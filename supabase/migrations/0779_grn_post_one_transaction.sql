-- 0779 · GRN Phase 3 (doc/purchase/grn-plan.md): POST A GRN IN ONE TRANSACTION, and keep
-- stock per bin.
--
-- WHY. `postGrn` (lib/purchase/grn-actions.ts) set the GRN to `posted` FIRST, then added
-- the received qty to the PO lines, then re-derived each PO's status, then booked stock,
-- then raised the draft bill — each a separate request, the last two in `try {} catch {}`
-- blocks that swallowed every error. So a GRN could read Posted with no stock booked and
-- no bill, and nothing anywhere said so. `grn_post()` does all of it in ONE statement:
-- any step that fails rolls every step back, the GRN stays a draft, and the reason
-- reaches the screen.
--
-- WHAT CHANGED ON THE WAY IN:
-- * A unit with no Material (or Rejection) store now REFUSES the post with a sentence.
--   Before, those movements were dropped silently — goods counted at the gate and in no
--   store.
-- * Accepted goods go to the line's own store (picked on the GRN, 0777), else the unit's
--   Material store; rejected goods to the unit's Rejection store — as before.
-- * Every movement carries the line's BIN (`stock_ledger.bin_id`, new), and
--   `stock_bin_balances` reads stock per store · bin · item off the ledger.
--
-- SECURITY DEFINER because the poster need not hold per-store access (the old code used
-- the service-role client for the same reason) — so the function makes the two checks
-- RLS would have made: the caller may edit purchase documents, and the GRN is in the
-- unit they are working in.

alter table public.stock_ledger
  add column if not exists bin_id uuid references public.bins(id);
create index if not exists idx_stock_ledger_bin on public.stock_ledger(bin_id) where bin_id is not null;

-- Stock per store · bin · item, read off the ledger (a bin-less movement sits under a
-- null bin). security_invoker: the reader's own RLS on stock_ledger decides what counts.
create or replace view public.stock_bin_balances
with (security_invoker = true) as
select
  sl.store_id,
  sl.bin_id,
  sl.item_id,
  sl.location_id,
  sum(case when sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then sl.quantity else -sl.quantity end) as quantity,
  min(sl.txn_date) filter (where sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in')) as first_in_date,
  max(sl.txn_date) as last_movement_date
from public.stock_ledger sl
group by sl.store_id, sl.bin_id, sl.item_id, sl.location_id;

grant select on public.stock_bin_balances to authenticated;

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

  -- The status change runs the 0620 tolerance guard; it raises if a line is over and
  -- nobody authorised it, and that raise undoes this whole function.
  update public.grns set status = 'posted' where id = p_grn_id;

  select coalesce(name, code) into v_unit from public.locations where id = g.location_id;
  select id into v_mat from public.stores
   where location_id = g.location_id and store_type = 'material' and is_active order by code limit 1;
  select id into v_rej from public.stores
   where location_id = g.location_id and store_type = 'rejection' and is_active order by code limit 1;

  for l in
    select gl.*, pl.item_id as po_item_id, pl.unit_price
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
          (v_store, l.bin_id, l.po_item_id, 'receipt', l.accepted_qty, g.grn_date, l.unit_price, g.location_id, 'grn', p_grn_id, 'GRN stock-in (material)');
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
    end if;
  end loop;

  -- Each PO this GRN touched: its status (derivePoReceiptStatus, in SQL) and one draft
  -- bill for the accepted value (threeWayMatchStatus, in SQL: 1% or 0.01, whichever larger).
  for v_po in
    select p.id, p.status, p.vendor_id, p.master_vendor_id, p.currency_code, p.total_amount,
           coalesce(p.location_id, g.location_id) as location_id,
           sum(gl.accepted_qty * coalesce(pl.unit_price, 0)) as accepted_value
      from public.grn_line_items gl
      join public.po_line_items pl on pl.id = gl.po_line_item_id
      join public.purchase_orders p on p.id = pl.purchase_order_id
     where gl.grn_id = p_grn_id and coalesce(gl.accepted_qty, 0) > 0
     group by p.id
  loop
    if v_po.status in ('approved', 'partially_received', 'received') then
      update public.purchase_orders po
         set status = case
               when not exists (select 1 from public.po_line_items x
                                 where x.purchase_order_id = po.id
                                   and coalesce(x.received_qty, 0) < coalesce(x.quantity, 0)) then 'received'
               when exists (select 1 from public.po_line_items x
                             where x.purchase_order_id = po.id and coalesce(x.received_qty, 0) > 0) then 'partially_received'
               else 'approved'
             end
       where po.id = v_po.id;
    end if;

    if v_po.accepted_value > 0 then
      insert into public.payables
        (vendor_id, master_vendor_id, purchase_order_id, grn_id, currency_code, amount, tax_amount, total_amount,
         match_status, status, location_id)
      values
        (v_po.vendor_id, v_po.master_vendor_id, v_po.id, p_grn_id, v_po.currency_code, v_po.accepted_value, 0, v_po.accepted_value,
         case
           when v_po.total_amount is null then 'unmatched'
           when abs(v_po.accepted_value - v_po.total_amount) <= greatest(0.01, abs(v_po.total_amount) * 0.01) then 'matched'
           else 'exception'
         end,
         'draft', v_po.location_id);
    end if;
  end loop;
end;
$$;

revoke all on function public.grn_post(uuid) from public, anon;
grant execute on function public.grn_post(uuid) to authenticated;
