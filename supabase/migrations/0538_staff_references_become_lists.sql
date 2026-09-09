-- ===========================================================================
-- 0538 — external references and emergency contacts become LISTS.
--
-- 0536 made these twenty-four columns on `staff`, and said why: legacy numbers
-- them 1) and 2) on the form, exactly two of each, so a table would have added
-- a join and a "which kind is this row" problem to answer a question the
-- columns answered directly.
--
-- THE CLIENT OVERRODE THAT (2026-09-09: "why fixed like this here we cna add it
-- for add external ref and add emergency contact like before"). Two is what the
-- legacy SCREEN could hold, not what the business has — a staff member may name
-- three referees, or one. Family Details and Work Experience are already grids
-- on this screen, and four fixed blocks beside them read as an arbitrary
-- exception rather than a rule.
--
-- ## THE COLUMNS ARE COPIED, THEN DROPPED
--
-- `insert … select` moves any row that actually holds a name, numbered so a
-- record's first referee stays its first. It is written to be correct against a
-- database that HAS data even though this one has none today (staff: 0 rows,
-- checked before writing) — a migration that only works on an empty table is a
-- migration that fails the one time it matters.
--
-- Dropping is the right end state rather than leaving them: twenty-four columns
-- that nothing reads are twenty-four things the next person has to work out are
-- dead. `if exists` keeps it re-runnable.
--
-- ## WHAT STAYS COLUMNS
--
-- The two ADDRESSES (0535) are untouched. Permanent and Correspondence are not
-- "the first two of a list" — they are two named, different things, and no
-- staff member has a third permanent address. The test is whether the legacy
-- screen would let an operator add a row, and there it would not.
-- ===========================================================================

create table if not exists public.staff_external_references (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  sno         integer not null default 0,
  name        text,
  designation text,
  address1    text,
  address2    text,
  phone       text,
  mobile      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.staff_emergency_contacts (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  sno        integer not null default 0,
  name       text,
  -- `relation`, not `designation`: an emergency contact is reached as a person,
  -- not in a professional capacity. The one field that differs between the two
  -- tables, which is why they are two tables and not one with a `kind` column.
  relation   text,
  address1   text,
  address2   text,
  phone      text,
  mobile     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- carry any existing values across ----------
-- Guarded on the source columns still existing, so a re-run after the drop
-- below is a no-op rather than an error.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'ext_ref1_name'
  ) then
    insert into public.staff_external_references
      (staff_id, sno, name, designation, address1, address2, phone, mobile)
    select id, 1, ext_ref1_name, ext_ref1_designation, ext_ref1_address1,
           ext_ref1_address2, ext_ref1_phone, ext_ref1_mobile
      from public.staff where ext_ref1_name is not null
    union all
    select id, 2, ext_ref2_name, ext_ref2_designation, ext_ref2_address1,
           ext_ref2_address2, ext_ref2_phone, ext_ref2_mobile
      from public.staff where ext_ref2_name is not null;

    insert into public.staff_emergency_contacts
      (staff_id, sno, name, relation, address1, address2, phone, mobile)
    select id, 1, emergency1_name, emergency1_relation, emergency1_address1,
           emergency1_address2, emergency1_phone, emergency1_mobile
      from public.staff where emergency1_name is not null
    union all
    select id, 2, emergency2_name, emergency2_relation, emergency2_address1,
           emergency2_address2, emergency2_phone, emergency2_mobile
      from public.staff where emergency2_name is not null;
  end if;
end $$;

-- ---------- triggers, indexes, RLS ----------
do $$
declare t text;
begin
  foreach t in array array['staff_external_references', 'staff_emergency_contacts'] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', t)::regclass and tgname = format('trg_%s_updated', t)
    ) then
      execute format(
        'create trigger trg_%1$s_updated before update on public.%1$s
           for each row execute function public.set_updated_at();', t);
    end if;
    execute format(
      'create index if not exists idx_%1$s_parent on public.%1$s (staff_id);', t);

    -- `hr_payroll`, matching every other child of `staff` (0535 · 0536).
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

-- ---------- the columns go ----------
alter table public.staff
  drop column if exists ext_ref1_name,
  drop column if exists ext_ref1_designation,
  drop column if exists ext_ref1_address1,
  drop column if exists ext_ref1_address2,
  drop column if exists ext_ref1_phone,
  drop column if exists ext_ref1_mobile,
  drop column if exists ext_ref2_name,
  drop column if exists ext_ref2_designation,
  drop column if exists ext_ref2_address1,
  drop column if exists ext_ref2_address2,
  drop column if exists ext_ref2_phone,
  drop column if exists ext_ref2_mobile,
  drop column if exists emergency1_name,
  drop column if exists emergency1_relation,
  drop column if exists emergency1_address1,
  drop column if exists emergency1_address2,
  drop column if exists emergency1_phone,
  drop column if exists emergency1_mobile,
  drop column if exists emergency2_name,
  drop column if exists emergency2_relation,
  drop column if exists emergency2_address1,
  drop column if exists emergency2_address2,
  drop column if exists emergency2_phone,
  drop column if exists emergency2_mobile;
