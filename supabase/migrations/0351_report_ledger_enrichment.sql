-- ============================================================================
-- Raagam ERP — 0351 Report foundation (1/2): enrich the stock ledger
--
-- `stock_ledger` records only (store, item, movement_type, quantity). That is
-- not enough to report on: there is no value, no unit, no document date and no
-- location. Consequences today:
--   * a back-dated GRN posts at now(), so every period report is wrong;
--   * no consumption value or inventory valuation is derivable at all;
--   * location is reachable only by joining out through stores.
--
-- This migration adds those five columns as NULLABLE (nothing existing breaks),
-- backfills history, and installs a BEFORE INSERT trigger that stamps them.
-- The trigger is the point: all eight existing posting call sites keep working
-- untouched and still produce complete rows. Call sites that know the real
-- document date / rate pass them explicitly and the trigger defers to them.
-- ADD-ONLY.
-- ============================================================================

-- ---------- new columns -----------------------------------------------------
alter table public.stock_ledger
  add column if not exists txn_date    date,
  add column if not exists uom_id      uuid references public.uoms(id),
  add column if not exists rate        numeric(14,4),
  add column if not exists value       numeric(16,2),
  add column if not exists location_id uuid references public.locations(id);

comment on column public.stock_ledger.txn_date is
  'Document date of the movement (grn_date / opening_date / return_date …). '
  'Defaults to current_date via trigger — NOT created_at, which is the posting instant.';
comment on column public.stock_ledger.rate is
  'Per-unit rate in the item stock UOM. Stamped from the source document where '
  'known, else resolved via public.resolve_item_rate().';

create index if not exists idx_ledger_txn_date on public.stock_ledger(txn_date desc);
create index if not exists idx_ledger_item     on public.stock_ledger(item_id);
create index if not exists idx_ledger_location on public.stock_ledger(location_id);

-- ---------- rate resolution -------------------------------------------------
-- The best-known per-unit rate for an item as of a date. Used for movements
-- whose source document carries no price — above all ISSUES, which is where
-- consumption *value* comes from.
--
-- ⚠️ BUSINESS RULE — the priority integers below decide how every consumption
-- figure in the ERP is valued. Lower number wins. Change these six numbers to
-- re-rank the sources; nothing else in the function needs to change.
create or replace function public.resolve_item_rate(p_item_id uuid, p_as_of date default current_date)
returns numeric
language sql stable security definer set search_path = '' as $$
  with candidates as (
    -- 1. last actual purchase price on or before the date (what we really paid)
    (select 1 as priority, pli.unit_price as rate
     from public.po_line_items pli
     join public.purchase_orders po on po.id = pli.purchase_order_id
     where pli.item_id = p_item_id
       and po.status <> 'cancelled'
       and coalesce(po.order_date, po.created_at::date) <= p_as_of
       and pli.unit_price > 0
     order by coalesce(po.order_date, po.created_at::date) desc
     limit 1)

    union all
    -- 2. maintained yarn rate master, effective on or before the date
    (select 2, ypri.rate
     from public.yarn_purchase_rate_items ypri
     join public.yarn_purchase_rates ypr on ypr.id = ypri.rate_id
     where ypri.item_id = p_item_id
       and ypr.effective_from <= p_as_of
       and ypri.rate > 0
     order by ypr.effective_from desc
     limit 1)

    union all
    -- 3. planned/standard rate on the material master
    (select 3, i.budget_rate
     from public.items i
     where i.id = p_item_id and coalesce(i.budget_rate, 0) > 0
     limit 1)
  )
  select rate from candidates order by priority limit 1;
$$;
revoke execute on function public.resolve_item_rate(uuid, date) from public, anon;
grant  execute on function public.resolve_item_rate(uuid, date) to authenticated;

-- ---------- stamp defaults on every insert ----------------------------------
-- BEFORE INSERT so it runs ahead of the existing trg_apply_stock (AFTER INSERT)
-- balance trigger. Every field defers to an explicitly-supplied value.
create or replace function public.stamp_stock_movement_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.txn_date := coalesce(new.txn_date, current_date);

  if new.uom_id is null then
    select coalesce(i.stock_uom_id, i.base_uom_id, i.uom_id) into new.uom_id
    from public.items i where i.id = new.item_id;
  end if;

  if new.location_id is null then
    select s.location_id into new.location_id
    from public.stores s where s.id = new.store_id;
  end if;

  if new.rate is null then
    new.rate := public.resolve_item_rate(new.item_id, new.txn_date);
  end if;

  if new.value is null and new.rate is not null then
    new.value := round(new.rate * new.quantity, 2);
  end if;

  return new;
end;
$$;
revoke execute on function public.stamp_stock_movement_defaults() from public, anon, authenticated;

drop trigger if exists trg_stamp_stock_defaults on public.stock_ledger;
create trigger trg_stamp_stock_defaults before insert on public.stock_ledger
  for each row execute function public.stamp_stock_movement_defaults();

-- ---------- backfill history ------------------------------------------------
-- Document dates were never captured, so created_at::date is the best available
-- proxy for existing rows. New rows carry the real document date.
update public.stock_ledger sl
set txn_date    = coalesce(sl.txn_date, sl.created_at::date),
    uom_id      = coalesce(sl.uom_id, i.stock_uom_id, i.base_uom_id, i.uom_id),
    location_id = coalesce(sl.location_id, s.location_id)
from public.items i, public.stores s
where i.id = sl.item_id
  and s.id = sl.store_id
  and (sl.txn_date is null or sl.uom_id is null or sl.location_id is null);

update public.stock_ledger sl
set rate = public.resolve_item_rate(sl.item_id, sl.txn_date)
where sl.rate is null;

update public.stock_ledger sl
set value = round(sl.rate * sl.quantity, 2)
where sl.value is null and sl.rate is not null;
