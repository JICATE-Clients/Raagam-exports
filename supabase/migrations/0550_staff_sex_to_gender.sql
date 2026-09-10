-- ===========================================================================
-- 0550 — `staff.sex` becomes `staff.gender`.
--
-- The client asked for the LABEL to read Gender (2026-09-09), and the column
-- follows it rather than staying behind — because the values were already
-- gender values and the name was the odd one out. 0535 constrained this column
-- to Male / Female / TRANS GENDER: "trans gender" is not an answer to a
-- question about sex, so `sex` was describing the wrong thing from the day it
-- was written.
--
-- A RENAME, NOT AN ADD-AND-DROP. `alter … rename column` carries the data, the
-- check constraint and the column comment across in one statement, so there is
-- no window where a row's value lives in neither column. (0 staff rows today —
-- but the same statement is correct against a table that has them.)
--
-- `employees.sex` (lib/masters/employee-types.ts) is a DIFFERENT master with
-- its own two-value list and is deliberately untouched: renaming a column
-- because a neighbouring screen changed a label would be a change nobody asked
-- for on a screen nobody was looking at.
-- ===========================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'sex'
  ) then
    alter table public.staff rename column sex to gender;
  end if;
end $$;

comment on column public.staff.gender is
  'Male / Female / Trans Gender. Named `sex` until 0550, which was the wrong word for a list whose third value is a gender.';
