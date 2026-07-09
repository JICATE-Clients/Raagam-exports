-- ============================================================================
-- Raagam ERP — 0252 Master Data ▸ Associates ▸ Courier Delivery Address
-- Legacy EDP2 "Courier Delivery Address" form — structurally identical to Notify
-- (0239): header (Short Name · Name · Blocked · Country) + Address (Street ·
-- City · State · Pin · Country · Land Line · Fax · E-Mail · Web site) + a
-- Contact child grid. Same picker wiring:
--   country / address country       → public.countries (red ⓘ)
--   city / state (address)          → public.config_lookups kind city/state (green ⊕)
--   department / designation /
--   internal_department (grid)      → public.config_lookups kinds (0236)
-- RLS = masters.
-- ============================================================================

create table if not exists public.courier_delivery_addresses (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                                   -- "Short Name"
  name               text not null,
  blocked            boolean not null default false,
  country_id         uuid references public.countries(id),   -- header Country
  -- Address -----------------------------------------------------------------
  street             text,
  city_id            uuid references public.config_lookups(id) on delete set null,
  state_id           uuid references public.config_lookups(id) on delete set null,
  pin                text,
  address_country_id uuid references public.countries(id),
  land_line          text,
  fax                text,
  email              text,
  web_site           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_courier_delivery_addresses_updated before update on public.courier_delivery_addresses
  for each row execute function public.set_updated_at();
create index if not exists idx_courier_delivery_addresses_country on public.courier_delivery_addresses(country_id);

create table if not exists public.courier_delivery_contacts (
  id                     uuid primary key default gen_random_uuid(),
  courier_id             uuid not null references public.courier_delivery_addresses(id) on delete cascade,
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
create trigger trg_courier_delivery_contacts_updated before update on public.courier_delivery_contacts
  for each row execute function public.set_updated_at();
create index if not exists idx_courier_delivery_contacts_courier on public.courier_delivery_contacts(courier_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['courier_delivery_addresses','courier_delivery_contacts'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
