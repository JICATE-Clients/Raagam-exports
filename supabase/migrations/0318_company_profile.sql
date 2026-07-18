-- ============================================================================
-- Raagam ERP — 0318 Company Profile (singleton)
--
-- Legal entity profile — company name, address, registration numbers, logos,
-- insurance, and export certifications. One row per company (singleton).
-- Derived from VB.NET FrmCompany (3998 LOC) + CompanyData entity.
--
-- RLS: system_admin for all operations.
-- ============================================================================

create table if not exists public.company_profile (
  id                    uuid primary key default gen_random_uuid(),

  -- Identity
  company_short_name    text,
  company_name          text not null,
  document_prefix_id    text,

  -- Registered address
  street1               text,
  street2               text,
  street3               text,
  city                  text,
  pin_code              text,
  state                 text,
  state_id              uuid references public.config_lookups(id) on delete set null,
  country_code          text,
  phone                 text,
  fax                   text,
  email                 text,
  website               text,

  -- Registered office (if different)
  reg_street1           text,
  reg_street2           text,
  reg_street3           text,
  reg_city              text,
  reg_pin_code          text,
  reg_state             text,

  -- Statutory / registration
  pan_no                text,
  gstin                 text,
  cin_no                text,
  ie_code               text,
  rbi_code              text,
  reg_no                text,
  cu_licence_no         text,
  service_tax_no        text,
  employer_code         text,
  ad_code               text,
  ediac_no              text,

  -- Export certifications
  aepc_no               text,
  aepc_date             date,
  rex_no                text,
  lut_no                text,
  lut_date              date,
  textile_committee_no  text,
  textile_committee_date date,
  renewed_on            date,
  valid_upto            date,
  gots_no               text,
  bci_no                text,
  oekotex_no            text,

  -- Central excise (legacy, may be unused post-GST)
  ce_commissionerate    text,
  ce_division           text,
  ce_range              text,
  ce_range_address1     text,
  ce_range_address2     text,

  -- Insurance
  insurance_company     text,
  insurance_policy_no   text,
  insurance_policy_date date,
  export_insurance_pct  numeric(5,2),

  -- Payroll
  min_wages             numeric(12,2),
  bonus_from_date       date,

  -- Document footer
  footer_text           text,

  -- Logos (stored as bytea or URL — bytea matches VB.NET pattern)
  logo                  text,
  logo2                 text,
  logo_with_name        text,
  with_logo             boolean not null default false,

  -- HO flag + location link
  is_ho                 boolean not null default false,
  location_ids          text,

  -- Timestamps
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_company_profile_updated before update on public.company_profile
  for each row execute function public.set_updated_at();

alter table public.company_profile enable row level security;
create policy company_profile_read on public.company_profile
  for select to authenticated using (true);
create policy company_profile_insert on public.company_profile
  for insert to authenticated with check (public.has_permission('system_admin','create'));
create policy company_profile_update on public.company_profile
  for update to authenticated
  using (public.has_permission('system_admin','edit'))
  with check (public.has_permission('system_admin','edit'));
