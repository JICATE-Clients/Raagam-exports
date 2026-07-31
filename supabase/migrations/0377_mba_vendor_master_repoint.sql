-- =============================================================================
-- 0377 — Material BOM Amendment items point at the Vendor MASTER
-- -----------------------------------------------------------------------------
-- Follows 0376. That migration moved `customer_nominated_vendors.vendor_id` to
-- `public.master_vendors` so a customer's nominations are made against the
-- Vendor master. This migration makes the one screen that CONSUMES those
-- nominations agree.
--
-- Orders ▸ Material BOM Amendment carries `supply_type` per item — Local /
-- Import / Nominated / Free Issue — and a Vendor picker that offered every
-- vendor in the system regardless. An operator could mark a line "Nominated"
-- against a vendor the customer had never approved, which is the whole point of
-- keeping a nomination list. `mba-master-screen.tsx` now narrows that picker to
-- the header customer's nominated vendors (empty, with a line explaining why,
-- when the customer has nominated nobody).
--
-- The picker therefore hands back a `master_vendors.id`, and
-- `material_bom_amendment_items.vendor_id` still referenced `public.vendors` —
-- so without this migration every save of a nominated line would fail with
--     violates foreign key constraint "material_bom_amendment_items_vendor_id_fkey"
-- which is exactly the class of bug 0375 and 0376 were written to clear.
--
-- FREE: `material_bom_amendments` and `material_bom_amendment_items` are both
-- EMPTY (verified before applying), so there is nothing to remap — unlike 0375
-- and 0376 this is a pure constraint swap. The guard below still runs, because
-- "it was empty when I checked" is not something a migration should assume.
--
-- SCOPE — this ONE column. Purchase and Stores keep `public.vendors`: 17 other
-- transaction tables FK there (purchase_orders, grns, rfq_quotes, payables,
-- process_orders …) and their pickers match. MBA moves because it is the screen
-- that reads a MASTER-level nomination; the rest do not. Merging the two vendor
-- tables remains a separate, larger decision.
-- =============================================================================

alter table public.material_bom_amendment_items
  drop constraint if exists material_bom_amendment_items_vendor_id_fkey;

-- Any line already naming a vendor absent from the master is blanked rather than
-- deleted — the BOM line and its quantities survive, and the Vendor cell shows
-- empty for the operator to re-pick. Matched by name first, so an environment
-- where both tables hold the same vendor keeps the link.
update public.material_bom_amendment_items x
   set vendor_id = (
         select mv.id
           from public.master_vendors mv,
                public.vendors v
          where v.id = x.vendor_id
            and upper(btrim(mv.name)) = upper(btrim(v.name))
          order by mv.created_at
          limit 1
       )
 where x.vendor_id is not null
   and not exists (
         select 1 from public.master_vendors mv where mv.id = x.vendor_id
       );

do $$
declare
  orphans bigint;
begin
  select count(*) into orphans
    from public.material_bom_amendment_items x
   where x.vendor_id is not null
     and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id);

  if orphans > 0 then
    raise exception
      '0377: material_bom_amendment_items.vendor_id still has % row(s) outside public.master_vendors', orphans;
  end if;
end $$;

alter table public.material_bom_amendment_items
  add constraint material_bom_amendment_items_vendor_id_fkey
  foreign key (vendor_id) references public.master_vendors(id) on delete set null;

comment on column public.material_bom_amendment_items.vendor_id is
  'FK to public.master_vendors (the Vendor master), NOT public.vendors — see 0377. '
  'When supply_type = ''Nominated'' the UI narrows this to the customer''s '
  'customer_nominated_vendors rows.';
