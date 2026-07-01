-- ============================================================================
-- Raagam ERP — 0004 Master data
-- Currencies, UOMs, buyers, items. Minimal set for the Sales→Order slice.
-- ============================================================================

create table if not exists public.currencies (
  code   text primary key,          -- ISO: GBP, EUR, INR, USD
  name   text not null,
  symbol text
);

create table if not exists public.uoms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,   -- nos, mtr, kg, gross, yard ...
  name       text not null,
  is_active  boolean not null default true
);

create table if not exists public.buyers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  country       text,
  currency_code text references public.currencies(code),
  contact_email text,
  contact_phone text,
  address       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_buyers_updated before update on public.buyers
  for each row execute function public.set_updated_at();

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  category   text,                   -- yarn, fabric, trim, packing ...
  uom_id     uuid references public.uoms(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_items_updated before update on public.items
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.currencies enable row level security;
alter table public.uoms       enable row level security;
alter table public.buyers     enable row level security;
alter table public.items      enable row level security;

-- currencies & uoms: readable by any authenticated user (used in dropdowns
-- across Sales/Orders); writable by masters editors
do $$
declare t text;
begin
  foreach t in array array['currencies','uoms','buyers','items'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('masters','edit'))
        with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (public.has_permission('masters','delete'));
    $f$, t);
  end loop;
end $$;

-- ---------- seed ----------
insert into public.currencies (code, name, symbol) values
  ('INR','Indian Rupee','₹'),
  ('GBP','Pound Sterling','£'),
  ('EUR','Euro','€'),
  ('USD','US Dollar','$')
on conflict (code) do nothing;

insert into public.uoms (code, name) values
  ('nos','Numbers'),
  ('mtr','Meters'),
  ('kg','Kilograms'),
  ('gross','Gross'),
  ('yard','Yards'),
  ('set','Set'),
  ('dzn','Dozen')
on conflict (code) do nothing;

insert into public.buyers (code, name, country, currency_code) values
  ('NEXT','NEXT','United Kingdom','GBP'),
  ('ABASIC','ABASIC','Spain','EUR')
on conflict (code) do nothing;
