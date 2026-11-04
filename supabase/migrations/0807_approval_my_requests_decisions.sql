-- 0807 — MY REQUESTS and DECIDED, for My Approvals' status tabs (user 2026-11-04,
-- approved phone mockup "My Approvals Mobile").
--
-- The engine could answer "what waits on me" (approval_my_queue) and, for a Super
-- Admin, "everything open" (0783) — never "where is the thing I SENT" or "what did
-- I decide". Both read the caller's own rows only: requested_by = auth.uid(), or an
-- event whose actor_id = auth.uid(). Nothing here widens who can see a run.
--
-- The step a request waits on and the timeline behind a tap stay where they were:
-- approval_current_step() and approval_timeline() — one reading of the frozen
-- steps_snapshot, never a second.

-- A document's own number ("HO/PO/26-27/0011", "LV-0002") for a status card, read
-- from the subject table's `code` column where it has one. NOT granted to anyone:
-- only the two SECURITY DEFINER functions below call it, as owner, for runs the
-- caller already owns or decided.
create or replace function public.approval_subject_code(p_table text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  if p_table is null or p_id is null then
    return null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'code'
  ) then
    return null;
  end if;
  execute format('select code::text from public.%I where id = $1', p_table) into v using p_id;
  return v;
exception when others then
  -- A card without a number still names its workflow; never fail the list for it.
  return null;
end;
$$;
revoke all on function public.approval_subject_code(text, uuid) from public, anon, authenticated;

-- What I raised: open ones first (the ones a requester checks), then the most
-- recent finished. The latest decision on the run rides along, so a card can say
-- "Sent back for rework" and quote the reason without a second read.
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
    where ev.run_id = r.id and ev.action <> 'submit'
    order by ev.created_at desc
    limit 1
  ) e on true
  where r.requested_by = auth.uid()
  order by (r.status = 'in_progress') desc, coalesce(r.completed_at, r.started_at) desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
revoke all on function public.approval_my_requests(integer) from public, anon;
grant execute on function public.approval_my_requests(integer) to authenticated;

-- What I decided: my latest approve / reject / return on each run, newest first,
-- with the step I decided it as and where the run stands now.
create or replace function public.approval_my_decisions(p_limit integer default 60)
returns table (
  run_id uuid,
  workflow_key text,
  subject_table text,
  subject_id uuid,
  subject_code text,
  action text,
  comment text,
  is_override boolean,
  step_order integer,
  step_label text,
  acted_at timestamptz,
  run_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select distinct on (e.run_id)
      e.run_id,
      r.workflow_key,
      r.subject_table,
      r.subject_id,
      public.approval_subject_code(r.subject_table, r.subject_id),
      e.action,
      e.comment,
      coalesce(e.is_override, false),
      e.step_order,
      (select s.value ->> 'step_label'
         from jsonb_array_elements(r.steps_snapshot) s
        where (s.value ->> 'step_order')::int = e.step_order
        limit 1),
      e.created_at,
      r.status
    from public.approval_run_events e
    join public.approval_runs r on r.id = e.run_id
    where e.actor_id = auth.uid()
      and e.action in ('approve', 'reject', 'return')
    order by e.run_id, e.created_at desc
  ) d
  order by d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
revoke all on function public.approval_my_decisions(integer) from public, anon;
grant execute on function public.approval_my_decisions(integer) to authenticated;
