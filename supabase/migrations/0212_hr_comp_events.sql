-- ============================================================================
-- Raagam ERP — 0212 HR ▸ Bonus & Increments   [Lane B]
-- Additive (legacy EDP2: HR ▸ "Bonus", "Increments"). A compensation event —
-- a bonus amount or a rate/salary increment — with approval; draft → approved/
-- rejected. Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_comp_event;
create table if not exists public.hr_comp_events (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                 -- CMP-0001
  employee_type  text not null check (employee_type in ('worker','staff','contractor')),
  employee_id    uuid not null,
  employee_name  text,
  kind           text not null check (kind in ('bonus','increment')),
  amount         numeric(14,2) not null default 0,            -- bonus amount
  new_rate       numeric(14,2),                               -- increment target (salary/rate)
  effective_date date,
  reason         text,
  status         text not null default 'draft'
                   check (status in ('draft','approved','rejected')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_cmp_code before insert on public.hr_comp_events
  for each row execute function public.assign_code('CMP','public.seq_hr_comp_event');
create trigger trg_cmp_updated before update on public.hr_comp_events
  for each row execute function public.set_updated_at();
create index if not exists idx_cmp_emp on public.hr_comp_events(employee_type, employee_id);

do $$
declare t text;
begin
  foreach t in array array['hr_comp_events'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
