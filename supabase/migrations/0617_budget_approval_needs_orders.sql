-- ============================================================================
-- Raagam ERP — 0617 A budget that names no order cannot be approved
--
-- Found on 2026-09-22 while testing Orders ▸ Order Amendments: budget "1" was
-- submitted on 09-19 for HO/RE/26-27/0012, that order was deleted afterwards
-- (order_budget_orders cascaded with it), and the approval inbox still let the
-- MD approve it today. The approval "succeeded": the budget reads approved, the
-- run reads completed, and NO order became `approved` — so nothing was locked,
-- nothing became amendable, and the operator read the empty register as broken.
--
-- `submitBudget` refuses a budget with no lines and checks its orders' BOMs at
-- SUBMIT; nothing re-asked at DECISION time. `approval_apply_terminal` is where
-- the decision reaches the document, so it is where the question belongs: an
-- approval that would cover no order is refused, and the RAISE rolls the
-- approve action back with the sentence — the approver sees it, the run stays
-- in progress, and they can reject it or the author can delete it.
--
-- A budget already in that state (budget "1") is not touched: it is approved
-- over nothing, which harms nothing, and rewriting history is not this
-- migration's job. Delete it from Budgeting if it should go.
-- ============================================================================

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
        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        v_status := case new.status when 'completed' then 'approved' else 'rejected' end;

        -- 0617: AN APPROVAL MUST COVER AT LEAST ONE ORDER. A budget whose orders
        -- were deleted after submit would be approved over nothing — locking
        -- nothing, and reading as approved everywhere.
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

        -- 0616: an APPROVED revised budget closes the Amendment Entry open on
        -- any of its orders.
        if v_status = 'approved' then
            for v_entry in
                select distinct r.id
                  from public.order_budget_revisions r
                  join public.order_budget_orders o on o.garment_order_id = r.garment_order_id
                 where o.budget_id = new.subject_id
                   and r.outcome = 'open'
                   and r.garment_order_id is not null
            loop
                perform public.close_order_amendment(v_entry, 'reapproved');
            end loop;
        end if;

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

    raise exception
        'approval_apply_terminal: no terminal callback is implemented for subject_table %. Add a branch in 0505 before starting runs for it.',
        new.subject_table
        using errcode = '0A000';
end $function$;

revoke all on function public.approval_apply_terminal() from public, anon;

-- $verify$ — behaviour, rolled back: a submitted budget with no orders is
-- refused an approval by the trigger, with the sentence; one WITH an order is
-- applied. Uses a throwaway run row so no real inbox is touched.
do $verify$
declare
  loc uuid; b uuid; x uuid; r uuid; f uuid; got text := 'not run'; applied text := 'not run';
begin
  select id into loc from public.locations limit 1;
  select a.id into x from public.garment_order_amendments a where a.re_status = 'open' limit 1;
  select id into f from public.approval_flows where workflow_key = 'order_budget' limit 1;
  if loc is null or x is null or f is null then
    raise notice '0617: no location / open order / order_budget flow — probe skipped';
    return;
  end if;
  begin
    -- 1. no orders → refused
    insert into public.order_budgets (budget_date, status, location_id) values (current_date, 'submitted', loc) returning id into b;
    insert into public.approval_runs (workflow_key, flow_id, subject_table, subject_id, status, steps_snapshot, requested_by, current_step)
    values ('order_budget', f, 'order_budgets', b, 'in_progress', '[{"step_order":1,"step_label":"x","step_type":"final"}]'::jsonb, gen_random_uuid(), 1)
    returning id into r;
    begin
      update public.approval_runs set status = 'completed', completed_at = now(), final_actor_id = gen_random_uuid() where id = r;
      got := 'NOT refused';
    exception when others then
      got := case when sqlerrm like '%no longer names any order%' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;
    -- 2. with an order → applied
    insert into public.order_budgets (budget_date, status, location_id) values (current_date, 'submitted', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal) values (b, x, '0617 verify');
    insert into public.approval_runs (workflow_key, flow_id, subject_table, subject_id, status, steps_snapshot, requested_by, current_step)
    values ('order_budget', f, 'order_budgets', b, 'in_progress', '[{"step_order":1,"step_label":"x","step_type":"final"}]'::jsonb, gen_random_uuid(), 1)
    returning id into r;
    update public.approval_runs set status = 'completed', completed_at = now(), final_actor_id = gen_random_uuid() where id = r;
    select status into applied from public.order_budgets where id = b;
    raise exception using message = '0617 rollback', errcode = 'P0617';
  exception when others then
    if sqlerrm <> '0617 rollback' then raise exception '0617 verify failed inside the probe: %', sqlerrm; end if;
  end;
  if got <> 'refused' then raise exception '0617: an order-less approval was %', got; end if;
  if applied <> 'approved' then raise exception '0617: a real approval was not applied (%)', applied; end if;
  raise notice '0617: verified — order-less approval refused, real approval applied';
end
$verify$;
