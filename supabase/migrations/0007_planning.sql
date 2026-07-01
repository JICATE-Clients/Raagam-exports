-- ============================================================================
-- Raagam ERP — 0007 Planning / BOM
-- Fabric BOM (component/colour/size consumption, diameter, process-loss
-- sequence) + Material BOM (sewing/packing accessories, attributes, nos+MOQ,
-- processing flag) + order-grouped Budgets (approval → downstream to purchase).
-- BOMs need NO approval; budgets DO (PRD).
-- ============================================================================

-- ---------- Fabric BOM ----------
create table if not exists public.fabric_boms (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  style_id       uuid references public.styles(id) on delete set null,
  fabric_type    text check (fabric_type in ('woven','circular','flat_knit')),
  fabric_subtype text check (fabric_subtype in ('solid','yarn_dyed','melange')),
  status         text not null default 'draft' check (status in ('draft','final')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sales_order_id)
);
create trigger trg_fbom_updated before update on public.fabric_boms
  for each row execute function public.set_updated_at();

-- component-wise + colour-wise + size-wise consumption, with diameter + loss
create table if not exists public.fabric_bom_components (
  id               uuid primary key default gen_random_uuid(),
  fabric_bom_id    uuid not null references public.fabric_boms(id) on delete cascade,
  component_name   text not null,                 -- Body, Sleeve, Collar, Rib ...
  color            text,
  size             text,
  diameter         text,                          -- e.g. "30 inch" (size-wise)
  gsm              numeric(10,2),
  consumption      numeric(14,4) not null default 0,  -- gross per piece (before loss)
  uom_id           uuid references public.uoms(id),
  process_loss_pct numeric(6,2) not null default 0,
  net_consumption  numeric(14,4) not null default 0,  -- consumption incl. loss
  sort_order       int not null default 0
);
create index if not exists idx_fbomc_bom on public.fabric_bom_components(fabric_bom_id);

-- process sequence with process-wise loss (yarn purchase → knitting → dyeing …)
create table if not exists public.fabric_bom_processes (
  id               uuid primary key default gen_random_uuid(),
  fabric_bom_id    uuid not null references public.fabric_boms(id) on delete cascade,
  sequence         int not null default 0,
  process_name     text not null,
  process_loss_pct numeric(6,2) not null default 0,
  notes            text
);
create index if not exists idx_fbomp_bom on public.fabric_bom_processes(fabric_bom_id);

-- ---------- Material BOM ----------
create table if not exists public.material_boms (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  status         text not null default 'draft' check (status in ('draft','final')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sales_order_id)
);
create trigger trg_mbom_updated before update on public.material_boms
  for each row execute function public.set_updated_at();

create table if not exists public.material_bom_items (
  id                 uuid primary key default gen_random_uuid(),
  material_bom_id    uuid not null references public.material_boms(id) on delete cascade,
  category           text not null default 'sewing_accessory'
                       check (category in ('sewing_accessory','packing_accessory')),
  item_id            uuid references public.items(id),
  description        text not null,
  attribute          text,                         -- e.g. "red label", "white label"
  uom_id             uuid references public.uoms(id),
  quantity_basis     text not null default 'nos' check (quantity_basis in ('nos','moq')),
  quantity_nos       numeric(14,3) not null default 0,
  moq                numeric(14,3),
  unit_cost          numeric(14,4) not null default 0,
  requires_processing boolean not null default false,  -- e.g. Button Coloring → DC → GRN
  processing_note    text,
  sort_order         int not null default 0
);
create index if not exists idx_mbomi_bom on public.material_bom_items(material_bom_id);

-- ---------- Budgets (group orders → pull BOM lines → approve) ----------
create sequence if not exists public.seq_budget;
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  is_grouped    boolean not null default false,
  status        text not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected')),
  currency_code text references public.currencies(code),
  total_amount  numeric(16,2) not null default 0,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_budget_code before insert on public.budgets
  for each row execute function public.assign_code('BUD','public.seq_budget');
create trigger trg_budget_updated before update on public.budgets
  for each row execute function public.set_updated_at();

-- which orders a budget covers (grouped = many; single = one)
create table if not exists public.budget_orders (
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  primary key (budget_id, sales_order_id)
);

create table if not exists public.budget_lines (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  source         text not null default 'other' check (source in ('fabric','material','other')),
  description    text not null,
  quantity       numeric(14,3) not null default 0,
  unit_cost      numeric(14,4) not null default 0,
  amount         numeric(16,2) not null default 0,
  sort_order     int not null default 0
);
create index if not exists idx_budgetlines_budget on public.budget_lines(budget_id);

-- ---------- RLS (all gated by 'planning' module) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'fabric_boms','fabric_bom_components','fabric_bom_processes',
    'material_boms','material_bom_items',
    'budgets','budget_orders','budget_lines'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- grant planning access to demo roles ----------
-- Manager: full planning incl. budget approve/export
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'planning' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: create/edit BOMs + budgets (no approve)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'planning' and p.action in ('view','create','edit')
where r.name = 'Merchandiser'
on conflict do nothing;
