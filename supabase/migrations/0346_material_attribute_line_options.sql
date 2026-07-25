-- =============================================================================
-- 0346 — Sewing/Packing accessories: per-line attribute value list
-- -----------------------------------------------------------------------------
-- Legacy "Material attribute" screen edits each attribute's pre-defined values
-- INLINE per (Item Class + Category + Attribute) — BOX's CATEGORY values differ
-- from Label's. Model that as a child of material_attribute_lines (not the
-- category-invariant attribute_value_options from 0341).
--
-- The accessory "Transaction Type" (Purchase / Converted) reuses the existing
-- items.material_type column — the Material form filters Production out for
-- SEW/PACK — so no new column is added here.
-- =============================================================================

-- 1) per-line pre-defined value list (Description + Blocked; Short Name dropped per client).
create table if not exists public.material_attribute_line_options (
  id                        uuid primary key default gen_random_uuid(),
  material_attribute_line_id uuid not null
    references public.material_attribute_lines(id) on delete cascade,
  sno                       integer not null default 0,
  description               text not null,
  blocked                   boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_mal_options_line
  on public.material_attribute_line_options(material_attribute_line_id);
create trigger trg_mal_options_updated before update on public.material_attribute_line_options
  for each row execute function public.set_updated_at();
alter table public.material_attribute_line_options enable row level security;
create policy mal_opt_read on public.material_attribute_line_options
  for select to authenticated using (true);
create policy mal_opt_ins on public.material_attribute_line_options
  for insert to authenticated with check (public.has_permission('masters', 'create'));
create policy mal_opt_upd on public.material_attribute_line_options
  for update to authenticated using (public.has_permission('masters', 'edit'))
  with check (public.has_permission('masters', 'edit'));
create policy mal_opt_del on public.material_attribute_line_options
  for delete to authenticated using (public.has_permission('masters', 'delete'));
