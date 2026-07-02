-- ============================================================================
-- Raagam ERP — 0022 Planning ▸ Budget Amendments
-- Additive sub-module of the existing Planning module (legacy EDP2:
-- Planning ▸ Materials ▸ "Budget Amendment / Budget amendments to approve").
--
-- Formal revise-with-approval on an already-APPROVED budget: capture the
-- previous total, propose a revised total + reason → submit → approve/reject.
-- On approve the parent budget's total is updated. Gated by the EXISTING
-- 'planning' permission — no new module, no change to the budgets table shape.
-- ============================================================================

create sequence if not exists public.seq_budget_amendment;
create table if not exists public.budget_amendments (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- BAM-0001 (assign_code)
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  previous_total numeric(16,2) not null default 0,
  revised_total  numeric(16,2) not null default 0,
  reason         text not null,
  status         text not null default 'draft'
                   check (status in ('draft','submitted','approved','rejected')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_bud_amend_code before insert on public.budget_amendments
  for each row execute function public.assign_code('BAM','public.seq_budget_amendment');
create trigger trg_bud_amend_updated before update on public.budget_amendments
  for each row execute function public.set_updated_at();
create index if not exists idx_bud_amend_budget on public.budget_amendments(budget_id);
create index if not exists idx_bud_amend_status on public.budget_amendments(status);

-- ---------- RLS (reuse the existing 'planning' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array['budget_amendments'] loop
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
