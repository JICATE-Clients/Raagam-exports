-- ============================================================================
-- Raagam ERP — 0207 Production ▸ Packing List   [Lane B]
-- Additive (legacy EDP2: Garmenting ▸ Production ▸ "Packing Lists"). Carton-wise
-- packing detail for an order; draft → finalized. Gated by 'production'.
-- ============================================================================

create sequence if not exists public.seq_packing_list;
create table if not exists public.packing_lists (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- PKL-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  packing_date   date,
  status         text not null default 'draft'
                   check (status in ('draft','finalized','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pkl_code before insert on public.packing_lists
  for each row execute function public.assign_code('PKL','public.seq_packing_list');
create trigger trg_pkl_updated before update on public.packing_lists
  for each row execute function public.set_updated_at();
create index if not exists idx_pkl_status on public.packing_lists(status);

create table if not exists public.packing_list_lines (
  id              uuid primary key default gen_random_uuid(),
  packing_list_id uuid not null references public.packing_lists(id) on delete cascade,
  carton_no       text,
  color           text,
  size            text,
  quantity        numeric(14,0) not null default 0,
  net_weight      numeric(10,2),
  gross_weight    numeric(10,2),
  sort_order      int not null default 0
);
create index if not exists idx_pkl_lines on public.packing_list_lines(packing_list_id);

do $$
declare t text;
begin
  foreach t in array array['packing_lists','packing_list_lines'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('production','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('production','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('production','edit')) with check (public.has_permission('production','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('production','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
