-- ============================================================================
-- Raagam ERP — 0211 HR ▸ Allowances & Deductions   [Lane B]
-- Additive (legacy EDP2: HR ▸ "Monthly Allowances / Monthly Deductions").
-- A recurring or one-off allowance/deduction per employee; active → ended.
-- Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_adjustment;
create table if not exists public.hr_adjustments (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                                -- ADJ-0001
  employee_type   text not null check (employee_type in ('worker','staff','contractor')),
  employee_id     uuid not null,
  employee_name   text,
  kind            text not null check (kind in ('allowance','deduction')),
  label           text not null,
  amount          numeric(14,2) not null default 0,
  effective_month date,
  recurring       boolean not null default false,
  status          text not null default 'active' check (status in ('active','ended')),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_adj_code before insert on public.hr_adjustments
  for each row execute function public.assign_code('ADJ','public.seq_hr_adjustment');
create trigger trg_adj_updated before update on public.hr_adjustments
  for each row execute function public.set_updated_at();
create index if not exists idx_adj_emp on public.hr_adjustments(employee_type, employee_id);

do $$
declare t text;
begin
  foreach t in array array['hr_adjustments'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
