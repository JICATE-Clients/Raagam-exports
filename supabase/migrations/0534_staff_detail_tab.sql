-- ===========================================================================
-- 0534 — `staff` gains the legacy Detail tab, and its identity block.
--
-- WHAT WAS THERE. `staff` was created by 0013 with twelve columns — id, code,
-- name, designation, location_id, monthly_salary, esi_applicable,
-- pf_applicable, joined_date, is_active and the two timestamps. That is a
-- payroll stub: enough to run a salary line, nothing like an employee record.
--
-- WHAT THE CLIENT ASKED FOR (2026-09-07) is legacy EDP2 Staff — the header
-- block above the tabs (ID No · Name · S/O · Mother Name · Designation ·
-- Category · Department · Location · Division) plus the whole Detail tab. Every
-- column below was verified ABSENT against the live catalog before this was
-- written, not assumed from reading 0013.
--
-- ## THREE THINGS THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- NO `age` COLUMN. Legacy shows Age beside DOB and stores both, which is a
-- value that is wrong from the day after it is saved. It is `date_of_birth`
-- and a computation at the call site. The one number the DB should hold is the
-- one a human typed.
--
-- NO `photo` COLUMN. The tab has a photo box, and an image is a storage object
-- with a bucket, a policy and a cleanup story — not a column on a row. It is
-- left out rather than stubbed as text so nobody wires a base64 blob into a
-- table row while nobody is looking.
--
-- NO CHANGE TO `designation`. It stays TEXT even though `designations` is a
-- real master, because turning it into a foreign key has to migrate the values
-- that are already in it — a separate decision with a data-repair step, not a
-- column add. `category_id`, `department_id` and `division_id` below are new
-- and therefore start as proper references.
--
-- ## SAFE TO RE-RUN, AND ADDITIVE ONLY
--
-- Every statement is `add column if not exists`. Nothing is dropped, nothing is
-- renamed, and every column is nullable or defaulted — the rows that exist stay
-- valid, which is what lets this ship without a backfill.
-- ===========================================================================

-- ---------- identity: the block above the legacy tabs ----------
alter table public.staff
  -- The legacy "S/O" pair: a relationship word and the name it points at.
  -- Two columns because they are two values — a screen that concatenates them
  -- for display can, but the record must not lose which is which.
  add column if not exists guardian_relation text
    check (guardian_relation is null
           or guardian_relation in ('S/O', 'D/O', 'W/O', 'C/O')),
  add column if not exists guardian_name     text,
  add column if not exists mother_name       text,
  add column if not exists category_id       uuid references public.employee_categories(id),
  add column if not exists department_id     uuid references public.departments(id),
  add column if not exists division_id       uuid references public.divisions(id);

