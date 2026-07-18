-- ============================================================================
-- Raagam ERP — 0320 Sales ▸ IOC Costing Engine
--
-- Extends cost_sheets into the full IOC (Intent of Customer) costing system.
-- The VB.NET IOC has 8 cost categories tracked per-style, a fabric rate
-- master, and an expenses/budget summary.
--
-- Design: cost_sheets remains the header; new child tables hold the
-- detailed cost breakdown. The old cost_sheet_items table stays for
-- backward compat but new IOC entries use the richer structure.
-- ============================================================================

-- ==========================================================================
-- 1. Enrich cost_sheets header with IOC fields
-- ==========================================================================
alter table public.cost_sheets
  add column if not exists costing_type      text not null default 'simple'
    check (costing_type in ('simple','ioc')),
  add column if not exists costing_for       text check (costing_for is null or costing_for in ('sample','production')),
  add column if not exists sample_for        text check (sample_for is null or sample_for in ('fabric','garment')),
  add column if not exists sample_type       text check (sample_type is null or sample_type in ('normal','assorted')),
  add column if not exists garment_waste_pct numeric(6,2),
  add column if not exists garment_wt        numeric(10,4),
  add column if not exists fabric_cost       numeric(14,2) default 0,
  add column if not exists trims_cost        numeric(14,2) default 0,
  add column if not exists cmt_cost          numeric(14,2) default 0,
  add column if not exists garment_process_cost numeric(14,2) default 0,
  add column if not exists other_expenses_cost  numeric(14,2) default 0,
  add column if not exists gross_cost        numeric(14,2) default 0,
  add column if not exists fob_inr           numeric(14,2) default 0,
  add column if not exists rate              numeric(14,4),
  add column if not exists rate_inr          numeric(14,4),
  add column if not exists fob_rate          numeric(14,4),
  add column if not exists fob_rate_inr      numeric(14,4),
  add column if not exists profit_loss       numeric(14,2),
  add column if not exists profit_loss_pct   numeric(8,2),
  add column if not exists exchange_rate     numeric(12,6),
  add column if not exists amendment_sno     integer default 0,
  add column if not exists smv_rate          numeric(14,4),
  add column if not exists smv_units         numeric(14,4),
  add column if not exists se_sizes          text;

