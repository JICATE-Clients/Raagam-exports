-- ============================================================================
-- 0775 — Work Timing: Tea Break 1, Lunch, Tea Break 2 (user 2026-10-31:
-- "there should be punch in tea break 1 lunch tea break 2 punch out").
--
-- Each break is a From–To pair on the category's dated timing row (0774), so
-- a change of break times is a new revision exactly like a change of hours.
-- ADDITIVE ONLY: six nullable columns, no row touched, nothing dropped. A
-- break left blank means the category has no such break.
--
-- The order inside the shift (In < Tea 1 < Lunch < Tea 2 < Out, a night shift
-- wrapping past midnight) is checked by the app's schema
-- (`categoryTimingInput`); the table only refuses a half-entered break.
-- ============================================================================

alter table public.hr_category_timings
  add column if not exists tea1_start  time,
  add column if not exists tea1_end    time,
  add column if not exists lunch_start time,
  add column if not exists lunch_end   time,
  add column if not exists tea2_start  time,
  add column if not exists tea2_end    time;

-- A break is both ends or neither.
alter table public.hr_category_timings
  drop constraint if exists hr_category_timings_tea1_pair,
  drop constraint if exists hr_category_timings_lunch_pair,
  drop constraint if exists hr_category_timings_tea2_pair;
alter table public.hr_category_timings
  add constraint hr_category_timings_tea1_pair  check ((tea1_start  is null) = (tea1_end  is null)),
  add constraint hr_category_timings_lunch_pair check ((lunch_start is null) = (lunch_end is null)),
  add constraint hr_category_timings_tea2_pair  check ((tea2_start  is null) = (tea2_end  is null));

notify pgrst, 'reload schema';
