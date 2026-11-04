-- 0807a — a request's "last action" is the last DECISION, not a system event.
-- 0807 took the newest non-submit event, and an overdue run's newest event is
-- `sla_breach` — a card would have read the clock as somebody's decision.
create or replace function public.approval_my_requests(p_limit integer default 60)
returns table (
  run_id uuid,
  workflow_key text,
  subject_table text,
  subject_id uuid,
  subject_code text,
  status text,
  step_order integer,
  step_count integer,
  step_label text,
  started_at timestamptz,
  completed_at timestamptz,
  waiting_hours numeric,
  is_overdue boolean,
  last_action text,
  last_comment text,
  last_actor_id uuid,
  last_is_override boolean,
  last_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.workflow_key,
    r.subject_table,
    r.subject_id,
    public.approval_subject_code(r.subject_table, r.subject_id),
    r.status,
    r.current_step,
    coalesce(jsonb_array_length(r.steps_snapshot), 0),
    public.approval_current_step(r.*) ->> 'step_label',
    r.started_at,
    r.completed_at,
    case when r.status = 'in_progress'
      then round(extract(epoch from (now() - coalesce(r.current_step_started_at, r.started_at))) / 3600.0, 1)
    end,
    (r.status = 'in_progress' and r.sla_due_at is not null and r.sla_due_at < now()),
    e.action,
    e.comment,
    e.actor_id,
    coalesce(e.is_override, false),
    e.created_at
  from public.approval_runs r
  left join lateral (
    select ev.action, ev.comment, ev.actor_id, ev.is_override, ev.created_at
    from public.approval_run_events ev
    where ev.run_id = r.id and ev.action in ('approve', 'reject', 'return', 'cancel')
    order by ev.created_at desc
    limit 1
  ) e on true
  where r.requested_by = auth.uid()
  order by (r.status = 'in_progress') desc, coalesce(r.completed_at, r.started_at) desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
revoke all on function public.approval_my_requests(integer) from public, anon;
grant execute on function public.approval_my_requests(integer) to authenticated;
