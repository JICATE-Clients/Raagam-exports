-- ============================================================================
-- Raagam ERP — 0278 Planning ▸ Approve Costing
-- Additive to the existing Sales quote_costings (0270). Legacy EDP2: Planning ▸
-- Materials-Garment Orders ▸ "Approve Costing" — the planner sign-off on a
-- FINALISED garment costing before it feeds order budgeting. Extends the status
-- check with 'approved'/'rejected' + approval columns, and adds two
-- supplementary RLS policies so planning users (who hold 'planning', not
-- 'sales') can read + approve costings cross-module. The existing 'sales'
-- policies are left intact.
-- ============================================================================

alter table public.quote_costings drop constraint if exists quote_costings_status_check;
alter table public.quote_costings add constraint quote_costings_status_check
  check (status in ('draft','finalised','approved','rejected'));

alter table public.quote_costings
  add column if not exists approved_by      uuid references public.profiles(id),
  add column if not exists approved_at      timestamptz,
  add column if not exists approval_reason  text;

-- cross-module access: quote_costings RLS is 'sales'; planners need to see +
-- approve without holding the 'sales' permission.
do $$
begin
  execute $f$
    create policy quote_costings_planning_read on public.quote_costings
      for select to authenticated using (public.has_permission('planning','view'));
    create policy quote_costings_planning_approve on public.quote_costings
      for update to authenticated
      using (public.has_permission('planning','approve'))
      with check (public.has_permission('planning','approve'));
  $f$;
end $$;
