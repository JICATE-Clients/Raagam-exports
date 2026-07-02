-- ============================================================================
-- Raagam ERP — 0213 HR ▸ Leave & Encashment   [Lane B]
-- Additive (legacy EDP2: HR ▸ "Leave Details", "EL EnCash"). Employee leave
-- application (or earned-leave encashment via the is_encashment flag);
-- pending → approved/rejected. Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_leave;
create table if not exists public.hr_leaves (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- LEV-0001
  employee_type  text not null check (employee_type in ('worker','staff','contractor')),
  employee_id    uuid not null,
  employee_name  text,
  leave_type     text not null default 'casual'
                   check (leave_type in ('casual','sick','earned','unpaid')),
  from_date      date,
  to_date        date,
  days           numeric(6,1) not null default 0,
  is_encashment  boolean not null default false,
  reason         text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected','cancelled')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_lev_code before insert on public.hr_leaves
  for each row execute function public.assign_code('LEV','public.seq_hr_leave');
create trigger trg_lev_updated before update on public.hr_leaves
  for each row execute function public.set_updated_at();
create index if not exists idx_lev_emp on public.hr_leaves(employee_type, employee_id);

do $$
declare t text;
begin
  foreach t in array array['hr_leaves'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
