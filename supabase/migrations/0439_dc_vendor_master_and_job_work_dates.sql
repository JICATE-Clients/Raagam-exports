-- =============================================================================
-- 0439 — Delivery Challans point at the Vendor MASTER, and job work gets dates
-- -----------------------------------------------------------------------------
-- Fourth table in the 0376 / 0377 / 0379 set, and the one that unblocks the
-- Material BOM's Processes tab.
--
-- ## Why this is needed at all
--
-- `material_bom_amendment_processes.vendor_id` references `master_vendors`
-- (0418, deliberately — the picker hands back a master id). `delivery_challans
-- .vendor_id` still references `public.vendors`, untouched since 0008. So a DC
-- generated from a Processes row inserts a master id into a column keyed to the
-- legacy table and fails with
-- `violates foreign key constraint delivery_challans_vendor_id_fkey` — every
-- time, for every row. That is the identical failure 0377 records, one table on.
--
-- ## 0418's stated reason for not generating a DC was wrong on the facts
--
-- The comment on `material_bom_amendment_processes.qty_out` reads: "No Delivery
-- Challan is generated from here — public.delivery_challans has no lines table
-- on this path". `public.dc_line_items` has existed since 0008:175, carries
-- `sent_qty` / `returned_qty` with the comment "balance = sent - returned", and
-- 0418's OWN stock view joins it (0418:508). The DC header even documents its
-- `purpose` column with the examples "Button Coloring, Knitting, Dyeing" and
-- carries a `partially_returned` status. The table was built for exactly this
-- flow. The comment is corrected at the end of this file rather than left to
-- mislead the next reader.
--
-- ## Why the vendor must be the MASTER and not the legacy row
--
-- Sending material to a processor is JOB WORK under s.143 of the CGST Act, and
-- Rule 55 makes the delivery challan mandatory for the movement — with the job
-- worker's GSTIN among its required particulars. `master_vendors` is where the
-- Vendor master's registration details live, and it carries `is_processor`,
-- which is the flag the job-worker picker narrows on. A challan naming a legacy
-- row the master does not know is a document we cannot complete.
--
-- ## The name match is 0379's, NOT 0376/0377's
--
-- Exactly one match or nothing, never `order by created_at limit 1`. There is no
-- unique index on `master_vendors.name` — uniqueness is app-side in
-- `checkDuplicateName`, which import and direct SQL bypass — so "the oldest of
-- several" binds a legal document to a guess and records nothing. Ambiguous rows
-- are blanked and counted as a notice; anything left unresolvable aborts.
--
-- ## THIS MIGRATION HAS A CODE HALF AND THEY MUST LAND TOGETHER
--
-- PostgREST names an embed after the RELATIONSHIP, so repointing the FK renames
-- `vendors(...)` to `master_vendors(...)` on every DC read. That breaks at
-- RUNTIME and is invisible to `tsc` and to `next build` — the lesson recorded
-- against `sales_orders` / `buyers`. The six sites, all inside the DC slice:
--
--   lib/purchase/grn-service.ts:175,207      .select("*, vendors(id, name)")
--   app/(app)/purchase/dc/page.tsx:40        r.vendors?.name
--   app/(app)/purchase/dc/[dcId]/page.tsx:73 dc.vendors?.name
--   app/(app)/purchase/dc/new/page.tsx:14    the vendor option feeder
--   app/(app)/purchase/dc/_components/dc-new-form.tsx:40   the `Vendor` prop type
--
-- ## What this does NOT do
--
-- It does not move `purchase_orders`, `grns` or `rfqs`. Those stay on
-- `public.vendors`, so a DC and a PO still name a processor from two different
-- tables. That split already exists — the BOM lines and the nominations have
-- been on the master since 0377 — and this moves the DC to the side the BOM is
-- on rather than opening a new one. Healing it is the purchase module's own job
-- and a much larger change.
-- =============================================================================

do $$
declare
  ambiguous bigint := 0;
  orphans   bigint := 0;
