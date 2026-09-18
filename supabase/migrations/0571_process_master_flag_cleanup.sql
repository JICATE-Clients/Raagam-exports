-- ============================================================================
-- Raagam ERP — 0571 Process Master flags & sub-category cleanup
--
-- Client, 2026-09-18 ("Process Master Flags & Sub-Category Cleanup"):
--
--   1. HSN Code removed from the individual SUB-CATEGORY rows.
--   2. Is Print / Is Dyeing / Is Knitting Process and Design-wise delivery
--      removed as "unnecessary backend flags".
--   3. Use Conversion Process RETAINED (`processes.is_conversion`, the 10–20%
--      of processes run as a conversion job) — untouched here.
--
-- Two columns leave the DATABASE; three flags leave only the FORM. The split is
-- the whole content of this migration, so it is stated before anything runs.
--
-- ## DROPPED: nothing reads them
--
--   * `process_sub_categories.hsn_code` — written only by the Process master's
--     Sub Categories grid, read by nothing. HSN is stated once, on the process
--     header (`processes.hsn_code`), which Master Data ▸ Process HSN Assign owns.
--     Live: one sub-category row, hsn_code NULL. No data is lost.
--   * `processes.designwise_delivery` — 0227's legacy checkbox. Read by nothing
--     outside the Process master, and false on every live row.
--
-- Why DROP and not merely hide: 0565's reason, one file on. `lib/data-io`
-- imports parse with the same Zod schema the screen uses and write straight to
-- Postgres, so a column the form stopped filling is a door a spreadsheet can
-- still walk through. `processInput` no longer carries either key.
--
-- ## KEPT: `is_print` (0528) · `is_dyeing` (0557) · `is_knitting` (0564)
--
-- These ARE read, by the Fabric BOM: the print gate, the Yarn-Dyed dyeing
-- withhold, and §2 Rule 2's knitting suppression for greige / dyed purchase
-- (lib/orders/fabric-bom/service.ts, actions.ts, reports.ts). Dropping them
-- would 400 every one of those selects, and `processKindsOf` refuses the BOM
-- save on that error by design.
--
-- They are NOT derived from `process_fabric_stages` either, though "Knitting is
-- the base of Greige" makes that look free. 0570 makes FABRIC PURCHASE a second
-- base of GREIGE, so "base of Greige" means "knitting OR buying greige", and
-- Rule 2 suppresses only the knitting. Derived, a greige-bought fabric would
-- drop its own purchase step's loss — an UNDER-buy, the one direction this
-- engine never lets a missing classification fail in.
--
-- So from today they are system-maintained: seeded by migrations (0570 sets
-- `is_print` on PRINTING as it inserts it), no longer operator-editable, and a
-- process created on the screen takes the column default `false` — which
-- errs toward OVER-buying, as each flag's own column comment already accepts.
-- ============================================================================

alter table public.process_sub_categories
  drop column if exists hsn_code;

alter table public.processes
  drop column if exists designwise_delivery;

comment on column public.processes.is_print is
  'Is this a PRINT process? (0528) Read by the Fabric BOM ▸ Fabric Process '
  'picker to refuse Print until the order declares an all-over print. Removed '
  'from the Process master form by the client on 2026-09-18 (0571): now seeded '
  'by migrations only, never operator-edited, never derived from the name or '
  'from process_fabric_stages.';

comment on column public.processes.is_dyeing is
  'Is this THE fabric Dyeing step? (0557) Read by the Fabric BOM to withhold '
  'Dyeing from a Yarn-Dyed fabric''s route, and by §2 Rule 2 to suppress it '
  'for a dyed_purchase fabric. Removed from the Process master form by the '
  'client on 2026-09-18 (0571): now seeded by migrations only. NOT derivable '
  'from "base of DYED" — a dyed-cloth purchase process would also be one.';

comment on column public.processes.is_knitting is
  'Is this THE greige Knitting step? (0564) Read by §2 Rule 2 to drop its loss '
  'for a greige_purchase / dyed_purchase fabric. Removed from the Process '
  'master form by the client on 2026-09-18 (0571): now seeded by migrations '
  'only. NOT derivable from "base of GREIGE" — FABRIC PURCHASE is also one '
  '(0570), and deriving would drop the purchase loss: an under-buy.';

notify pgrst, 'reload schema';
