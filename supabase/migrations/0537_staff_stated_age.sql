-- ===========================================================================
-- 0537 — an age that can be TYPED, for the records where nobody knows the date.
--
-- 0534 and 0536 both left `age` out, and the reasoning was sound as far as it
-- went: an age computed from `date_of_birth` is right forever, and a stored copy
-- is wrong from the day after it is written.
--
-- IT MISSED THE CASE THE LEGACY BOX EXISTS FOR. An operator entering an older
-- worker's record often has "about 45" and no date at all — the birth was never
-- registered, or the document is long gone. With a derived-only age there was
-- nowhere to put that: the field showed "—" and refused to be typed in
-- (client 2026-09-09: "but i can't type anything into age it just shows ---").
--
-- ## `stated_age`, NOT `age`
--
-- The name is the point. `age` would read as the answer to "how old is this
-- person", and any code that found it would use it — including for a record
-- whose `date_of_birth` is present and authoritative, which is exactly the
-- staleness this was avoiding. `stated_age` is what somebody SAID, and it is
-- only consulted when there is no date to compute from.
--
-- The rule, in one line, and it holds in both places:
--
--     age = date_of_birth ? computed(date_of_birth) : stated_age
--
-- This is the same shape as `staff_work_experience.duration` (0536): the
-- arithmetic wins when its inputs are there, and the typed value carries the
-- case where they are not.
--
-- Additive, idempotent, nullable — null means "nobody stated one".
-- ===========================================================================

alter table public.staff
  add column if not exists stated_age smallint
    check (stated_age is null or (stated_age >= 0 and stated_age <= 120));

comment on column public.staff.stated_age is
  'An age TYPED by an operator, for a record with no date_of_birth. Never read when date_of_birth is present — the computed value wins there. Named `stated_age` rather than `age` so nothing mistakes it for the authoritative answer. 0537.';

-- The family grid carries the same pair of columns and the same rule.
alter table public.staff_family_members
  add column if not exists stated_age smallint
    check (stated_age is null or (stated_age >= 0 and stated_age <= 120));

comment on column public.staff_family_members.stated_age is
  'As staff.stated_age — the typed fallback for a family member whose date of birth is unknown. 0537.';
