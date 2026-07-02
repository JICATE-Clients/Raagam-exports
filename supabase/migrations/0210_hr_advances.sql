-- ============================================================================
-- Raagam ERP — 0210 HR ▸ Advances (+ Returns)   [Lane B · band 0200–0299]
-- Additive (legacy EDP2: HR ▸ "Advances / Advance Returns"). Employee advance
-- with repayment tracking; open → repaying → closed. Polymorphic employee ref
-- (worker/staff/contractor). Gated by the EXISTING 'hr_payroll' permission.
-- ============================================================================

create sequence if not exists public.seq_hr_advance;
create table if not exists public.hr_advances (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                                  -- ADV-0001
  employee_type text not null check (employee_type in ('worker','staff','contractor')),
  employee_id   uuid not null,
  employee_name text,
  amount        numeric(14,2) not null default 0,
  repaid_amount numeric(14,2) not null default 0,
  reason        text,
  advance_date  date,
  status        text not null default 'open'
                  check (status in ('open','repaying','closed','cancelled')),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_adv_code before insert on public.hr_advances
  for each row execute function public.assign_code('ADV','public.seq_hr_advance');
create trigger trg_adv_updated before update on public.hr_advances
  for each row execute function public.set_updated_at();
create index if not exists idx_adv_emp on public.hr_advances(employee_type, employee_id);

do $$
declare t text;
begin
  foreach t in array array['hr_advances'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('hr_payroll','edit')) with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
