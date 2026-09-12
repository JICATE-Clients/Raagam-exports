-- ===========================================================================
-- 0548 — a staff member's designation becomes a reference to the master.
--
-- 0534 left `staff.designation` as TEXT and said why: turning it into a foreign
-- key has to migrate the values already stored, which is a data-repair step
-- rather than a column add. That was the right call to defer and the wrong one
-- to keep — a typed designation means MANAGER, Manager and MGR are three
-- different answers to one question, and none of them links to the master the
-- client maintains at Master Data ▸ HR ▸ Designation.
--
-- ## DONE NOW BECAUSE IT IS FREE NOW
--
-- Checked before writing: `staff` holds 0 rows, 0 of them with a designation,
-- and no view or function names the column. The repair step below is therefore
-- a no-op today — and it is written anyway, because this migration will run
-- against a database that has data by the time anyone else applies it.
--
-- ## THE REPAIR MATCHES ON A NORMALISED NAME, AND CREATES NOTHING
--
-- `upper(btrim(...))` so "manager" finds MANAGER. A value that matches nothing
-- is LEFT BEHIND rather than inserted into the master: seeding a designations
-- row from whatever somebody once typed is how a master fills with typos, and
-- AGENTS.md ▸ "Near misses" records that exact failure from a vocabulary that
-- defaulted its seed. The old text is kept in `designation_legacy` so an
-- operator can see what a record used to say and pick the right row by hand.
--
-- ## WHAT STAYS TEXT, DELIBERATELY
--
-- `staff_work_experience.designation` (0536) is untouched. That is the title
-- somebody held at ANOTHER company — it is not ours to have a master row for,
-- and constraining it to our designations would make a previous job
-- unrecordable unless we happened to use the same word.
-- ===========================================================================

alter table public.staff
  add column if not exists designation_id uuid references public.designations(id);

comment on column public.staff.designation_id is
  'The staff member''s designation, from the master. Replaced the free-text `designation` in 0548; the pre-migration text survives in `designation_legacy` for rows whose value matched no master row.';

-- ---------- carry the typed values across ----------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'designation'
  ) then
    -- Keep what was typed, so an unmatched value is visible rather than lost.
    alter table public.staff add column if not exists designation_legacy text;
    update public.staff set designation_legacy = designation where designation is not null;

    update public.staff s
       set designation_id = d.id
      from public.designations d
     where s.designation is not null
       and upper(btrim(s.designation)) = upper(btrim(d.name));

    alter table public.staff drop column designation;
  end if;
end $$;

comment on column public.staff.designation_legacy is
  'What `designation` said before 0548 turned it into a foreign key, for rows whose text matched no master row. Nothing reads it; it exists so an operator can see the old value and pick the right designation by hand. Drop it once the backlog is cleared.';

create index if not exists staff_designation_id_idx on public.staff (designation_id);
