-- ============================================================================
-- Raagam ERP — 0835 Comp-off claims go Department HOD → HR Manager → ED too
-- (Written and applied as 0823 on 2026-11-06; renumbered 0835 to clear master's 0823_hr_calendar_events. Already applied on xcidbfgujrxginrgvbjw — do not re-run.)
--
-- User 2026-11-06: "yes put comp off claims on the 3 stages too".
--
-- Leave, permission, on duty, comp-off bookings and encashments already climb
-- the HOD → HR Manager → ED ladder (0817 · 0820 · 0821 · 0822). A comp-off
-- CLAIM — "I worked this holiday, credit me a day" — was still decided by HR
-- directly in one step (0770 `timeoff_decide_comp_off`), so it skipped the
-- HOD, never reached My Approvals and had no "Send to …".
--
-- 1. A third Time Off workflow, `timeoff_comp_off`, over
--    timeoff_comp_off_credits, with the same three steps. ONE RUN PER CREDIT:
--    a claim of several dates is stored as one credit per date (0770), and
--    each is approved on its own.
-- 2. timeoff_claim_comp_off starts that run for every credit it writes, in
--    the same transaction (as timeoff_apply / timeoff_request_encashment do).
-- 3. timeoff_comp_off_apply_decision + a branch in approval_apply_terminal:
--    approved / rejected / withdrawn follow the run, as for an encashment.
-- 4. timeoff_decide_comp_off stops deciding a claim that has a run — the
--    run is the decision now. Withdrawing one cancels its run. A claim filed
--    before this (no run) is still decided the old way, so nothing strands.
-- 5. The four HR-only engine pieces that list the Time Off workflows learn the
--    new one, patched IN PLACE from their live definitions so nothing in them
--    is lost: approve-closes (0820), next stage + send on (0821), no-HOD start
--    (0822). Refused loudly if the list is not found.
-- 6. Visibility: the HOD reads their department's claims (as 0817 did for
--    requests), and whoever can see a claim sees its trail (as 0818 did).
--
-- Nothing is deleted. No row changes except the new flow.
-- ============================================================================

-- ─── 1. The flow ────────────────────────────────────────────────────────────

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'timeoff_comp_off', 'Comp-off Claim — default',
       'Every comp-off claim goes to the department HOD, who approves or rejects it — or sends it to the HR Manager, who may send it on to the ED. Whoever approves closes it.',
       '{}'::jsonb,
       '[
         {"step_order":1,"step_key":"hod","step_type":"review","step_label":"Department HOD","approver_resolver":"hr_department_head"},
         {"step_order":2,"step_key":"hr_manager","step_type":"review","step_label":"HR Manager","approver_resolver":"hr_manager"},
         {"step_order":3,"step_key":"ed","step_type":"final","step_label":"ED","approver_resolver":"hr_executive_director"}
       ]'::jsonb,
       900, true
 where not exists (select 1 from public.approval_flows x where x.workflow_key = 'timeoff_comp_off');

-- ─── 3. What a decision does to the claim ───────────────────────────────────

create or replace function public.timeoff_comp_off_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.timeoff_comp_off_credits;
begin
  select * into c from public.timeoff_comp_off_credits where id = p_id for update;
  if c.id is null or c.status <> 'pending' then
    raise exception 'Comp-off claim % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  if p_run_status = 'completed' then
    if c.expires_on < public.timeoff_today() then
      raise exception 'This comp-off claim has expired (a month after the day worked) — it can only be rejected'
        using errcode = '55000';
    end if;
    update public.timeoff_comp_off_credits
       set status = 'approved', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark where id = c.id;
  elsif p_run_status = 'rejected' then
    update public.timeoff_comp_off_credits
       set status = 'rejected', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark where id = c.id;
  elsif p_run_status = 'cancelled' then
    update public.timeoff_comp_off_credits
       set status = 'withdrawn', decided_by = coalesce(auth.uid(), p_actor), decided_at = p_at,
           decision_remark = p_remark where id = c.id;
  end if;
end $$;

-- The engine's terminal trigger calls it — the same anchor 0770 used.
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''timeoff_comp_off_credits'' then\n'
                || E'        perform public.timeoff_comp_off_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''timeoff_comp_off_credits''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0835: approval_apply_terminal''s final refusal was not found — add the comp-off branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- ─── 2. Filing a claim starts its run ───────────────────────────────────────

