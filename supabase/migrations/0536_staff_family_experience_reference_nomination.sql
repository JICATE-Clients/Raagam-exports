-- ===========================================================================
-- 0536 — the last four legacy Staff tabs: Family Details, Work Experience,
-- Reference and Nomination.
--
-- 0534 brought Detail, 0535 brought General. These four complete the record.
-- Three of them are GRIDS and become child tables; Reference is mostly named
-- pairs and becomes columns, with one grid at its foot.
--
-- ## WHAT IS A TABLE AND WHAT IS A COLUMN
--
-- The test is whether the legacy screen lets an operator add a ROW. Family
-- members, previous employers, internal referees and nominations are each an
-- open-ended list — a table. External References and Emergency Contacts are
-- numbered 1) and 2) on the form, exactly two of each, so they are columns for
-- the same reason 0535's two addresses are: no join, and no "which kind is this
-- row" problem to answer a question the columns answer directly.
--
-- ## ESI AND PF MOVE HERE, AND THE BOOLEAN STAYS
--
-- Legacy puts ESI and PF on THIS tab, as a three-state Yes / No / Exempted plus
-- a number and two dates. `staff` already carries `esi_applicable` /
-- `pf_applicable` booleans from 0013, and payroll reads them.
--
-- Two columns for one fact would drift, so the boolean is DERIVED FROM THE
-- STATUS AND KEPT IN STEP BY A TRIGGER — `esi_applicable = (esi_status =
-- 'Yes')`. The status is what an operator sets; the boolean is what payroll
-- already reads and keeps reading. Doing it in the database rather than the
-- screen matters because `lib/data-io` imports write straight to Postgres and
-- never reach a screen's logic.
--
-- EXEMPTED IS NOT THE SAME AS NO, which is why the three-state exists: an
-- exempted employee is outside the scheme by entitlement, a "No" is simply not
-- enrolled. Both mean payroll deducts nothing, so both map the boolean to
-- false, and the distinction survives in `esi_status` for the statutory return.
--
-- ## AGE AND DURATION ARE NOT STORED
--
-- Family Details shows Age beside DOB and Work Experience shows Duration beside
-- From/To. Both are arithmetic on dates already in the row, and a stored copy is
-- wrong from the day after it is written — the same call 0534 made for the
-- staff member's own age.
--
-- Additive and idempotent; every column nullable or defaulted.
-- ===========================================================================

