-- ============================================================================
-- Raagam ERP — 0276 Associates Schema Catch-Up
-- Brings migration files in sync with the live Supabase DB for all Associates
-- tables. Columns were added during development without migration files.
-- Idempotent (IF NOT EXISTS / IF EXISTS throughout).
-- ============================================================================

-- ==========================================================================
-- 1. UNIVERSAL: blocked → inactive rename across all Associates tables
-- ==========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'countries','destinations','banks','receivable_terms','applicants',
    'notifies','customers','consignees','payment_terms','employees',
    'master_vendors','account_groups','account_heads','merchandising_teams',
    'courier_delivery_addresses','states'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'blocked'
    ) then
      execute format('alter table public.%I rename column blocked to inactive', t);
    end if;
    -- Ensure inactive exists for fresh deploys
    execute format(
      'alter table public.%I add column if not exists inactive boolean not null default false', t
    );
  end loop;
end $$;

-- ==========================================================================
-- 2. APPLICANTS — extra payment/shipping columns
-- ==========================================================================

alter table public.applicants
  add column if not exists ac_no           text,
  add column if not exists bank_id         uuid references public.banks(id) on delete set null,
  add column if not exists currency_1      text,
  add column if not exists currency_2      text,
  add column if not exists currency_3      text,
  add column if not exists pay_mode        text,
  add column if not exists payment_term_id uuid references public.receivable_terms(id) on delete set null,
  add column if not exists ship_mode       text,
  add column if not exists ship_type_id    uuid references public.config_lookups(id) on delete set null;

-- ==========================================================================
-- 3. CUSTOMERS — extra export/shipping/format columns
-- ==========================================================================

alter table public.customers
  add column if not exists color_spec_applicable          boolean not null default false,
  add column if not exists commercial_invoice_format_id   uuid references public.config_lookups(id) on delete set null,
  add column if not exists currency_1                     text,
  add column if not exists currency_2                     text,
  add column if not exists currency_3                     text,
  add column if not exists final_destination_id           uuid references public.destinations(id) on delete set null,
  add column if not exists gst_no                         text,
  add column if not exists packing_list_format_id         uuid references public.config_lookups(id) on delete set null,
  add column if not exists pay_mode                       text,
  add column if not exists port_of_discharge_id           uuid references public.ports(id) on delete set null,
  add column if not exists port_of_loading_id             uuid references public.ports(id) on delete set null,
  add column if not exists pref_courier_id                uuid references public.config_lookups(id) on delete set null,
  add column if not exists receivable_term_id             uuid references public.receivable_terms(id) on delete set null,
  add column if not exists ship_mode                      text,
  add column if not exists ship_type_id                   uuid references public.config_lookups(id) on delete set null,
  add column if not exists tcs_applicable                 boolean not null default false;

-- Customer child tables added after 0240
create table if not exists public.customer_agents (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  sno           integer not null default 0,
  agent_id      uuid references public.config_lookups(id) on delete set null,
  agent_type_id uuid references public.config_lookups(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_customer_agents_customer on public.customer_agents(customer_id);

create table if not exists public.customer_markings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sno         integer not null default 0,
  marking     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_customer_markings_customer on public.customer_markings(customer_id);

create table if not exists public.customer_nominated_vendors (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sno         integer not null default 0,
  vendor_id   uuid references public.master_vendors(id) on delete set null,
  list_kind   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_customer_nominated_vendors_customer on public.customer_nominated_vendors(customer_id);

-- ==========================================================================
-- 4. CONSIGNEES — extra payment/shipping/tax columns
-- ==========================================================================

alter table public.consignees
  add column if not exists ac_no           text,
  add column if not exists bank_id         uuid references public.banks(id) on delete set null,
  add column if not exists currency_1      text,
  add column if not exists currency_2      text,
  add column if not exists currency_3      text,
  add column if not exists gst_no          text,
  add column if not exists pan_no          text,
  add column if not exists pay_mode        text,
  add column if not exists payment_term_id uuid references public.receivable_terms(id) on delete set null,
  add column if not exists ship_mode       text,
  add column if not exists ship_type_id    uuid references public.config_lookups(id) on delete set null,
  add column if not exists tin_no          text,
  add column if not exists tin_no_2        text,
  add column if not exists tin_no_3        text;

-- Consignee child tables added after 0245
create table if not exists public.consignee_markings (
  id           uuid primary key default gen_random_uuid(),
  consignee_id uuid not null references public.consignees(id) on delete cascade,
  sno          integer not null default 0,
  marking      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_consignee_markings_consignee on public.consignee_markings(consignee_id);

create table if not exists public.consignee_notifies (
  id           uuid primary key default gen_random_uuid(),
  consignee_id uuid not null references public.consignees(id) on delete cascade,
  sno          integer not null default 0,
  notify_id    uuid references public.notifies(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_consignee_notifies_consignee on public.consignee_notifies(consignee_id);

-- ==========================================================================
-- 5. MASTER_VENDORS — extra bank/accounting columns
-- ==========================================================================

alter table public.master_vendors
  add column if not exists ac_no           text,
  add column if not exists ac_type         text,
  add column if not exists bank_name       text,
  add column if not exists branch          text,
  add column if not exists credit_group_id uuid references public.account_groups(id) on delete set null,
  add column if not exists debit_group_id  uuid references public.account_groups(id) on delete set null,
  add column if not exists gst_no          text,
  add column if not exists gst_reg_status  text,
  add column if not exists ifsc_code       text;

-- ==========================================================================
-- 6. EMPLOYEES — blocked → inactive already handled above
--    Note: category_id/department_id/designation_id still point to
--    config_lookups. The dedicated employee_categories/departments/
--    designations tables exist separately. Re-pointing is a future task.
-- ==========================================================================

-- ==========================================================================
-- 7. HSN_DETAILS — extra columns
-- ==========================================================================

alter table public.hsn_details
  add column if not exists for_type       text,
  add column if not exists item_class_id  uuid references public.config_lookups(id) on delete set null,
  add column if not exists is_draft       boolean not null default false;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hsn_details' and column_name = 'blocked'
  ) then
    alter table public.hsn_details rename column blocked to inactive;
  end if;
end $$;
alter table public.hsn_details
  add column if not exists inactive boolean not null default false;

-- ==========================================================================
-- 8. EXCHANGE_RATE_DETAILS — new table not in original migration
-- ==========================================================================

create table if not exists public.exchange_rate_details (
  id             uuid primary key default gen_random_uuid(),
  currency_code  text,
  rate_date      date,
  actual_rate    numeric(18,4),
  booked_rate    numeric(18,4),
  foreign_amount numeric(18,4),
  reference      text,
  remarks        text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ==========================================================================
-- 9. RLS for new child tables
-- ==========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'customer_agents','customer_markings','customer_nominated_vendors',
    'consignee_markings','consignee_notifies','exchange_rate_details'
  ] loop
    -- Skip if policies already exist
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = t || '_read'
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s for select to authenticated using (true);
        create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
        create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
        create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
      $f$, t);
      execute format('alter table public.%I enable row level security;', t);
    end if;
  end loop;
end $$;

-- ==========================================================================
-- 10. Triggers for new child tables
-- (exchange_rate_details excluded: already covered by trigger trg_erd_updated)
-- ==========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'customer_agents','customer_markings','customer_nominated_vendors',
    'consignee_markings','consignee_notifies'
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
