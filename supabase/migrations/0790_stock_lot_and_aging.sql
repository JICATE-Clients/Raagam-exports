-- 0790 · LOT ON EVERY STOCK MOVEMENT + STOCK PER STORE · BIN · ITEM · LOT WITH AGE
-- (user 2026-10-31, multi-bin rule §4: "live balances per bin — Store ▸ Bin ▸ Item ▸ Lot No ▸
-- Qty — and aging reports showing how long a lot has sat in a rack").
--
-- `stock_ledger.lot_no` is filled by ONE trigger from the document behind the movement, not
-- by editing the four posting functions (grn_post, the two Production DC steps, the two
-- Process DC steps) again:
--   reference 'grn'              → the GRN line's Lot No for that item
--   reference 'delivery_challan' → the DC line's Lot No for that item (both legs, both units)
--   reference 'dc_receipt'       → the Process DC line the receipt is against (the lot that
--                                  went out comes back under the same lot)
-- A caller that states a lot keeps it. A movement with no document lot stays null and
-- reports as "no lot".
--
-- `stock_lot_balances` reads the ledger per store · bin · item · lot: qty on hand, the first
-- day it came in, and days since — the aging. security_invoker, so the reader's own RLS on
-- the ledger (their unit, their stores) decides what counts.

alter table public.stock_ledger add column if not exists lot_no text;
create index if not exists idx_stock_ledger_lot on public.stock_ledger(item_id, lot_no) where lot_no is not null;

create or replace function public.stamp_stock_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lot_no is not null or new.reference_id is null then
    return new;
  end if;
  if new.reference_type = 'grn' then
    select nullif(btrim(gl.roll_batch_no), '') into new.lot_no
      from public.grn_line_items gl
      left join public.po_line_items pl on pl.id = gl.po_line_item_id
     where gl.grn_id = new.reference_id
       and coalesce(gl.item_id, pl.item_id) = new.item_id
       and nullif(btrim(gl.roll_batch_no), '') is not null
     order by gl.sort_order
     limit 1;
  elsif new.reference_type = 'delivery_challan' then
    select nullif(btrim(dl.lot_no), '') into new.lot_no
      from public.dc_line_items dl
     where dl.delivery_challan_id = new.reference_id
       and dl.item_id = new.item_id
       and nullif(btrim(dl.lot_no), '') is not null
     order by dl.sort_order
     limit 1;
  elsif new.reference_type = 'dc_receipt' then
    select nullif(btrim(dl.lot_no), '') into new.lot_no
      from public.dc_receipts r
      join public.dc_line_items dl on dl.delivery_challan_id = r.delivery_challan_id
     where r.id = new.reference_id
       and nullif(btrim(dl.lot_no), '') is not null
     order by (dl.item_id = new.item_id) desc, dl.sort_order
     limit 1;
  end if;
  if new.lot_no is not null then
    new.lot_no := upper(new.lot_no);
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_stock_lot() from public, anon;

drop trigger if exists trg_stamp_stock_lot on public.stock_ledger;
create trigger trg_stamp_stock_lot
  before insert on public.stock_ledger
  for each row execute function public.stamp_stock_lot();

create or replace view public.stock_lot_balances
with (security_invoker = true) as
select
  sl.location_id,
  sl.store_id,
  sl.bin_id,
  sl.item_id,
  sl.lot_no,
  sum(case when sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then sl.quantity else -sl.quantity end) as quantity,
  sum(case when sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then coalesce(sl.value, 0) else -coalesce(sl.value, 0) end) as value,
  min(sl.txn_date) filter (where sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in')) as first_in_date,
  max(sl.txn_date) as last_movement_date
from public.stock_ledger sl
group by sl.location_id, sl.store_id, sl.bin_id, sl.item_id, sl.lot_no;

grant select on public.stock_lot_balances to authenticated;
revoke all on public.stock_lot_balances from anon;
