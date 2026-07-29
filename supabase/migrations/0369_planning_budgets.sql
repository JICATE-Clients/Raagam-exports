-- ============================================================================
-- Raagam ERP — 0369 Planning ▸ Budgets (SQ Budget + PPM Budget)
-- Rebuilt from VB.NET FrmSQBudget.vb deep-dive (ver_30A, company 38).
-- Budget = costing document linked to an SQ/order. 6 purchase/process bands
-- + CMTs + OtherExpenses/Incomes + summary heads.
-- Approval workflow: draft → submitted → approved → rejected.
-- ============================================================================

-- ============================================================================
-- 1. BUDGET HEADER
-- ============================================================================
create sequence if not exists public.seq_budget;

create table if not exists public.budgets (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,
  budget_type      text not null default 'sq'
                     check (budget_type in ('sq','ppm','amendment')),
  entry_type       text not null default 'A'
                     check (entry_type in ('A','F','T','G')),
  sales_order_id   uuid references public.sales_orders(id),
  customer_id      uuid references public.customers(id),
  group_no         text,
  group_description text,
  uom_id           uuid references public.uoms(id),
  sq_qty           numeric(14,3) default 0,
  currency_code    text default 'INR',
  exchange_rate    numeric(14,4) default 1,
  smv_rate         numeric(14,4) default 0,
  amendment_no     int not null default 0,
  reason           text,
  task_owner_id    uuid references public.profiles(id),
  -- summary calculated fields
  gross_sales_value numeric(16,2) default 0,
  avg_price         numeric(14,4) default 0,
  sales_value       numeric(16,2) default 0,
  total_expense     numeric(16,2) default 0,
  profit_loss_value numeric(16,2) default 0,
  profit_loss_pct   numeric(8,2) default 0,
  -- workflow
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','rejected')),
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  location_id      uuid references public.locations(id),
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_budget_code before insert on public.budgets
  for each row execute function public.assign_code('BDG','public.seq_budget');
create trigger trg_budget_updated before update on public.budgets
  for each row execute function public.set_updated_at();
create index if not exists idx_budget_order on public.budgets(sales_order_id);
create index if not exists idx_budget_customer on public.budgets(customer_id);
create index if not exists idx_budget_status on public.budgets(status);

-- ============================================================================
-- 2. PURCHASE BANDS (Yarn, Fabric, Accessories)
--    Single table with purchase_type discriminator.
-- ============================================================================
create table if not exists public.budget_purchases (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  purchase_type    text not null check (purchase_type in ('yarn','fabric','accessories')),
  sno              int not null default 0,
  item_id          uuid references public.items(id),
  item_name        text,
  gsm              numeric(10,2),
  stage            text,
  item_type        text,
  item_color       text,
  print_name       text,
  vendor_id        uuid references public.vendors(id),
  vendor_name      text,
  item_process_type text,
  specifications   text,
  uom_id           uuid references public.uoms(id),
  reqd_qty         numeric(14,3) default 0,
  is_foc           boolean not null default false,
  is_import        boolean not null default false,
  currency_code    text default 'INR',
  exchange_rate    numeric(14,4) default 1,
  is_sizewise_rate boolean not null default false,
  rate             numeric(14,4) default 0,
  inr_rate         numeric(14,4) default 0,
  moq              numeric(14,3),
  last_po_rate     numeric(14,4),
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgpur_parent on public.budget_purchases(budget_id);
create index if not exists idx_budgpur_type on public.budget_purchases(purchase_type);

-- Size-wise rate detail for purchases (child of budget_purchases)
create table if not exists public.budget_purchase_size_rates (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null references public.budget_purchases(id) on delete cascade,
  sno              int not null default 0,
  item_size        text,
  rate             numeric(14,4) default 0,
  inr_rate         numeric(14,4) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgpursz_parent on public.budget_purchase_size_rates(purchase_id);

-- ============================================================================
-- 3. PROCESS BANDS (Yarn, Fabric, Accessories, Garment)
--    Single table with process_type discriminator.
-- ============================================================================
create table if not exists public.budget_processes (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  process_type     text not null check (process_type in ('yarn','fabric','accessories','garment')),
  sno              int not null default 0,
  process_id       uuid references public.processes(id),
  process_name     text,
  rate_for         text,
  rate_for_type    text,
  uom_id           uuid references public.uoms(id),
  reqd_qty         numeric(14,3) default 0,
  is_foc           boolean not null default false,
  rate_type        text,
  charges          numeric(14,4) default 0,
  design_charges   numeric(14,4) default 0,
  po_value         numeric(16,2) default 0,
  rate             numeric(14,4) default 0,
  is_by_us         boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgproc_parent on public.budget_processes(budget_id);
create index if not exists idx_budgproc_type on public.budget_processes(process_type);

-- Process items (child of budget_processes — per-item breakdown)
create table if not exists public.budget_process_items (
  id               uuid primary key default gen_random_uuid(),
  process_id       uuid not null references public.budget_processes(id) on delete cascade,
  sno              int not null default 0,
  description      text,
  uom_id           uuid references public.uoms(id),
  reqd_qty         numeric(14,3) default 0,
  is_foc           boolean not null default false,
  charges          numeric(14,4) default 0,
  design_charges   numeric(14,4) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgprit_parent on public.budget_process_items(process_id);

-- ============================================================================
-- 4. CMTs (Cut, Make & Trim)
--    Header per style/coordinate → child operations → grandchild sizes.
-- ============================================================================
create table if not exists public.budget_cmts (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  sno              int not null default 0,
  style_ref_no     text,
  style_no         text,
  article_no       text,
  oc_no            text,
  order_no         text,
  coordinate_name  text,
  order_qty        numeric(14,3) default 0,
  sq_qty           numeric(14,3) default 0,
  smvs             numeric(10,4) default 0,
  rate             numeric(14,4) default 0,
  is_flat_rate     boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgcmt_parent on public.budget_cmts(budget_id);

-- CMT operations (child of budget_cmts)
create table if not exists public.budget_cmt_operations (
  id               uuid primary key default gen_random_uuid(),
  cmt_id           uuid not null references public.budget_cmts(id) on delete cascade,
  sno              int not null default 0,
  operation_name   text,
  is_sizewise      boolean not null default false,
  is_detailwise    boolean not null default false,
  is_colorwise     boolean not null default false,
  smvs             numeric(10,4) default 0,
  rate             numeric(14,4) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgcmtop_parent on public.budget_cmt_operations(cmt_id);

-- CMT operation sizes (grandchild — when is_sizewise = true)
create table if not exists public.budget_cmt_operation_sizes (
  id               uuid primary key default gen_random_uuid(),
  operation_id     uuid not null references public.budget_cmt_operations(id) on delete cascade,
  sno              int not null default 0,
  item_size        text,
  rate             numeric(14,4) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgcmtsz_parent on public.budget_cmt_operation_sizes(operation_id);

-- ============================================================================
-- 5. OTHER EXPENSES & OTHER INCOMES
--    Single table with entry_type discriminator.
-- ============================================================================
create table if not exists public.budget_other_entries (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  entry_type       text not null check (entry_type in ('expense','income')),
  sno              int not null default 0,
  cost_description text,
  description      text,
  type_for         text,
  rate_type        text,
  qty              numeric(14,3) default 0,
  uom_id           uuid references public.uoms(id),
  rate             numeric(14,4) default 0,
  cost             numeric(16,2) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgother_parent on public.budget_other_entries(budget_id);

-- Style details for other entries (child — per-style breakdown)
create table if not exists public.budget_other_entry_styles (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null references public.budget_other_entries(id) on delete cascade,
  sno              int not null default 0,
  style_ref_no     text,
  style_no         text,
  qty              numeric(14,3) default 0,
  rate             numeric(14,4) default 0,
  cost             numeric(16,2) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgothsty_parent on public.budget_other_entry_styles(entry_id);

-- ============================================================================
-- 6. COST HEADS SUMMARY (General tab — Heads grid)
--    Cost breakdown by category.
-- ============================================================================
create table if not exists public.budget_heads (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  sno              int not null default 0,
  cost_description text,
  cost             numeric(16,2) default 0,
  contribution_pct numeric(8,2) default 0,
  cost_per_garment numeric(14,4) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budghead_parent on public.budget_heads(budget_id);

-- ============================================================================
-- 7. STYLE SUMMARY (General tab — Styles grid)
--    Per-style revenue vs expense analysis.
-- ============================================================================
create table if not exists public.budget_styles (
  id               uuid primary key default gen_random_uuid(),
  budget_id        uuid not null references public.budgets(id) on delete cascade,
  sno              int not null default 0,
  style_ref_no     text,
  style_no         text,
  article_no       text,
  oc_no            text,
  order_no         text,
  uom_id           uuid references public.uoms(id),
  order_qty        numeric(14,3) default 0,
  rate             numeric(14,4) default 0,
  wt_per_garment   numeric(10,4) default 0,
  revenue          numeric(16,2) default 0,
  expenses_fabric  numeric(16,2) default 0,
  expenses_production numeric(16,2) default 0,
  expenses_cmt     numeric(16,2) default 0,
  expenses_trims   numeric(16,2) default 0,
  expenses_garments numeric(16,2) default 0,
  expenses_packs   numeric(16,2) default 0,
  expenses_gar_rejection numeric(16,2) default 0,
  expenses_others  numeric(16,2) default 0,
  expenses_total   numeric(16,2) default 0,
  profit_loss      numeric(16,2) default 0,
  profit_loss_pct  numeric(8,2) default 0,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_budgsty_parent on public.budget_styles(budget_id);

-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'budgets','budget_purchases','budget_purchase_size_rates',
    'budget_processes','budget_process_items',
    'budget_cmts','budget_cmt_operations','budget_cmt_operation_sizes',
    'budget_other_entries','budget_other_entry_styles',
    'budget_heads','budget_styles'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
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
  end loop;
end $$;
