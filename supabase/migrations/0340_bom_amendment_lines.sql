-- ============================================================================
-- Raagam ERP — 0340 Planning ▸ BOM Amendment Lines
-- VB.NET FrmBOMXfrs has per-line XfrQty/XfrWt editing.
-- Adds bom_amendment_lines child table for line-level transfer quantities.
-- ============================================================================

create table if not exists public.bom_amendment_lines (
  id                    uuid primary key default gen_random_uuid(),
  amendment_id          uuid not null references public.bom_amendments(id) on delete cascade,
  sno                   integer not null default 0,
  item_description      text,
  uom_id                text,
  original_qty          numeric(14,4) default 0,
  original_wt           numeric(14,4) default 0,
  transfer_qty          numeric(14,4) default 0,
  transfer_wt           numeric(14,4) default 0,
  transfer_qty_with_loss numeric(14,4) default 0,
  transfer_wt_with_loss  numeric(14,4) default 0,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_bal_updated before update on public.bom_amendment_lines
  for each row execute function public.set_updated_at();
create index if not exists idx_bal_amendment on public.bom_amendment_lines(amendment_id);

alter table public.bom_amendment_lines enable row level security;
create policy bom_amendment_lines_read on public.bom_amendment_lines
  for select to authenticated using (public.has_permission('planning','view'));
create policy bom_amendment_lines_insert on public.bom_amendment_lines
  for insert to authenticated with check (public.has_permission('planning','create'));
create policy bom_amendment_lines_update on public.bom_amendment_lines
  for update to authenticated
  using (public.has_permission('planning','edit'))
  with check (public.has_permission('planning','edit'));
create policy bom_amendment_lines_delete on public.bom_amendment_lines
  for delete to authenticated using (public.has_permission('planning','delete'));
