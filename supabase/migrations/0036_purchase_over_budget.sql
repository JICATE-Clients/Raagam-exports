-- ============================================================================
-- Raagam ERP — 0036 Purchase ▸ Price-over-Budget Confirmation
-- Additive sub-module (legacy EDP2: Materials ▸ Purchase ▸ "Price more than the
-- Budget Rate confirmation"). Captures a quoted rate that exceeds the budget
-- rate and routes it for approval; draft → submitted → approved/rejected.
-- Gated by the EXISTING 'materials_purchase' permission.
-- ============================================================================

create sequence if not exists public.seq_over_budget;
create table if not exists public.over_budget_confirmations (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                               -- OBC-0001
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  rfq_id            uuid references public.rfqs(id) on delete set null,
  description       text not null,
  budget_rate       numeric(14,4) not null default 0,
  quoted_rate       numeric(14,4) not null default 0,
  variance_pct      numeric(8,2) not null default 0,          -- (quoted-budget)/budget*100; set by action
  reason            text,
  status            text not null default 'draft'
                      check (status in ('draft','submitted','approved','rejected')),
  created_by        uuid references public.profiles(id) default auth.uid(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_obc_code before insert on public.over_budget_confirmations
  for each row execute function public.assign_code('OBC','public.seq_over_budget');
create trigger trg_obc_updated before update on public.over_budget_confirmations
  for each row execute function public.set_updated_at();
create index if not exists idx_obc_status on public.over_budget_confirmations(status);

do $$
declare t text;
begin
  foreach t in array array['over_budget_confirmations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('materials_purchase','edit')) with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
