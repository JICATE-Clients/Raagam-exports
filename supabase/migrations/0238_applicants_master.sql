-- ============================================================================
-- Raagam ERP — 0238 Master Data ▸ Associates ▸ Applicant (master-detail)
-- (Applied to remote as version "0237_applicants_master"; local file renumbered
--  to 0238 to avoid a duplicate 0237_ prefix with the parallel lane's
--  0237_receivable_terms_master.sql — same drift convention as 0233→0234.)
-- Legacy EDP2 "Applicant" form: a header (Short Name · Name · Blocked · Also
-- Customer · Also Consignee · Country) + two tabs (Address | General). This
-- migration builds the header + the Address tab + the Contact child grid; the
-- General tab's fields are deferred to a later additive migration.
--
-- Picker fields reference existing masters:
--   country / address country  → public.countries (red ⓘ)
--   city / state               → public.config_lookups kind 'city' / 'state'
--   department / designation /
--   internal_department (grid)  → public.config_lookups kinds (0236)
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.applicants (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                                   -- "Short Name"
  name               text not null,
  blocked            boolean not null default false,
  also_customer      boolean not null default false,
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
create trigger trg_applicants_updated before update on public.applicants
  for each row execute function public.set_updated_at();
create index if not exists idx_applicants_country on public.applicants(country_id);

create table if not exists public.applicant_contacts (
  id                    uuid primary key default gen_random_uuid(),
  applicant_id          uuid not null references public.applicants(id) on delete cascade,
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
create trigger trg_applicant_contacts_updated before update on public.applicant_contacts
  for each row execute function public.set_updated_at();
create index if not exists idx_applicant_contacts_applicant on public.applicant_contacts(applicant_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['applicants','applicant_contacts'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
