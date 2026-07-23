-- =============================================================================
-- 0341 — Attribute-driven creation for Sewing/Packing accessories (Phase 2)
-- -----------------------------------------------------------------------------
-- Adds the consumption-side model: categorical option lists for attributes, a
-- name-generation separator, and per-item chosen answers. Config tables
-- (material_attributes/_lines, attribute_values) already exist.
-- =============================================================================

-- 1) attribute_values: categorical vs numeric. Default numeric keeps existing rows valid.
alter table public.attribute_values
  add column if not exists input_type text not null default 'numeric_range'
  check (input_type in ('option_list', 'numeric_range'));

-- 2) option list for a categorical attribute (e.g. Type = Printed / Laminated),
--    defined once per item-class attribute (category-invariant).
create table if not exists public.attribute_value_options (
  id                 uuid primary key default gen_random_uuid(),
  attribute_value_id uuid not null references public.attribute_values(id) on delete cascade,
  sno                integer not null default 0,
  value              text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_attr_value_options_parent on public.attribute_value_options(attribute_value_id);
create trigger trg_avo_updated before update on public.attribute_value_options
  for each row execute function public.set_updated_at();
alter table public.attribute_value_options enable row level security;
create policy avo_read on public.attribute_value_options for select to authenticated using (true);
create policy avo_ins  on public.attribute_value_options for insert to authenticated with check (public.has_permission('masters', 'create'));
create policy avo_upd  on public.attribute_value_options for update to authenticated using (public.has_permission('masters', 'edit')) with check (public.has_permission('masters', 'edit'));
create policy avo_del  on public.attribute_value_options for delete to authenticated using (public.has_permission('masters', 'delete'));

-- 3) name-generation separator per (item_class + category) attribute set.
alter table public.material_attributes
  add column if not exists name_separator text not null default ' ';

-- 4) per-item chosen answers (denormalised sno + text answer → naming/dedupe without joins).
create table if not exists public.item_attribute_values (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.items(id) on delete cascade,
  attribute_line_id uuid references public.material_attribute_lines(id) on delete set null,
  sno               integer not null default 0,
  value             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_item_attr_values_item on public.item_attribute_values(item_id);
create trigger trg_iav_updated before update on public.item_attribute_values
  for each row execute function public.set_updated_at();
alter table public.item_attribute_values enable row level security;
create policy iav_read on public.item_attribute_values for select to authenticated using (true);
create policy iav_ins  on public.item_attribute_values for insert to authenticated with check (public.has_permission('masters', 'create'));
create policy iav_upd  on public.item_attribute_values for update to authenticated using (public.has_permission('masters', 'edit')) with check (public.has_permission('masters', 'edit'));
create policy iav_del  on public.item_attribute_values for delete to authenticated using (public.has_permission('masters', 'delete'));