create or replace function public.timeoff_claim_comp_off(
  p_staff_id uuid, p_worker_id uuid, p_dates date[], p_credit numeric, p_reason text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  p       record;
  d       date;
  v_id    uuid;
  v_n     int := 0;
  v_today date := public.timeoff_today();
begin
  if num_nonnulls(p_staff_id, p_worker_id) <> 1 then
    raise exception 'Pick one staff member or worker' using errcode = '23514';
  end if;
  select * into p from public.timeoff_person(p_staff_id, p_worker_id);
  if p.name is null then raise exception 'Person not found' using errcode = '23503'; end if;
  if not public.timeoff_may_act_for(p_staff_id, p_worker_id, p.location_id, 'create') then
    raise exception 'You can claim only for yourself, or for people in the unit you are working in' using errcode = '42501';
  end if;
  if coalesce(array_length(p_dates, 1), 0) = 0 then
    raise exception 'Pick at least one worked date' using errcode = '23514';
  end if;
  if array_length(p_dates, 1) > 31 then
    raise exception 'At most 31 dates in one claim' using errcode = '23514';
  end if;
  if coalesce(p_credit, 0) not in (0.5, 1) then
    raise exception 'Credit is a full day or a half day' using errcode = '23514';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say what the work was — the reason is mandatory' using errcode = '23514';
  end if;

  foreach d in array p_dates loop
    if d > v_today then
      raise exception '% is in the future — a credit is claimed for a day already worked', to_char(d, 'DD/MM/YYYY')
        using errcode = '23514';
    end if;
    if (d + interval '1 month')::date < v_today then
      raise exception 'A credit for % would already have expired (a month after the day worked)', to_char(d, 'DD/MM/YYYY')
        using errcode = '23514';
    end if;
    if exists (select 1 from public.timeoff_comp_off_credits c
                where coalesce(c.staff_id, c.worker_id) = coalesce(p_staff_id, p_worker_id)
                  and c.worked_date = d and c.status in ('pending', 'approved', 'consumed')) then
      raise exception 'There is already a credit for %', to_char(d, 'DD/MM/YYYY') using errcode = '23505';
    end if;
    insert into public.timeoff_comp_off_credits
      (staff_id, worker_id, location_id, worked_date, credit_days, reason, had_punch, expires_on)
    values
      (p_staff_id, p_worker_id, p.location_id, d, p_credit, upper(btrim(p_reason)),
       p.biometric_id is not null and exists (
         select 1 from public.punches x
          where x.user_id = p.biometric_id
            and (x.punch_time at time zone 'Asia/Kolkata')::date = d),
       (d + interval '1 month')::date)
    returning id into v_id;

    -- 0835: the claim climbs HOD → HR Manager → ED like every other request.
    perform public.approval_start_run(
      'timeoff_comp_off', 'timeoff_comp_off_credits', v_id,
      jsonb_build_object('staff_id', p_staff_id, 'worker_id', p_worker_id, 'person_name', p.name,
                         'worked_date', to_char(d, 'DD/MM/YYYY'), 'credit_days', p_credit),
      jsonb_build_object('location_id', p.location_id), null, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ─── 4. The direct decision is for claims WITHOUT a run ─────────────────────

create or replace function public.timeoff_decide_comp_off(p_ids uuid[], p_decision text, p_remark text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  c      public.timeoff_comp_off_credits;
  v_run  public.approval_runs;
  v_mine uuid := public.timeoff_my_staff_id();
  v_n    int := 0;
begin
  if p_decision not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and btrim(coalesce(p_remark, '')) = '' then
    raise exception 'Say why the claim is rejected' using errcode = '23514';
  end if;
  for c in select * from public.timeoff_comp_off_credits where id = any(p_ids) for update loop
    if c.status <> 'pending' then
      raise exception 'Claim % is already %', c.code, c.status using errcode = '55000';
    end if;

    -- 0835: a claim on the three stages is decided on its run, not here.
    select * into v_run from public.approval_runs
     where subject_table = 'timeoff_comp_off_credits' and subject_id = c.id and status = 'in_progress'
     order by started_at desc limit 1
     for update;
    if v_run.id is not null then
      if p_decision <> 'withdrawn' then
        raise exception 'Claim % is with the % — decide it on Time Off ▸ Approvals', c.code,
          coalesce(v_run.steps_snapshot -> (v_run.current_step - 1) ->> 'step_label', 'approver')
          using errcode = '55000';
      end if;
      if not public.timeoff_may_act_for(c.staff_id, c.worker_id, c.location_id, 'edit') then
        raise exception 'You can withdraw only your own claims' using errcode = '42501';
      end if;
      -- Cancelling the run is the withdrawal; the terminal trigger marks the
      -- claim withdrawn (timeoff_comp_off_apply_decision).
      insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
      values (v_run.id, v_run.current_step, 'cancel', auth.uid(),
              coalesce(nullif(upper(btrim(coalesce(p_remark, ''))), ''), 'WITHDRAWN'));
      update public.approval_runs
         set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
       where id = v_run.id;
      v_n := v_n + 1;
      continue;
    end if;

    if p_decision = 'withdrawn' then
      if not public.timeoff_may_act_for(c.staff_id, c.worker_id, c.location_id, 'edit') then
        raise exception 'You can withdraw only your own claims' using errcode = '42501';
      end if;
    else
      if not (public.has_permission('hr_payroll', 'edit') and public.is_current_location(c.location_id)) then
        raise exception 'Only HR in this unit can decide comp-off claims' using errcode = '42501';
      end if;
      if c.staff_id is not null and c.staff_id = v_mine then
        raise exception 'You cannot decide your own claim' using errcode = '42501';
      end if;
      if p_decision = 'approved' and c.expires_on < public.timeoff_today() then
        raise exception 'Claim % has expired — it can only be rejected', c.code using errcode = '55000';
      end if;
    end if;
    update public.timeoff_comp_off_credits
       set status = p_decision, decided_by = auth.uid(), decided_at = now(),
           decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ─── 5. The HR-only engine pieces learn the third workflow ──────────────────

do $$
declare
  v_fn  text;
  v_def text;
  v_old text := '(''timeoff_request'', ''timeoff_encashment'')';
  v_new text := '(''timeoff_request'', ''timeoff_encashment'', ''timeoff_comp_off'')';
begin
  foreach v_fn in array array[
    'public.hr_approval_approve_closes()',          -- 0820: approve closes
    'public.hr_approval_next_stage(uuid)',          -- 0821: where Send goes
    'public.hr_approval_forward(uuid, text)',       -- 0821: Send to …
    'public.hr_approval_skip_empty_hod()'           -- 0822: no HOD → HR Manager
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    continue when position('''timeoff_comp_off''' in v_def) > 0;  -- already patched
    if position(v_old in v_def) = 0 then
      raise exception '0835: the Time Off workflow list in % was not found — add timeoff_comp_off by hand.', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $$;

-- ─── 6. Who can see a claim and its trail ───────────────────────────────────

drop policy if exists timeoff_co_read_hod on public.timeoff_comp_off_credits;
create policy timeoff_co_read_hod on public.timeoff_comp_off_credits for select
  using (public.hr_i_am_hod_of(staff_id, worker_id));

drop policy if exists approval_runs_read_hr_subject on public.approval_runs;
create policy approval_runs_read_hr_subject on public.approval_runs for select to authenticated
  using (
    (subject_table = 'timeoff_requests'
       and exists (select 1 from public.timeoff_requests t where t.id = approval_runs.subject_id))
    or
    (subject_table = 'timeoff_encashments'
       and exists (select 1 from public.timeoff_encashments x where x.id = approval_runs.subject_id))
    or
    (subject_table = 'timeoff_comp_off_credits'
       and exists (select 1 from public.timeoff_comp_off_credits c where c.id = approval_runs.subject_id))
  );

create or replace function public.hr_waiting_on(p_run_id uuid)
returns table (user_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_runs;
begin
  select * into r from public.approval_runs where id = p_run_id;
  if r.id is null or r.status <> 'in_progress' then
    return;
  end if;
  -- A definer bypasses RLS, so the read rules of 0770 / 0817 are spelled out:
  -- HR of the unit, the person themself, or their HOD.
  if not exists (
    select 1
      from (select t.location_id, t.staff_id, t.worker_id from public.timeoff_requests t
             where r.subject_table = 'timeoff_requests' and t.id = r.subject_id
            union all
            select x.location_id, x.staff_id, x.worker_id from public.timeoff_encashments x
             where r.subject_table = 'timeoff_encashments' and x.id = r.subject_id
            union all
            select c.location_id, c.staff_id, c.worker_id from public.timeoff_comp_off_credits c
             where r.subject_table = 'timeoff_comp_off_credits' and c.id = r.subject_id) d
     where (public.has_permission('hr_payroll', 'view') and public.is_current_location(d.location_id))
        or (d.staff_id is not null and d.staff_id = public.timeoff_my_staff_id())
        or public.hr_i_am_hod_of(d.staff_id, d.worker_id)
  ) then
    return;
  end if;
  return query
    select u, coalesce(nullif(btrim(p.full_name), ''), p.email)
      from public.approval_step_approvers(public.approval_current_step(r), r.requested_by, r.scope, r.context) u
      join public.profiles p on p.id = u
     order by 2;
end $$;

revoke all on function public.timeoff_comp_off_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.timeoff_claim_comp_off(uuid, uuid, date[], numeric, text) from public, anon;
revoke all on function public.timeoff_decide_comp_off(uuid[], text, text)               from public, anon;
revoke all on function public.hr_waiting_on(uuid)                                       from public, anon;
grant execute on function public.timeoff_claim_comp_off(uuid, uuid, date[], numeric, text) to authenticated;
grant execute on function public.timeoff_decide_comp_off(uuid[], text, text)               to authenticated;
grant execute on function public.hr_waiting_on(uuid)                                       to authenticated;
