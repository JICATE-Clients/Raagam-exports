-- ============================================================================
-- Raagam ERP — 0335 Planning ▸ Material Excess Plan + Fabric Consumption
--
-- Material Excess Plan = waste allowances for ordering/issuing/receiving.
-- Three allowance buckets (order/issue/receive) with size-wise overrides.
--
-- Fabric Consumption = multi-level fabric requirement reference (read-heavy).
-- Maps fabric requirements by component, structure, color, print, size.
-- ============================================================================

-- ==========================================================================
-- 1. Material Excess Plans
-- ==========================================================================
create sequence if not exists public.seq_material_excess_plan;
create table if not exists public.material_excess_plans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  sq_no                 text,
  sq_description        text,
  customer_id           uuid references public.buyers(id) on delete set null,
  entry_date            date not null default current_date,
  is_allowance_from_base boolean not null default false,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_mep_code before insert on public.material_excess_plans
  for each row execute function public.assign_code('MEP','public.seq_material_excess_plan');
create trigger trg_mep_updated before update on public.material_excess_plans
  for each row execute function public.set_updated_at();
create index if not exists idx_mep_so on public.material_excess_plans(sales_order_id);

-- ==========================================================================
-- 2. Material Excess Plan Items
-- ==========================================================================
create table if not exists public.material_excess_plan_items (
  id                       uuid primary key default gen_random_uuid(),
  excess_plan_id           uuid not null references public.material_excess_plans(id) on delete cascade,
  sno                      integer not null default 0,
  item_class_name          text,
  description              text,
  process_name             text,
  uom_id                   text,
  qty_for_plan             numeric(14,3) default 0,
  mtr_for_plan             numeric(14,3) default 0,
  wt_for_plan              numeric(14,4) default 0,
  -- Order allowance
  allowance_type_order     text check (allowance_type_order is null or allowance_type_order in ('pct','qty','mtr','wt')),
  allowance_value_order    numeric(14,4) default 0,
  allowed_to_order         numeric(14,3) default 0,
  -- Issue allowance
  allowance_type_issue     text check (allowance_type_issue is null or allowance_type_issue in ('pct','qty','mtr','wt')),
  allowance_value_issue    numeric(14,4) default 0,
  allowed_to_issue         numeric(14,3) default 0,
  -- Receive allowance
  allowance_type_receive   text check (allowance_type_receive is null or allowance_type_receive in ('pct','qty','mtr','wt')),
  allowance_value_receive  numeric(14,4) default 0,
  allowed_to_receive       numeric(14,3) default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_mepi_updated before update on public.material_excess_plan_items
  for each row execute function public.set_updated_at();
create index if not exists idx_mepi_plan on public.material_excess_plan_items(excess_plan_id);

-- ==========================================================================
-- 3. Material Excess Plan Item Sizes (per-size allowance override)
-- ==========================================================================
create table if not exists public.material_excess_plan_sizes (
  id                       uuid primary key default gen_random_uuid(),
  excess_item_id           uuid not null references public.material_excess_plan_items(id) on delete cascade,
  sno                      integer not null default 0,
  item_size                text not null,
  allowed_to_order         numeric(14,3) default 0,
  allowed_to_issue         numeric(14,3) default 0,
  allowed_to_receive       numeric(14,3) default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger trg_meps_updated before update on public.material_excess_plan_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_meps_item on public.material_excess_plan_sizes(excess_item_id);

-- ==========================================================================
-- 4. Fabric Consumption Records (reference/tracking)
-- ==========================================================================
create sequence if not exists public.seq_fabric_consumption;
create table if not exists public.fabric_consumption_records (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sales_order_id        uuid references public.sales_orders(id) on delete set null,
  style_ref_no          text,
  style_no              text,
  entry_date            date not null default current_date,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fcr_code before insert on public.fabric_consumption_records
  for each row execute function public.assign_code('FCR','public.seq_fabric_consumption');
create trigger trg_fcr_updated before update on public.fabric_consumption_records
  for each row execute function public.set_updated_at();
create index if not exists idx_fcr_so on public.fabric_consumption_records(sales_order_id);

-- ==========================================================================
-- 5. Fabric Consumption Lines (per-fabric consumption detail)
-- ==========================================================================
create table if not exists public.fabric_consumption_lines (
  id                    uuid primary key default gen_random_uuid(),
  consumption_id        uuid not null references public.fabric_consumption_records(id) on delete cascade,
  sno                   integer not null default 0,
  fabric_name           text,
  structure_name        text,
  component             text,
  coordinate            text,
  fabric_color          text,
  fabric_print          text,
  gsm                   numeric(10,2),
  process_type          text,
  uom_id                text,
  consumption_qty       numeric(14,4) default 0,
  consumption_wt        numeric(14,4) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_fcl_updated before update on public.fabric_consumption_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_fcl_cons on public.fabric_consumption_lines(consumption_id);

-- ==========================================================================
-- 6. Fabric Consumption Size Details (per-size qty/wt breakdown)
-- ==========================================================================
create table if not exists public.fabric_consumption_sizes (
  id                    uuid primary key default gen_random_uuid(),
  consumption_line_id   uuid not null references public.fabric_consumption_lines(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  dia                   numeric(10,2),
  qty                   numeric(14,4) default 0,
  wt                    numeric(14,4) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_fcs_line on public.fabric_consumption_sizes(consumption_line_id);

-- ==========================================================================
-- 7. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'material_excess_plans','material_excess_plan_items','material_excess_plan_sizes',
    'fabric_consumption_records','fabric_consumption_lines','fabric_consumption_sizes'
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
