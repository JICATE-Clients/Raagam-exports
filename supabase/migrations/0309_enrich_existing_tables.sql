-- ============================================================================
-- Raagam ERP — 0279 Enrich Existing Tables
-- Adds missing columns to existing master tables, identified by comparing our
-- Supabase schema against the client's VB.NET ERP (Value Plus 3.0 / Masters_DAL).
-- All statements are idempotent (ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ==========================================================================
-- 1. UOMS — extra classification flags and GST UQC code
--    Existing cols: id, code, name, is_active (from 0004)
-- ==========================================================================

alter table public.uoms
  add column if not exists decimal_places_allowed integer default 2,
  add column if not exists unit_code    text,
  add column if not exists is_fabric    boolean not null default false,
  add column if not exists is_yarn      boolean not null default false,
  add column if not exists is_sewing    boolean not null default false,
  add column if not exists is_packing   boolean not null default false,
  add column if not exists is_general   boolean not null default false,
  add column if not exists is_garment   boolean not null default false;

-- ==========================================================================
-- 2. CURRENCIES — subunit name
--    Existing cols: code (PK), name, symbol (from 0004)
-- ==========================================================================

alter table public.currencies
  add column if not exists money_unit text;

-- ==========================================================================
-- 3. BANKS — interest rate
--    bank_type already exists (0235), own_bank already exists (0277)
-- ==========================================================================

alter table public.banks
  add column if not exists interest_per numeric;

-- ==========================================================================
-- 4. DEPARTMENTS — outsourcing flag, sequence numbers, item-class booleans
--    Existing cols: id, short_name, name, doc_prefix, warehouse,
--      blocked/inactive, item_classes (text[]), strength (0277)
--    The client stores item-class applicability as individual booleans;
--    we already have item_classes text[] but add booleans for compatibility.
-- ==========================================================================

alter table public.departments
  add column if not exists is_outsourcing    boolean not null default false,
  add column if not exists sequence_no       integer,
  add column if not exists staff_sequence_no integer,
  add column if not exists is_fabric         boolean not null default false,
  add column if not exists is_yarn           boolean not null default false,
  add column if not exists is_sewing         boolean not null default false,
  add column if not exists is_packing        boolean not null default false,
  add column if not exists is_general        boolean not null default false,
  add column if not exists is_garment        boolean not null default false;

-- ==========================================================================
-- 5. EMPLOYEE_CATEGORIES — alias, pay type, attendance incentives
--    0277 already added a large set of payroll columns; these are the
--    remaining administrative/display fields from the client.
-- ==========================================================================

alter table public.employee_categories
  add column if not exists category_alias_name    text,
  add column if not exists pay_type               text default 'M',
  add column if not exists paid_day               text,
  add column if not exists attendance_bonus        numeric default 0,
  add column if not exists attendance_incentive    numeric default 0;

-- ==========================================================================
-- 6. EMPLOYEES — spouse type, confirmation/filing dates, employee type
--    0277 already added statutory IDs, payroll linkage, service history.
--    These are the remaining fields from the client's Employee master.
-- ==========================================================================

alter table public.employees
  add column if not exists spouse_type          text,
  add column if not exists date_of_confirmation date,
  add column if not exists date_of_filing       date,
  add column if not exists employee_type        text default 'S';

-- ==========================================================================
-- 7. CUSTOMERS — notify flag, business entity, inhouse unit
--    also_consignee already exists (0240).
-- ==========================================================================

alter table public.customers
  add column if not exists also_notify      boolean not null default false,
  add column if not exists business_entity  text,
  add column if not exists inhouse_unit_id  text;

-- ==========================================================================
-- 8. MASTER_VENDORS — enterprise status, memorandum, inhouse unit, duty
--    is_processor already exists (0246). This is the Associates "master_vendors"
--    table (not the core purchase "vendors" table from 0008).
-- ==========================================================================

alter table public.master_vendors
  add column if not exists enterprise_status text,
  add column if not exists memorandum_no     text,
  add column if not exists inhouse_unit_id   text,
  add column if not exists duty_against      text;

-- ==========================================================================
-- 9. COUNTRIES — MEIS eligibility
--    country_group and ecgc_code already exist (0232).
-- ==========================================================================

alter table public.countries
  add column if not exists meis_eligible boolean not null default false;

-- ==========================================================================
-- 10. CATEGORIES (item categories) — costing percentages, size group, monitoring
--     Existing cols: id, item_class_id, short_name, name, short_spec, made,
--       levy_id, commodity_id, blocked (0223)
-- ==========================================================================

alter table public.categories
  add column if not exists wastage_per            numeric default 0,
  add column if not exists profit_per             numeric default 0,
  add column if not exists freight_per            numeric default 0,
  add column if not exists insurance_per          numeric default 0,
  add column if not exists interest_per           numeric default 0,
  add column if not exists size_group_id          uuid references public.size_groups(id) on delete set null,
  add column if not exists status_monitoring_type text;

create index if not exists idx_categories_size_group on public.categories(size_group_id);

-- ==========================================================================
-- 11. LOCATIONS — PF number prefix
--     Existing cols: id, code, name, gst_number, is_active (0001)
-- ==========================================================================

alter table public.locations
  add column if not exists pf_no_prefix text;

-- ==========================================================================
-- 12. GST_RATES — purchase/sales discriminator
--     Existing cols: id, name, rate_pct, hsn_code, is_active (0218)
-- ==========================================================================

alter table public.gst_rates
  add column if not exists gst_for text;
