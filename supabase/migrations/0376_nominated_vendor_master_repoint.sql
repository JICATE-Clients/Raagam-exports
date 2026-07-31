-- =============================================================================
-- 0376 — Customer ▸ Nominated / Recommended Vendor points at the Vendor MASTER
-- -----------------------------------------------------------------------------
-- Reported 2026-07-31: "the nominated vendor field is listing hardcoded values".
-- They were not hardcoded — they were the wrong table's rows.
--
-- There are two vendor tables and both hold data:
--
--   * `public.vendors`        — the older purchase-side table. 18 transaction
--                               tables FK here (purchase_orders, grns, rfqs,
--                               payables, process_orders, …). Seven rows on
--                               file, four of them the `decade00-…` demo seed
--                               (Kandagiri Spinning, Sri Vari Yarns, Sakthi
--                               Dyeing, Kumaran Trims — see the demo-data note
--                               in supabase/seed/).
--   * `public.master_vendors` — the Vendor MASTER the operator maintains at
--                               Masters ▸ Associates ▸ Vendor, with its four
--                               child grids (0369 · 0370 · 0372).
--
-- The Customer screen fed its Nominated / Recommended grids from
-- `getVendorsForPicker()` (`lib/purchase/po-service.ts`), which reads the FIRST
-- table — so the dropdown offered the demo seed, and a vendor created in the
-- master (SIVAM TREADES) could not be nominated at all. `customer_nominated_
-- vendors.vendor_id` FK'd to the same wrong table, which is why it never threw:
-- the field was consistently pointed at the wrong place, reads and writes alike.
--
-- SCOPE — deliberately ONE column. The purchase module keeps reading
-- `public.vendors`, and correctly so: its 18 FKs are there and its own pickers
-- match. Merging the two tables is a much larger migration and a separate
-- decision. This fixes the one field where a MASTER-level nomination was being
-- drawn from the transaction-side list.
--
-- DATA — three nominations exist, all naming vendors absent from the master
-- (SD Textile, Kumaran Trims, Nivedha Knits). They are remapped BY NAME where
-- the master holds a vendor of the same name, and otherwise BLANKED, not
-- deleted: the row survives, so the customer still shows "there is a nomination
-- here" and the operator re-picks from the master list. Inventing master_vendors
-- rows from purchase-side data would pollute a master with demo records, and
-- deleting the rows would lose the fact silently. `vendor_id` is nullable, and
-- the editor already round-trips a null child row.
-- =============================================================================

-- Dropped first: the remap below writes a `master_vendors.id`, which the old
-- constraint rejects (0375 learned this the hard way).
alter table public.customer_nominated_vendors
  drop constraint if exists customer_nominated_vendors_vendor_id_fkey;

update public.customer_nominated_vendors cnv
   set vendor_id = (
         select mv.id
           from public.master_vendors mv,
                public.vendors v
          where v.id = cnv.vendor_id
            and upper(btrim(mv.name)) = upper(btrim(v.name))
          order by mv.created_at
          limit 1
       )
 where cnv.vendor_id is not null
   -- Only rows that do not already resolve in the master, so this is re-runnable
   -- and a nomination made after the screen was rewired is left alone.
   and not exists (
         select 1 from public.master_vendors mv where mv.id = cnv.vendor_id
       );

do $$
declare
  orphans bigint;
begin
  select count(*) into orphans
    from public.customer_nominated_vendors cnv
   where cnv.vendor_id is not null
     and not exists (select 1 from public.master_vendors mv where mv.id = cnv.vendor_id);

  if orphans > 0 then
    raise exception
      '0376: customer_nominated_vendors.vendor_id still has % row(s) outside public.master_vendors', orphans;
  end if;
end $$;

alter table public.customer_nominated_vendors
  add constraint customer_nominated_vendors_vendor_id_fkey
  foreign key (vendor_id) references public.master_vendors(id) on delete set null;

comment on column public.customer_nominated_vendors.vendor_id is
  'FK to public.master_vendors (the Vendor master), NOT public.vendors — see 0376.';
