-- =============================================================================
-- 0445 — A Delivery Challan names a vendor from the MASTER
--
-- Supersedes the first half of 0439, which was committed and never applied. Its
-- second half is deliberately NOT carried over; see the end of this header.
--
-- ## Why this is needed at all
--
-- `material_bom_amendment_processes.vendor_id` references `master_vendors`
-- (0418, and 0377 repointed it there on purpose — the picker hands back a master
-- id). `delivery_challans.vendor_id` still references `public.vendors`,
-- untouched since 0008. So a challan generated from a Processes row inserts a
-- master id into a column keyed to the legacy table and fails with
-- `violates foreign key constraint delivery_challans_vendor_id_fkey` — every
-- time, for every row. Identical failure to the one 0377 records, one table on.
--
-- ## FREE, AND VERIFIED FREE FIRST
--
-- `delivery_challans` holds ZERO rows (catalogue, 2026-08-21), so there is
-- nothing to re-key and no orphan to reconcile. The name-matching block 0439
-- carried for populated environments is kept, and simply matches nothing here.
--
-- ## THE CODE HALF LANDS IN THE SAME COMMIT, AND THAT IS NOT OPTIONAL
--
-- PostgREST names an embed after the RELATIONSHIP, so `select("*, vendors(...)")`
-- stops resolving the moment this FK moves. `tsc` cannot see it and neither can
-- `next build` — it is a runtime 400 on a screen that compiled clean. The four
-- sites are `grn-service.ts` (`listDcs`, `getDc`, and the `DcWithVendor` /
-- `DcDetail` types) and the two `purchase/dc` pages that read `.vendors?.name`.
--
-- ## `getVendors()` IS NOT ONE OF THEM, and 0439's header was wrong about this
--
-- 0439 lists `getVendors()` as a site to repoint. It is shared with the GRN
-- form, and GRN deliberately stays on `public.vendors` — repointing it in place
-- would offer that form master ids that fail `grns_vendor_id_fkey`, which is the
-- SAME defect this migration exists to prevent, reintroduced by the fix. A new
-- `getProcessorVendors()` is added beside it instead.
--
-- It also filters `.eq("is_active", true)`, and `master_vendors` HAS NO
-- `is_active` COLUMN — it carries `status` in
-- ('Approved','Under Evaluation','Terminated','Hold') (0246). A naive repoint
-- returns a PostgREST 400 at runtime. The new function filters on `status`.
--
-- ## WHAT 0439's SECOND HALF DID, AND WHY IT IS DROPPED
--
-- It added `sent_on` and `delivery_challan_id` to
-- `material_bom_amendment_processes`. That is the worst available place for the
-- link: `writeChildren` DELETES AND REINSERTS every process row on every save,
-- so the pointer is lost by any stale form, and the operator then generates a
-- second challan for buttons already at the dyer. The link belongs on
-- `dc_line_items`, keyed to something immutable — see 0446.
-- =============================================================================

do $$
declare
  v_bad int;
begin
  -- Re-key any legacy vendor_id onto its master twin by NAME. No rows here, so
  -- this is for other environments; a name match is the only bridge the two
  -- tables share (0377's approach).
  update public.delivery_challans dc
     set vendor_id = mv.id
    from public.vendors v
    join public.master_vendors mv
      on upper(trim(mv.name)) = upper(trim(v.name))
   where dc.vendor_id = v.id;

  -- Anything left pointing at a legacy row with no master twin would be orphaned
  -- by the repoint. Refuse rather than null it out: a challan with no processor
  -- is a document nobody can act on.
  select count(*) into v_bad
    from public.delivery_challans dc
   where dc.vendor_id is not null
     and not exists (select 1 from public.master_vendors mv where mv.id = dc.vendor_id);

  if v_bad > 0 then
    raise exception '0445: % delivery challan(s) name a vendor with no master twin — create those masters first', v_bad;
  end if;
end $$;

alter table public.delivery_challans
  drop constraint if exists delivery_challans_vendor_id_fkey;

alter table public.delivery_challans
  add constraint delivery_challans_vendor_id_fkey
  foreign key (vendor_id) references public.master_vendors(id);

comment on column public.delivery_challans.vendor_id is
  'The processor, from master_vendors (0445, superseding 0439). NOT public.vendors: '
  'material_bom_amendment_processes.vendor_id is a master id (0377/0418), and a '
  'challan generated from a Processes row has to be able to carry it.';

do $assert$
declare
  v_target text;
begin
  select confrelid::regclass::text into v_target
    from pg_constraint where conname = 'delivery_challans_vendor_id_fkey';

  if v_target is null then
    raise exception '0445: the FK is missing — the drop ran and the add did not';
  end if;
  if v_target <> 'master_vendors' then
    raise exception '0445: delivery_challans.vendor_id still points at % — the repoint did not take', v_target;
  end if;

  -- master_vendors has no is_active; anything filtering on it 400s at runtime.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'master_vendors' and column_name = 'is_active'
  ) then
    raise exception '0445: master_vendors grew an is_active column — getProcessorVendors filters on status and should be revisited';
  end if;
end $assert$;
