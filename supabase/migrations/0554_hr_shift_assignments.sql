-- ===========================================================================
-- 0554 — which shift a person is on, and since when.
--
-- `workers` carries `shift_wage_per_day` and `ctc_per_shift`, which are RATES.
-- Nothing said which shift a worker is actually on: `work_timing_lines` hangs
-- its `shift_category_id` off a Work Timing header (a date, a location and an
-- effective-from), not off a person, and `employees.shift_id` belongs to a
-- different master. So "which shift is this worker on?" had no answer.
--
-- ## DATED, NOT A COLUMN
--
-- The obvious shape is `workers.shift_category_id`. It is wrong for the
-- question the data has to answer: attendance and OT both ask "which shift was
-- this person on THAT DAY", and a single column only ever knows today. A worker
-- moved from General to Night in March would make every February payslip
-- recompute against the wrong shift the moment somebody re-ran it.
--
-- So it is a row per spell — `effective_from`, and `effective_to` NULL while the
-- assignment is current.
--
-- ## NO TWO SPELLS MAY OVERLAP, AND POSTGRES ENFORCES IT
--
-- A person on two shifts on one day is not a UI slip to guard against in the
-- screen — it makes "which shift on that day" unanswerable, which is the whole
-- point of the table. `btree_gist` (available here, checked) lets one EXCLUDE
-- constraint say it for both parent columns at once.
--
-- `daterange(effective_from, effective_to, '[]')` is INCLUSIVE at both ends: a
-- spell ending 31 March and the next starting 1 April do not touch, while two
-- both covering 31 March do.
--
-- ## IT TAKES EITHER PARENT
--
-- Same shape as the other seven `hr_*` tables (0553): a `staff_id` or a
-- `worker_id`, exactly one. Shifts are mostly a worker thing, but a supervisor
-- on nights is staff on a shift, and a second table for that would be the
-- duplication 0553 exists to avoid.
-- ===========================================================================

create extension if not exists btree_gist;

create table if not exists public.hr_shift_assignments (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid references public.staff(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete cascade,
  sno       integer not null default 0,

  -- The shift itself, from `config_lookups` kind 'shift_category' — the same
  -- master `work_timing_lines` points at, so a shift named on a Work Timing and
  -- a shift a person is assigned to are the same row, not two spellings.
  -- `on delete restrict`: retiring a shift category that people are still on
  -- should fail loudly, not silently orphan their assignments.
  shift_category_id uuid not null references public.config_lookups(id) on delete restrict,

  effective_from date not null default current_date,
  -- NULL means "still on it". Not a far-future date: "unknown end" and "ends in
  -- 2099" are different facts, and only one of them is true.
  effective_to   date,
  notes          text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hr_shift_assignments_one_parent
    check ((staff_id is null) <> (worker_id is null)),
  constraint hr_shift_assignments_dates
    check (effective_to is null or effective_to >= effective_from)
);

-- One spell per person per day. Two constraints because a row has one parent or
-- the other, and an EXCLUDE can only compare columns that are both non-null —
-- each is partial on the parent it guards.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_shift_assignments_no_overlap_staff') then
    alter table public.hr_shift_assignments
      add constraint hr_shift_assignments_no_overlap_staff
      exclude using gist (
        staff_id with =,
        daterange(effective_from, effective_to, '[]') with &&
      ) where (staff_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hr_shift_assignments_no_overlap_worker') then
    alter table public.hr_shift_assignments
      add constraint hr_shift_assignments_no_overlap_worker
      exclude using gist (
        worker_id with =,
        daterange(effective_from, effective_to, '[]') with &&
      ) where (worker_id is not null);
  end if;
end $$;

create trigger trg_hr_shift_assignments_updated before update on public.hr_shift_assignments
  for each row execute function public.set_updated_at();

create index if not exists idx_hr_shift_assignments_staff  on public.hr_shift_assignments (staff_id);
create index if not exists idx_hr_shift_assignments_worker on public.hr_shift_assignments (worker_id);

-- RLS on `hr_payroll`, matching every other child of a person (0535 · 0536).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hr_shift_assignments'
  ) then
    create policy hr_shift_assignments_read on public.hr_shift_assignments
      for select to authenticated using (true);
    create policy hr_shift_assignments_insert on public.hr_shift_assignments
      for insert to authenticated
      with check (public.has_permission('hr_payroll', 'create'));
    create policy hr_shift_assignments_update on public.hr_shift_assignments
      for update to authenticated
      using (public.has_permission('hr_payroll', 'edit'))
      with check (public.has_permission('hr_payroll', 'edit'));
    create policy hr_shift_assignments_delete on public.hr_shift_assignments
      for delete to authenticated
      using (public.has_permission('hr_payroll', 'delete'));
  end if;
end $$;

alter table public.hr_shift_assignments enable row level security;

comment on table public.hr_shift_assignments is
  'Which shift a staff member or worker is on, and for which dates. One row per spell; `effective_to` NULL means current. Overlaps are refused by an EXCLUDE constraint, because "which shift on that day" must have exactly one answer. 0554.';
