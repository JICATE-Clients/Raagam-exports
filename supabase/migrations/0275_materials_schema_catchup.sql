-- ============================================================================
-- Raagam ERP — 0275 Materials Schema Catch-Up
-- Brings migration files in sync with the live Supabase DB. Several columns
-- were added directly to the DB during development but never captured in
-- migration files. This migration is idempotent (IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- ==========================================================================
-- 1. ATTRIBUTES TABLE — restructured in live DB
--    Live DB dropped the `attributes` parent table and flattened
--    `attribute_values` to reference item_class_id directly instead of
--    attribute_id. The attribute-master-screen now works against
--    config_lookups (kind = 'attribute') + attribute_values by item_class_id.
-- ==========================================================================

-- Drop the FK from attribute_values → attributes (if it still exists)
alter table public.attribute_values
  drop constraint if exists attribute_values_attribute_id_fkey;

-- Drop the attribute_id column (replaced by item_class_id)
alter table public.attribute_values
  drop column if exists attribute_id;

-- Add item_class_id if not present
alter table public.attribute_values
  add column if not exists item_class_id uuid references public.config_lookups(id) on delete set null;

-- Drop the attributes parent table (no longer used)
drop table if exists public.attributes cascade;

-- ==========================================================================
-- 2. ITEMS TABLE — missing columns added during Fabric/Yarn development
-- ==========================================================================

alter table public.items
  add column if not exists fabric_type_id     uuid references public.config_lookups(id) on delete set null,
  add column if not exists yarn_type_id       uuid references public.config_lookups(id) on delete set null,
  add column if not exists ply                integer,
  add column if not exists direct_purchase    boolean not null default false,
  add column if not exists created_by         text,
  add column if not exists hsn_id             uuid references public.config_lookups(id) on delete set null,
  add column if not exists fabric_structure_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists fabric_using       text;

-- Performance indexes for all FK columns on items (11 from 0226 + 7 new)
create index if not exists idx_items_item_class      on public.items(item_class_id);
create index if not exists idx_items_category        on public.items(category_id);
create index if not exists idx_items_count           on public.items(count_id);
create index if not exists idx_items_purity          on public.items(purity_id);
create index if not exists idx_items_base_uom        on public.items(base_uom_id);
create index if not exists idx_items_stock_uom       on public.items(stock_uom_id);
create index if not exists idx_items_billing_uom     on public.items(billing_uom_id);
create index if not exists idx_items_planning_uom    on public.items(planning_uom_id);
create index if not exists idx_items_purchase_uom    on public.items(purchase_uom_id);
create index if not exists idx_items_cost_head       on public.items(cost_head_id);
create index if not exists idx_items_budget_rate_uom on public.items(budget_rate_uom_id);
create index if not exists idx_items_fabric_type     on public.items(fabric_type_id);
create index if not exists idx_items_yarn_type       on public.items(yarn_type_id);
create index if not exists idx_items_hsn             on public.items(hsn_id);
create index if not exists idx_items_fabric_structure on public.items(fabric_structure_id);

-- ==========================================================================
-- 3. MATERIAL_MIXINGS — missing columns for yarn blend tracking
-- ==========================================================================

alter table public.material_mixings
  add column if not exists component_item_id uuid references public.items(id) on delete set null,
  add column if not exists count_id          uuid references public.config_lookups(id) on delete set null,
  add column if not exists blend_pct         numeric(6,2);

create index if not exists idx_material_mixings_component on public.material_mixings(component_item_id);

-- ==========================================================================
-- 4. CATEGORIES — missing columns + naming fix (blocked → inactive)
-- ==========================================================================

-- Rename blocked → inactive (live DB uses 'inactive')
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'categories' and column_name = 'blocked'
  ) then
    alter table public.categories rename column blocked to inactive;
  end if;
end $$;

alter table public.categories
  add column if not exists fabric_structure_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists created_by         uuid,
  add column if not exists user_defined       boolean not null default false;

