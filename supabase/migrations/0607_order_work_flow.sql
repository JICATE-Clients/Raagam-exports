-- ============================================================================
-- Raagam ERP — 0607 Order Entry ▸ T&A ▸ Work Flow (six office milestones)
--
-- Spec: doc/order/orderentry workflow feature.md · Plan: doc/order/orderentry-workflow-plan.md
--
-- Six pre-production OFFICE milestones per order — Order Entry, CAD, Material
-- BOM, Fabric BOM, Budgeting, Budget Approval — dated FORWARD from the order's
-- received date, each with an owner from the Employee master, going red when
-- late. The production ladder (garment_order_amendment_ta_activities) is dated
-- BACKWARD from delivery; this is the other end of the order.
--
-- ## WHY ITS OWN TABLE, AND NOT ROWS ON THE LADDER TABLE
--
-- The ladder is saved by delete-and-reinsert from the Order Entry screen's own
-- state (`writeChildren`, lib/orders/amendments/actions.ts). Rows that the
-- DATABASE stamps would have to be threaded through that save — a 23,000-line
-- screen — and a stamp landing between its read and its reinsert would be lost.
-- A sibling table that the order's Save never touches has neither problem.
--
-- ## KEYED BY THE RE (sales_order_id), NOT BY A DOCUMENT
--
-- One RE No can hold several `garment_order_amendments` documents (0517). These
-- are the ORDER's pre-production milestones: a Fabric BOM saved against a later
-- amendment document still completes the order's Fabric BOM milestone. So every
-- trigger resolves a document to its `sales_order_id`, and Day 0 is read off the
-- RE's ORIGINAL (earliest) document.
--
-- ## NOBODY TYPES A COMPLETION
--
-- `status` / `actual_date` are written ONLY by `work_flow_mark`, from triggers on
-- the modules themselves, and the column grants below make that a fact rather
-- than a convention: `authenticated` may update `days`, `owner_id` and
-- `remarks` and nothing else. A typed date could say "done" over a draft BOM.
--
-- ## A COMPLETION IS HISTORY
--
-- `work_flow_mark` never moves a row backwards. A BOM reopened as a draft is an
-- amendment, not a missed deadline; the BOM queue's own "recalculate" state is
-- where that shows.
--
-- ## OVERDUE IS NOT STORED
--
-- The spec stores an OVERDUE status. It is derived at read time instead, as the
-- worklist (`daysLate`) and approvals (`is_overdue`) already do: a stored
-- "overdue" goes stale the moment the date changes with nobody writing the row.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The milestone list. ONE declaration in SQL, mirrored by
--    WORK_FLOW_MILESTONES in lib/orders/work-flow/types.ts (checked by the
--    smoke test at the end of this file, and by scripts/check-work-flow.mts).
-- ----------------------------------------------------------------------------
create or replace function public.work_flow_milestone_defaults()
returns table (code text, sn int, days int)
language sql immutable
set search_path = ''
as $$
  values
    ('ORDER_ENTRY',     1, 1),
    ('CAD_COMPLETION',  2, 2),
    ('MATERIAL_BOM',    3, 3),
    ('FABRIC_BOM',      4, 3),
    ('BUDGETING',       5, 4),
    ('BUDGET_APPROVAL', 6, 4)
$$;


