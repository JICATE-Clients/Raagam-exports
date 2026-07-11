-- ============================================================================
-- Raagam ERP — 0270 Sales ▸ Marketing ▸ Quote Preparation (costing sheet)
-- Legacy RP-Software "Quote preparation — By Costing No.": a garment costing
-- register. A flat costing document — cost buckets (Fabric / Trims / CMT /
-- Garment Process / Other Expenses) roll up to Gross → Waste% → Total → Margin%
-- → FOB. Distinct from the generic line-item `cost_sheets` (0005, at
-- /sales/cost-sheets) and the thin buyer-quotation `quotes` (0005) — both left
-- untouched. Gated by the EXISTING 'sales' permission — no new module.
-- ============================================================================

create sequence if not exists public.seq_quote_costing;
create table if not exists public.quote_costings (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique,                                  -- CST-0001 "Costing No"
  status               text not null default 'draft'
                         check (status in ('draft','finalised')),
  costing_date         date not null default current_date,          -- "Costing Dt"
  opportunity_id       uuid references public.opportunities(id),    -- "Enquiry No"
  customer_id          uuid references public.buyers(id),           -- "Customer"
  style_id             uuid references public.garment_styles(id),   -- "Style No"
  currency_code        text references public.currencies(code),
  weight               numeric(14,3) not null default 0,            -- "Wt"
  -- cost buckets (typed directly)
  fabric_cost          numeric(16,2) not null default 0,
  trims_cost           numeric(16,2) not null default 0,
  cmt_cost             numeric(16,2) not null default 0,
  garment_process_cost numeric(16,2) not null default 0,
  other_expenses       numeric(16,2) not null default 0,
  -- computed-and-stored roll-up
  gross_cost           numeric(16,2) not null default 0,            -- Σ buckets
  garment_waste_pct    numeric(6,2)  not null default 0,
  garment_waste_amt    numeric(16,2) not null default 0,            -- gross × waste%
  total_cost           numeric(16,2) not null default 0,            -- gross + waste
  margin_pct           numeric(6,2)  not null default 0,
  fob_value            numeric(16,2) not null default 0,            -- total × (1 + margin%) "FOB INR"
  notes                text,
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_qcs_code before insert on public.quote_costings
  for each row execute function public.assign_code('CST','public.seq_quote_costing');
create trigger trg_qcs_updated before update on public.quote_costings
  for each row execute function public.set_updated_at();
create index if not exists idx_qcs_opportunity on public.quote_costings(opportunity_id);
create index if not exists idx_qcs_customer    on public.quote_costings(customer_id);
create index if not exists idx_qcs_style       on public.quote_costings(style_id);
create index if not exists idx_qcs_status      on public.quote_costings(status);

-- ---------- RLS (reuse the existing 'sales' module — no new permission) ----------
do $$
begin
  execute format($f$
    create policy quote_costings_read on public.quote_costings for select to authenticated using (public.has_permission('sales','view'));
    create policy quote_costings_insert on public.quote_costings for insert to authenticated with check (public.has_permission('sales','create'));
    create policy quote_costings_update on public.quote_costings for update to authenticated using (public.has_permission('sales','edit')) with check (public.has_permission('sales','edit'));
    create policy quote_costings_delete on public.quote_costings for delete to authenticated using (public.has_permission('sales','delete'));
  $f$);
  execute 'alter table public.quote_costings enable row level security';
end $$;
