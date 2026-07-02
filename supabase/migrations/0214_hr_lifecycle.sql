-- ============================================================================
-- Raagam ERP — 0214 HR ▸ Lifecycle events (Transfer / Resignation / Settlement)
-- [Lane B]  Additive (legacy EDP2: HR ▸ "Worker/Staff Transfers", "Resignation
-- Details", "Settlements"). One record per lifecycle event, discriminated by
-- `kind`; draft → completed. Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_lifecycle;
create table if not exists public.hr_lifecycle_events (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                              -- LCE-0001
  employee_type     text not null check (employee_type in ('worker','staff','contractor')),
  employee_id       uuid not null,
  employee_name     text,
  kind              text not null check (kind in ('transfer','resignation','settlement')),
  effective_date    date,
  from_location     text,                                     -- transfer
  to_location       text,                                     -- transfer
  last_working_day  date,                                     -- resignation
  settlement_amount numeric(14,2),                            -- settlement
  reason            text,
  status            text not null default 'draft'
                      check (status in ('draft','completed','cancelled')),
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_lce_code before insert on public.hr_lifecycle_events
  for each row execute function public.assign_code('LCE','public.seq_hr_lifecycle');
create trigger trg_lce_updated before update on public.hr_lifecycle_events
  for each row execute function public.set_updated_at();
create index if not exists idx_lce_emp  on public.hr_lifecycle_events(employee_type, employee_id);
create index if not exists idx_lce_kind on public.hr_lifecycle_events(kind);

do $$
declare t text;
begin
  foreach t in array array['hr_lifecycle_events'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
