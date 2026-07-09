-- ============================================================================
-- Raagam ERP — 0226 Master Data ▸ Materials ▸ Material (rich, class-driven)
-- Legacy EDP2 "Material" master maps to the existing `items` table. Header
-- (Item Class + HSN) + a UOM tab (common) + a Details tab that varies per Item
-- Class (3 layouts across 8 classes). ADD-ONLY on `items` (18 tables FK
-- items(id); never touch code/name/category/uom_id/is_active). Two child grids.
-- ============================================================================

-- ---------- enrich items (common + per-form + UOM-tab columns) ----------
alter table public.items
  -- common / header
  add column if not exists item_class_id     uuid references public.config_lookups(id) on delete set null,
  add column if not exists hsn_code          text,
  add column if not exists category_id       uuid references public.categories(id) on delete set null,
  add column if not exists material_type     text,
  add column if not exists user_defined      boolean not null default false,
  -- Form A (Button/Capital/General/Sewing/Packing)
  add column if not exists specifications    text,
  add column if not exists short_spec        text,
  -- Form B (Fabric/Yarn)
  add column if not exists count_id          uuid references public.config_lookups(id) on delete set null,
  add column if not exists purity_id         uuid references public.config_lookups(id) on delete set null,
  add column if not exists shade             text,
  -- UOM tab (common)
  add column if not exists base_uom_id       uuid references public.uoms(id) on delete set null,
  add column if not exists stock_uom_id      uuid references public.uoms(id) on delete set null,
  add column if not exists billing_uom_id    uuid references public.uoms(id) on delete set null,
  add column if not exists planning_uom_id   uuid references public.uoms(id) on delete set null,
  add column if not exists purchase_uom_id   uuid references public.uoms(id) on delete set null,
  add column if not exists cost_head_id      uuid references public.cost_heads(id) on delete set null,
  add column if not exists budget_rate       numeric(14,4),
  add column if not exists budget_rate_uom_id uuid references public.uoms(id) on delete set null;

-- ---------- child grid: Mixing (Details, Form B) ----------
create table if not exists public.material_mixings (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  sno         integer not null default 0,
  description text,
  shade       text,
  uom_id      uuid references public.uoms(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_material_mixings_updated before update on public.material_mixings
  for each row execute function public.set_updated_at();
create index if not exists idx_material_mixings_item on public.material_mixings(item_id);

-- ---------- child grid: UOM conversions (UOM tab, common) ----------
create table if not exists public.material_uom_conversions (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.items(id) on delete cascade,
  sno          integer not null default 0,
  alt_qty      numeric(14,4),
  alt_uom_id   uuid references public.uoms(id) on delete set null,
  base_qty     numeric(14,4),
  base_uom_id  uuid references public.uoms(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_material_uom_conversions_updated before update on public.material_uom_conversions
  for each row execute function public.set_updated_at();
create index if not exists idx_material_uom_conversions_item on public.material_uom_conversions(item_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['material_mixings','material_uom_conversions'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
