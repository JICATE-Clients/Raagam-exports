-- ============================================================================
-- Raagam ERP — 0286 Levy Master: Created User + Annexure No
-- Legacy EDP2 "Levies" list shows two columns we never captured: "Created
-- User" (who entered the record) and "Annexure" (e.g. "I") as a field
-- distinct from "Category" (e.g. "R") — 0282 only modeled Category. Follows
-- the created_by convention already used elsewhere (0124_orders_styles.sql).
-- ============================================================================

alter table public.levies
  add column if not exists created_by uuid references public.profiles(id) default auth.uid(),
  add column if not exists annexure_no text;
