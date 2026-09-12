-- ===========================================================================
-- 0555 — a person's ID No is a plain running number: 01, 02, 03.
--
-- `staff.code` and `workers.code` were assigned by `public.assign_code`
-- (0005), the app-wide helper that writes `<PREFIX>-0001` — so a staff member
-- was "STF-0001" and a worker "WRK-0001". The client wants the ID No on the
-- HR person screen to read 01, 02, … instead (2026-09-11), and said in the
-- same breath that the FORMAT is expected to change again later.
--
-- ## A NEW FUNCTION, NOT AN EDIT TO `assign_code`
--
-- `assign_code` is a trigger function shared by ~20 tables — opportunities,
-- contractors, and every other master that mints a code. Changing its body to
-- drop the prefix would silently renumber all of them, which is not what was
-- asked for and would be invisible until someone read an existing document.
-- So this is a second function that only staff and workers point at, and the
-- shared one is untouched.
--
-- It takes the sequence as `tg_argv[0]` exactly as `assign_code` does, so
-- pointing a third table at it later is one `create trigger` line.
--
-- ## `lpad(..., 2, '0')` DOES NOT CAP AT 99
--
-- lpad only PADS; it never truncates. So the series runs 01 … 09, 10 … 99,
-- then 100, 101 — it widens rather than wrapping or failing. Two is the
-- minimum width the client asked for, not a maximum.
--
-- ## THE SEQUENCES ARE RESTARTED, AND THAT IS ONLY SAFE BECAUSE BOTH TABLES
-- ## ARE EMPTY
--
-- Checked from the catalog before writing, not assumed: staff 0 rows, workers
-- 0 rows, seq_staff at 14 and seq_worker at 4 — both advanced by test records
-- that have since been deleted. Restarting them is therefore what makes the
-- FIRST real staff member "01" rather than "15".
--
-- Restarting a sequence under rows that exist would hand the next record a
-- code an earlier one already holds; `code` is `text unique` on both tables so
-- the insert would be refused rather than silently colliding, but the operator
-- would see a failed save with nothing to explain it. If either table is
-- non-empty when this runs, the guard below leaves its sequence alone and the
-- numbering simply continues from where it is — a gap is not a defect.
-- ===========================================================================

create or replace function public.hr_assign_person_code()
returns trigger language plpgsql as $$
declare
  v_seq text := tg_argv[0];
begin
  -- Same shape as `assign_code`: only ever fills a code the row did not bring
  -- its own. A data-io import that carries an ID No keeps it.
  if new.code is null or new.code = '' then
    new.code := lpad(nextval(v_seq::regclass)::text, 2, '0');
  end if;
  return new;
end;
$$;

-- AGENTS.md ▸ "Function grants": a new function is born anon-callable by TWO
-- independent grants, and revoking one leaves the other standing. Both, in one
-- statement — the idiom 0042 · 0352 · 0382 use. A trigger function is not
-- reachable by `.rpc()`, but the rule is "no function in public is executable
-- by anon", and an exception that has to be reasoned about each time is how
-- the last three holes got in.
revoke all on function public.hr_assign_person_code() from public, anon;

drop trigger if exists trg_staff_code on public.staff;
create trigger trg_staff_code before insert on public.staff
  for each row execute function public.hr_assign_person_code('public.seq_staff');

drop trigger if exists trg_worker_code on public.workers;
create trigger trg_worker_code before insert on public.workers
  for each row execute function public.hr_assign_person_code('public.seq_worker');

-- Only when the table is empty — see the header.
do $$
begin
  if not exists (select 1 from public.staff) then
    alter sequence public.seq_staff restart with 1;
  end if;
  if not exists (select 1 from public.workers) then
    alter sequence public.seq_worker restart with 1;
  end if;
end $$;

comment on function public.hr_assign_person_code() is
  'Assigns a plain zero-padded running number (01, 02, …) to staff.code / workers.code on insert, from the sequence named in tg_argv[0]. Separate from public.assign_code so the ~20 tables sharing that one keep their <PREFIX>-0001 format. 0555.';
