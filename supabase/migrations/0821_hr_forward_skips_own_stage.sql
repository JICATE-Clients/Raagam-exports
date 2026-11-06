-- ============================================================================
-- Raagam ERP — 0821 "Send on" never sends a request back to the sender
--
-- User 2026-11-06, logged in as TEST HR on TEST HOD's own leave (LV-0004):
--   "I don't wanna approve this — send it to ED, how can I do that".
--
-- An HOD's own leave has no HOD to ask, so stage 1 falls to the HR Manager
-- (0807's fallback). 0814's forward then moved it to stage 2 — the HR Manager
-- again, the same person — and the "Send to HR Manager" it offered would have
-- put the request straight back in the sender's own queue. The same happens
-- when nobody holds HR Manager and both stages resolve to the MD.
--
-- hr_approval_next_stage(run) is the ONE answer to "where does Send go": the
-- first later stage that has an approver who is not the caller. The button's
-- label and hr_approval_forward both read it, so what the button says is
-- where the request lands. Nothing else in 0820 changes.
-- ============================================================================

create or replace function public.hr_approval_next_stage(p_run_id uuid)
returns table (step_no int, step_label text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_run  public.approval_runs;
  v_i    int;
  v_step jsonb;
begin
  select * into v_run from public.approval_runs where id = p_run_id;
  if v_run.id is null or v_run.status <> 'in_progress'
     or v_run.workflow_key not in ('timeoff_request', 'timeoff_encashment') then
    return;
  end if;
  -- Only someone who may decide the current stage needs to know.
  if not coalesce((public.approval_can_act(p_run_id, auth.uid()) ->> 'can_act')::bool, false) then
    return;
  end if;
  for v_i in v_run.current_step + 1 .. jsonb_array_length(v_run.steps_snapshot) loop
    v_step := v_run.steps_snapshot -> (v_i - 1);
    if exists (select 1
                 from public.approval_step_approvers(v_step, v_run.requested_by, v_run.scope, v_run.context) u
                where u is distinct from auth.uid()) then
      step_no := v_i;
      step_label := v_step ->> 'step_label';
      return next;
      return;
    end if;
  end loop;
end $$;

create or replace function public.hr_approval_forward(p_run_id uuid, p_comment text default null)
returns public.approval_runs
language plpgsql security definer set search_path = public as $$
declare
  v_run     public.approval_runs;
  v_verdict jsonb;
  v_to      int;
  v_label   text;
begin
  select * into v_run from public.approval_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'This request has no approval to send on — reload' using errcode = '42704';
  end if;
  if v_run.workflow_key not in ('timeoff_request', 'timeoff_encashment') then
    raise exception 'Only an HR request can be sent to the next stage' using errcode = '22023';
  end if;
  if v_run.status <> 'in_progress' then
    raise exception 'This request is already %', v_run.status using errcode = '55000';
  end if;

  v_verdict := public.approval_can_act(p_run_id, auth.uid());
  if not coalesce((v_verdict ->> 'can_act')::bool, false) then
    raise exception 'This is waiting on someone else, not you' using errcode = '42501';
  end if;

  select n.step_no, n.step_label into v_to, v_label from public.hr_approval_next_stage(p_run_id) n;
  if v_to is null then
    raise exception 'There is nobody after you to send it to — approve or reject it' using errcode = '22023';
  end if;

  insert into public.approval_run_events (run_id, step_order, step_key, action, actor_id, is_override, comment, metadata)
  values (v_run.id, v_run.current_step, public.approval_current_step(v_run) ->> 'step_key', 'forward', auth.uid(),
          coalesce((v_verdict ->> 'is_override')::bool, false), nullif(btrim(coalesce(p_comment, '')), ''),
          jsonb_build_object('to_step', v_to, 'to_label', v_label));

  update public.approval_runs
     set current_step = v_to, lock_version = lock_version + 1
   where id = v_run.id
  returning * into v_run;
  return v_run;
end $$;

revoke all on function public.hr_approval_next_stage(uuid)    from public, anon;
revoke all on function public.hr_approval_forward(uuid, text) from public, anon;
grant execute on function public.hr_approval_next_stage(uuid)    to authenticated;
grant execute on function public.hr_approval_forward(uuid, text) to authenticated;