-- ----------------------------------------------------------------------------
-- 2. The table.
-- ----------------------------------------------------------------------------
create table if not exists public.order_work_flow_milestones (
  id                  uuid primary key default gen_random_uuid(),
  sales_order_id      uuid not null references public.sales_orders(id) on delete cascade,
  code                text not null check (code in (
                        'ORDER_ENTRY','CAD_COMPLETION','MATERIAL_BOM',
                        'FABRIC_BOM','BUDGETING','BUDGET_APPROVAL')),
  sn                  int  not null check (sn between 1 and 6),
  -- Working days after Day 0 (Sunday off — lib/ta/schedule.ts's calendar).
  days                int  not null check (days between 0 and 365),
  -- STORED so the sweep and the dashboard can ask SQL "what is late". Written
  -- only by the BEFORE trigger below, from `days` and the RE's Day 0.
  target_date         date,
  actual_date         date,
  status              text not null default 'pending'
                        check (status in ('pending','in_progress','done')),
  -- 'auto' = stamped by a module trigger; 'backfill' = reconstructed by this
  -- migration for an order that existed before it (its date may be NULL where
  -- the module kept no timestamp — an honest blank beats an invented date).
  actual_source       text check (actual_source in ('auto','backfill')),
  owner_id            uuid references public.employees(id) on delete set null,
  remarks             text,
  -- Sweep bookkeeping (idempotent alerts). Cleared when target_date moves.
  overdue_notified_at timestamptz,
  escalated_at        timestamptz,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_owf_order_code unique (sales_order_id, code),
  -- An actual date only on a finished row; a finished row carries one unless
  -- it was reconstructed.
  constraint chk_owf_actual_only_when_done
    check (status = 'done' or actual_date is null),
  constraint chk_owf_done_has_date
    check (status <> 'done' or actual_date is not null or actual_source = 'backfill')
);

create index if not exists idx_owf_open_target
  on public.order_work_flow_milestones(target_date) where status <> 'done';
create index if not exists idx_owf_owner
  on public.order_work_flow_milestones(owner_id);

comment on table public.order_work_flow_milestones is
  '0607 — Order Entry ▸ T&A ▸ Work Flow: six office milestones per RE, dated forward from Day 0 (received_date ?? amend_date of the RE''s original document). status/actual_date written only by work_flow_mark (module triggers).';


-- ----------------------------------------------------------------------------
-- 3. Dates.
-- ----------------------------------------------------------------------------

-- Forward N working days, Sunday the only day off — `addWorkingDays` in
-- lib/ta/schedule.ts, the same walk. Holidays are not consulted on EITHER side
-- (see the note on `taActivityRows`): both halves or neither.
create or replace function public.work_flow_add_working_days(p_from date, p_days int)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_at   date := p_from;
  v_left int  := coalesce(p_days, 0);
begin
  if p_from is null then return null; end if;
  while v_left > 0 loop
    v_at := v_at + 1;
    if extract(dow from v_at) <> 0 then v_left := v_left - 1; end if;
  end loop;
  return v_at;
end $$;

-- Day 0 of an RE: the ORIGINAL document's received date, else its order date.
create or replace function public.work_flow_day0(p_so uuid)
returns date
language sql stable security definer
set search_path = ''
as $$
  select coalesce(g.received_date, g.amend_date)
    from public.garment_order_amendments g
   where g.sales_order_id = p_so
   order by g.created_at, g.id
   limit 1
$$;

-- "Today" in Tirupur, never UTC (lib/calendar.ts's rule, in SQL).
create or replace function public.work_flow_today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;


-- target_date follows `days`; a moved target re-arms the alerts.
create or replace function public.work_flow_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.target_date := public.work_flow_add_working_days(public.work_flow_day0(new.sales_order_id), new.days);
  if tg_op = 'UPDATE' and new.target_date is distinct from old.target_date then
    new.overdue_notified_at := null;
    new.escalated_at        := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_owf_before_write on public.order_work_flow_milestones;
create trigger trg_owf_before_write
  before insert or update on public.order_work_flow_milestones
  for each row execute function public.work_flow_before_write();


-- ----------------------------------------------------------------------------
-- 4. ensure / retarget / mark.
-- ----------------------------------------------------------------------------

-- Create whichever of the six rows an RE is missing. Owner defaults:
-- ORDER_ENTRY = the order's own Merchandiser (an employees id since 0478);
-- every other row = whoever owned that milestone on the most recent other RE
-- (the 0547 "copy the last order's owners" rule).
create or replace function public.work_flow_ensure(p_so uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_merch uuid;
begin
  if p_so is null then return; end if;
  select g.merchandiser_id into v_merch
    from public.garment_order_amendments g
   where g.sales_order_id = p_so
   order by g.created_at, g.id
   limit 1;
  if not found then return; end if;

  insert into public.order_work_flow_milestones (sales_order_id, code, sn, days, owner_id)
  select p_so, m.code, m.sn, m.days,
         case when m.code = 'ORDER_ENTRY' then v_merch
              else (select w.owner_id
                      from public.order_work_flow_milestones w
                     where w.code = m.code
                       and w.sales_order_id <> p_so
                       and w.owner_id is not null
                     order by w.created_at desc
                     limit 1)
         end
    from public.work_flow_milestone_defaults() m
  on conflict (sales_order_id, code) do nothing;
end $$;

-- Re-date an RE's rows after its Day 0 moved (the BEFORE trigger does the maths).
create or replace function public.work_flow_retarget(p_so uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.order_work_flow_milestones w
     set days = w.days
   where w.sales_order_id = p_so
     and w.target_date is distinct from
         public.work_flow_add_working_days(public.work_flow_day0(p_so), w.days)
$$;

-- Move one milestone forward. NEVER backward: done stays done (a completion is
-- history), in_progress never returns to pending.
create or replace function public.work_flow_mark(p_so uuid, p_code text, p_state text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_so is null then return; end if;
  perform public.work_flow_ensure(p_so);
  if p_state = 'done' then
    update public.order_work_flow_milestones
       set status = 'done', actual_date = public.work_flow_today(), actual_source = 'auto'
     where sales_order_id = p_so and code = p_code and status <> 'done';
  elsif p_state = 'in_progress' then
    update public.order_work_flow_milestones
       set status = 'in_progress'
     where sales_order_id = p_so and code = p_code and status = 'pending';
  else
    raise exception 'work_flow_mark: unknown state %', p_state;
  end if;
end $$;

-- A document id → its RE.
create or replace function public.work_flow_so_of(p_doc uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$ select g.sales_order_id from public.garment_order_amendments g where g.id = p_doc $$;

-- Budget status → the two budget milestones, for one RE.
create or replace function public.work_flow_apply_budget(p_so uuid, p_status text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status = 'draft' then
    perform public.work_flow_mark(p_so, 'BUDGETING', 'in_progress');
  elsif p_status in ('submitted', 'rejected') then
    -- Rejected was submitted first: Budgeting WAS done; approval is still owed.
    perform public.work_flow_mark(p_so, 'BUDGETING', 'done');
    perform public.work_flow_mark(p_so, 'BUDGET_APPROVAL', 'in_progress');
  elsif p_status = 'approved' then
    perform public.work_flow_mark(p_so, 'BUDGETING', 'done');
    perform public.work_flow_mark(p_so, 'BUDGET_APPROVAL', 'done');
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5. The module triggers. On the COLUMN, not in the server actions: a budget is
--    decided on two paths (the approval engine's terminal trigger and the
--    direct `decideBudget`), CAD can be un-submitted, and a trigger sees every
--    path where an action call sees only the one it was written into.
-- ----------------------------------------------------------------------------

-- 5a. The order document.
create or replace function public.work_flow_on_order()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.sales_order_id is null then return null; end if;
  perform public.work_flow_ensure(new.sales_order_id);
  if tg_op = 'UPDATE' and (
       new.received_date  is distinct from old.received_date
    or new.amend_date     is distinct from old.amend_date
    or new.sales_order_id is distinct from old.sales_order_id) then
    perform public.work_flow_retarget(new.sales_order_id);
  end if;
  perform public.work_flow_mark(new.sales_order_id, 'ORDER_ENTRY',
            case when new.is_draft then 'in_progress' else 'done' end);
  return null;
end $$;

drop trigger if exists trg_goa_work_flow on public.garment_order_amendments;
create trigger trg_goa_work_flow
  after insert or update of is_draft, received_date, amend_date, sales_order_id
  on public.garment_order_amendments
  for each row execute function public.work_flow_on_order();

-- 5b. CAD sheet.
create or replace function public.work_flow_on_cad()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.work_flow_mark(public.work_flow_so_of(new.garment_order_id), 'CAD_COMPLETION',
            case when new.status = 'submitted' then 'done' else 'in_progress' end);
  return null;
end $$;

drop trigger if exists trg_cad_work_flow on public.order_cad_markers;
create trigger trg_cad_work_flow
  after insert or update of status on public.order_cad_markers
  for each row execute function public.work_flow_on_cad();

-- 5c. Material BOM (several documents per order are possible; any one leaving
--     draft completes the milestone — the same test `bomRefusalOf` gates on).
create or replace function public.work_flow_on_material_bom()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.garment_order_id is null then return null; end if;
  perform public.work_flow_mark(public.work_flow_so_of(new.garment_order_id), 'MATERIAL_BOM',
            case when new.is_draft then 'in_progress' else 'done' end);
  return null;
end $$;

drop trigger if exists trg_mba_work_flow on public.material_bom_amendments;
create trigger trg_mba_work_flow
  after insert or update of is_draft, garment_order_id on public.material_bom_amendments
  for each row execute function public.work_flow_on_material_bom();

-- 5d. Fabric BOM.
create or replace function public.work_flow_on_fabric_bom()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.work_flow_mark(public.work_flow_so_of(new.garment_order_id), 'FABRIC_BOM',
            case when new.is_draft then 'in_progress' else 'done' end);
  return null;
end $$;

drop trigger if exists trg_ofb_work_flow on public.order_fabric_boms;
create trigger trg_ofb_work_flow
  after insert or update of is_draft on public.order_fabric_boms
  for each row execute function public.work_flow_on_fabric_bom();

-- 5e. Budget status — fans out through order_budget_orders, the shape
--     `sync_re_status_from_budget` (0576) uses.
create or replace function public.work_flow_on_budget()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select distinct g.sales_order_id
      from public.order_budget_orders o
      join public.garment_order_amendments g on g.id = o.garment_order_id
     where o.budget_id = new.id and g.sales_order_id is not null
  loop
    perform public.work_flow_apply_budget(r.sales_order_id, new.status);
  end loop;
  return null;
end $$;

drop trigger if exists trg_ob_work_flow on public.order_budgets;
create trigger trg_ob_work_flow
  after update of status on public.order_budgets
  for each row when (old.status is distinct from new.status)
  execute function public.work_flow_on_budget();

-- 5f. A budget is linked to its order in a SECOND insert, after the budget row.
create or replace function public.work_flow_on_budget_link()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_status text;
begin
  select b.status into v_status from public.order_budgets b where b.id = new.budget_id;
  perform public.work_flow_apply_budget(public.work_flow_so_of(new.garment_order_id), v_status);
  return null;
end $$;

drop trigger if exists trg_obo_work_flow on public.order_budget_orders;
create trigger trg_obo_work_flow
  after insert on public.order_budget_orders
  for each row execute function public.work_flow_on_budget_link();


-- ----------------------------------------------------------------------------
-- 6. Grants. Every function here is internal — reached through triggers, or by
--    the service role from the sweep. `revoke … from public, anon` both, always
--    (AGENTS.md "Function grants": either alone leaves the other grant standing).
-- ----------------------------------------------------------------------------
revoke all on function public.work_flow_milestone_defaults()              from public, anon, authenticated;
revoke all on function public.work_flow_add_working_days(date, int)       from public, anon, authenticated;
revoke all on function public.work_flow_day0(uuid)                        from public, anon, authenticated;
revoke all on function public.work_flow_today()                           from public, anon, authenticated;
revoke all on function public.work_flow_before_write()                    from public, anon, authenticated;
revoke all on function public.work_flow_ensure(uuid)                      from public, anon, authenticated;
revoke all on function public.work_flow_retarget(uuid)                    from public, anon, authenticated;
revoke all on function public.work_flow_mark(uuid, text, text)            from public, anon, authenticated;
revoke all on function public.work_flow_so_of(uuid)                       from public, anon, authenticated;
revoke all on function public.work_flow_apply_budget(uuid, text)          from public, anon, authenticated;
revoke all on function public.work_flow_on_order()                        from public, anon, authenticated;
revoke all on function public.work_flow_on_cad()                          from public, anon, authenticated;
revoke all on function public.work_flow_on_material_bom()                 from public, anon, authenticated;
revoke all on function public.work_flow_on_fabric_bom()                   from public, anon, authenticated;
revoke all on function public.work_flow_on_budget()                       from public, anon, authenticated;
revoke all on function public.work_flow_on_budget_link()                  from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. RLS + column grants. Read with orders:view; the operator may change
--    Days, Owner and Remarks (orders:edit) and NOTHING ELSE — status and dates
--    are the triggers'. Rows are created only by work_flow_ensure (definer), so
--    there is no insert or delete policy; FK cascades are not subject to RLS.
-- ----------------------------------------------------------------------------
alter table public.order_work_flow_milestones enable row level security;

drop policy if exists owf_read   on public.order_work_flow_milestones;
drop policy if exists owf_update on public.order_work_flow_milestones;
create policy owf_read on public.order_work_flow_milestones
  for select to authenticated using (public.has_permission('orders','view'));
create policy owf_update on public.order_work_flow_milestones
  for update to authenticated
  using (public.has_permission('orders','edit'))
  with check (public.has_permission('orders','edit'));

revoke all on public.order_work_flow_milestones from anon;
revoke insert, update, delete on public.order_work_flow_milestones from authenticated;
grant select on public.order_work_flow_milestones to authenticated;
grant update (days, owner_id, remarks) on public.order_work_flow_milestones to authenticated;


-- ----------------------------------------------------------------------------
-- 8. Owner vocabulary — the WORDS only (the 0482 precedent: a migration seeds
--    the word, a person tags the people). Idempotent by name.
-- ----------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select v.kind, v.code, v.name, true
from (values
  ('department',  'DEPT-CAD',  'CAD'),
  ('department',  'DEPT-COST', 'COSTING'),
  ('department',  'DEPT-MGMT', 'MANAGEMENT'),
  ('designation', 'MD',        'MANAGING DIRECTOR')
) as v(kind, code, name)
where not exists (
  select 1 from public.config_lookups c
   where c.kind = v.kind and lower(btrim(c.name)) = lower(btrim(v.name))
);


-- ----------------------------------------------------------------------------
-- 9. Backfill every existing RE, from each module's CURRENT state, marked
--    'backfill'. A date is carried only where the module kept a real timestamp
--    (order created_at, CAD submitted_at, budget submitted_at / decided_at);
--    the BOMs kept none, so theirs stay NULL rather than invented.
--
--    Rows ALREADY overdue at backfill time are marked as notified: alerts are
--    for work that goes late from now on, not a flood about months-old orders.
--    They still show red on the tab and on the dashboard.
-- ----------------------------------------------------------------------------
do $bf$
declare
  so record;
  v_first record;
begin
  for so in select distinct g.sales_order_id as id
              from public.garment_order_amendments g
             where g.sales_order_id is not null
  loop
    perform public.work_flow_ensure(so.id);

    select g.id, g.is_draft, g.created_at into v_first
      from public.garment_order_amendments g
     where g.sales_order_id = so.id order by g.created_at, g.id limit 1;

    -- ORDER_ENTRY
    update public.order_work_flow_milestones w
       set status = case when v_first.is_draft then 'in_progress' else 'done' end,
           actual_date = case when v_first.is_draft then null
                              else (v_first.created_at at time zone 'Asia/Kolkata')::date end,
           actual_source = case when v_first.is_draft then null else 'backfill' end
     where w.sales_order_id = so.id and w.code = 'ORDER_ENTRY' and w.status = 'pending';

    -- CAD
    update public.order_work_flow_milestones w
       set status = case when c.status = 'submitted' then 'done' else 'in_progress' end,
           actual_date = case when c.status = 'submitted'
                              then (coalesce(c.submitted_at, c.updated_at) at time zone 'Asia/Kolkata')::date end,
           actual_source = case when c.status = 'submitted' then 'backfill' end
      from public.order_cad_markers c
      join public.garment_order_amendments g on g.id = c.garment_order_id
     where g.sales_order_id = so.id
       and w.sales_order_id = so.id and w.code = 'CAD_COMPLETION' and w.status = 'pending';

    -- MATERIAL BOM / FABRIC BOM — done if any document of the RE left draft.
    update public.order_work_flow_milestones w
       set status = case when x.any_saved then 'done' else 'in_progress' end,
           actual_source = case when x.any_saved then 'backfill' end
      from (select bool_or(not m.is_draft) as any_saved
              from public.material_bom_amendments m
              join public.garment_order_amendments g on g.id = m.garment_order_id
             where g.sales_order_id = so.id
            having count(*) > 0) x
     where w.sales_order_id = so.id and w.code = 'MATERIAL_BOM' and w.status = 'pending';

    update public.order_work_flow_milestones w
       set status = case when x.any_saved then 'done' else 'in_progress' end,
           actual_source = case when x.any_saved then 'backfill' end
      from (select bool_or(not f.is_draft) as any_saved
              from public.order_fabric_boms f
              join public.garment_order_amendments g on g.id = f.garment_order_id
             where g.sales_order_id = so.id
            having count(*) > 0) x
     where w.sales_order_id = so.id and w.code = 'FABRIC_BOM' and w.status = 'pending';

    -- BUDGETING / BUDGET_APPROVAL — the most advanced budget linked to the RE.
    update public.order_work_flow_milestones w
       set status = case
             when w.code = 'BUDGETING' and b.status = 'draft' then 'in_progress'
             when w.code = 'BUDGETING' then 'done'
             when b.status = 'approved' then 'done'
             when b.status in ('submitted','rejected') then 'in_progress'
             else w.status end,
           actual_date = case
             when w.code = 'BUDGETING' and b.status <> 'draft'
               then (b.submitted_at at time zone 'Asia/Kolkata')::date
             when w.code = 'BUDGET_APPROVAL' and b.status = 'approved'
               then (b.decided_at at time zone 'Asia/Kolkata')::date
             end,
           actual_source = case
             when (w.code = 'BUDGETING' and b.status <> 'draft')
               or (w.code = 'BUDGET_APPROVAL' and b.status = 'approved') then 'backfill' end
      from (select ob.status, ob.submitted_at, ob.decided_at
              from public.order_budgets ob
              join public.order_budget_orders o on o.budget_id = ob.id
              join public.garment_order_amendments g on g.id = o.garment_order_id
             where g.sales_order_id = so.id
             order by case ob.status when 'approved' then 0 when 'submitted' then 1
                                     when 'rejected' then 2 else 3 end,
                      ob.created_at desc
             limit 1) b
     where w.sales_order_id = so.id and w.code in ('BUDGETING','BUDGET_APPROVAL')
       and w.status = 'pending';
  end loop;

  update public.order_work_flow_milestones
     set overdue_notified_at = now(),
         escalated_at        = now()
   where status <> 'done' and target_date < public.work_flow_today();
end $bf$;
