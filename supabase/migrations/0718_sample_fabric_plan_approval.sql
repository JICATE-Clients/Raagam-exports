-- 0718 — Sample ▸ Fabric Plan APPROVAL + Fabric Plan REVISION (client brief
-- 2026-10-13, "approval checkpoints" §2).
--
-- A sample Fabric Plan aggregates the SWO's fabric requirement into yarn
-- purchase weights and processing (dyeing shades, knitting structures,
-- stages). The brief:
--   * it is APPROVED before anything is bought — "upon approval the system
--     unlocks yarn purchasing and dyeing work orders";
--   * once approved it is LOCKED — "users cannot directly edit the fabric
--     plan; any changes to weights or processes must go through a Fabric Plan
--     Revision".
--
-- WHAT THIS ADDS, ALL ON THE ONE PLAN RECORD (iwo_fabric_boms):
--   approval_status  open → submitted → approved, or → returned (sent back by
--                    the approver: editable again, resubmit). Production IWO
--                    plans never leave 'open' — the Submit lives only on the
--                    Sample Fabric Plan, so nothing changes for Orders.
--   revision_no      0 = the first approval; Raise Revision makes it 1, 2 …
--   iwo_fabric_bom_revisions — one row per revision: why, who, when, and the
--                    yarn purchase weights that had been approved before it.
--
-- THE LOCK IS IN THE DATABASE, BESIDE THE IWO BUDGET'S. 0595 put
-- `refuse_when_iwo_budget_locked` on every plan table; this adds a SECOND
-- trigger on the same tables rather than re-creating that one, so the budget
-- lock's body is never at risk of being rewritten from a stale copy. While a
-- plan is submitted or approved, no row of it can be inserted, changed or
-- deleted — a stale tab and a direct API call are refused exactly as the
-- screen is.
--
-- PURCHASING READS THE STATUS THROUGH THE ONE GATE IT ALREADY HAS.
-- `iwo_purchase_check__all_units` (0595/0681) is what every PO path asks; its
-- fabric-side `bom` object now also says `approval_status`, `revision_no` and
-- `needs_approval` (= the work order is a sample one). The refusal sentence is
-- TS (`iwoCeilingRefusal`), pinned by scripts/check-iwo-material-bom.mts.
--
-- THE DECISION IS APPLIED BY THE ENGINE'S TERMINAL TRIGGER. Workflow
-- 'sample_fabric_plan', subject 'iwo_fabric_boms'. `approval_apply_terminal`
-- is extended IN PLACE from its LIVE body (read with pg_get_functiondef, one
-- branch inserted before its final refusal) — never retyped, so no branch a
-- parallel migration added can be lost.

-- ---------------------------------------------------------------------------
-- 1. The status on the plan
-- ---------------------------------------------------------------------------
alter table public.iwo_fabric_boms
  add column if not exists approval_status text not null default 'open',
  add column if not exists revision_no     integer not null default 0,
  add column if not exists submitted_at    timestamptz,
  add column if not exists submitted_by    uuid,
  add column if not exists decided_at      timestamptz,
  add column if not exists decided_by      uuid,
  add column if not exists decision_remark text,
  add column if not exists approved_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'iwo_fabric_boms_approval_status_check') then
    alter table public.iwo_fabric_boms
      add constraint iwo_fabric_boms_approval_status_check
      check (approval_status in ('open', 'submitted', 'approved', 'returned'));
  end if;
end $$;

comment on column public.iwo_fabric_boms.approval_status is
  '0718 — open | submitted | approved | returned. Submitted and approved LOCK every row of the plan (refuse_when_fabric_plan_approved); a sample work order buys yarn only once approved.';
comment on column public.iwo_fabric_boms.revision_no is
  '0718 — 0 until the first Fabric Plan Revision; raise_fabric_plan_revision adds one.';

-- ---------------------------------------------------------------------------
-- 2. The revision log
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_fabric_bom_revisions (
  id             uuid primary key default gen_random_uuid(),
  bom_id         uuid not null references public.iwo_fabric_boms(id) on delete cascade,
  revision_no    integer not null,
  reason         text not null check (btrim(reason) <> ''),
  -- What had been approved before this revision reopened the plan: one entry
  -- per yarn line (item, purchase weight, unit). Evidence, never re-applied.
  approved_yarns jsonb not null default '[]'::jsonb,
  raised_by      uuid default auth.uid(),
  raised_at      timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (bom_id, revision_no)
);

alter table public.iwo_fabric_bom_revisions enable row level security;

