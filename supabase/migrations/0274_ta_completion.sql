-- ============================================================================
-- Raagam ERP — 0274 Orders ▸ TA ▸ TA Completion
-- Legacy "TA completion": a small document that logs the completion of an order's
-- Time & Action schedule — Completion No (auto) · Date · Customer ⓘ · SC No ⓘ ·
-- Order No · Remarks. Structurally identical to Garment Order Completion (0123/
-- 0132) but does NOT flip any order status (ta_plans has no completion state) —
-- it just records a completion. Gated by the existing 'orders' permission.
-- ============================================================================

create sequence if not exists public.seq_ta_completion;
create table if not exists public.ta_completions (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                  -- Completion No (TAC-0001)
  order_id        uuid references public.sales_orders(id),      -- SC No
  customer_id     uuid references public.buyers(id),            -- Customer (auto-filled from SC No)
  order_no        text,
  completion_date date not null default current_date,
  completion_year int,                                          -- derived from the date
  remarks         text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_tacompl_code before insert on public.ta_completions
  for each row execute function public.assign_code('TAC','public.seq_ta_completion');
create trigger trg_tacompl_updated before update on public.ta_completions
  for each row execute function public.set_updated_at();
create index if not exists idx_tacompl_order    on public.ta_completions(order_id);
create index if not exists idx_tacompl_customer on public.ta_completions(customer_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['ta_completions'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
