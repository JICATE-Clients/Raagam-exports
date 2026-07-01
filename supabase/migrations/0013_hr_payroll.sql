-- ============================================================================
-- Raagam ERP — 0013 HR & Payroll
-- 3 worker types (shift / contractor-piece / company-piece), dual-account wages
-- (Actual from A/C 1 with ESI+PF; Extra from A/C 2, no deductions), OT paid
-- double, weekly worker payroll + monthly staff salary, contractor netting.
-- Wage math lives in lib/hr/calc.ts (pure functions); these tables store inputs
-- and computed results. GL posting + ESI/PF challans → stubbed (Finance later).
-- ============================================================================

-- ---------- contractors ----------
create sequence if not exists public.seq_contractor;
create table if not exists public.contractors (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  name           text not null,
  contact_person text,
  phone          text,
  location_id    uuid references public.locations(id),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_contractor_code before insert on public.contractors
  for each row execute function public.assign_code('CON','public.seq_contractor');
create trigger trg_contractor_updated before update on public.contractors
  for each row execute function public.set_updated_at();

-- ---------- workers (weekly, piece/shift) ----------
create sequence if not exists public.seq_worker;
create table if not exists public.workers (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,
  name               text not null,
  worker_type        text not null check (worker_type in
                       ('shift','contractor_piece','company_piece')),
  contractor_id      uuid references public.contractors(id),  -- for contractor_piece
  location_id        uuid references public.locations(id),
  biometric_id       text,
  shift_wage_per_day numeric(12,2) not null default 0,
  hourly_wage        numeric(12,2) not null default 0,   -- for OT + extra hours
  piece_rate         numeric(12,4) not null default 0,   -- for piece workers
  esi_applicable     boolean not null default true,
  pf_applicable      boolean not null default true,
  joined_date        date,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_worker_code before insert on public.workers
  for each row execute function public.assign_code('WRK','public.seq_worker');
create trigger trg_worker_updated before update on public.workers
  for each row execute function public.set_updated_at();
create index if not exists idx_workers_type on public.workers(worker_type);
create index if not exists idx_workers_contractor on public.workers(contractor_id);

-- ---------- staff (monthly salary) ----------
create sequence if not exists public.seq_staff;
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  name           text not null,
  designation    text,
  location_id    uuid references public.locations(id),
  monthly_salary numeric(12,2) not null default 0,
  esi_applicable boolean not null default true,
  pf_applicable  boolean not null default true,
  joined_date    date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_staff_code before insert on public.staff
  for each row execute function public.assign_code('STF','public.seq_staff');
create trigger trg_staff_updated before update on public.staff
  for each row execute function public.set_updated_at();

-- ---------- global payroll settings (single row) ----------
create table if not exists public.payroll_settings (
  id                     uuid primary key default gen_random_uuid(),
  ot_multiplier          numeric(4,2) not null default 2,
  max_ot_hours_per_day   numeric(5,2) not null default 4,
  max_ot_hours_per_month numeric(6,2) not null default 50,
  esi_rate               numeric(6,5) not null default 0.00750,  -- employee 0.75%
  pf_rate                numeric(6,5) not null default 0.12000,  -- employee 12%
  currency               text not null default 'INR',
  updated_at             timestamptz not null default now()
);

-- ---------- attendance (daily, from biometric or manual) ----------
create table if not exists public.worker_attendance (
  id           uuid primary key default gen_random_uuid(),
  worker_id    uuid not null references public.workers(id) on delete cascade,
  work_date    date not null,
  present      boolean not null default true,
  normal_hours numeric(5,2) not null default 0,
  ot_hours     numeric(5,2) not null default 0,   -- capped by settings at entry
  extra_hours  numeric(5,2) not null default 0,   -- extra shift hours (for extra wage)
  source       text not null default 'manual' check (source in ('biometric','manual')),
  note         text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (worker_id, work_date)
);
create trigger trg_attendance_updated before update on public.worker_attendance
  for each row execute function public.set_updated_at();
create index if not exists idx_attendance_worker on public.worker_attendance(worker_id, work_date);

-- ---------- worker piece records (HR-editable until run locks them) ----------
create table if not exists public.worker_piece_records (
  id             uuid primary key default gen_random_uuid(),
  worker_id      uuid not null references public.workers(id) on delete cascade,
  work_date      date not null default current_date,
  pieces         numeric(14,0) not null default 0,
  sales_order_id uuid references public.sales_orders(id),
  is_locked      boolean not null default false,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_piece_updated before update on public.worker_piece_records
  for each row execute function public.set_updated_at();
create index if not exists idx_piece_worker on public.worker_piece_records(worker_id, work_date);

-- ---------- payroll runs ----------
create sequence if not exists public.seq_payroll_run;
create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,
  run_kind     text not null default 'worker' check (run_kind in ('worker','staff')),
  period_type  text not null default 'weekly' check (period_type in ('weekly','monthly')),
  period_start date not null,
  period_end   date not null,
  location_id  uuid references public.locations(id),  -- separate HR teams HO/Unit2
  status       text not null default 'draft'
                 check (status in ('draft','calculated','approved','locked','paid')),
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  approved_by  uuid references public.profiles(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_payrun_code before insert on public.payroll_runs
  for each row execute function public.assign_code('PR','public.seq_payroll_run');
create trigger trg_payrun_updated before update on public.payroll_runs
  for each row execute function public.set_updated_at();

-- per-worker / per-staff computed line (the dual-account split)
create table if not exists public.payroll_lines (
  id              uuid primary key default gen_random_uuid(),
  payroll_run_id  uuid not null references public.payroll_runs(id) on delete cascade,
  worker_id       uuid references public.workers(id),
  staff_id        uuid references public.staff(id),
  worker_type     text,
  days_worked     numeric(5,1) not null default 0,
  ot_hours        numeric(6,2) not null default 0,
  ot_wage         numeric(12,2) not null default 0,
  actual_gross    numeric(12,2) not null default 0,   -- A/C 1 gross
  esi             numeric(12,2) not null default 0,
  pf              numeric(12,2) not null default 0,
  actual_net      numeric(12,2) not null default 0,   -- A/C 1 net (after ESI+PF)
  pieces          numeric(14,0) not null default 0,
  extra_wage      numeric(12,2) not null default 0,   -- A/C 2 (no deductions)
  total_net       numeric(12,2) not null default 0,   -- actual_net + extra_wage
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_paylines_run on public.payroll_lines(payroll_run_id);

-- contractor netting: extra wage to the contractor (not the workers)
create table if not exists public.contractor_payroll (
  id               uuid primary key default gen_random_uuid(),
  payroll_run_id   uuid not null references public.payroll_runs(id) on delete cascade,
  contractor_id    uuid not null references public.contractors(id),
  total_pieces     numeric(14,0) not null default 0,
  piece_amount     numeric(14,2) not null default 0,
  sum_actual_wages numeric(14,2) not null default 0,
  extra_wage       numeric(14,2) not null default 0,   -- piece_amount - sum_actual_wages
  created_at       timestamptz not null default now()
);
create index if not exists idx_contrpay_run on public.contractor_payroll(payroll_run_id);

-- ---------- RLS (gated by 'hr_payroll') ----------
do $$
declare t text;
begin
  foreach t in array array[
    'contractors','workers','staff','payroll_settings','worker_attendance',
    'worker_piece_records','payroll_runs','payroll_lines','contractor_payroll'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('hr_payroll','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('hr_payroll','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('hr_payroll','edit'))
        with check (public.has_permission('hr_payroll','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('hr_payroll','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- roles + grants ----------
insert into public.roles (name, description, is_system) values
  ('HR Manager', 'Approves and locks payroll runs', false),
  ('HR Executive', 'Manages workers, attendance and piece counts', false)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'hr_payroll' and p.action in ('view','create','edit','approve','export')
where r.name in ('HR Manager','Manager') on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'hr_payroll' and p.action in ('view','create','edit')
where r.name = 'HR Executive' on conflict do nothing;

-- ---------- seed the single settings row ----------
insert into public.payroll_settings (ot_multiplier, max_ot_hours_per_day, max_ot_hours_per_month)
select 2, 4, 50
where not exists (select 1 from public.payroll_settings);
