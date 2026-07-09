-- ============================================================================
-- Raagam ERP — 0245 Master Data ▸ Associates ▸ Consignee (master-detail)
-- Legacy EDP2 "Consignee" form: a header (Short Name · Name · Blocked · Country
-- ⓘ · Also Notify [Yes/No] · Customer ⓘ) + three tabs (Address | General |
-- Notify) + a Contact child grid on the Address tab.
--
-- Structurally = Notify (0239) + also_notify + customer_id + two extra tabs.
-- This migration builds the header + Address tab + Contact grid; the General
-- and Notify tabs are deferred to a later additive migration (need screenshots).
--
-- Picker fields reference existing masters:
--   country / address country → public.countries (red ⓘ)
--   customer                   → public.customers (red ⓘ, select-only)
--   city / state               → public.config_lookups kind 'city' / 'state'
--   department / designation /
--   internal_department (grid) → public.config_lookups kinds (0236)
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.consignees (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                                   -- "Short Name"
  name               text not null,
  blocked            boolean not null default false,
  country_id         uuid references public.countries(id),   -- header Country
  also_notify        boolean not null default false,
  customer_id        uuid references public.customers(id) on delete set null,
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
create trigger trg_consignees_updated before update on public.consignees
  for each row execute function public.set_updated_at();
create index if not exists idx_consignees_country on public.consignees(country_id);
create index if not exists idx_consignees_customer on public.consignees(customer_id);

create table if not exists public.consignee_contacts (
  id                     uuid primary key default gen_random_uuid(),
  consignee_id           uuid not null references public.consignees(id) on delete cascade,
  sno                    integer not null default 0,
  department_id          uuid references public.config_lookups(id) on delete set null,
  contact_name           text,
  designation_id         uuid references public.config_lookups(id) on delete set null,
  land_line              text,
  mobile                 text,
  email_id               text,
  internal_department_id uuid references public.config_lookups(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_consignee_contacts_updated before update on public.consignee_contacts
  for each row execute function public.set_updated_at();
create index if not exists idx_consignee_contacts_consignee on public.consignee_contacts(consignee_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['consignees','consignee_contacts'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
