-- 0709 — Sample ▸ Accessories Plan answers to its SWO (user 2026-10-12,
-- screenshot 3437: "Swo number from grouping, Date* … remove the remaining all
-- the fields").
--
-- An SWO already holds ONE work order — `sample_product_groups.iwo_id`, the
-- FABRIC IW (0702, unique since 0707). Fabric Plan's SWO picker, Distribute's
-- cutting basis and the dyeing work order all read that column as the fabric
-- one, so the accessories work order is a SEPARATE link, never a re-point:
--
--   * `accessories_iwo_id` — the SWO's For-Accessories work order, one per SWO
--     (unique), raised in place from the Accessories Plan's SWO No picker.
--
-- SET NULL like `iwo_id`: deleting the work order frees the SWO to raise a new
-- one rather than refusing the delete.

alter table public.sample_product_groups
  add column if not exists accessories_iwo_id uuid references public.internal_work_orders(id) on delete set null;

create unique index if not exists uq_sample_product_groups_accessories_iwo
  on public.sample_product_groups(accessories_iwo_id) where accessories_iwo_id is not null;

comment on column public.sample_product_groups.accessories_iwo_id is
  'The SWO''s For-Accessories work order (0709). iwo_id stays the FABRIC work order.';
