-- ============================================================================
-- Raagam ERP — 0030 Planning ▸ Stock Completion
-- Additive sub-module (legacy EDP2: Planning ▸ "Stock completion"). Closes out
-- planned stock for an order (records completed qty); draft → completed →
-- cancelled. Gated by the EXISTING 'planning' permission.
-- ============================================================================

create sequence if not exists public.seq_stock_completion;
create table if not exists public.stock_completions (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- STC-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  description    text not null,
  completed_qty  numeric(14,3) not null default 0,
  status         text not null default 'draft'
                   check (status in ('draft','completed','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_stock_comp_code before insert on public.stock_completions
  for each row execute function public.assign_code('STC','public.seq_stock_completion');
create trigger trg_stock_comp_updated before update on public.stock_completions
  for each row execute function public.set_updated_at();
create index if not exists idx_stock_comp_order  on public.stock_completions(sales_order_id);
create index if not exists idx_stock_comp_status on public.stock_completions(status);

do $$
declare t text;
begin
  foreach t in array array['stock_completions'] loop
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
