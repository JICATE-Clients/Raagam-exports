-- ============================================================================
-- Raagam ERP — 0315 Data Integrity Audit ▸ Add missing UNIQUE constraints
--
-- The dup-guard (lib/masters/dup-guard.ts) enforces case-insensitive name
-- uniqueness at the app layer, but a direct SQL insert or data import could
-- bypass it.  This migration adds DB-level UNIQUE constraints to match every
-- field that dup-guard already checks, closing the gap.
--
-- Also adds UNIQUE(kind, lower(name)) on config_lookups so two lookups of the
-- same kind can never share a name.
-- ============================================================================

-- ---------------------------------------------------------------
-- 1. config_lookups — composite unique on (kind, name)
--    dup-guard: checkDuplicateName(…, { scope: { kind } })
-- ---------------------------------------------------------------
create unique index if not exists uq_config_lookups_kind_name
  on public.config_lookups (kind, lower(trim(name)));

-- ---------------------------------------------------------------
-- 2. Dedicated master tables — name columns checked by dup-guard
-- ---------------------------------------------------------------

-- brands.brand_name  (brand_short_name already UNIQUE)
create unique index if not exists uq_brands_brand_name
  on public.brands (lower(trim(brand_name)));

-- divisions.division_name  (division_id already UNIQUE)
create unique index if not exists uq_divisions_division_name
  on public.divisions (lower(trim(division_name)));

-- seasons.season_name
create unique index if not exists uq_seasons_season_name
  on public.seasons (lower(trim(season_name)));

-- zones.zone_name  (zone_short_name already UNIQUE)
create unique index if not exists uq_zones_zone_name
  on public.zones (lower(trim(zone_name)));

-- shade_groups.name  (short_name already UNIQUE)
create unique index if not exists uq_shade_groups_name
  on public.shade_groups (lower(trim(name)));

-- bins.bin_code
create unique index if not exists uq_bins_bin_code
  on public.bins (lower(trim(bin_code)));

-- certifications.certification_name
create unique index if not exists uq_certifications_certification_name
  on public.certifications (lower(trim(certification_name)));

-- compositions.name  (scoped by item_class_id, matching dup-guard logic)
create unique index if not exists uq_compositions_name
  on public.compositions (lower(trim(name)));

-- processes.name
create unique index if not exists uq_processes_name
  on public.processes (lower(trim(name)));

-- components.short_name
create unique index if not exists uq_components_short_name
  on public.components (lower(trim(short_name)));

-- commodities.name
create unique index if not exists uq_commodities_name
  on public.commodities (lower(trim(name)));

-- packing_instructions.packing_type
create unique index if not exists uq_packing_instructions_packing_type
  on public.packing_instructions (lower(trim(packing_type)));

-- packing_methods.packing_type
create unique index if not exists uq_packing_methods_packing_type
  on public.packing_methods (lower(trim(packing_type)));

-- our_banks.account_no
create unique index if not exists uq_our_banks_account_no
  on public.our_banks (lower(trim(account_no)));

-- style_levels.level_short_name
create unique index if not exists uq_style_levels_level_short_name
  on public.style_levels (lower(trim(level_short_name)));

-- color_name already has a plain UNIQUE in 0308, skip.
-- style_names.short_name already has a plain UNIQUE in 0307, skip.
-- size_groups.size_group_no already has a plain UNIQUE in 0308, skip.
