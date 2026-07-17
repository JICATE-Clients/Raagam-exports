-- ============================================================================
-- Raagam ERP — 0283 Master Data ▸ Categories ▸ User Defined flag
-- Legacy EDP2 Category form shows a "User Defined" Yes/No dropdown for
-- Capital/General/Sewing/Packing/Garments classes (not Fabric/Yarn) — inert
-- flag only, mirrors Materials' own user_defined column (0226).
-- ============================================================================
alter table public.categories
  add column if not exists user_defined boolean not null default false;
