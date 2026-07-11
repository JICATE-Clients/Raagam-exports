-- ============================================================================
-- Raagam ERP — 0123 Orders ▸ Garment Order Completion
-- Additive sub-module (legacy EDP2: Sales ▸ Garment Orders ▸ "Garment order
-- completion"). Records a formal completion (date + year, legacy CompletionID /
-- Completion Yr fields); the action also sets sales_orders.status='closed'.
-- One completion per order. Gated by the EXISTING 'orders' permission.
-- ============================================================================

create sequence if not exists public.seq_order_completion;
create table if not exists public.order_completions (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                -- GCM-0001 (legacy CompletionID)
  order_id        uuid not null references public.sales_orders(id) on delete cascade,
  completion_date date not null default current_date,
  completion_year int,                                        -- legacy "Completion Yr"
  remarks         text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (order_id)                                           -- one completion per order
);
create trigger trg_ordcomplete_code before insert on public.order_completions
  for each row execute function public.assign_code('GCM','public.seq_order_completion');
create index if not exists idx_ordcomplete_order on public.order_completions(order_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['order_completions'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