-- ==========================================================================
-- 2. IOC Style Costs — per-style cost summary
-- ==========================================================================
create table if not exists public.ioc_style_costs (
  id                  uuid primary key default gen_random_uuid(),
  cost_sheet_id       uuid not null references public.cost_sheets(id) on delete cascade,
  sno                 integer not null default 0,
  style_id            uuid references public.styles(id) on delete set null,
  style_ref_no        text,
  style_no            text,
  article_no          text,
  uom_id              text,
  order_qty           numeric(14,3),
  wt_per_garment      numeric(10,4),
  fabric_cost         numeric(14,2) default 0,
  trims_cost          numeric(14,2) default 0,
  cmt_cost            numeric(14,2) default 0,
  garment_process_cost numeric(14,2) default 0,
  pack_cost           numeric(14,2) default 0,
  rejection_cost      numeric(14,2) default 0,
  expenses_production numeric(14,2) default 0,
  expenses_others     numeric(14,2) default 0,
  expenses_total      numeric(14,2) default 0,
  expenses_revenue    numeric(14,2) default 0,
  profit_loss_garment numeric(14,2) default 0,
  profit_loss_pct     numeric(8,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ioc_style_costs_updated before update on public.ioc_style_costs
  for each row execute function public.set_updated_at();
create index if not exists idx_ioc_style_costs_cs on public.ioc_style_costs(cost_sheet_id);

-- ==========================================================================
-- 3. IOC Consumption Details — unified table for all 5 cost categories
--    ConsumptionFor: F=Fabric, T=Trim, G=GarmentProcess, M=CMT, R=Rejection
-- ==========================================================================
create table if not exists public.ioc_cons_details (
  id                  uuid primary key default gen_random_uuid(),
  style_cost_id       uuid not null references public.ioc_style_costs(id) on delete cascade,
  consumption_for     text not null check (consumption_for in ('F','T','G','M','R')),
  sno                 integer not null default 0,
  category_name       text,
  item_description    text,
  process_name        text,
  coordinate          text,
  uom_id              text,
  gsm                 integer,
  fab_width           numeric(10,2),
  no_of_items_for_pcs numeric(14,3),
  no_of_pcs_for_items numeric(14,3),
  rate_type           text check (rate_type is null or rate_type in ('Q','F','P')),
  cons_qty            numeric(14,4) default 0,
  cons_wt             numeric(14,4) default 0,
  rate                numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  calculated_cost     numeric(14,2) default 0,
  additional_cost     numeric(14,2) default 0,
  is_direct_rate      boolean not null default false,
  is_assort_colorwise boolean not null default false,
  details             text,
  category_id         uuid,
  item_id             uuid,
  process_id          uuid,
  cost_head_id        uuid,
  ref_sno             integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ioc_cons_details_updated before update on public.ioc_cons_details
  for each row execute function public.set_updated_at();
create index if not exists idx_ioc_cons_details_sc on public.ioc_cons_details(style_cost_id);
create index if not exists idx_ioc_cons_details_for on public.ioc_cons_details(consumption_for);

-- ==========================================================================
-- 4. IOC CMT Operation Details — size-wise CMT breakdown
-- ==========================================================================
create table if not exists public.ioc_cmt_operations (
  id                  uuid primary key default gen_random_uuid(),
  cons_detail_id      uuid not null references public.ioc_cons_details(id) on delete cascade,
  sno                 integer not null default 0,
  operation_name      text not null,
  is_sizewise         boolean not null default false,
  rate                numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_cmt_ops_cd on public.ioc_cmt_operations(cons_detail_id);

-- ==========================================================================
-- 5. IOC CMT Size Details — per-size rate within a CMT operation
-- ==========================================================================
create table if not exists public.ioc_cmt_sizes (
  id                  uuid primary key default gen_random_uuid(),
  cmt_operation_id    uuid not null references public.ioc_cmt_operations(id) on delete cascade,
  item_size           text not null,
  qty                 numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_cmt_sizes_op on public.ioc_cmt_sizes(cmt_operation_id);

-- ==========================================================================
-- 6. IOC Consumption Color Details — color-wise rate/percentage per item
-- ==========================================================================
create table if not exists public.ioc_cons_colors (
  id                  uuid primary key default gen_random_uuid(),
  cons_detail_id      uuid not null references public.ioc_cons_details(id) on delete cascade,
  sno                 integer not null default 0,
  color_name          text,
  percentage          numeric(8,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_cons_colors_cd on public.ioc_cons_colors(cons_detail_id);

-- ==========================================================================
-- 7. IOC Fabric Rates — fabric rate master per costing
-- ==========================================================================
create table if not exists public.ioc_fabric_rates (
  id                    uuid primary key default gen_random_uuid(),
  cost_sheet_id         uuid not null references public.cost_sheets(id) on delete cascade,
  sno                   integer not null default 0,
  fabric_description    text,
  structure_name        text,
  composition_name      text,
  struct_type           text,
  fabric_type           text,
  fabric_sub_type       text,
  gsm                   integer,
  is_direct_rate        boolean not null default false,
  style_ref_no          text,
  style_no              text,
  fabric_rate_without_loss numeric(14,4) default 0,
  process_loss_pct      numeric(8,2) default 0,
  process_loss_rate     numeric(14,4) default 0,
  fabric_rate           numeric(14,4) default 0,
  margin_pct            numeric(8,2) default 0,
  margin_cost           numeric(14,2) default 0,
  fob_inr               numeric(14,2) default 0,
  other_expenses_cost   numeric(14,2) default 0,
  gross_cost            numeric(14,2) default 0,
  is_assort_colorwise   boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ioc_fabric_rates_updated before update on public.ioc_fabric_rates
  for each row execute function public.set_updated_at();
create index if not exists idx_ioc_fabric_rates_cs on public.ioc_fabric_rates(cost_sheet_id);

-- ==========================================================================
-- 8. IOC Fabric Process Rates — process charges per fabric rate
-- ==========================================================================
create table if not exists public.ioc_fabric_process_rates (
  id                  uuid primary key default gen_random_uuid(),
  fabric_rate_id      uuid not null references public.ioc_fabric_rates(id) on delete cascade,
  sno                 integer not null default 0,
  process_name        text,
  process_rate        numeric(14,4) default 0,
  uom_id              text,
  is_direct_rate      boolean not null default false,
  item_class_type     text,
  purchase_process_type text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_fab_proc_rates_fr on public.ioc_fabric_process_rates(fabric_rate_id);

-- ==========================================================================
-- 9. IOC Fabric Process Details — color/mixing details per process rate
-- ==========================================================================
create table if not exists public.ioc_fabric_process_details (
  id                  uuid primary key default gen_random_uuid(),
  process_rate_id     uuid not null references public.ioc_fabric_process_rates(id) on delete cascade,
  sno                 integer not null default 0,
  color_group         text,
  mixing_item_details text,
  uom_id              text,
  rate                numeric(14,4) default 0,
  mixing_pct          numeric(8,2) default 0,
  qty                 numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_fab_proc_det_pr on public.ioc_fabric_process_details(process_rate_id);

-- ==========================================================================
-- 10. IOC Fabric Rate Colors — color breakdown per fabric rate
-- ==========================================================================
create table if not exists public.ioc_fabric_rate_colors (
  id                  uuid primary key default gen_random_uuid(),
  fabric_rate_id      uuid not null references public.ioc_fabric_rates(id) on delete cascade,
  sno                 integer not null default 0,
  color_name          text,
  percentage          numeric(8,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_fab_rate_colors_fr on public.ioc_fabric_rate_colors(fabric_rate_id);

-- ==========================================================================
-- 11. IOC Other Expenses — additional cost items
-- ==========================================================================
create table if not exists public.ioc_other_expenses (
  id                  uuid primary key default gen_random_uuid(),
  cost_sheet_id       uuid not null references public.cost_sheets(id) on delete cascade,
  sno                 integer not null default 0,
  cost_short_name     text,
  cost_description    text,
  item_description    text,
  type_for            text check (type_for is null or type_for in ('O','S')),
  rate_type           text check (rate_type is null or rate_type in ('Q','F','P')),
  cons_qty            numeric(14,4) default 0,
  uom_id              text,
  rate                numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ioc_other_expenses_updated before update on public.ioc_other_expenses
  for each row execute function public.set_updated_at();
create index if not exists idx_ioc_other_expenses_cs on public.ioc_other_expenses(cost_sheet_id);

-- ==========================================================================
-- 12. IOC Other Expenses — per-style breakdown
-- ==========================================================================
create table if not exists public.ioc_expense_styles (
  id                  uuid primary key default gen_random_uuid(),
  expense_id          uuid not null references public.ioc_other_expenses(id) on delete cascade,
  sno                 integer not null default 0,
  style_ref_no        text,
  style_no            text,
  article_no          text,
  uom_id              text,
  order_qty           numeric(14,3),
  qty                 numeric(14,3),
  rate                numeric(14,4) default 0,
  cost                numeric(14,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_expense_styles_ex on public.ioc_expense_styles(expense_id);

-- ==========================================================================
-- 13. IOC Budget Summary — cost head totals
-- ==========================================================================
create table if not exists public.ioc_budgets (
  id                  uuid primary key default gen_random_uuid(),
  cost_sheet_id       uuid not null references public.cost_sheets(id) on delete cascade,
  sno                 integer not null default 0,
  cost_short_name     text,
  cost_description    text,
  cost                numeric(14,2) default 0,
  by_us_cost          numeric(14,2) default 0,
  by_vendor_cost      numeric(14,2) default 0,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ioc_budgets_cs on public.ioc_budgets(cost_sheet_id);

-- ==========================================================================
-- 14. RLS for all new IOC tables
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'ioc_style_costs','ioc_cons_details','ioc_cmt_operations','ioc_cmt_sizes',
    'ioc_cons_colors','ioc_fabric_rates','ioc_fabric_process_rates',
    'ioc_fabric_process_details','ioc_fabric_rate_colors',
    'ioc_other_expenses','ioc_expense_styles','ioc_budgets'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('sales','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('sales','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('sales','edit'))
        with check (public.has_permission('sales','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('sales','delete'));
    $f$, t);
  end loop;
end $$;
