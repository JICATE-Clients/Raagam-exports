-- ════════════════════════════════════════════════════════════════════════════
-- 0798 — Time off is applied IN ADVANCE, and On Duty is a type
-- ════════════════════════════════════════════════════════════════════════════
--
-- The rule (user 2026-11-03): "all the time off things happening in Raagam are
-- beforehand — they apply for leave, permission, OD and all, and only if it
-- gets approved is it considered", and "not only these 3, all time offs".
--
-- "Only approved counts" already holds: the dashboard, Attendance Report and
-- payroll read `status = 'approved'` only. "Beforehand" did not: every type's
-- `min_advance_notice_days` is 0, and 0 lets a From date in the PAST through,
-- so yesterday's absence could be turned into leave after the fact.
--
-- 1. A request may not START BEFORE TODAY (IST, `timeoff_today()`), for EVERY
--    type and EVERY applicant — HR recording for someone else included (user:
--    "blocked for everyone"). Today itself is allowed, so same-day permission
--    ("2 hours this afternoon") still works.
--
--    A TRIGGER ON THE TABLE, not an edit to `timeoff_apply`: the rule is about
--    the row, so it holds for every way a row can arrive (the apply function,
--    an import, a hand-written insert), a type added later is covered without
--    anyone setting it up, and the 300-line apply function is not re-created —
--    re-creating a function from an old body is how a later fix gets lost.
--    Per-type `min_advance_notice_days` still applies on top (asked of the
--    applicant, for a type that needs more notice).
--
--    NOT CAUGHT, ON PURPOSE: comp-off CREDITS (`timeoff_comp_off_credits`) —
--    claiming a Sunday already worked is past-dated by nature and is its own
--    table. Rows already in `timeoff_requests` are untouched (there are none
--    today); an UPDATE is checked only when it MOVES the start date.
--
-- 2. ON DUTY (OD) — there was no type for it, so nobody could apply for OD and
--    the dashboard's On duty card could only read 0. The dashboard already
--    recognises code OD (lib/hr/dashboard-service.ts `timeOffToday`). Paid,
--    no balance (work away from the desk is not drawn from an entitlement),
--    half days allowed. Added only if no OD type exists yet.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.timeoff_refuse_past_start()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.start_date is not distinct from old.start_date then
    return new;
  end if;
  if new.start_date < public.timeoff_today() then
    raise exception 'Time off is applied in advance — the From date cannot be before today (%)',
      to_char(public.timeoff_today(), 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.timeoff_refuse_past_start() from public, anon;

drop trigger if exists trg_timeoff_requests_in_advance on public.timeoff_requests;
create trigger trg_timeoff_requests_in_advance
  before insert or update of start_date on public.timeoff_requests
  for each row execute function public.timeoff_refuse_past_start();

insert into public.timeoff_leave_types
  (code, name, color, sort_order, request_category, is_paid, allow_half_day, track_balance,
   default_entitled_days, accrual_type, allow_carry_forward, is_encashable, sto_limit_mode, sto_limit_period)
select 'OD', 'ON DUTY', '#7c3aed', 45, 'leave', true, true, false, 0, 'annual', false, false, 'none', 'month'
where not exists (select 1 from public.timeoff_leave_types where upper(btrim(code)) = 'OD');