-- If inactive doesn't exist yet (fresh deploy), add it
alter table public.categories
  add column if not exists inactive boolean not null default false;

-- ==========================================================================
-- 5. LEVIES — missing VAT/BED/TDS/Excise/Annexure columns + naming fix
-- ==========================================================================

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'levies' and column_name = 'blocked'
  ) then
    alter table public.levies rename column blocked to inactive;
  end if;
end $$;

alter table public.levies
  add column if not exists inactive             boolean not null default false,
  add column if not exists created_by           uuid,
  add column if not exists vat_cst_pct          numeric(6,2),
  add column if not exists vat_cst_ac_head      uuid references public.gl_accounts(id) on delete set null,
  add column if not exists bed_pct              numeric(6,2),
  add column if not exists edu_on_bed_pct       numeric(6,2),
  add column if not exists she_on_bed_pct       numeric(6,2),
  add column if not exists tds_pct              numeric(6,2),
  add column if not exists surcharge_pct        numeric(6,2),
  add column if not exists addnl_surcharge_pct  numeric(6,2),
  add column if not exists excise_duty_pct      numeric(6,2),
  add column if not exists excise_cess_pct      numeric(6,2),
  add column if not exists excise_edu_cess_pct  numeric(6,2),
  add column if not exists annexure_category_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists annexure_category_sno integer,
  add column if not exists annexure_no          text,
  add column if not exists calc_exempt          text,
  add column if not exists annexure_ac_head     uuid references public.gl_accounts(id) on delete set null;

-- Indexes for levy GL account FKs
create index if not exists idx_levies_cgst_ac   on public.levies(cgst_ac_head);
create index if not exists idx_levies_sgst_ac   on public.levies(sgst_ac_head);
create index if not exists idx_levies_igst_ac   on public.levies(igst_ac_head);
create index if not exists idx_levies_cess_ac   on public.levies(cess_ac_head);
create index if not exists idx_levies_vat_ac    on public.levies(vat_cst_ac_head);
create index if not exists idx_levies_annex_ac  on public.levies(annexure_ac_head);

-- ==========================================================================
-- 6. PROCESSES — missing sl_no, created_by + naming fix
-- ==========================================================================

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'processes' and column_name = 'blocked'
  ) then
    alter table public.processes rename column blocked to inactive;
  end if;
end $$;

alter table public.processes
  add column if not exists inactive   boolean not null default false,
  add column if not exists sl_no      integer,
  add column if not exists created_by text;

-- ==========================================================================
-- 7. COMPONENTS — missing created_by + naming fix
-- ==========================================================================

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'components' and column_name = 'blocked'
  ) then
    alter table public.components rename column blocked to inactive;
  end if;
end $$;

alter table public.components
  add column if not exists inactive   boolean not null default false,
  add column if not exists created_by text;

-- ==========================================================================
-- 8. COMPOSITIONS — naming fix (blocked → inactive)
-- ==========================================================================

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compositions' and column_name = 'blocked'
  ) then
    alter table public.compositions rename column blocked to inactive;
  end if;
end $$;

alter table public.compositions
  add column if not exists inactive boolean not null default false;

-- ==========================================================================
-- 9. COMMODITIES — naming fix (blocked → inactive)
-- ==========================================================================

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'commodities' and column_name = 'blocked'
  ) then
    alter table public.commodities rename column blocked to inactive;
  end if;
end $$;

alter table public.commodities
  add column if not exists inactive boolean not null default false;

-- ==========================================================================
-- 10. MATERIAL_ATTRIBUTE_LINES — missing index on attribute FK
-- ==========================================================================

create index if not exists idx_material_attribute_lines_attribute
  on public.material_attribute_lines(attribute_id);
create index if not exists idx_material_attribute_lines_unit
  on public.material_attribute_lines(unit_id);
create index if not exists idx_material_attributes_category
  on public.material_attributes(category_id);
