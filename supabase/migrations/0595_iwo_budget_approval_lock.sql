-- ============================================================================
-- Raagam ERP — 0595 IWO Budget: approval, the lock it brings, and the yarn PO
-- ceiling.
--
-- Client audio 2026-09-19 ("merchandisers input estimated purchase and
-- processing rates to lock the approved budget for the stock run"); decided by
-- the user the same day: approving an IWO budget LOCKS the work order's BOMs,
-- and a yarn purchase for a work order may not exceed its BOM's purchase
-- weight. Plan: ~/.claude/plans/humming-discovering-beacon.md, Phase 5.
--
-- ## 1. THE DECISION REACHES THE DOCUMENT
--
-- `approval_apply_terminal` (0505) gains an `iwo_budgets` branch — the
-- `order_budgets` branch's shape exactly: only `completed` / `rejected` write,
-- only a `submitted` budget is moved (idempotent by predicate), and a decision
-- that applied to nothing RAISES rather than leaving the run and the document
-- disagreeing. The order branch is restated VERBATIM from the live definition
-- (read from the catalog, not from 0505's file).
--
-- ## 2. A CATCH-ALL FLOW, as 0503 seeded one per workflow: every submitted IWO
--    budget goes to the Managing Director unless a more specific flow matches.
--
-- ## 3. THE LOCK — SUBMITTED OR APPROVED
--
-- While a budget is SUBMITTED the approver is reading its figures; while it is
-- APPROVED purchase is acting on them. In both states a BOM edit would change
-- a number under someone's feet, so both lock (the order side locks only on
-- approval because its budget spans sibling documents; an IWO budget is one
-- work order's). Locked: both IWO BOMs and every child, and the budget's lines.
-- A rejected budget is editable again, and so is its BOM.
--
-- `iwo_budget_lock_of` is SECURITY DEFINER for 0586's reason: RLS scopes
-- `iwo_budgets` by unit and permission, so a caller who cannot SEE the budget
-- would read "no budget" and the lock would fail OPEN.
--
-- TG_ARGV IS ZERO-BASED (0577's lesson — 44 of 0576's triggers were no-ops):
-- every trigger names its path in `tg_argv[0]`, and §6 asserts each table
-- carries its trigger AND that a locked row is actually refused.
--
-- ## 4. WHO MAY MOVE THE STATUS
--
-- A client (role `authenticated`) may submit, and may put a submitted budget
-- back to draft (the submit action's own rollback when no run could start).
-- It may NOT write `approved` / `rejected`, and may not move an approved
-- budget at all: the decision is the approval engine's (SECURITY DEFINER, so it
-- runs as the owner) and reopening is `reopen_iwo_budget`'s (approver-only).
--
-- ## 5. THE YARN CEILING
--
-- `iwo_purchase_check` (0587, same signature, grants kept) now answers a Yarn
-- or Fabric work order too: its `bom` is the IWO Fabric BOM and its `lines`
-- are that BOM's yarns — `purchase_qty` in the yarn's unit (KGS), the figure
-- the BOM's own save computed (Σ shades on a Dyed Purchase, 0592). The rule
-- that reads it (`iwoCeilingRefusal`) is unchanged in shape.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The terminal callback
-- ---------------------------------------------------------------------------
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

        return new;
    end if;

    -- 0595 — the IWO budget, the order budget's branch exactly.
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


-- ---------------------------------------------------------------------------
-- 2. The catch-all flow
-- ---------------------------------------------------------------------------
insert into public.approval_flows
    (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select
   'iwo_budget',
   'IWO Budget — default',
   'Catch-all. Every submitted IWO budget goes to the Managing Director unless a more specific flow matches first.',
   '{}'::jsonb,
   '[{"step_order": 1,
      "step_label": "Managing Director",
      "step_type": "final",
      "approver_role_key": "Managing Director"}]'::jsonb,
   900, true
where not exists (
  select 1 from public.approval_flows f where f.workflow_key = 'iwo_budget' and f.flow_name = 'IWO Budget — default'
);


-- ---------------------------------------------------------------------------
-- 3. The lock
-- ---------------------------------------------------------------------------
create or replace function public.iwo_budget_lock_of(p_iwo uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select b.status
    from public.iwo_budgets b
   where b.iwo_id = p_iwo
     and b.status in ('submitted', 'approved')
$$;

comment on function public.iwo_budget_lock_of(uuid) is
  'IWO Budget lock (0595): the status (submitted / approved) of the work order''s budget when it '
  'locks the BOMs, else NULL. SECURITY DEFINER so RLS cannot make the lock fail open.';

revoke all on function public.iwo_budget_lock_of(uuid) from public, anon;
grant execute on function public.iwo_budget_lock_of(uuid) to authenticated;

create or replace function public.refuse_when_iwo_budget_locked()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_path   text := tg_argv[0];            -- zero-based: see 0577
  v_rows   jsonb[];
  v_r      jsonb;
  v_iwo    uuid;
  v_status text;
begin
  -- Judge the row as it WAS and as it WILL BE: moving a child from an
  -- unlocked BOM into a locked one is as much an edit of the locked one.
  if tg_op <> 'INSERT' then v_rows := array_append(v_rows, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_rows := array_append(v_rows, to_jsonb(new)); end if;

  foreach v_r in array v_rows loop
    v_iwo := case v_path
      when 'iwo' then (v_r->>'iwo_id')::uuid
      when 'fabric_bom' then (select b.iwo_id from public.iwo_fabric_boms b where b.id = (v_r->>'bom_id')::uuid)
      when 'fabric_yarn' then (
        select b.iwo_id from public.iwo_fabric_bom_yarns y
          join public.iwo_fabric_boms b on b.id = y.bom_id
         where y.id = (v_r->>'yarn_id')::uuid)
      when 'fabric_yd' then (
        select b.iwo_id from public.iwo_fabric_bom_yd_combinations c
          join public.iwo_fabric_boms b on b.id = c.bom_id
         where c.id = (v_r->>'combination_id')::uuid)
      when 'material_bom' then (select b.iwo_id from public.iwo_material_boms b where b.id = (v_r->>'bom_id')::uuid)
      when 'budget_line' then (select b.iwo_id from public.iwo_budgets b where b.id = (v_r->>'budget_id')::uuid)
      else null
    end;
    if v_path not in ('iwo', 'fabric_bom', 'fabric_yarn', 'fabric_yd', 'material_bom', 'budget_line') then
      raise exception 'refuse_when_iwo_budget_locked: unknown path %', v_path;
    end if;
    -- A parent already gone (a cascade from an unlocked delete) locks nothing.
    continue when v_iwo is null;
    v_status := public.iwo_budget_lock_of(v_iwo);
    if v_status is not null then
      raise exception
        'This work order''s budget is % — its BOM and budget lines are locked. Reopen the budget to change them.',
        v_status
        using errcode = '55000';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.refuse_when_iwo_budget_locked() is
  'IWO Budget lock (0595): refuses a write to an IWO BOM row (or a budget line) while the work '
  'order''s budget is submitted or approved. TG_ARGV[0] names how the row reaches its IWO.';

revoke all on function public.refuse_when_iwo_budget_locked() from public, anon;

do $$
declare
  v_t text[];
begin
  foreach v_t slice 1 in array array[
    ['iwo_fabric_boms', 'iwo'],
    ['iwo_fabric_bom_palette', 'fabric_bom'],
    ['iwo_fabric_bom_dias', 'fabric_bom'],
    ['iwo_fabric_bom_lines', 'fabric_bom'],
    ['iwo_fabric_bom_processes', 'fabric_bom'],
    ['iwo_fabric_bom_process_scope', 'fabric_bom'],
    ['iwo_fabric_bom_yarns', 'fabric_bom'],
    ['iwo_fabric_bom_yd_repeats', 'fabric_bom'],
    ['iwo_fabric_bom_yd_combinations', 'fabric_bom'],
    ['iwo_fabric_bom_yarn_stages', 'fabric_yarn'],
    ['iwo_fabric_bom_yarn_shades', 'fabric_yarn'],
    ['iwo_fabric_bom_yd_combination_colors', 'fabric_yd'],
    ['iwo_material_boms', 'iwo'],
    ['iwo_material_bom_items', 'material_bom'],
    ['iwo_material_bom_processes', 'material_bom'],
    ['iwo_budget_lines', 'budget_line']
  ] loop
    execute format('drop trigger if exists trg_iwo_budget_lock on public.%I', v_t[1]);
    execute format(
      'create trigger trg_iwo_budget_lock before insert or update or delete on public.%I '
      'for each row execute function public.refuse_when_iwo_budget_locked(%L)',
      v_t[1], v_t[2]);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 4. The budget row itself: content frozen while locked, status by rule
-- ---------------------------------------------------------------------------
create or replace function public.guard_iwo_budget()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('submitted', 'approved') then
      raise exception 'This budget is % — it cannot be deleted.', old.status using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status in ('submitted', 'approved')
     and (new.iwo_id, new.budget_date, new.remark) is distinct from (old.iwo_id, old.budget_date, old.remark) then
    raise exception 'This budget is % — it can no longer be edited.', old.status using errcode = '55000';
  end if;

  -- A CLIENT never decides. The engine's terminal and `reopen_iwo_budget` run
  -- as the definer, so `current_user` there is not `authenticated`.
  if new.status is distinct from old.status and current_user = 'authenticated' then
    if new.status in ('approved', 'rejected') then
      raise exception 'Only the approval flow can approve or reject a budget.' using errcode = '42501';
    end if;
    if old.status = 'approved' then
      raise exception 'An approved budget is changed only by reopening it.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_iwo_budget() from public, anon;
grant execute on function public.guard_iwo_budget() to authenticated;

drop trigger if exists trg_guard_iwo_budget on public.iwo_budgets;
create trigger trg_guard_iwo_budget
  before update or delete on public.iwo_budgets
  for each row execute function public.guard_iwo_budget();


-- ---------------------------------------------------------------------------
-- 5. Reopen — the approver's way back
-- ---------------------------------------------------------------------------
create or replace function public.reopen_iwo_budget(p_budget uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows int;
begin
  if not public.has_permission('orders', 'approve') then
    raise exception 'Only an approver can reopen an approved budget.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the budget is being reopened.' using errcode = '22023';
  end if;

  update public.iwo_budgets b
     set status            = 'draft',
         decided_at        = null,
         decided_by        = null,
         submitted_at      = null,
         submitted_by      = null,
         submitted_summary = null,
         decision_remark   = 'REOPENED: ' || upper(btrim(p_reason)),
         updated_at        = now()
   where b.id = p_budget
     and b.status = 'approved'
     and public.is_current_location(b.location_id);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This budget is not approved at this unit, so there is nothing to reopen.' using errcode = '55000';
  end if;
end;
$$;

comment on function public.reopen_iwo_budget(uuid, text) is
  'IWO Budget (0595): an approver moves an APPROVED budget back to draft, with a reason, which '
  'unlocks its BOMs. The only path out of approved.';

revoke all on function public.reopen_iwo_budget(uuid, text) from public, anon;
grant execute on function public.reopen_iwo_budget(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. The yarn ceiling — `iwo_purchase_check` answers Yarn / Fabric IWOs too
-- ---------------------------------------------------------------------------
create or replace function public.iwo_purchase_check(p_iwo_id uuid, p_exclude_po uuid default null, p_exclude_line uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'code', w.code,
    'iwo_for', w.iwo_for,
    'status', w.status,
    'bom', case when w.iwo_for = 'accessories' then (
      select jsonb_build_object('is_draft', b.is_draft)
      from public.iwo_material_boms b
      where b.iwo_id = w.id
    ) else (
      select jsonb_build_object('is_draft', b.is_draft)
      from public.iwo_fabric_boms b
      where b.iwo_id = w.id
    ) end,
    'advised', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', it.name) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      where b.iwo_id = w.id
        and i.is_advised
        and i.item_id is not null
    ), '[]'::jsonb),
    'lines', case when w.iwo_for = 'accessories' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', i.item_id,
               'name', it.name,
               'purchase_qty', i.purchase_qty,
               'uom', u.code
             ) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
      where b.iwo_id = w.id
        and i.item_id is not null
    ), '[]'::jsonb) else coalesce((
      -- 0595: the Fabric BOM's yarns — the server-computed buy, in its unit.
      select jsonb_agg(jsonb_build_object(
               'item_id', y.item_id,
               'name', it.name,
               'purchase_qty', y.purchase_qty,
               'uom', u.code
             ) order by y.sno)
      from public.iwo_fabric_boms b
      join public.iwo_fabric_bom_yarns y on y.bom_id = b.id
      left join public.items it on it.id = y.item_id
      left join public.uoms u on u.id = y.uom_id
      where b.iwo_id = w.id
    ), '[]'::jsonb) end,
    'committed', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'qty', c.qty))
      from (
        select pl.item_id, sum(pl.quantity) as qty
        from public.po_line_items pl
        join public.purchase_orders po on po.id = pl.purchase_order_id
        where pl.iwo_id = w.id
          and pl.item_id is not null
          and po.status is distinct from 'cancelled'
          and (p_exclude_po is null or pl.purchase_order_id <> p_exclude_po)
          and (p_exclude_line is null or pl.id <> p_exclude_line)
        group by pl.item_id
      ) c
    ), '[]'::jsonb)
  )
  from public.internal_work_orders w
  where w.id = p_iwo_id
$function$;

revoke all on function public.iwo_purchase_check(uuid, uuid, uuid) from public, anon;
grant execute on function public.iwo_purchase_check(uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Assertions, from the catalog
-- ---------------------------------------------------------------------------
do $$
declare v_f text;
begin
  if (select count(*) from pg_trigger
       where tgfoid = 'public.refuse_when_iwo_budget_locked()'::regprocedure and not tgisinternal) <> 16 then
    raise exception '0595: the lock trigger is not on all 16 tables';
  end if;
  foreach v_f in array array[
    'public.iwo_budget_lock_of(uuid)', 'public.refuse_when_iwo_budget_locked()',
    'public.guard_iwo_budget()', 'public.reopen_iwo_budget(uuid,text)',
    'public.iwo_purchase_check(uuid,uuid,uuid)', 'public.approval_apply_terminal()'
  ] loop
    if has_function_privilege('anon', v_f, 'EXECUTE') then
      raise exception '0595: % is executable by anon', v_f;
    end if;
  end loop;
  if not exists (select 1 from public.approval_flows where workflow_key = 'iwo_budget' and is_active) then
    raise exception '0595: no active iwo_budget flow';
  end if;
end $$;
