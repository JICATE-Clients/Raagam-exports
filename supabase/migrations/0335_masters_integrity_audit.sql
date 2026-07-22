-- ============================================================================
-- Raagam ERP — 0335 Masters Integrity Audit Fixes
--
-- Addresses 6 gaps found during source-of-truth audit:
--   CRITICAL (1-3): Missing unique constraints
--   HIGH     (4-6): Missing cross-table validation + range checks + enum
-- ============================================================================

-- ==========================================================================
-- 1. CRITICAL: config_lookups — add unique on (kind, code)
--    Migration 0317 added (kind, lower(name)), but (kind, code) is missing.
--    Without this, two lookups of the same kind can share a code.
-- ==========================================================================
create unique index if not exists uq_config_lookups_kind_code
  on public.config_lookups (kind, lower(trim(code)))
  where code is not null;

-- ==========================================================================
-- 2. CRITICAL: categories — scoped unique on (item_class_id, short_name)
--    App-level dup-guard checks this, but no DB constraint backs it.
--    Two categories with the same short_name under the same item class
--    would cause picker confusion.
-- ==========================================================================
create unique index if not exists uq_categories_per_class
  on public.categories (item_class_id, lower(trim(short_name)))
  where short_name is not null;

-- ==========================================================================
-- 3. CRITICAL: destinations — scoped unique on (country_id, short_name)
--    Duplicate destination names per country cause shipment routing errors.
-- ==========================================================================
create unique index if not exists uq_destinations_per_country
  on public.destinations (country_id, lower(trim(short_name)))
  where short_name is not null;

-- ==========================================================================
-- 4. HIGH: items — cross-table validation (category must belong to item class)
--    If a material references item_class=YARN but category belongs to FABRIC,
--    downstream BOM/costing logic breaks silently.
-- ==========================================================================
create or replace function public.validate_item_class_category()
returns trigger as $$
begin
  if new.item_class_id is not null and new.category_id is not null then
    if (select item_class_id from public.categories where id = new.category_id)
       is distinct from new.item_class_id
    then
      raise exception 'Category must belong to the selected Item Class';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_item_class_category_check on public.items;
create trigger trg_item_class_category_check
  before insert or update on public.items
  for each row execute function public.validate_item_class_category();

-- ==========================================================================
-- 5. HIGH: categories — percentage columns must be 0–100
--    wastage_per, profit_per, freight_per, insurance_per, interest_per
--    are used in costing calculations; values outside 0–100 corrupt output.
-- ==========================================================================
alter table public.categories
  drop constraint if exists chk_categories_wastage_range,
  drop constraint if exists chk_categories_profit_range,
  drop constraint if exists chk_categories_freight_range,
  drop constraint if exists chk_categories_insurance_range,
  drop constraint if exists chk_categories_interest_range;

alter table public.categories
  add constraint chk_categories_wastage_range
    check (wastage_per is null or (wastage_per >= 0 and wastage_per <= 100)),
  add constraint chk_categories_profit_range
    check (profit_per is null or (profit_per >= 0 and profit_per <= 100)),
  add constraint chk_categories_freight_range
    check (freight_per is null or (freight_per >= 0 and freight_per <= 100)),
  add constraint chk_categories_insurance_range
    check (insurance_per is null or (insurance_per >= 0 and insurance_per <= 100)),
  add constraint chk_categories_interest_range
    check (interest_per is null or (interest_per >= 0 and interest_per <= 100));

-- ==========================================================================
-- 6. HIGH: ports — add port_type enum constraint
--    VB.NET source enforces Air/Sea/Sea-Air. Currently free text.
-- ==========================================================================
alter table public.ports
  drop constraint if exists chk_ports_port_type;

alter table public.ports
  add constraint chk_ports_port_type
    check (port_type is null or port_type in ('Air','Sea','Sea-Air'));