begin
  if to_regclass('public.delivery_challans') is null then
    raise notice '0439: delivery_challans does not exist — skipping.';
    return;
  end if;
  if to_regclass('public.master_vendors') is null then
    raise notice '0439: master_vendors does not exist (0246 not applied here) — skipping.';
    return;
  end if;

  execute 'alter table public.delivery_challans
             drop constraint if exists delivery_challans_vendor_id_fkey';

  -- Count what the name match cannot decide, BEFORE blanking it, so the run
  -- leaves a trace. A silent blank reads afterwards as "there was no vendor".
  execute $q$
    select count(*)
      from public.delivery_challans x
      join public.vendors v on v.id = x.vendor_id
     where x.vendor_id is not null
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
       and (select count(*) from public.master_vendors mv
             where upper(btrim(mv.name)) = upper(btrim(v.name))) > 1
  $q$ into ambiguous;

  if ambiguous > 0 then
    raise notice '0439: % challan(s) named a vendor matching more than one master row — blanked, not guessed.', ambiguous;
  end if;

  execute $q$
    update public.delivery_challans x
       set vendor_id = (
             select mv.id
               from public.master_vendors mv, public.vendors v
              where v.id = x.vendor_id
                and upper(btrim(mv.name)) = upper(btrim(v.name))
                -- Exactly one match, or nothing: never the oldest of several.
                and (select count(*) from public.master_vendors m2
                      where upper(btrim(m2.name)) = upper(btrim(v.name))) = 1
           )
     where x.vendor_id is not null
       -- Only rows that do not already resolve in the master, so this is
       -- re-runnable and a vendor picked after the screen was rewired is left
       -- alone.
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
  $q$;

  execute $q$
    select count(*) from public.delivery_challans x
     where x.vendor_id is not null
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
  $q$ into orphans;

  if orphans > 0 then
    raise exception
      '0439: delivery_challans.vendor_id still has % row(s) outside public.master_vendors', orphans;
  end if;

  execute 'alter table public.delivery_challans
             add constraint delivery_challans_vendor_id_fkey
             foreign key (vendor_id) references public.master_vendors(id) on delete set null';

  execute $q$
    comment on column public.delivery_challans.vendor_id is
      'The processor / job worker. FK to public.master_vendors (the Vendor master), '
      'NOT public.vendors — see 0439, matching 0376 · 0377 · 0379. Narrow the picker '
      'on master_vendors.is_processor. Required particular of a Rule 55 challan, so '
      'this is never left blank on a challan that has actually been issued.'
  $q$;
end $$;

-- -----------------------------------------------------------------------------
-- The job-work clock, and the link back to the challan
-- -----------------------------------------------------------------------------
-- `sent_on` is the DISPATCH date, and the ONLY thing the statutory one-year
-- return window can run from. NULLABLE and never backfilled: every row written
-- before this column has no such date, and defaulting it from `created_at` would
-- start a statutory clock on the day a merchandiser opened a form. A row with no
-- date is unageable in `lib/orders/material-bom/process-return.ts`, never
-- overdue — the same "NULL IS AN ANSWER" rule the requirement engine states.

alter table public.material_bom_amendment_processes
  add column if not exists sent_on             date,
  add column if not exists delivery_challan_id uuid
    references public.delivery_challans(id) on delete set null;

comment on column public.material_bom_amendment_processes.sent_on is
  'Dispatch date. Inputs sent for job work must return within ONE YEAR (CGST s.143) '
  'or the movement becomes a deemed supply — jobWorkAgeing() in '
  'lib/orders/material-bom/process-return.ts reads this and nothing else. Null means '
  'unageable, never overdue.';

comment on column public.material_bom_amendment_processes.delivery_challan_id is
  'The Rule 55 challan this dispatch was made under (0439). Null on a row still being '
  'planned, and on every row predating this column.';

create index if not exists idx_mba_proc_dc
  on public.material_bom_amendment_processes(delivery_challan_id);

-- SUPERSEDES 0418's comment on this column, which said no DC is generated
-- because "delivery_challans has no lines table on this path". dc_line_items has
-- existed since 0008:175; the claim was wrong when it was written.
comment on column public.material_bom_amendment_processes.qty_out is
  'Sent for processing, under the challan named by delivery_challan_id (0439). '
  'Balance (qty_out - qty_in) is derived, never stored. A short return is measured '
  'against the stored REQUIREMENT, not against this column — see '
  'lib/orders/material-bom/process-return.ts.';
