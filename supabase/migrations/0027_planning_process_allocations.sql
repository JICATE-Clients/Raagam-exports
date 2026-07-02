-- ============================================================================
-- Raagam ERP — 0027 Planning ▸ Purchase Process Allocation
-- Additive sub-module (legacy EDP2: Planning ▸ "Purchase Process Allocation").
-- Allocates an order's outsourced process (knitting/dyeing/finishing…) to a
-- vendor with qty + rate before purchasing; draft → confirmed → cancelled.
-- Gated by the EXISTING 'planning' permission.
-- ============================================================================

create sequence if not exists public.seq_process_allocation;
create table if not exists public.process_allocations (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- PAL-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  process_name   text not null,
  vendor_id      uuid references public.vendors(id) on delete set null,
  allocated_qty  numeric(14,3) not null default 0,
  uom_id         uuid references public.uoms(id),
  rate           numeric(14,4) not null default 0,
  status         text not null default 'draft'
                   check (status in ('draft','confirmed','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_proc_alloc_code before insert on public.process_allocations
  for each row execute function public.assign_code('PAL','public.seq_process_allocation');
create trigger trg_proc_alloc_updated before update on public.process_allocations
  for each row execute function public.set_updated_at();
create index if not exists idx_proc_alloc_order  on public.process_allocations(sales_order_id);
create index if not exists idx_proc_alloc_status on public.process_allocations(status);

do $$
declare t text;
begin
  foreach t in array array['process_allocations'] loop
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
