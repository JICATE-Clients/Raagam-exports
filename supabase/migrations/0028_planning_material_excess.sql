-- ============================================================================
-- Raagam ERP — 0028 Planning ▸ Material Excess Order & Receipt
-- Additive sub-module (legacy EDP2: Planning ▸ "Material Excess Order and
-- Receipt"). Orders contingency/excess material for an order and tracks its
-- receipt; open → received → closed (or cancelled). Gated by 'planning'.
-- ============================================================================

create sequence if not exists public.seq_material_excess;
create table if not exists public.material_excess (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- MEX-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  item_id        uuid references public.items(id),
  description    text not null,
  uom_id         uuid references public.uoms(id),
  ordered_qty    numeric(14,3) not null default 0,
  received_qty   numeric(14,3) not null default 0,
  status         text not null default 'open'
                   check (status in ('open','received','closed','cancelled')),
  reason         text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_mat_excess_code before insert on public.material_excess
  for each row execute function public.assign_code('MEX','public.seq_material_excess');
create trigger trg_mat_excess_updated before update on public.material_excess
  for each row execute function public.set_updated_at();
create index if not exists idx_mat_excess_order  on public.material_excess(sales_order_id);
create index if not exists idx_mat_excess_status on public.material_excess(status);

do $$
declare t text;
begin
  foreach t in array array['material_excess'] loop
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
