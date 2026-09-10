-- ===========================================================================
-- 0552 — the five running balances go.
--
-- 0534 added `loan_balance`, `advance_balance`, `cl_balance`, `el_credit_days`
-- and `el_carry_days` because the legacy Detail tab draws them, and said in its
-- own comment that they are "OPENING/CURRENT figures typed by a human, not a
-- ledger — when advances and loans get their own transactions, these become the
-- derived answer".
--
-- The client has now said they are not wanted at all (2026-09-09), which is the
-- better answer to the same observation: a balance nobody posts to is a number
-- that is right on the day it is typed and drifts every day after. Advances,
-- loans and leave already have their own screens under HR ▸ Pay and HR ▸ Time
-- & Attendance; a total living on the employee record would be a second, stale
-- copy of what those tables can answer.
--
-- Checked before writing: 0 staff rows, 0 with any of the five non-zero.
-- Nothing outside the staff screen and its own types reads them — no service,
-- no report, no payroll path.
--
-- `expected_salary` went the same way in 0551, for the same reason.
-- ===========================================================================

alter table public.staff
  drop column if exists loan_balance,
  drop column if exists advance_balance,
  drop column if exists cl_balance,
  drop column if exists el_credit_days,
  drop column if exists el_carry_days;
