-- ============================================================================
-- Raagam ERP — 0129 Orders ▸ Garment Orders ▸ step 11 "Approve Amendment"
-- Additive: the Garment Order Amendment header (0126/0128) records an amendment
-- but has no approval field (only is_draft = Draft/Recorded). The 0126 header
-- comment reserves step 11 as the screen that DECIDES an amendment. This adds
-- the decision columns to garment_order_amendments so the approval queue can
-- stamp who approved/rejected it, when, and why.
--
-- Vocabulary mirrors the legacy order_amendments approval flow (0006:
-- pending/approved/rejected + decided_by/decided_at/decided_reason) — kept on
-- THIS table. Approving records the decision only; it does not mutate the live
-- sales_orders (applying amended values back to the order is a separate, later
-- step once the field mapping is confirmed). No new tables/sequence/trigger and
-- no new RLS — the existing 'orders' UPDATE policy already covers these columns.
-- ============================================================================

alter table public.garment_order_amendments
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected')),
  add column if not exists approved_by     uuid references public.profiles(id),
  add column if not exists approved_at      timestamptz,
  add column if not exists approval_reason  text;

create index if not exists idx_goa_approval on public.garment_order_amendments(approval_status);