-- ---------- Family Details ----------
create table if not exists public.staff_family_members (
  id                     uuid primary key default gen_random_uuid(),
  staff_id               uuid not null references public.staff(id) on delete cascade,
  sno                    integer not null default 0,
  name                   text,
  date_of_birth          date,
  -- Legacy's "Alive" tick. Defaults TRUE: a family member is presumed living,
  -- and an unticked box on a new row would state the opposite by accident.
  alive                  boolean not null default true,
  relation               text,
  other_information      text,
  residing_with_employee boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------- Work Experience ----------
create table if not exists public.staff_work_experience (
  id                 uuid primary key default gen_random_uuid(),
  staff_id           uuid not null references public.staff(id) on delete cascade,
  sno                integer not null default 0,
  company_name       text,
  address            text,
  designation        text,
  exp_from           date,
  exp_to             date,
  -- FREE TEXT, NOT A COMPUTED NUMBER, and deliberately kept even though
  -- From/To are here. A candidate often gives "about 3 years" for a job whose
  -- exact dates they no longer have, and the legacy column accepts that. When
  -- both dates ARE present the screen shows the arithmetic instead.
  duration           text,
  last_salary_drawn  numeric(12,2),
  reason_for_leaving text,
  details            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- Reference: the two external referees ----------
alter table public.staff
  add column if not exists ext_ref1_name        text,
  add column if not exists ext_ref1_designation text,
  add column if not exists ext_ref1_address1    text,
  add column if not exists ext_ref1_address2    text,
  add column if not exists ext_ref1_phone       text,
  add column if not exists ext_ref1_mobile      text,
  add column if not exists ext_ref2_name        text,
  add column if not exists ext_ref2_designation text,
  add column if not exists ext_ref2_address1    text,
  add column if not exists ext_ref2_address2    text,
  add column if not exists ext_ref2_phone       text,
  add column if not exists ext_ref2_mobile      text;

-- ---------- Reference: the two emergency contacts ----------
-- Same shape as the referees but for `relation` in place of `designation` —
-- an emergency contact is reached as a person, not in a professional capacity.
alter table public.staff
  add column if not exists emergency1_name     text,
  add column if not exists emergency1_relation text,
  add column if not exists emergency1_address1 text,
  add column if not exists emergency1_address2 text,
  add column if not exists emergency1_phone    text,
  add column if not exists emergency1_mobile   text,
  add column if not exists emergency2_name     text,
  add column if not exists emergency2_relation text,
  add column if not exists emergency2_address1 text,
  add column if not exists emergency2_address2 text,
  add column if not exists emergency2_phone    text,
  add column if not exists emergency2_mobile   text;

-- ---------- Reference: internal referees ----------
create table if not exists public.staff_internal_references (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  sno           integer not null default 0,
  department_id uuid references public.departments(id) on delete set null,
  -- The referee is another staff member (legacy's second `i` lookup).
  -- `on delete set null`: their leaving must not delete this row.
  referee_id    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- Nomination: the "For" grid ----------
create table if not exists public.staff_nominations (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff(id) on delete cascade,
  sno            integer not null default 0,
  -- Legacy's single unlabelled column, headed "For": what the nomination is
  -- FOR (gratuity, PF, insurance). Free text, because the legacy list is not
  -- seeded and inventing a vocabulary is how a name master goes wrong.
  nomination_for text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- Nomination: ESI and PF ----------
alter table public.staff
  add column if not exists esi_status text not null default 'No'
    check (esi_status in ('Yes', 'No', 'Exempted')),
  add column if not exists esi_no text,
  add column if not exists esi_date_of_joining date,
  add column if not exists esi_date_of_leaving date,
  add column if not exists esi_dispensary text,
  add column if not exists pf_status text not null default 'No'
    check (pf_status in ('Yes', 'No', 'Exempted')),
  add column if not exists pf_no text,
  add column if not exists pf_date_of_joining date,
  add column if not exists pf_date_of_leaving date;

-- ---------- the boolean follows the status ----------
-- ONE FACT, ONE PLACE. `esi_applicable` / `pf_applicable` (0013) are what
-- payroll reads and will keep reading; `esi_status` / `pf_status` are what an
-- operator sets. Rather than leave two columns to drift, the booleans are
-- maintained here — in the DATABASE, because `lib/data-io` imports write
-- straight to Postgres and never reach a screen's logic.
create or replace function public.staff_sync_statutory_flags()
returns trigger language plpgsql as $$
begin
  new.esi_applicable := (new.esi_status = 'Yes');
  new.pf_applicable  := (new.pf_status  = 'Yes');
  return new;
end $$;

comment on function public.staff_sync_statutory_flags() is
  'Keeps staff.esi_applicable / pf_applicable equal to (status = ''Yes''). The status is the operator-facing three-state (Yes / No / Exempted); the booleans are the payroll-facing fact. Exempted and No both deduct nothing, so both map to false — the distinction survives in the status column for the statutory return. 0536.';

drop trigger if exists trg_staff_statutory_flags on public.staff;
create trigger trg_staff_statutory_flags
  before insert or update of esi_status, pf_status on public.staff
  for each row execute function public.staff_sync_statutory_flags();

-- Existing rows: seed the status FROM the boolean, which is the only
-- information there is for a row created before this migration.
update public.staff
   set esi_status = case when esi_applicable then 'Yes' else 'No' end,
       pf_status  = case when pf_applicable  then 'Yes' else 'No' end
 where esi_status = 'No' and pf_status = 'No'
   and (esi_applicable or pf_applicable);

-- ---------- triggers, indexes, RLS ----------
do $$
declare t text;
begin
  foreach t in array array[
    'staff_family_members',
    'staff_work_experience',
    'staff_internal_references',
    'staff_nominations'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$s
         for each row execute function public.set_updated_at();', t);
    execute format(
      'create index if not exists idx_%1$s_parent on public.%1$s (staff_id);', t);

    -- Gated on `hr_payroll` — the module that owns this screen — matching
    -- `staff_bank_accounts` (0535) rather than the masters idiom.
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s
          for select to authenticated using (true);
        create policy %1$s_insert on public.%1$s
          for insert to authenticated
          with check (public.has_permission('hr_payroll','create'));
        create policy %1$s_update on public.%1$s
          for update to authenticated
          using (public.has_permission('hr_payroll','edit'))
          with check (public.has_permission('hr_payroll','edit'));
        create policy %1$s_delete on public.%1$s
          for delete to authenticated
          using (public.has_permission('hr_payroll','delete'));
      $f$, t);
    end if;

    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
