-- ============================================================================
-- Raagam ERP — 0240 Master Data ▸ Associates ▸ Customer (master-detail)
-- Legacy EDP2 "Customer" form — the richest Associates master: a header
-- (Short Name · Blocked · Name · Doc Prefix · ID · Also Consignee · Country)
-- + an Applicant(s) sub-list (5 picker slots) + five tabs
-- (Address | Agents | Customer Supplied Items | Customer Nominated Vendors |
--  CustomerGeneral). Save / Save-as-Draft.
--
-- Phase 1 (this migration) models the header + the Address tab (same shape as
-- the Applicant master, 0238) + the Applicant slots + the Address Contact grid.
-- The other four tabs are deferred to later additive migrations once their
-- legacy screenshots are captured.
--
-- Picker fields reference existing masters:
--   country / address country          → public.countries
--   city / state / department /
--   designation / internal_department   → public.config_lookups kinds (0236)
--   applicant slots                     → public.applicants (0238)
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                                   -- "Short Name"
  name               text not null,
  blocked            boolean not null default false,
  doc_prefix         text,                                   -- document number prefix
  doc_id             text,                                   -- the "ID" field
  also_consignee     boolean not null default false,
  country_id         uuid references public.countries(id),   -- header Country
  -- Address tab -------------------------------------------------------------
  street             text,
  city_id            uuid references public.config_lookups(id) on delete set null,
  state_id           uuid references public.config_lookups(id) on delete set null,
  pin                text,
  address_country_id uuid references public.countries(id),
  land_line          text,
  fax                text,
  email              text,
  web_site           text,
  is_draft           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();
create index if not exists idx_customers_country on public.customers(country_id);

-- The 5 Applicant slots — a customer links to N applicant masters, ordered.
create table if not exists public.customer_applicants (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  sno           integer not null default 0,
  applicant_id  uuid references public.applicants(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_customer_applicants_updated before update on public.customer_applicants
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_applicants_customer on public.customer_applicants(customer_id);

-- Address-tab Contact grid — identical shape to applicant_contacts.
create table if not exists public.customer_contacts (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.customers(id) on delete cascade,
  sno                   integer not null default 0,
  department_id         uuid references public.config_lookups(id) on delete set null,
  contact_name          text,
  designation_id        uuid references public.config_lookups(id) on delete set null,
  land_line             text,
  mobile                text,
  email_id              text,
  internal_department_id uuid references public.config_lookups(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_customer_contacts_updated before update on public.customer_contacts
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_contacts_customer on public.customer_contacts(customer_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['customers','customer_applicants','customer_contacts'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
