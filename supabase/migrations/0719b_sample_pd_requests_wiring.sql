-- 0719b — Sample ▸ PD Request, part 2: the decision and its wiring (0719 is
-- the table). Split only because one request could not carry both, as 0716b.

create or replace function public.sample_pd_request_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_run_status not in ('completed', 'rejected', 'cancelled') then
    return;
  end if;
  update public.sample_pd_requests
     set status          = case p_run_status
                             when 'completed' then 'acknowledged'
                             when 'rejected'  then 'not_acknowledged'
                             else 'cancelled' end,
         decided_at      = now(),
         decided_by      = p_actor,
         decision_remark = p_remark,
         updated_at      = now()
   where id = p_id and status = 'requested';
  -- A request already gone (its enquiry deleted) has nothing to apply to; the
  -- decision is still recorded on the run.
end;
$function$;

revoke all on function public.sample_pd_request_apply_decision(uuid, text, uuid, text) from public, anon;

-- approval_apply_terminal: ONE branch added to the LIVE body (as 0718b).
do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''sample_pd_requests'' then\n'
                || E'        perform public.sample_pd_request_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''sample_pd_requests''' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0719: approval_apply_terminal''s final refusal was not found — add the sample_pd_requests branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'sample_pd_request',
       'Sample PD Request — default',
       'Catch-all. The Sample Department acknowledges (Approve) or declines (Reject, with a reason) each Product Development request. Point the step at the Sample Department role.',
       '{}'::jsonb,
       f.steps,
       900,
       true
  from public.approval_flows f
 where f.workflow_key = 'sample_costing' and f.flow_name = 'Sample Costing — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'sample_pd_request');