-- ---------- Detail: employment ----------
alter table public.staff
  add column if not exists staff_type text not null default 'Permanent'
    check (staff_type in ('Permanent', 'Temporary', 'Contract', 'Probation', 'Trainee')),
  add column if not exists card_no text,
  add column if not exists salary_paid text not null default 'Monthly'
    check (salary_paid in ('Monthly', 'Weekly', 'Daily', 'Piece Rate')),
  -- Stored as the English day name rather than 0-6: it is read straight onto a
  -- roster and printed, and an integer would need a lookup on every surface
  -- that shows it. `null` means no fixed weekly off.
  add column if not exists week_off text
    check (week_off is null
           or week_off in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  add column if not exists hostel_category_id uuid references public.hostel_categories(id),
  add column if not exists vehicle_no text,
  -- Self-reference: a manager is another staff member. `on delete set null`
  -- rather than cascade — losing a manager's row must not delete their reports.
  add column if not exists manager_id uuid references public.staff(id) on delete set null;

-- ---------- Detail: pay, statutory vs actual ----------
-- TWO SETS OF THE SAME FOUR HEADS, which is the legacy screen's Pay(Statutory)
-- and Pay(Actual) panels. They are separate columns and not a child table: the
-- heads are fixed by the form (Gross, Basic, DA, HRA) and there is exactly one
-- of each per staff member, so a table would add a join and a row-shape problem
-- to answer a question the columns answer directly.
--
-- OTHERS is deliberately absent from both. It is greyed and computed in legacy
-- (Gross less the named heads); storing it invites the stored copy and the
-- arithmetic to disagree.
alter table public.staff
  add column if not exists stat_gross numeric(12,2) not null default 0,
  add column if not exists stat_basic numeric(12,2) not null default 0,
  add column if not exists stat_da    numeric(12,2) not null default 0,
  add column if not exists stat_hra   numeric(12,2) not null default 0,
  add column if not exists act_gross  numeric(12,2) not null default 0,
  add column if not exists act_basic  numeric(12,2) not null default 0,
  add column if not exists act_da     numeric(12,2) not null default 0,
  add column if not exists act_hra    numeric(12,2) not null default 0;

-- ---------- Detail: statutory status ----------
alter table public.staff
  add column if not exists migrant_worker       boolean not null default false,
  add column if not exists international_worker boolean not null default false,
  -- Legacy offers L / H / V / No. Modelled as a nullable code plus a percentage
  -- rather than a boolean, because the category is what statutory returns ask
  -- for and "No" is simply the absence of one.
  add column if not exists disability_type text
    check (disability_type is null or disability_type in ('L', 'H', 'V')),
  add column if not exists disability_pct numeric(5,2) not null default 0
    check (disability_pct >= 0 and disability_pct <= 100);

-- ---------- Detail: the dates ----------
-- DOJ IS NOT ADDED. `joined_date` (0013) is already the date of joining, and a
-- second column meaning the same thing is how two screens come to disagree
-- about when someone started. The Detail tab's DOJ reads and writes
-- `joined_date`.
alter table public.staff
  add column if not exists date_of_birth  date,
  add column if not exists place_of_birth text,
  add column if not exists date_of_probation  date,   -- DOP
  add column if not exists date_of_confirmation date, -- DOC
  add column if not exists date_of_leaving date;      -- DOL

-- ---------- Detail: pay mode, tax and identifiers ----------
alter table public.staff
  add column if not exists pay_mode text not null default 'Cash'
    check (pay_mode in ('Cash', 'Bank')),
  add column if not exists tds_applicable boolean not null default false,
  add column if not exists police_station text,
  -- India's PAN is a fixed 10-character shape. Constrained here as well as in
  -- Zod because `lib/data-io` imports write straight to Postgres and never
  -- reach the screen's validation.
  add column if not exists pan_no text
    check (pan_no is null or pan_no ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

-- ---------- Detail: running balances ----------
-- Held on the record because the legacy screen shows them there. They are
-- OPENING/CURRENT figures typed by a human, not a ledger — when advances and
-- loans get their own transactions, these become the derived answer and this
-- comment is the note that says so.
alter table public.staff
  add column if not exists loan_balance    numeric(12,2) not null default 0,
  add column if not exists advance_balance numeric(12,2) not null default 0,
  add column if not exists expected_salary numeric(12,2) not null default 0,
  add column if not exists cl_balance      numeric(6,2)  not null default 0,
  add column if not exists el_credit_days  numeric(6,2)  not null default 0,
  add column if not exists el_carry_days   numeric(6,2)  not null default 0;

-- ---------- Detail: blocked ----------
-- SEPARATE FROM `is_active`, and the difference is the point. `is_active` is
-- "does this person still work here"; blocked is a deliberate bar on a current
-- employee (legacy shows both on one screen, and the tick sits with the dates
-- rather than with the status). Collapsing them would make un-blocking someone
-- indistinguishable from re-hiring them.
alter table public.staff
  add column if not exists blocked boolean not null default false;

-- A manager lookup runs on every Detail render; the reports-of query is the
-- only one that scans by this column.
create index if not exists staff_manager_id_idx on public.staff (manager_id);
