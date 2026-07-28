-- ============================================================================
-- Raagam ERP -- 0351 RFQ Quote Lines
-- Per-line vendor quote amounts for side-by-side comparison.
-- Currently rfq_quotes only has total_amount; this adds per-line breakdown.
-- From VB.NET FrmFN_PurchaseReceiveQuoteFromVendor + FrmFN_ReceivedQuoteFrmVendor.
-- ============================================================================

create table if not exists public.rfq_quote_lines (
  id            uuid primary key default gen_random_uuid(),
  rfq_quote_id  uuid not null references public.rfq_quotes(id) on delete cascade,
  rfq_line_id   uuid not null references public.rfq_lines(id) on delete cascade,
  unit_price    numeric(14,4) not null default 0,
  amount        numeric(16,2) not null default 0,
  lead_days     int,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_rql_quote on public.rfq_quote_lines(rfq_quote_id);
create index if not exists idx_rql_line on public.rfq_quote_lines(rfq_line_id);

create trigger trg_rfq_quote_lines_updated before update on public.rfq_quote_lines
  for each row execute function public.set_updated_at();

-- RLS
alter table public.rfq_quote_lines enable row level security;

create policy rfq_quote_lines_read on public.rfq_quote_lines
  for select to authenticated using (public.has_permission('materials_purchase','view'));
create policy rfq_quote_lines_insert on public.rfq_quote_lines
  for insert to authenticated with check (public.has_permission('materials_purchase','create'));
create policy rfq_quote_lines_update on public.rfq_quote_lines
  for update to authenticated
  using (public.has_permission('materials_purchase','edit'))
  with check (public.has_permission('materials_purchase','edit'));
create policy rfq_quote_lines_delete on public.rfq_quote_lines
  for delete to authenticated using (public.has_permission('materials_purchase','delete'));
