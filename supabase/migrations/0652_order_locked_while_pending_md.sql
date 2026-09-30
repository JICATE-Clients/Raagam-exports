-- 0652 — AN ORDER IS LOCKED WHILE ITS BUDGET WAITS FOR THE MD (client 2026-09-29,
-- "End-to-End Approval Flow" §1: "Submit Budget for MD Approval … locks the
-- order; Edit and Delete go visible-but-disabled").
--
-- ## WHAT WAS WRONG
--
-- 0576's lock fired only once a budget was APPROVED (`order_lock_of` reads
-- `re_status = 'approved'`). Between Submit and the MD's decision the order,
-- its Fabric BOM and its Material BOM stayed fully writable — and the budget
-- the MD was reading is COMPUTED from those rows. Nothing re-checked at
-- decision time (`submitBudget` checks BOM drift at SUBMIT only), so a BOM
-- edited mid-review was approved at figures it no longer matched.
--
-- ## THE RULE
--
-- A garment order is locked while ANY budget covering it — or covering any
-- document of the same RE No, the same grain as the approved lock — has
-- status 'submitted'. `order_lock_message`, the one sentence every lock
-- trigger raises (`refuse_when_order_locked`), now answers for both states:
-- the approved sentence first, unchanged word for word, and otherwise the
-- pending one. So all 45 tables carrying `trg_order_lock` refuse with no
-- trigger touched.
--
-- `order_lock_of` is deliberately NOT widened: it means "approved" to every
-- reader (0619's raise reads its budget id; `lib/orders/budget/lock.ts` its
-- approval date). The pending state has its own `order_pending_of`.
--
-- Nothing a Submit does is refused: `submitBudget` writes only
-- `order_budgets`, `order_budget_orders` / `_lines` snapshots (before the
-- status moves) and `order_budget_revisions` — none of them carries the
-- trigger. The bookkeeping columns (`re_status`, `approval_status`, …) stay
-- writable exactly as under the approved lock.
--
-- ## THE WAY OUT MUST EXIST: A CANCELLED RUN RETURNS THE BUDGET TO DRAFT
--
-- Before 0652 a cancelled run left the budget 'submitted' with no live run —
-- harmless while 'submitted' locked nothing. Now it would lock the order with
-- nobody able to decide it. `approval_apply_terminal` therefore sends a
-- cancelled order-budget run's budget back to DRAFT (the same four columns
-- `submitBudget` clears when a run fails to start).
--
-- ## AND 0617 COMES BACK
--
-- 0617 refused to approve a budget that no longer names any order (its orders
-- deleted after submit — an approval over nothing, locking nothing). 0619 and
-- 0629 each re-created `approval_apply_terminal` from an older body and the
-- check was lost. It is restored here, verbatim.

-- ---------------------------------------------------------------------------
-- 1. Which submitted budget holds this order (or its RE No)
-- ---------------------------------------------------------------------------
create or replace function public.order_pending_of(p_order uuid, p_sales_order uuid default null)
returns table(pending_order_id uuid, re_no text, budget_id uuid, budget_code text, submitted_at timestamptz)
language sql
stable
security definer
set search_path to ''
as $$
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id,
         so.order_number,
         bb.id,
         bb.code,
         bb.submitted_at
    from public.garment_order_amendments a
    cross join me
    left join public.sales_orders so on so.id = a.sales_order_id
    join public.order_budget_orders o on o.garment_order_id = a.id
    join public.order_budgets bb on bb.id = o.budget_id and bb.status = 'submitted'
   where (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc, bb.submitted_at desc nulls last
   limit 1;
$$;

comment on function public.order_pending_of(uuid, uuid) is
  '0652: the submitted budget (awaiting the MD) that locks this order or any document of its RE No; empty when none. The approved lock is order_lock_of.';

revoke all on function public.order_pending_of(uuid, uuid) from public, anon;
grant execute on function public.order_pending_of(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one lock sentence — approved first (unchanged), else pending
-- ---------------------------------------------------------------------------
-- TS twins: `orderLockMessage` / `orderPendingMessage` in
-- lib/orders/budget/amendment.ts. Edit the words in both, or the banner and the
-- refusal disagree.
create or replace function public.order_lock_message(p_order uuid, p_sales_order uuid default null)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select
        'Selected budget has been approved'
        || case when nullif(btrim(l.re_no), '') is not null
                then ' — RE ' || btrim(l.re_no) else '' end
        || case when nullif(btrim(l.budget_code), '') is not null
                then case when nullif(btrim(l.re_no), '') is not null then ', ' else ' — ' end
                     || 'budget ' || btrim(l.budget_code)
                else '' end
        || case when l.approved_at is not null
                then case when nullif(btrim(l.re_no), '') is not null
                            or nullif(btrim(l.budget_code), '') is not null
                          then ', ' else ' — ' end
                     || 'approved on ' || to_char(l.approved_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY')
                else '' end
        || '. Direct edits are disabled. Raise an Order Revision to change it.'
      from public.order_lock_of(p_order, p_sales_order) l
    ),
    (
      select
        'Waiting for MD approval'
        || case when nullif(btrim(p.re_no), '') is not null
                then ' — RE ' || btrim(p.re_no) else '' end
        || case when nullif(btrim(p.budget_code), '') is not null
                then case when nullif(btrim(p.re_no), '') is not null then ', ' else ' — ' end
                     || 'budget ' || btrim(p.budget_code)
                else '' end
        || case when p.submitted_at is not null
                then case when nullif(btrim(p.re_no), '') is not null
                            or nullif(btrim(p.budget_code), '') is not null
                          then ', ' else ' — ' end
                     || 'submitted on ' || to_char(p.submitted_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY')
                else '' end
        || '. Direct edits are disabled until the MD approves it or sends it back for rework.'
      from public.order_pending_of(p_order, p_sales_order) p
    )
  );
$$;

revoke all on function public.order_lock_message(uuid, uuid) from public, anon;
grant execute on function public.order_lock_message(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. approval_apply_terminal — cancelled → draft, and 0617's guard restored
-- ---------------------------------------------------------------------------
-- The live 0629 body, with exactly two changes in the order_budgets branch,
-- each marked 0652. The iwo_budgets and hr_staff_fine_deductions branches are
-- untouched.
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
        -- 0652: A CANCELLED RUN RETURNS THE BUDGET TO DRAFT. While 'submitted'
        -- the order is locked (order_pending_of); a budget left 'submitted'
        -- with no live run would lock it with nobody able to decide it.
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

        -- 0617 (restored by 0652): AN APPROVAL MUST COVER AT LEAST ONE ORDER.
        -- A budget whose orders were deleted after submit would be approved
        -- over nothing — locking nothing, and reading as approved everywhere.
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

    raise exception
        'approval_apply_terminal: no terminal callback is implemented for subject_table %. Add a branch in 0505 before starting runs for it.',
        new.subject_table
        using errcode = '0A000';
end $function$;
