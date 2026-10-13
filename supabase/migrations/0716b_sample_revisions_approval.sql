-- 0716b — Sample ▸ Revision, part 2: the approval (0716 is the table, the
-- lock and the functions). Split from 0716 only because one request could not
-- carry both. Workflow 'sample_revision', subject 'sample_revisions'.

-- ---------------------------------------------------------------------------
-- 6. The approval: workflow 'sample_revision', subject 'sample_revisions'
-- ---------------------------------------------------------------------------
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'sample_revision',
       'Sample Revision — default',
       'Catch-all. Every sample revision goes to the Managing Director before the changed sample is approved again.',
       '{}'::jsonb,
       f.steps,
       900,
       true
  from public.approval_flows f
 where f.workflow_key = 'sample_costing' and f.flow_name = 'Sample Costing — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'sample_revision');

-- approval_apply_terminal, RE-CREATED FROM ITS LIVE BODY (pg_get_functiondef,
-- last written by 0688) with ONE branch added before the final refusal.
create or replace function public.approval_apply_terminal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
    v_remark text;
    v_rows   int;
    v_status text;
    v_entry  uuid;
    v_code   text;
begin
    if new.status = old.status or new.status = 'in_progress' then
        return new;
    end if;

    select e.comment into v_remark
    from public.approval_run_events e
    where e.run_id = new.id
      and e.action in ('approve', 'reject', 'cancel')
    order by e.created_at desc
    limit 1;

    if new.subject_table = 'order_budgets' then
        if new.status = 'cancelled' then
            update public.order_budgets b
               set status            = 'draft',
                   submitted_at      = null,
                   submitted_by      = null,
                   submitted_summary = null,
                   updated_at        = now()
             where b.id = new.subject_id
               and b.status = 'submitted';
            return new;
        end if;

        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        v_status := case new.status when 'completed' then 'approved' else 'rejected' end;

        if v_status = 'approved' and not exists (
            select 1 from public.order_budget_orders o where o.budget_id = new.subject_id
        ) then
            select coalesce(nullif(btrim(b.code), ''), left(b.id::text, 8)) into v_code
              from public.order_budgets b where b.id = new.subject_id;
            raise exception
                'Budget % no longer names any order — its orders were removed after it was submitted, so there is nothing to approve. Reject it, or delete it from Budgeting.',
                coalesce(v_code, new.subject_id::text)
                using errcode = 'P0001';
        end if;

        update public.order_budgets b
        set status          = v_status,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where b.id = new.subject_id
          and b.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: order_budget % is not awaiting a decision, so this approval could not be applied. Reload the budget — it may already have been decided another way.',
                new.subject_id
                using errcode = '55000';
        end if;

        for v_entry in
            select distinct r.id
              from public.order_budget_revisions r
              join public.order_budget_orders o on o.garment_order_id = r.garment_order_id
             where o.budget_id = new.subject_id
               and r.outcome = 'open'
               and r.garment_order_id is not null
        loop
            if v_status = 'approved' then
                perform public.close_order_amendment(v_entry, 'reapproved');
            else
                begin
                    perform public.order_amendment_revert(v_entry, 'rejected', v_remark);
                exception when others then
                    update public.order_budget_revisions
                       set revert_error = sqlerrm, rejection_reason = v_remark, reverting_txid = null
                     where id = v_entry;
                end;
            end if;
        end loop;

        return new;
    end if;

    if new.subject_table = 'iwo_budgets' then
        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        update public.iwo_budgets b
        set status          = case new.status when 'completed' then 'approved' else 'rejected' end,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where b.id = new.subject_id
          and b.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: iwo_budget % is not awaiting a decision, so this approval could not be applied. Reload the budget — it may already have been decided another way.',
                new.subject_id
                using errcode = '55000';
        end if;

        return new;
    end if;

    if new.subject_table = 'hr_staff_fine_deductions' then
        perform public.hr_fine_apply_decision(
            new.subject_id, new.status, new.final_actor_id, v_remark,
            coalesce(new.completed_at, now()));
        return new;
    end if;

    if new.subject_table = 'cost_sheets' then
        if new.status = 'cancelled' then
            update public.cost_sheets c
               set status = 'draft', submitted_at = null, submitted_by = null, updated_at = now()
             where c.id = new.subject_id
               and c.status = 'submitted';
            return new;
        end if;

        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        update public.cost_sheets c
        set status          = case new.status when 'completed' then 'approved' else 'rejected' end,
            approved_by     = case new.status when 'completed' then new.final_actor_id else null end,
            approved_at     = case new.status when 'completed' then coalesce(new.completed_at, now()) else null end,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where c.id = new.subject_id
          and c.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: cost sheet % is not awaiting a decision, so this approval could not be applied. Reload the costing — it may already have been decided another way.',
                new.subject_id
                using errcode = '55000';
        end if;

        return new;
    end if;

    -- 0716 — Sample ▸ Revision: approve locks the changed sample again; reject
    -- restores V0; cancel returns the revision to draft.
    if new.subject_table = 'sample_revisions' then
        perform public.sample_revision_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark);
        return new;
    end if;

    raise exception
        'approval_apply_terminal: no terminal callback is implemented for subject_table %. Add a branch in 0505 before starting runs for it.',
        new.subject_table
        using errcode = '0A000';
end $function$;

-- ---------------------------------------------------------------------------
-- 7. Read it back
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.approval_apply_terminal'::regproc);
begin
  if position('sample_revision_apply_decision' in v_def) = 0
     or position('hr_fine_apply_decision' in v_def) = 0
     or position('order_amendment_revert' in v_def) = 0
     or position('''cost_sheets''' in v_def) = 0
     or position('''iwo_budgets''' in v_def) = 0 then
    raise exception '0716: approval_apply_terminal lost a branch';
  end if;
  if not exists (select 1 from public.approval_flows where workflow_key = 'sample_revision' and is_active) then
    raise exception '0716: no active sample_revision flow';
  end if;
  if public.next_sample_revision_no() !~ '^SMP-REV/\d\d-\d\d/\d{4}$' then
    raise exception '0716: revision number is %', public.next_sample_revision_no();
  end if;
  if (select count(*) from pg_trigger where tgname = 'trg_sample_lock' and not tgisinternal) <> 2 then
    raise exception '0716: the sample lock is not on both opportunities and styles';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('raise_sample_revision', 'abandon_sample_revision', 'sample_revision_revert', 'sample_revision_apply_decision')
       and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception '0716: a sample revision function is executable without a login';
  end if;
end $$;
