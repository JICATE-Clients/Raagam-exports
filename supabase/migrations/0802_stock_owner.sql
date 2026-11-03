-- 0802 · STOCK HAS AN OWNER — Stock Transfer phase 1 (doc/stores/stock-transfer-plan.md §1.1,
-- user 2026-11-03: "go with your recommendations on all three … begin Phase 1").
--
-- Until now a stock_ledger row said WHERE stock is (store · bin · lot, 0779 / 0790) but not
-- WHOSE it is, so "260 kg of RE-13's yarn" and "260 kg of general stock" were the same row and
-- a transfer between them had nothing to move. Each movement now carries the order it belongs
-- to, in the SAME two columns po_line_items (0737 / 0586) and opening_stocks (0801) already use:
--
--   garment_order_id  → the RE   (garment_order_amendments.id)
--   iwo_id            → the IWO, or the SWO (internal_work_orders, is_sample)
--   both null         → GENERAL STOCK (the brief's "GENSTK"). Not a fake order row.
--
-- STAMPED BY A TRIGGER, NOT BY EDITING THE POSTING FUNCTIONS — the 0790 lot pattern. Eight
-- functions write the ledger (grn_post, the DC family, department returns, opening stock …),
-- several were re-created by a parallel session today, and re-creating them here from an old
-- body would erase that work (the 0617 lesson). A caller that states an owner keeps it — Stock
-- Transfer (phase 2) will, on both legs. Otherwise the owner is read off the document:
--
--   grn                         the GRN line's PO line, for that item
--   vendor_return[_replacement] the GRN the return was raised against
--   opening_stock               the document header (0801)
--   delivery_challan            its Process Order, else the GRN it was raised from
--   dc_receipt · process_order  the Process Order: its IWO, else its sales order's RE
--
-- Anything else (department returns, general DC, material requisitions …) names no order and
-- posts as General Stock. KNOWN FLOOR: an OUTFLOW of order stock through one of those posts
-- against General, so General can read negative while the RE reads high. The balance view
-- below shows that as it is rather than hiding it; each such document gains an owner when its
-- screen learns to ask for one.
--
-- origin_ledger_id is added now and used in phase 2: a transfer_in names the receipt row it
-- came from, so FIFO keeps that receipt's GRN, first-in date and rate (plan §1.3).

-- ---------- columns ----------
alter table public.stock_ledger
  add column if not exists garment_order_id uuid references public.garment_order_amendments(id),
  add column if not exists iwo_id uuid references public.internal_work_orders(id),
  add column if not exists origin_ledger_id uuid references public.stock_ledger(id);

alter table public.stock_ledger drop constraint if exists stock_ledger_one_owner;
alter table public.stock_ledger add constraint stock_ledger_one_owner
  check (garment_order_id is null or iwo_id is null);

create index if not exists idx_stock_ledger_owner_re  on public.stock_ledger(garment_order_id) where garment_order_id is not null;
create index if not exists idx_stock_ledger_owner_iwo on public.stock_ledger(iwo_id) where iwo_id is not null;
create index if not exists idx_stock_ledger_origin    on public.stock_ledger(origin_ledger_id) where origin_ledger_id is not null;

comment on column public.stock_ledger.garment_order_id is
  'Owner: the RE this stock belongs to (0802). Null with iwo_id null = General Stock.';
comment on column public.stock_ledger.iwo_id is
  'Owner: the IWO / SWO this stock belongs to (0802). Null with garment_order_id null = General Stock.';
comment on column public.stock_ledger.origin_ledger_id is
  'transfer_in only (0802, used from phase 2): the receipt row this stock first came in on — its GRN, date and rate travel with it.';

-- ---------- one resolver: the trigger and the backfill both call it ----------
create or replace function public.stock_owner_for(p_ref_type text, p_ref_id uuid, p_item_id uuid)
returns table (garment_order_id uuid, iwo_id uuid)
language plpgsql
stable
-- DEFINER: the poster may not see the PO, process order or GRN behind the movement (grn_post
-- is itself definer for that reason). Returns two ids, nothing else.
security definer
set search_path = ''
as $$
declare
  v_re  uuid;
  v_iwo uuid;
  v_grn uuid;
  v_po  uuid;
begin
  if p_ref_id is null then
    return;
  end if;

  if p_ref_type = 'grn' then
    v_grn := p_ref_id;
  elsif p_ref_type in ('vendor_return', 'vendor_return_replacement') then
    select vr.grn_id into v_grn from public.vendor_returns vr where vr.id = p_ref_id;
  elsif p_ref_type = 'opening_stock' then
    select os.garment_order_id, os.iwo_id into v_re, v_iwo from public.opening_stocks os where os.id = p_ref_id;
  elsif p_ref_type = 'delivery_challan' then
    select dc.process_order_id, dc.source_grn_id into v_po, v_grn from public.delivery_challans dc where dc.id = p_ref_id;
  elsif p_ref_type = 'dc_receipt' then
    select r.process_order_id into v_po from public.dc_receipts r where r.id = p_ref_id;
  elsif p_ref_type = 'process_order' then
    v_po := p_ref_id;
  end if;

  if v_re is null and v_iwo is null and v_po is not null then
    select po.iwo_id,
           case when po.iwo_id is null then
             (select goa.id from public.garment_order_amendments goa
               where goa.sales_order_id = po.sales_order_id
               order by goa.created_at, goa.id limit 1)
           end
      into v_iwo, v_re
      from public.process_orders po where po.id = v_po;
  end if;

  if v_re is null and v_iwo is null and v_grn is not null then
    -- Same item twice on one GRN for two orders: the first line wins — the same floor
    -- stamp_stock_lot (0790) has, because grn_post writes one row per item, not per line.
    select pl.garment_order_id, pl.iwo_id into v_re, v_iwo
      from public.grn_line_items gl
      join public.po_line_items pl on pl.id = gl.po_line_item_id
     where gl.grn_id = v_grn
       and coalesce(gl.item_id, pl.item_id) = p_item_id
       and (pl.garment_order_id is not null or pl.iwo_id is not null)
     order by gl.sort_order
     limit 1;
  end if;

  -- One owner only (stock_ledger_one_owner): an IWO is the narrower requirement.
  if v_iwo is not null then
    v_re := null;
  end if;

  garment_order_id := v_re;
  iwo_id := v_iwo;
  return next;
end;
$$;
revoke all on function public.stock_owner_for(text, uuid, uuid) from public, anon;

create or replace function public.stamp_stock_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.garment_order_id is not null or new.iwo_id is not null or new.reference_id is null then
    return new;
  end if;
  select o.garment_order_id, o.iwo_id
    into new.garment_order_id, new.iwo_id
    from public.stock_owner_for(new.reference_type, new.reference_id, new.item_id) o;
  return new;
end;
$$;
revoke all on function public.stamp_stock_owner() from public, anon;

drop trigger if exists trg_stamp_stock_owner on public.stock_ledger;
create trigger trg_stamp_stock_owner
  before insert on public.stock_ledger
  for each row execute function public.stamp_stock_owner();

-- ---------- backfill (11 rows on the day; 9 GRN receipts, all traceable to one order) ----------
update public.stock_ledger sl
   set garment_order_id = o.garment_order_id,
       iwo_id = o.iwo_id
  from public.stock_ledger src
  cross join lateral public.stock_owner_for(src.reference_type, src.reference_id, src.item_id) o
 where sl.id = src.id
   and sl.garment_order_id is null and sl.iwo_id is null
   and (o.garment_order_id is not null or o.iwo_id is not null);

-- ---------- balance per owner (0790's shape + the owner) ----------
create or replace view public.stock_owner_balances
with (security_invoker = true) as
select
  sl.location_id,
  sl.store_id,
  sl.bin_id,
  sl.item_id,
  sl.lot_no,
  sl.garment_order_id,
  sl.iwo_id,
  sum(case when sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then sl.quantity else -sl.quantity end) as quantity,
  sum(case when sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in') then coalesce(sl.value, 0) else -coalesce(sl.value, 0) end) as value,
  min(sl.txn_date) filter (where sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in')) as first_in_date,
  max(sl.txn_date) as last_movement_date
from public.stock_ledger sl
group by sl.location_id, sl.store_id, sl.bin_id, sl.item_id, sl.lot_no, sl.garment_order_id, sl.iwo_id;

grant select on public.stock_owner_balances to authenticated;
revoke all on public.stock_owner_balances from anon;
