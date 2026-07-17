-- ============================================================================
-- Raagam ERP — 0278 New Master Tables
-- Creates missing master tables identified by reverse-engineering the client's
-- VB.NET ERP (Value Plus 3.0 / Masters_DAL). All tables are idempotent
-- (IF NOT EXISTS), follow the project's blocked/created_at/updated_at pattern,
-- and have standard RLS policies.
-- ============================================================================

-- ==========================================================================
-- 1. OUR_BANKS — Company's own bank accounts (distinct from counterparty banks)
-- ==========================================================================

create table if not exists public.our_banks (
  id           uuid primary key default gen_random_uuid(),
  account_no   text,
  account_name text,
  bank_name    text,
  branch_name  text,
  swift_code   text,
  ifsc_code    text,
  address      text,
  blocked      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ==========================================================================
-- 2. DIVISIONS — Business units / divisions
-- ==========================================================================

create table if not exists public.divisions (
  id                uuid primary key default gen_random_uuid(),
  division_id       text unique,
  division_name     text not null,
  document_prefix_id text,
  blocked           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ==========================================================================
-- 3. SEASONS — Style seasons
-- ==========================================================================

create table if not exists public.seasons (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,
  season_yr    text,
  season_name  text,
  blocked      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ==========================================================================
-- 4. BRANDS — Brand master (party sub-type)
-- ==========================================================================

create table if not exists public.brands (
  id               uuid primary key default gen_random_uuid(),
  brand_short_name text unique,
  brand_name       text not null,
  country_id       uuid references public.countries(id) on delete set null,
  website          text,
  phone            text,
  fax              text,
  blocked          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_brands_country on public.brands(country_id);

-- ==========================================================================
-- 5. SIZE_GROUPS — Size groupings (S/M/L/XL sets)
-- ==========================================================================

create table if not exists public.size_groups (
  id              uuid primary key default gen_random_uuid(),
  size_group_no   text unique,
  size_group_name text,
  blocked         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ==========================================================================
-- 6. SIZE_GROUP_SIZES — Individual sizes within a group
-- ==========================================================================

create table if not exists public.size_group_sizes (
  id            uuid primary key default gen_random_uuid(),
  size_group_id uuid not null references public.size_groups(id) on delete cascade,
  size_name     text not null,
  sort_order    integer,
  blocked       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_size_group_sizes_group on public.size_group_sizes(size_group_id);

-- ==========================================================================
-- 7. SHADE_GROUPS — Shade groupings
-- ==========================================================================

create table if not exists public.shade_groups (
  id         uuid primary key default gen_random_uuid(),
  short_name text unique,
  name       text not null,
  hours_reqd numeric,
  blocked    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==========================================================================
-- 8. SHADES — Individual shades within a shade group
-- ==========================================================================

create table if not exists public.shades (
  id             uuid primary key default gen_random_uuid(),
  shade_group_id uuid references public.shade_groups(id) on delete cascade,
  shade_id       text,
  short_name     text,
  shade_name     text,
  blocked        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_shades_shade_group on public.shades(shade_group_id);

-- ==========================================================================
-- 9. COLORS — Simple colour master
-- ==========================================================================

create table if not exists public.colors (
  id         uuid primary key default gen_random_uuid(),
  color_name text not null unique,
  blocked    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==========================================================================
-- 10. ZONES — Sales zones
-- ==========================================================================

create table if not exists public.zones (
  id              uuid primary key default gen_random_uuid(),
  zone_short_name text unique,
  zone_name       text not null,
  blocked         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ==========================================================================
-- 11. ZONE_AREAS — Areas within zones
--     No public.areas table exists, so we store area_name as text.
-- ==========================================================================

create table if not exists public.zone_areas (
  id        uuid primary key default gen_random_uuid(),
  zone_id   uuid not null references public.zones(id) on delete cascade,
  area_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_zone_areas_zone on public.zone_areas(zone_id);

-- ==========================================================================
-- 12. BINS — Storage bin locations
-- ==========================================================================

create table if not exists public.bins (
  id          uuid primary key default gen_random_uuid(),
  bin_code    text not null,
  location_id uuid references public.locations(id) on delete set null,
  description text,
  blocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_bins_location on public.bins(location_id);

-- ==========================================================================
-- 13. CERTIFICATIONS — Certification standards
-- ==========================================================================

create table if not exists public.certifications (
  id                 uuid primary key default gen_random_uuid(),
  certification_name text not null,
  description        text,
  blocked            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ==========================================================================
-- 14. CERTIFICATION_VALIDITIES — Validity periods
-- ==========================================================================

create table if not exists public.certification_validities (
  id               uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications(id) on delete cascade,
  valid_from       date,
  valid_to         date,
  blocked          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_certification_validities_cert on public.certification_validities(certification_id);


-- ==========================================================================
-- TRIGGERS — set_updated_at for all new tables
-- ==========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'our_banks','divisions','seasons','brands','size_groups','size_group_sizes',
    'shade_groups','shades','colors','zones','zone_areas','bins',
    'certifications','certification_validities'
  ] loop
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_' || t || '_updated'
    ) then
      execute format(
        'create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()',
        t
      );
    end if;
  end loop;
end $$;


-- ==========================================================================
-- RLS — enable + standard read-open / write-gated policies for all new tables
-- ==========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'our_banks','divisions','seasons','brands','size_groups','size_group_sizes',
    'shade_groups','shades','colors','zones','zone_areas','bins',
    'certifications','certification_validities'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = t || '_read'
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s for select to authenticated using (true);
        create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
        create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
        create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
      $f$, t);
    end if;
  end loop;
end $$;
