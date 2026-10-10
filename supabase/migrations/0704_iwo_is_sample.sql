-- 0704 — A WORK ORDER RAISED FOR A SAMPLE SAYS SO (user 2026-10-09).
--
-- Sample ▸ Fabric Plan and Sample ▸ Accessories Plan are the IWO Fabric BOM and
-- IWO Material BOM screens, same logic and same UI, listing only the SAMPLE
-- work orders. The plan stays ONE record per work order (the user chose this
-- over a separate sample copy): Sample ▸ Grouping's "Raise IW" already creates
-- a Fabric IW, and a second, sample-only plan table would have given that one
-- work order two fabric plans that never agree. Sharing it also keeps the IWO
-- Budget and the PO ceiling (0586 / 0587) working for sample material.
--
-- Set ONCE, at insert, by whatever raised the work order from the Sample
-- module (Grouping, or "+ New work order" on the two Sample plan screens).
-- `saveInternalWorkOrder` never writes it on update, so editing the header on
-- Orders ▸ Internal Work Order cannot move a work order between the two lists.

alter table public.internal_work_orders
  add column if not exists is_sample boolean not null default false;

comment on column public.internal_work_orders.is_sample is
  'Raised from the Sample module (Grouping or the Sample Fabric / Accessories Plan screens). Listed on Sample ▸ Fabric Plan / Accessories Plan; still a normal IWO everywhere else.';

-- Every IW a sample group has raised so far is a sample work order.
update public.internal_work_orders w
   set is_sample = true
  from public.sample_product_groups g
 where g.iwo_id = w.id
   and not w.is_sample;

create index if not exists internal_work_orders_sample_idx
  on public.internal_work_orders (location_id, created_at)
  where is_sample;
