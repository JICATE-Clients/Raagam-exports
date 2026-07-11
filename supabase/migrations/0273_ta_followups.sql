-- ============================================================================
-- Raagam ERP — 0272 Orders ▸ TA ▸ TA Followups
-- Legacy RP-Software "TA Followups — By Department" screen. A followup is the
-- actuals/progress recorded against each planned activity of a TA Plan (0271),
-- so this is additive on `ta_plan_activities` (no new table). Gated by the
-- existing 'orders' module — new columns inherit the table's RLS.
-- ============================================================================

alter table public.ta_plan_activities
  add column if not exists actual_date  date,
  add column if not exists status       text not null default 'pending',
  add column if not exists description  text,   -- followup description
  add column if not exists notes        text;   -- followup remark / next action

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ta_plan_activities_status_check'
  ) then
    alter table public.ta_plan_activities
      add constraint ta_plan_activities_status_check
      check (status in ('pending','in_progress','done'));
  end if;
end $$;

create index if not exists idx_ta_plan_activities_status
  on public.ta_plan_activities(status);
