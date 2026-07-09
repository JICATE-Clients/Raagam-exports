-- ============================================================================
-- Raagam ERP — 0220 Master Data ▸ Materials ▸ Attributes (master-detail)
-- Legacy EDP2 "Attribute" master: header (Code/Type/Description/Blocked/Has
-- Attributes) + a child grid of attribute values (S No + Attribute). Too rich
-- for the flat config_lookups engine, so it gets its own two tables.
-- Type dropdown = fixed material-category list from the legacy form.
-- Gated by the existing 'masters' permission (read open, write gated) — 0218 style.
-- ============================================================================

create table if not exists public.attributes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  type           text check (type is null or type in (
                   'Yarn','Fabric','Sewing Accessories','Packing Accessories',
                   'General','Garments','Consumables','Capital Items')),
  description    text,
  blocked        boolean not null default false,
  has_attributes boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_attributes_updated before update on public.attributes
  for each row execute function public.set_updated_at();

create table if not exists public.attribute_values (
  id           uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references public.attributes(id) on delete cascade,
  sno          integer not null default 0,
  value        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_attribute_values_updated before update on public.attribute_values
  for each row execute function public.set_updated_at();
create index if not exists idx_attribute_values_attribute
  on public.attribute_values(attribute_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['attributes','attribute_values'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