-- A detail table follows its document (AGENTS.md "Locations"): the plan's unit.
drop policy if exists iwo_fabric_bom_revisions_read on public.iwo_fabric_bom_revisions;
create policy iwo_fabric_bom_revisions_read on public.iwo_fabric_bom_revisions
  for select to authenticated
  using (public.has_permission('orders', 'view') and public.lv_iwo_fabric_boms(bom_id));
-- No insert / update / delete policy: a revision is written only by
-- raise_fabric_plan_revision (SECURITY DEFINER), so it cannot be forged or erased.

-- ---------------------------------------------------------------------------
-- 3. The lock — a second trigger on every plan table
-- ---------------------------------------------------------------------------
create or replace function public.fabric_plan_lock_message(p_status text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case p_status
    when 'submitted' then
      'This Fabric Plan is with the approver — nothing in it can change until it is approved or sent back.'
    else
      'This Fabric Plan is approved and locked. Raise Revision to change it — the revised plan goes for approval again.'
  end
$$;

create or replace function public.refuse_when_fabric_plan_approved()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_path   text := tg_argv[0];            -- zero-based: see 0577
  v_rows   jsonb[];
  v_r      jsonb;
  v_bom    uuid;
  v_status text;
begin
  if v_path not in ('fabric_bom', 'fabric_yarn', 'fabric_yd') then
    raise exception 'refuse_when_fabric_plan_approved: unknown path %', v_path;
  end if;

  -- Judge the row as it WAS and as it WILL BE (0595's reasoning): moving a
  -- child from an open plan into a locked one is an edit of the locked one.
  if tg_op <> 'INSERT' then v_rows := array_append(v_rows, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then v_rows := array_append(v_rows, to_jsonb(new)); end if;

  foreach v_r in array v_rows loop
    v_bom := case v_path
      when 'fabric_bom' then (v_r->>'bom_id')::uuid
      when 'fabric_yarn' then (
        select y.bom_id from public.iwo_fabric_bom_yarns y where y.id = (v_r->>'yarn_id')::uuid)
      when 'fabric_yd' then (
        select c.bom_id from public.iwo_fabric_bom_yd_combinations c where c.id = (v_r->>'combination_id')::uuid)
    end;
    -- A parent already gone (a cascade from an allowed delete) locks nothing.
    continue when v_bom is null;
    select b.approval_status into v_status
      from public.iwo_fabric_boms b
     where b.id = v_bom and b.approval_status in ('submitted', 'approved');
    if v_status is not null then
      raise exception '%', public.fabric_plan_lock_message(v_status) using errcode = '55000';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.refuse_when_fabric_plan_approved() from public, anon;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('iwo_fabric_bom_palette',               'fabric_bom'),
      ('iwo_fabric_bom_dias',                  'fabric_bom'),
      ('iwo_fabric_bom_lines',                 'fabric_bom'),
      ('iwo_fabric_bom_processes',             'fabric_bom'),
      ('iwo_fabric_bom_process_scope',         'fabric_bom'),
      ('iwo_fabric_bom_yarns',                 'fabric_bom'),
      ('iwo_fabric_bom_yd_repeats',            'fabric_bom'),
      ('iwo_fabric_bom_yd_combinations',       'fabric_bom'),
      ('iwo_fabric_bom_yarn_stages',           'fabric_yarn'),
      ('iwo_fabric_bom_yarn_shades',           'fabric_yarn'),
      ('iwo_fabric_bom_yd_combination_colors', 'fabric_yd')
    ) as v(tbl, path)
  loop
    execute format('drop trigger if exists trg_fabric_plan_lock on public.%I', t.tbl);
    execute format(
      'create trigger trg_fabric_plan_lock before insert or update or delete on public.%I '
      'for each row execute function public.refuse_when_fabric_plan_approved(%L)',
      t.tbl, t.path);
  end loop;
end $$;

-- The header: plan fields frozen while submitted/approved, no delete, and the
-- status moved by a client only along the two edges the Submit action owns.
-- NOT security definer: `current_user` must read 'authenticated' for a client
-- write and the owner for the terminal trigger / revision RPC.
create or replace function public.fabric_plan_has_live_run(p_bom uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.approval_runs r
     where r.subject_table = 'iwo_fabric_boms'
       and r.subject_id = p_bom
       and r.status = 'in_progress')
$$;
revoke all on function public.fabric_plan_has_live_run(uuid) from public, anon;
grant execute on function public.fabric_plan_has_live_run(uuid) to authenticated;

create or replace function public.guard_fabric_plan_approval()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    if old.approval_status in ('submitted', 'approved') then
      raise exception 'This Fabric Plan is % — it cannot be deleted.', old.approval_status using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if current_user = 'authenticated'
       and (new.approval_status <> 'open' or new.revision_no <> 0) then
      raise exception 'A new Fabric Plan starts open, at revision 0.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.approval_status in ('submitted', 'approved')
     and (new.iwo_id, new.bom_date, new.is_draft, new.remark)
         is distinct from (old.iwo_id, old.bom_date, old.is_draft, old.remark) then
    raise exception '%', public.fabric_plan_lock_message(old.approval_status) using errcode = '55000';
  end if;

  if current_user = 'authenticated' then
    if new.revision_no is distinct from old.revision_no then
      raise exception 'A Fabric Plan revision is raised only through Raise Revision.' using errcode = '42501';
    end if;
    if new.approval_status is distinct from old.approval_status
       and not (
         -- Submit for approval.
         (old.approval_status in ('open', 'returned') and new.approval_status = 'submitted')
         -- Submit's own rollback when no approval could be started — only
         -- while no run holds it, so a plan can never be pulled out from
         -- under an approver.
         or (old.approval_status = 'submitted' and new.approval_status = 'open'
             and not public.fabric_plan_has_live_run(old.id))
       ) then
      raise exception
        'Only the approval flow can approve or send back a Fabric Plan; an approved plan reopens only through Raise Revision.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_fabric_plan_approval on public.iwo_fabric_boms;
create trigger trg_guard_fabric_plan_approval
  before insert or update or delete on public.iwo_fabric_boms
  for each row execute function public.guard_fabric_plan_approval();

-- ---------------------------------------------------------------------------
-- 4. Raise Revision
-- ---------------------------------------------------------------------------
create or replace function public.raise_fabric_plan_revision(p_bom uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_plan public.iwo_fabric_boms%rowtype;
  v_next integer;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception 'Raising a Fabric Plan revision needs Orders ▸ Edit.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the plan is being revised.' using errcode = '23514';
  end if;

  select * into v_plan from public.iwo_fabric_boms b where b.id = p_bom for update;
  if not found or not public.is_current_location(v_plan.location_id) then
    raise exception 'That Fabric Plan no longer exists in this unit.' using errcode = 'P0002';
  end if;
  if v_plan.approval_status <> 'approved' then
    raise exception 'Only an approved Fabric Plan is revised — this one is %; edit it directly.', v_plan.approval_status
      using errcode = '55000';
  end if;

  v_next := v_plan.revision_no + 1;

  insert into public.iwo_fabric_bom_revisions (bom_id, revision_no, reason, approved_yarns)
  select p_bom, v_next, btrim(p_reason),
         coalesce(jsonb_agg(jsonb_build_object(
                    'item_id', y.item_id,
                    'name', it.name,
                    'purchase_qty', y.purchase_qty,
                    'uom', u.code) order by y.sno), '[]'::jsonb)
    from public.iwo_fabric_bom_yarns y
    left join public.items it on it.id = y.item_id
    left join public.uoms u on u.id = y.uom_id
   where y.bom_id = p_bom;

  -- Runs as the owner, so the header guard allows the reopen; the budget lock
  -- (0595) still refuses if the work order's budget is submitted/approved.
  update public.iwo_fabric_boms
     set approval_status = 'open',
         revision_no     = v_next,
         submitted_at    = null,
         submitted_by    = null,
         updated_at      = now()
   where id = p_bom;

  return v_next;
end;
$function$;

revoke all on function public.raise_fabric_plan_revision(uuid, text) from public, anon;
grant execute on function public.raise_fabric_plan_revision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The decision
-- ---------------------------------------------------------------------------
create or replace function public.sample_fabric_plan_apply_decision(
  p_bom uuid, p_run_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rows int;
begin
  if p_run_status = 'cancelled' then
    update public.iwo_fabric_boms
       set approval_status = 'open', submitted_at = null, submitted_by = null, updated_at = now()
     where id = p_bom and approval_status = 'submitted';
    return;
  end if;

  if p_run_status not in ('completed', 'rejected') then
    return;
  end if;

  update public.iwo_fabric_boms
     set approval_status = case p_run_status when 'completed' then 'approved' else 'returned' end,
         approved_at     = case p_run_status when 'completed' then now() else approved_at end,
         decided_at      = now(),
         decided_by      = p_actor,
         decision_remark = p_remark,
         updated_at      = now()
   where id = p_bom and approval_status = 'submitted';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception
      'Fabric Plan % is not awaiting a decision, so this approval could not be applied. Reload the plan — it may already have been decided another way.',
      p_bom
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function public.sample_fabric_plan_apply_decision(uuid, text, uuid, text) from public, anon;
