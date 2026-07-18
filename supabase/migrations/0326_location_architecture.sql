-- ============================================================================
-- Raagam ERP — 0326 Location Architecture
--
-- Implements Option A: Single DB with location_id on transactional tables.
-- Adds location_id to ~19 tables that need location-scoped data isolation.
-- Adds has_location_access() function for RLS enforcement.
-- Adds tally_company_name to locations for Tally integration.
--
-- Design rules:
-- - location_id is NULLABLE (NULL = company-wide / unassigned)
-- - Masters/config tables: NO location_id (shared across locations)
-- - Sales tables: NO location_id (merchandising is centralized)
-- - Location enters the flow at order confirmation (sales_orders already has it)
-- ============================================================================

-- ==========================================================================
-- 1. Add tally_company_name to locations (for future Tally integration)
-- ==========================================================================
alter table public.locations
  add column if not exists tally_company_name text;

-- ==========================================================================
-- 2. has_location_access() — checks if a user can see data from a location
--    Returns TRUE if:
--    - User is super_admin
--    - User has ANY role with location_id IS NULL (global role)
--    - User has ANY role with location_id = the given location
-- ==========================================================================
create or replace function public.has_location_access(
  p_location_id uuid, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin(uid) or exists (
    select 1
    from public.user_roles ur
    where ur.user_id = uid
    and (ur.location_id is null or ur.location_id = p_location_id)
  );
$$;

-- Grant only to authenticated (same pattern as has_permission)
revoke execute on function public.has_location_access(uuid, uuid) from public;
grant execute on function public.has_location_access(uuid, uuid) to authenticated;

-- ==========================================================================
-- 3. Add location_id to Logistics tables
-- ==========================================================================
alter table public.shipments
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_shipments_location on public.shipments(location_id);

alter table public.proforma_invoices
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_proforma_invoices_location on public.proforma_invoices(location_id);

alter table public.lc_details
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_lc_details_location on public.lc_details(location_id);

alter table public.epcg_declarations
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_epcg_declarations_location on public.epcg_declarations(location_id);

alter table public.domestic_garment_invoices
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_domestic_invoices_location on public.domestic_garment_invoices(location_id);

-- ==========================================================================
-- 4. Add location_id to Finance tables
-- ==========================================================================
alter table public.bank_journals
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_bank_journals_location on public.bank_journals(location_id);

alter table public.forward_contracts
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_forward_contracts_location on public.forward_contracts(location_id);

alter table public.cheques
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_cheques_location on public.cheques(location_id);

alter table public.bank_limits
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_bank_limits_location on public.bank_limits(location_id);

alter table public.other_income_expenses
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_other_income_expenses_location on public.other_income_expenses(location_id);

alter table public.provisional_invoices
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_provisional_invoices_location on public.provisional_invoices(location_id);

alter table public.party_openings
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_party_openings_location on public.party_openings(location_id);

-- ==========================================================================
-- 5. Add location_id to Planning/Process tables
-- ==========================================================================
alter table public.ppm_issues
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_ppm_issues_location on public.ppm_issues(location_id);

alter table public.knitting_programs
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_knitting_programs_location on public.knitting_programs(location_id);

alter table public.process_jobs
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_process_jobs_location on public.process_jobs(location_id);

-- ==========================================================================
-- 6. Add location_id to Integration table
-- ==========================================================================
alter table public.tally_exports
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_tally_exports_location on public.tally_exports(location_id);

-- ==========================================================================
-- 7. Add location_id to Admin table
-- ==========================================================================
alter table public.courier_despatches
  add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists idx_courier_despatches_location on public.courier_despatches(location_id);
