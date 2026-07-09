-- ============================================================================
-- Raagam ERP — 0232 Master Data ▸ Associates ▸ Countries
-- Legacy EDP2 "Country" form: Code · Country Group (EU/USA/CANADA/OTHERS) ·
-- ECGC Code · Name · ISD Code · Default Country · Blocked, with Save / Save As
-- Drafts (is_draft). First rich Associates child. RLS = 0218 style (masters).
-- ============================================================================

create table if not exists public.countries (
  id              uuid primary key default gen_random_uuid(),
  code            text,
  name            text not null,
  country_group   text check (country_group is null or country_group in ('EU','USA','CANADA','OTHERS')),
  ecgc_code       text,
  isd_code        text,
  default_country boolean not null default false,
  blocked         boolean not null default false,
  is_draft        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_countries_updated before update on public.countries
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
begin
  execute $f$
    create policy countries_read on public.countries for select to authenticated using (true);
    create policy countries_insert on public.countries for insert to authenticated with check (public.has_permission('masters','create'));
    create policy countries_update on public.countries for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy countries_delete on public.countries for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.countries enable row level security;
end $$;
