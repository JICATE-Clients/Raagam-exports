-- ===========================================================================
-- 0535 — `staff` gains the legacy General tab, and its Banks grid becomes a
-- child table.
--
-- 0534 brought the Detail tab. This is the next one the client named: two
-- addresses, contact and identity fields, and — at the foot of the legacy
-- screen — a multi-row Banks grid, which is the one part that cannot be
-- columns.
--
-- ## THE ADDRESSES ARE TWO SETS OF THE SAME SEVEN FIELDS
--
-- Permanent and Correspondence, each with three free lines, a city, a pin and
-- two phone numbers. They are columns rather than an `addresses` child table
-- because there are exactly two, they are named, and a staff member cannot have
-- three of either — a table would add a join and a "which kind is this row"
-- problem to answer a question the columns answer directly.
--
-- `corr_same_as_permanent` IS STORED, not derived. The legacy screen has the
-- tick and it means something the copied values cannot: "keep these in step".
-- Copying the permanent address into the correspondence columns and dropping
-- the flag would lose the operator's intent the moment the permanent address
-- changed — the two would silently diverge with nothing recording that they
-- were meant to match.
--
-- ## THE BANKS GRID IS A CHILD TABLE
--
-- `staff_bank_accounts`, one row per account, because the legacy grid takes
-- several and a staff member genuinely can hold more than one. This is the
-- table the Bank Account Details tab was waiting for — 0534 deliberately added
-- no account columns, and this is why.
--
-- ## WHAT THIS DOES NOT DO
--
-- The tab's four buttons — Education & Technical Details, Language Details,
-- Other Details, Enclosure — open their own sub-screens, each with its own
-- rows. They are NOT fields on this tab and get their own tables when they are
-- built; nothing here stubs them.
--
-- No `age` and no photo, for the reasons 0534 states.
--
-- Additive and idempotent: every statement is `add column if not exists` or
-- `create table if not exists`, and every column is nullable or defaulted, so
-- existing rows stay valid without a backfill.
-- ===========================================================================

-- ---------- General: permanent address ----------
alter table public.staff
  add column if not exists perm_address1 text,
  add column if not exists perm_address2 text,
  add column if not exists perm_address3 text,
  add column if not exists perm_city     text,
  add column if not exists perm_pin      text,
  add column if not exists perm_phone    text,
  add column if not exists perm_mobile   text;

-- ---------- General: correspondence address ----------
alter table public.staff
  add column if not exists corr_same_as_permanent boolean not null default false,
  add column if not exists corr_address1 text,
  add column if not exists corr_address2 text,
  add column if not exists corr_address3 text,
  add column if not exists corr_city     text,
  add column if not exists corr_pin      text,
  add column if not exists corr_phone    text,
  add column if not exists corr_mobile   text;

-- ---------- General: contact and identity ----------
alter table public.staff
  add column if not exists email text,
  add column if not exists qualification text,
  -- The eight ABO/Rh groups. A constraint rather than a free text box, because
  -- "O+" and "O positive" and "o+ve" are the same fact typed three ways, and a
  -- statutory form needs one of them.
  add column if not exists blood_group text
    check (blood_group is null
           or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  add column if not exists identification_mark_1 text,
  add column if not exists identification_mark_2 text,
  add column if not exists sex text
    check (sex is null or sex in ('Male', 'Female', 'Trans Gender')),
  add column if not exists marital_status text
    check (marital_status is null
           or marital_status in ('Single', 'Married', 'Divorced', 'Widow')),
  add column if not exists nationality text,
  add column if not exists religion text,
  add column if not exists driving_licence_no text,
  add column if not exists driving_licence_valid_upto date,
  -- TWELVE DIGITS, AND NO CHECK DIGIT VALIDATION HERE. Aadhaar's Verhoeff
  -- checksum belongs in one place the app can report on, not in a constraint
  -- that rejects a row with a Postgres error the operator cannot read. The
  -- shape is worth constraining; the arithmetic is the screen's job.
  add column if not exists aadhaar_no text
    check (aadhaar_no is null or aadhaar_no ~ '^[0-9]{12}$'),
  -- The legacy tick beside Enclosure. Its meaning is the operator's — legacy
  -- labels it "Flag" and nothing else — so it is stored as what it is rather
  -- than renamed to a guess.
  add column if not exists general_flag boolean not null default false;

-- ---------- the Banks grid ----------
create table if not exists public.staff_bank_accounts (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  sno        integer not null default 0,
  -- Legacy's "Bank Type" is a word on the line, not the master's own
  -- `banks.bank_type` — the grid lets an operator say how THIS account is held.
  bank_type  text,
  -- The bank itself is a master row (the legacy grid's `i` lookup).
  -- `on delete set null`: retiring a bank master must not delete an employee's
  -- account history.
  bank_id    uuid references public.banks(id) on delete set null,
  ac_type    text,
  ac_no      text,
  ifsc_code  text
    check (ifsc_code is null or ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  branch     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_staff_bank_accounts_updated before update on public.staff_bank_accounts
  for each row execute function public.set_updated_at();

create index if not exists idx_staff_bank_accounts_parent
  on public.staff_bank_accounts (staff_id);

-- RLS — gated on `hr_payroll`, which is the module that owns this screen.
-- (Masters' own children gate on `masters`; a staff member's bank account is
-- HR data, and the permission has to match the module the operator is in.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'staff_bank_accounts'
  ) then
    create policy staff_bank_accounts_read on public.staff_bank_accounts
      for select to authenticated using (true);
    create policy staff_bank_accounts_insert on public.staff_bank_accounts
      for insert to authenticated
      with check (public.has_permission('hr_payroll', 'create'));
    create policy staff_bank_accounts_update on public.staff_bank_accounts
      for update to authenticated
      using (public.has_permission('hr_payroll', 'edit'))
      with check (public.has_permission('hr_payroll', 'edit'));
    create policy staff_bank_accounts_delete on public.staff_bank_accounts
      for delete to authenticated
      using (public.has_permission('hr_payroll', 'delete'));
  end if;
end $$;

alter table public.staff_bank_accounts enable row level security;
