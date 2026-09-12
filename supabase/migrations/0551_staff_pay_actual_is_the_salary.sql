-- ===========================================================================
-- 0551 — Pay(Actual) Gross IS the monthly salary, and `expected_salary` goes.
--
-- The client trimmed the Pay(Actual) panel back to legacy's five heads
-- (2026-09-09) — Gross · Basic · DA · HRA · Others — which meant removing the
-- two boxes this screen had added beside them: Monthly Salary and Exp. Salary.
--
-- ## `monthly_salary` CANNOT SIMPLY LOSE ITS FIELD
--
-- It is not decoration. `computeStaffSalary` (lib/hr/calc.ts) takes it as the
-- gross a payslip is built from, and `payroll-actions.ts` reads it per run. Drop
-- the input and nothing could ever set it — every monthly payslip would quietly
-- compute from zero, which is the worst kind of failure: a run that succeeds and
-- pays nobody.
--
-- So it becomes DERIVED, exactly as `esi_applicable` did in 0536: a trigger
-- keeps `monthly_salary = act_gross`. There is one place to type the figure —
-- the Pay(Actual) panel, where the legacy screen puts it — and payroll keeps
-- reading the column it has always read.
--
-- The trigger deliberately fires on EVERY insert and update, not just when
-- `act_gross` changes. A column list would leave `update staff set
-- monthly_salary = 999` standing, and the whole point is that it cannot be
-- written independently.
--
-- ## `expected_salary` IS DROPPED, NOT DERIVED
--
-- Nothing reads it — no screen, no service, no report (checked). It came in
-- with 0534 because the legacy Payment block draws an "Exp. Salary" box, and it
-- has never held a value. A column nothing reads and nothing writes is a column
-- the next person has to work out is dead.
--
-- ## THE DATA-IO ENTITY WAS ALREADY BROKEN BY EARLIER MIGRATIONS
--
-- `lib/data-io/entities.ts` still imports `designation` (dropped in 0548 for
-- `designation_id`) and `esi_applicable` / `pf_applicable` (derived since
-- 0536 — an imported value is overwritten by the trigger on the same
-- statement). Those are fixed in the same change as this, because a spreadsheet
-- import that silently drops three columns is worse than one that refuses.
-- ===========================================================================

-- ---------- monthly_salary follows Pay(Actual) Gross ----------
create or replace function public.staff_sync_monthly_salary()
returns trigger language plpgsql as $$
begin
  new.monthly_salary := new.act_gross;
  return new;
end $$;

comment on function public.staff_sync_monthly_salary() is
  'Keeps staff.monthly_salary equal to staff.act_gross. `act_gross` is what an operator types on the Pay(Actual) panel; `monthly_salary` is what computeStaffSalary (lib/hr/calc.ts) and the payroll run read, and has done since 0013. One fact, one place to type it. 0551.';

drop trigger if exists trg_staff_monthly_salary on public.staff;
create trigger trg_staff_monthly_salary
  before insert or update on public.staff
  for each row execute function public.staff_sync_monthly_salary();

-- Bring any existing rows into line. `act_gross` defaults 0 and no row has been
-- created since 0534, so this is a no-op today — and correct against a table
-- that has rows.
update public.staff
   set act_gross = monthly_salary
 where act_gross = 0 and monthly_salary <> 0;

-- ---------- expected_salary goes ----------
alter table public.staff drop column if exists expected_salary;
