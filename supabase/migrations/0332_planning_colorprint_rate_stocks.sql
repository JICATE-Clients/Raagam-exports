-- ============================================================================
-- Raagam ERP — 0332 Planning ▸ Color/Print Details + Material Rate + General Stocks
--
-- Color/Print Details = assign dyeing/print specifications for orders.
-- Material Rate = manage rates by item class, process, UOM.
-- General Stocks = stock group classification for planning lookups.
-- ============================================================================

-- ==========================================================================
-- 1. Color/Print Details
-- ==========================================================================
create sequence if not exists public.seq_color_print_detail;
create table if not exists public.color_print_details (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  entry_date            date not null default current_date,
  entry_type            text not null check (entry_type in ('yarn_dyeing','fabric_dyeing','fabric_print','garment_design','accessories')),
  process_name          text,
  process_id            uuid,
  location_id           uuid references public.locations(id) on delete set null,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cpd_code before insert on public.color_print_details
  for each row execute function public.assign_code('CPD','public.seq_color_print_detail');
create trigger trg_cpd_updated before update on public.color_print_details
  for each row execute function public.set_updated_at();
create index if not exists idx_cpd_type on public.color_print_details(entry_type);

-- Color/Print Detail Lines
create table if not exists public.color_print_detail_lines (
  id                    uuid primary key default gen_random_uuid(),
  color_print_id        uuid not null references public.color_print_details(id) on delete cascade,
  sno                   integer not null default 0,
  color_type            text,
  description           text not null,
  process_loss_pct      numeric(8,2) default 0,
  blocked               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_cpdl_updated before update on public.color_print_detail_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_cpdl_cpd on public.color_print_detail_lines(color_print_id);

-- ==========================================================================
-- 2. Material Rates
-- ==========================================================================
create sequence if not exists public.seq_material_rate;
create table if not exists public.material_rate_entries (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  entry_date            date not null default current_date,
  group_no              text,
  group_description     text,
  customer_id           uuid references public.buyers(id) on delete set null,
  parent_group_id       uuid references public.material_rate_entries(id) on delete set null,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_mre_code before insert on public.material_rate_entries
  for each row execute function public.assign_code('MRT','public.seq_material_rate');
create trigger trg_mre_updated before update on public.material_rate_entries
  for each row execute function public.set_updated_at();

-- Material Rate Items
create table if not exists public.material_rate_items (
  id                    uuid primary key default gen_random_uuid(),
  rate_entry_id         uuid not null references public.material_rate_entries(id) on delete cascade,
  sno                   integer not null default 0,
  item_class_name       text,
  description           text,
  process_name          text,
  rate_uom_id           text,
  rate                  numeric(14,4) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_mri_updated before update on public.material_rate_items
  for each row execute function public.set_updated_at();
create index if not exists idx_mri_entry on public.material_rate_items(rate_entry_id);

-- ==========================================================================
-- 3. General Stocks (stock group classification)
-- ==========================================================================
create sequence if not exists public.seq_general_stock;
create table if not exists public.general_stock_groups (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  group_date            date not null default current_date,
  group_description     text,
  long_description      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_gsg_code before insert on public.general_stock_groups
  for each row execute function public.assign_code('GSG','public.seq_general_stock');
create trigger trg_gsg_updated before update on public.general_stock_groups
  for each row execute function public.set_updated_at();

-- General Stock Group Item Classes
create table if not exists public.general_stock_item_classes (
  id                    uuid primary key default gen_random_uuid(),
  stock_group_id        uuid not null references public.general_stock_groups(id) on delete cascade,
  item_class_code       text not null,
  is_selected           boolean not null default false,
  created_at            timestamptz not null default now()
);
create index if not exists idx_gsic_group on public.general_stock_item_classes(stock_group_id);

-- ==========================================================================
-- 4. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'color_print_details','color_print_detail_lines',
    'material_rate_entries','material_rate_items',
    'general_stock_groups','general_stock_item_classes'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('planning','delete'));
    $f$, t);
  end loop;
end $$;
