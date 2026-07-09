-- ============================================================================
-- Raagam ERP — 0222 Master Data ▸ Materials ▸ Material Attributes (master-detail)
-- Legacy EDP2 "Material attribute" form: a header (Item Class + Category) with a
-- grid of attribute specs. Each line references an Attribute (0220) + a Unit
-- (uoms) and defines value range / step / mandatory / blocked. Two tables, RLS
-- 0218-style (read open, write gated by 'masters'). `material_attribute` remains
-- an unused config_lookups kind (harmless drift, as with attribute/levy).
-- ============================================================================

create table if not exists public.material_attributes (
  id          uuid primary key default gen_random_uuid(),
  item_class  text,
  category_id uuid references public.config_lookups(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_material_attributes_updated before update on public.material_attributes
  for each row execute function public.set_updated_at();

create table if not exists public.material_attribute_lines (
  id                    uuid primary key default gen_random_uuid(),
  material_attribute_id uuid not null references public.material_attributes(id) on delete cascade,
  sno                   integer not null default 0,
  attribute_id          uuid references public.attributes(id) on delete set null,
  value_in_steps        boolean not null default false,
  start_value           numeric(14,4),
  end_value             numeric(14,4),
  unit_id               uuid references public.uoms(id) on delete set null,
  step_value            numeric(14,4),
  mandatory             boolean not null default false,
  blocked               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_material_attribute_lines_updated before update on public.material_attribute_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_material_attribute_lines_parent
  on public.material_attribute_lines(material_attribute_id);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['material_attributes','material_attribute_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
