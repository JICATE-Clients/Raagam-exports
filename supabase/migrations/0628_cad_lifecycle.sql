-- ============================================================================
-- Raagam ERP — 0628 CAD lifecycle: Allocation → Dispatch → Buyer decision,
-- versioned per STYLE, gating the Fabric BOM (doc/order/cad.md; plan and the
-- spec-to-schema mapping in doc/order/cad-plan.md).
--
-- ## WHAT THE SPEC NAMED THAT THIS REPO DOES NOT HAVE
--
-- The spec's SQL is written against tables this database never had, so it is
-- mapped, not copied:
--
--   spec                        here
--   --------------------------  ------------------------------------------------
--   staff_master / designations employees.designation_id → config_lookups
--                                (kind 'designation') — the list the Employee
--                                master's Designation picker offers (0243, 0482).
--   style_id INT                (garment_order_id, style_ref_no TEXT): order
--                                styles are re-minted on every order save, so no
--                                table in this repo holds a style-row FK (0460,
--                                0461, 0479 all say why).
--   marker_definitions          never existed. `is_submitted` lives on the
--     .is_submitted              allocation (the VERSION) — TRUE exactly when that
--                                version was approved — and "the order's CAD is
--                                submitted" is `cad_order_ready()`: every style's
--                                LATEST version approved.
--   Customer Review Lead Days   customers.cad_review_days (new).
--   layout_type (style)         garment_order_amendment_styles.layout_type (new).
--                                0533 removed a PER-COMPONENT layout type on
--                                2026-09-05; this is a per-STYLE one, restored at
--                                the user's instruction on 2026-09-24 for the
--                                spec's approval check.
--   ENUM / SERIAL / TINYINT     text + CHECK, uuid, int.
--
-- ## THE EXISTING CAD SHEET IS UNTOUCHED
--
-- `order_cad_markers` (0460) is the marker SHEET: layouts and panel weights, one
-- per order, draft / submitted — the consumption data the Fabric BOM seeds from.
-- It stays exactly as it is. This migration adds the lifecycle AROUND it: who
-- makes the pattern, when it went to the buyer, what the buyer said. The Fabric
-- BOM now needs both — the lifecycle approved (this file's guard) and, for the
-- CAD seed, the sheet submitted (0460's own rule, unchanged).
--
-- ## WRITES
--
--   allocations   direct (RLS orders:edit), validated by a BEFORE trigger;
--                 only a not-yet-dispatched version can be changed or removed.
--   dispatches,   ONLY through cad_dispatch / cad_decide / cad_undo_dispatch /
--   files,        cad_reopen_decision (SECURITY DEFINER, orders:edit checked
--   approvals     inside). A dispatch and its files are one transaction, which
--                 is how "an attachment is mandatory for Dispatch" is a
--                 database rule and not a screen rule.
--
-- ## DATES ARE TIRUPUR'S
--
-- "Cannot be future" is judged against the IST date (work_flow_today(), 0607),
-- never current_date: the database runs in UTC and the business in UTC+5:30, so
-- current_date is YESTERDAY for the first five and a half hours of every day.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The words: two designations (the 0482 / 0607 §8 precedent — a migration
--    seeds the WORD, a person tags the people on Master Data ▸ Employee).
-- ----------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select v.kind, v.code, v.name, true
from (values
  ('designation', 'PATTERN-MAKER',  'PATTERN MAKER'),
  ('designation', 'CAD-TECHNICIAN', 'CAD TECHNICIAN')
) as v(kind, code, name)
where not exists (
  select 1 from public.config_lookups c
   where c.kind = v.kind and lower(btrim(c.name)) = lower(btrim(v.name))
);


-- ----------------------------------------------------------------------------
-- 2. The two facts the spec reads off masters.
-- ----------------------------------------------------------------------------
alter table public.customers
  add column if not exists cad_review_days int
    check (cad_review_days is null or cad_review_days between 0 and 365);
comment on column public.customers.cad_review_days is
  '0628 — Customer Review Lead Days for a CAD pattern: Expected Approval Date = Dispatch Date + this (calendar days). NULL = not set; the dispatch then carries no expected date and says why.';

alter table public.garment_order_amendment_styles
  add column if not exists layout_type text
    check (layout_type is null or layout_type in ('open_width','tubular'));
comment on column public.garment_order_amendment_styles.layout_type is
  '0628 — the style''s fabric layout (Open Width / Tubular). A CAD whose marker layout disagrees cannot be approved (cad_decide). Per STYLE, not per component (0527/0533 was the per-component one, removed 2026-09-05).';


-- ----------------------------------------------------------------------------
-- 3. The tables.
-- ----------------------------------------------------------------------------

-- One row per (order, style, version). The spec's cad_allocations.
create table if not exists public.order_cad_allocations (
  id                uuid primary key default gen_random_uuid(),
  garment_order_id  uuid not null references public.garment_order_amendments(id) on delete cascade,
  -- TEXT, compared trim + upper (the `styleKey` rule) — see the header.
  style_ref_no      text not null check (btrim(style_ref_no) <> ''),
  version_no        int  not null check (version_no >= 1),
  -- "Hard-validated at the database level" (spec §7): NOT NULL, and the
  -- designation is checked by the trigger below.
  pattern_maker_id  uuid not null references public.employees(id),
  cad_type          text not null check (cad_type in ('first_pattern','grading','marker_planning')),
  -- The system date, set by the trigger on insert and never edited.
  allocation_date   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  target_date       date not null,
  remarks           text,
  -- TRUE exactly while this version's buyer decision is Approved. Written by
  -- cad_decide / cad_reopen_decision only (no column grant).
  is_submitted      boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_oca_target_after_allocation check (target_date >= allocation_date)
);
create unique index if not exists uq_oca_style_version
  on public.order_cad_allocations (garment_order_id, upper(btrim(style_ref_no)), version_no);
create index if not exists ix_oca_order on public.order_cad_allocations (garment_order_id);
create index if not exists ix_oca_maker on public.order_cad_allocations (pattern_maker_id);

comment on table public.order_cad_allocations is
  '0628 — CAD Allocation: one row per (order, style, version). Version n+1 exists only after version n was sent back for Rework.';

-- One dispatch per version. The spec's cad_dispatches.
create table if not exists public.order_cad_dispatches (
  id                      uuid primary key default gen_random_uuid(),
  allocation_id           uuid not null unique references public.order_cad_allocations(id) on delete cascade,
  dispatch_date           date not null,
  courier_tracking_no     text,
  email_sent_at           timestamptz,
  -- The marker's layout as sent — checked against the style's at approval.
  layout_type             text check (layout_type is null or layout_type in ('open_width','tubular')),
  -- Dispatch Date + customers.cad_review_days, stamped at dispatch.
  expected_approval_date  date,
  remarks                 text,
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now(),
  -- Dispatch proofing (spec §3.2): at least one of the two.
  constraint chk_ocd_proof check (
    nullif(btrim(coalesce(courier_tracking_no, '')), '') is not null or email_sent_at is not null)
);

-- The files sent. Storage objects live in the private `garment-order-docs`
-- bucket (0416) under cad/{order}/{style}/v{n}/ — the spec's revision path.
create table if not exists public.order_cad_dispatch_files (
  id            uuid primary key default gen_random_uuid(),
  dispatch_id   uuid not null references public.order_cad_dispatches(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null unique,
  extension     text not null check (extension in ('dxf','pds','plt')),
  mime_type     text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);
create index if not exists ix_ocdf_dispatch on public.order_cad_dispatch_files (dispatch_id);

-- The buyer's decision on one dispatch. The spec's cad_approvals.
create table if not exists public.order_cad_approvals (
  id              uuid primary key default gen_random_uuid(),
  dispatch_id     uuid not null unique references public.order_cad_dispatches(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending','approved','rework')),
  decided_on      date,
  buyer_comments  text,
  decided_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  constraint chk_oca_decided_has_date check (status = 'pending' or decided_on is not null),
  -- Rework must say what the buyer asked for (spec §4.2).
  constraint chk_oca_rework_comments check (
    status <> 'rework' or nullif(btrim(coalesce(buyer_comments, '')), '') is not null)
);


-- ----------------------------------------------------------------------------
-- 4. Reading the state — one definition, read by the guard, the RPCs and (as
--    `cadStyleState` in lib/orders/cad-lifecycle/types.ts) the screens.
-- ----------------------------------------------------------------------------

-- Every style of an order with its LATEST version's state:
--   not_allocated · allocated · pending (dispatched, awaiting the buyer) ·
--   approved · rework (sent back; waiting for version n+1).
create or replace function public.cad_style_states(p_order uuid)
returns table (style_ref_no text, version_no int, allocation_id uuid, state text,
               dispatch_date date, decided_on date)
language sql stable security definer
set search_path = ''
as $$
  with styles as (
    select distinct on (upper(btrim(s.style_ref_no))) btrim(s.style_ref_no) as ref, s.sno
      from public.garment_order_amendment_styles s
     where s.amendment_id = p_order and nullif(btrim(s.style_ref_no), '') is not null
     order by upper(btrim(s.style_ref_no)), s.sno
  ), latest as (
    select distinct on (upper(btrim(a.style_ref_no))) a.*
      from public.order_cad_allocations a
     where a.garment_order_id = p_order
     order by upper(btrim(a.style_ref_no)), a.version_no desc
  )
  select st.ref, l.version_no, l.id,
         case when l.id is null then 'not_allocated'
              when d.id is null then 'allocated'
              else coalesce(ap.status, 'pending') end,
         d.dispatch_date, ap.decided_on
    from styles st
    left join latest l on upper(btrim(l.style_ref_no)) = upper(btrim(st.ref))
    left join public.order_cad_dispatches d on d.allocation_id = l.id
    left join public.order_cad_approvals ap on ap.dispatch_id = d.id
   order by st.sno
$$;

-- "The order's CAD is submitted" — the spec's is_submitted at ORDER grain.
-- An order with no styles is NOT ready: there is nothing to have approved.
create or replace function public.cad_order_ready(p_order uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.cad_style_states(p_order))
     and not exists (select 1 from public.cad_style_states(p_order) s where s.state <> 'approved')
$$;


-- ----------------------------------------------------------------------------
-- 5. Allocation rules — sequential versions, the designation, the system date,
--    and "a dispatched version is history".
-- ----------------------------------------------------------------------------
create or replace function public.cad_allocation_before_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prev   record;
  v_desig  text;
begin
  if tg_op = 'INSERT' then
    new.style_ref_no    := btrim(new.style_ref_no);
    new.allocation_date := public.work_flow_today();
    new.is_submitted    := false;

    -- SEQUENTIAL VERSION CONTROL (spec §7): v(n+1) only after v(n) was sent
    -- back for Rework. The number is assigned here, never trusted from a caller.
    select a.id, a.version_no, ap.status into v_prev
      from public.order_cad_allocations a
      left join public.order_cad_dispatches d on d.allocation_id = a.id
      left join public.order_cad_approvals ap on ap.dispatch_id = d.id
     where a.garment_order_id = new.garment_order_id
       and upper(btrim(a.style_ref_no)) = upper(new.style_ref_no)
     order by a.version_no desc
     limit 1;
    if found then
      if v_prev.status is distinct from 'rework' then
        raise exception using errcode = 'P0001',
          message = format('Style %s already has CAD version %s, which has not been sent back for rework — a new version can only follow a Rework decision.',
                           new.style_ref_no, v_prev.version_no);
      end if;
      new.version_no := v_prev.version_no + 1;
    else
      new.version_no := 1;
    end if;
  else
    if new.garment_order_id is distinct from old.garment_order_id
       or upper(btrim(new.style_ref_no)) is distinct from upper(btrim(old.style_ref_no))
       or new.version_no is distinct from old.version_no
       or new.allocation_date is distinct from old.allocation_date then
      raise exception using errcode = 'P0001',
        message = 'A CAD allocation''s order, style, version and allocation date cannot be changed.';
    end if;
    -- Once sent, a version is what the buyer saw. Only the decision RPCs may
    -- still touch it (is_submitted), and they change nothing else.
    if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = old.id)
       and (new.pattern_maker_id is distinct from old.pattern_maker_id
            or new.cad_type is distinct from old.cad_type
            or new.target_date is distinct from old.target_date
            or new.remarks is distinct from old.remarks) then
      raise exception using errcode = 'P0001',
        message = format('CAD version %s of style %s has been dispatched and can no longer be changed.',
                         old.version_no, old.style_ref_no);
    end if;
    new.updated_at := now();
  end if;

  -- THE PATTERN MAKER (spec §2.1): designation PATTERN MAKER or CAD TECHNICIAN.
  -- Checked when the value is SET, not on every write — an allocation keeps the
  -- person it was given even if their designation later changes.
  if tg_op = 'INSERT' or new.pattern_maker_id is distinct from old.pattern_maker_id then
    select upper(btrim(c.name)) into v_desig
      from public.employees e
      left join public.config_lookups c on c.id = e.designation_id
     where e.id = new.pattern_maker_id;
    if v_desig is null or v_desig not in ('PATTERN MAKER', 'CAD TECHNICIAN') then
      raise exception using errcode = 'P0001',
        message = 'The Pattern Maker must be an employee whose Designation is PATTERN MAKER or CAD TECHNICIAN (Master Data ▸ Associates ▸ Employee).';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_oca_before_write on public.order_cad_allocations;
create trigger trg_oca_before_write
  before insert or update on public.order_cad_allocations
  for each row execute function public.cad_allocation_before_write();

create or replace function public.cad_allocation_before_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- An ORDER being deleted takes its CAD with it (the FK cascade runs inside
  -- the RI trigger, depth > 1). Deleting a sent version on its own is refused.
  if pg_trigger_depth() > 1 then return old; end if;
  if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = old.id) then
    raise exception using errcode = 'P0001',
      message = format('CAD version %s of style %s has been dispatched and cannot be deleted — undo the dispatch first if it was a mistake.',
                       old.version_no, old.style_ref_no);
  end if;
  return old;
end $$;

drop trigger if exists trg_oca_before_delete on public.order_cad_allocations;
create trigger trg_oca_before_delete
  before delete on public.order_cad_allocations
  for each row execute function public.cad_allocation_before_delete();


-- ----------------------------------------------------------------------------
-- 6. T&A — two new Work Flow milestones (0607), stamped with the EVENT's date.
--
--    PATTERN_SENT      done when every style's latest version has been
--                      dispatched; actual = the last of those dispatch dates.
--    PATTERN_APPROVAL  done when every style's latest version is approved
--                      (the order's CAD is submitted); actual = the last
--                      decision date.
--    Both go in_progress at the first dispatch. Neither moves backward
--    (work_flow_mark's rule): an approval later reopened does not un-date
--    the milestone, the same as a reopened BOM (0607).
--
--    sn is renumbered so the rows read in the order the work happens.
-- ----------------------------------------------------------------------------
alter table public.order_work_flow_milestones
  drop constraint if exists order_work_flow_milestones_code_check,
  drop constraint if exists order_work_flow_milestones_sn_check;

update public.order_work_flow_milestones set sn = case code
    when 'ORDER_ENTRY'     then 1
    when 'CAD_COMPLETION'  then 4
    when 'MATERIAL_BOM'    then 5
    when 'FABRIC_BOM'      then 6
    when 'BUDGETING'       then 7
    when 'BUDGET_APPROVAL' then 8
    else sn end;

alter table public.order_work_flow_milestones
  add constraint order_work_flow_milestones_code_check check (code in (
    'ORDER_ENTRY','PATTERN_SENT','PATTERN_APPROVAL','CAD_COMPLETION','MATERIAL_BOM',
    'FABRIC_BOM','BUDGETING','BUDGET_APPROVAL')),
  add constraint order_work_flow_milestones_sn_check check (sn between 1 and 8);

-- Mirrored by WORK_FLOW_MILESTONES (lib/orders/work-flow/types.ts); asserted
-- equal by scripts/check-work-flow.mts, which now parses THIS file.
create or replace function public.work_flow_milestone_defaults()
returns table (code text, sn int, days int)
language sql immutable
set search_path = ''
as $$
  values
    ('ORDER_ENTRY',      1, 1),
    ('PATTERN_SENT',     2, 2),
    ('PATTERN_APPROVAL', 3, 2),
    ('CAD_COMPLETION',   4, 2),
    ('MATERIAL_BOM',     5, 3),
    ('FABRIC_BOM',       6, 3),
    ('BUDGETING',        7, 4),
    ('BUDGET_APPROVAL',  8, 4)
$$;
revoke all on function public.work_flow_milestone_defaults() from public, anon, authenticated;

-- work_flow_mark with the EVENT's date instead of today (spec §4.3:
-- "actual_date = dispatch_date"). Same forward-only rule.
create or replace function public.work_flow_mark_on(p_so uuid, p_code text, p_state text, p_date date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_so is null then return; end if;
  perform public.work_flow_ensure(p_so);
  if p_state = 'done' then
    update public.order_work_flow_milestones
       set status = 'done', actual_date = coalesce(p_date, public.work_flow_today()), actual_source = 'auto'
     where sales_order_id = p_so and code = p_code and status <> 'done';
  elsif p_state = 'in_progress' then
    update public.order_work_flow_milestones
       set status = 'in_progress'
     where sales_order_id = p_so and code = p_code and status = 'pending';
  else
    raise exception 'work_flow_mark_on: unknown state %', p_state;
  end if;
end $$;
revoke all on function public.work_flow_mark_on(uuid, text, text, date) from public, anon, authenticated;

create or replace function public.cad_work_flow_sync(p_order uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_so        uuid := public.work_flow_so_of(p_order);
  v_styles    int;
  v_sent      int;
  v_approved  int;
  v_last_sent date;
  v_last_ok   date;
begin
  if v_so is null then return; end if;
  select count(*),
         count(*) filter (where s.state in ('pending','approved','rework')),
         count(*) filter (where s.state = 'approved'),
         max(s.dispatch_date) filter (where s.state in ('pending','approved','rework')),
         max(s.decided_on) filter (where s.state = 'approved')
    into v_styles, v_sent, v_approved, v_last_sent, v_last_ok
    from public.cad_style_states(p_order) s;

  if v_sent > 0 then
    perform public.work_flow_mark_on(v_so, 'PATTERN_SENT', 'in_progress', null);
    perform public.work_flow_mark_on(v_so, 'PATTERN_APPROVAL', 'in_progress', null);
  end if;
  if v_styles > 0 and v_sent = v_styles then
    perform public.work_flow_mark_on(v_so, 'PATTERN_SENT', 'done', v_last_sent);
  end if;
  if v_styles > 0 and v_approved = v_styles then
    perform public.work_flow_mark_on(v_so, 'PATTERN_APPROVAL', 'done', v_last_ok);
  end if;
end $$;
revoke all on function public.cad_work_flow_sync(uuid) from public, anon, authenticated;

-- Give every existing RE its two new rows (pending — nothing has been sent yet).
do $ensure$
declare r record;
begin
  for r in select distinct g.sales_order_id as id
             from public.garment_order_amendments g
            where g.sales_order_id is not null
  loop
    perform public.work_flow_ensure(r.id);
  end loop;
  -- 0607 §9's rule: a row ALREADY late the day it is created is marked as
  -- notified, so the sweep does not flood every old RE with "Pattern Sent is
  -- overdue". It still shows red on the tab and the dashboard.
  update public.order_work_flow_milestones
     set overdue_notified_at = now(), escalated_at = now()
   where code in ('PATTERN_SENT', 'PATTERN_APPROVAL')
     and status <> 'done'
     and target_date < public.work_flow_today();
end $ensure$;


-- ----------------------------------------------------------------------------
-- 7. The four writes.
-- ----------------------------------------------------------------------------

-- DISPATCH: the dispatch, its files and a Pending decision, in one transaction.
-- p_files = [{ "file_name", "storage_path", "mime_type", "size_bytes" }, …]
create or replace function public.cad_dispatch(
  p_allocation   uuid,
  p_date         date,
  p_courier      text,
  p_email_at     timestamptz,
  p_layout       text,
  p_remarks      text,
  p_files        jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a        public.order_cad_allocations%rowtype;
  v_days     int;
  v_id       uuid;
  v_f        jsonb;
  v_name     text;
  v_ext      text;
  v_path     text;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to dispatch a CAD.';
  end if;

  select * into v_a from public.order_cad_allocations where id = p_allocation for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That CAD allocation no longer exists.';
  end if;
  if exists (select 1 from public.order_cad_dispatches d where d.allocation_id = p_allocation) then
    raise exception using errcode = 'P0001',
      message = format('CAD version %s of style %s has already been dispatched.', v_a.version_no, v_a.style_ref_no);
  end if;

  -- DATE INTEGRITY (spec §7).
  if p_date is null then
    raise exception using errcode = 'P0001', message = 'Dispatch Date is required.';
  end if;
  if p_date > public.work_flow_today() then
    raise exception using errcode = 'P0001', message = 'Dispatch Date cannot be in the future.';
  end if;
  if p_date < v_a.allocation_date then
    raise exception using errcode = 'P0001',
      message = format('Dispatch Date cannot be before the Allocation Date (%s).', to_char(v_a.allocation_date, 'DD/MM/YYYY'));
  end if;

  -- PROOF (spec §3.2).
  if nullif(btrim(coalesce(p_courier, '')), '') is null and p_email_at is null then
    raise exception using errcode = 'P0001',
      message = 'Enter a Courier Tracking Number or an Email Timestamp — a dispatch needs proof it was sent.';
  end if;

  -- LAYOUT: a marker is laid out one way or the other, and that is what the
  -- approval compares with the style.
  if p_layout is not null and p_layout not in ('open_width', 'tubular') then
    raise exception using errcode = 'P0001', message = 'Layout Type must be Open Width or Tubular.';
  end if;
  if v_a.cad_type = 'marker_planning' and p_layout is null then
    raise exception using errcode = 'P0001', message = 'A Marker Planning CAD needs its Layout Type (Open Width / Tubular).';
  end if;

  -- THE FILES (spec §3.1): at least one, and only .DXF / .PDS / .PLT.
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception using errcode = 'P0001',
      message = 'Attach the CAD file (.DXF, .PDS or .PLT) — a dispatch cannot be recorded without it.';
  end if;

  select c.cad_review_days into v_days
    from public.garment_order_amendments g
    left join public.customers c on c.id = g.customer_id
   where g.id = v_a.garment_order_id;

  insert into public.order_cad_dispatches
    (allocation_id, dispatch_date, courier_tracking_no, email_sent_at, layout_type,
     expected_approval_date, remarks)
  values
    (p_allocation, p_date, nullif(btrim(coalesce(p_courier, '')), ''), p_email_at, p_layout,
     case when v_days is null then null else p_date + v_days end,
     nullif(btrim(coalesce(p_remarks, '')), ''))
  returning id into v_id;

  for v_f in select * from jsonb_array_elements(p_files) loop
    v_name := nullif(btrim(v_f ->> 'file_name'), '');
    v_path := nullif(btrim(v_f ->> 'storage_path'), '');
    if v_name is null or v_path is null then
      raise exception using errcode = 'P0001', message = 'A CAD file is missing its name or storage path.';
    end if;
    v_ext := lower(substring(v_name from '\.([^.]+)$'));
    if v_ext is null or v_ext not in ('dxf', 'pds', 'plt') then
      raise exception using errcode = 'P0001',
        message = format('%s is not a CAD file — only .DXF, .PDS and .PLT are accepted.', v_name);
    end if;
    -- The revision path (spec §3, "File Revision Architecture").
    if v_path not like ('cad/' || v_a.garment_order_id::text || '/%/v' || v_a.version_no || '/%') then
      raise exception using errcode = 'P0001', message = 'The CAD file was not stored under this version''s folder.';
    end if;
    insert into public.order_cad_dispatch_files (dispatch_id, file_name, storage_path, extension, mime_type, size_bytes)
    values (v_id, v_name, v_path, v_ext, nullif(v_f ->> 'mime_type', ''), nullif(v_f ->> 'size_bytes', '')::bigint);
  end loop;

  insert into public.order_cad_approvals (dispatch_id, status) values (v_id, 'pending');

  perform public.cad_work_flow_sync(v_a.garment_order_id);
  return v_id;
end $$;

-- DECIDE: Approved or Rework Required.
create or replace function public.cad_decide(
  p_dispatch    uuid,
  p_status      text,
  p_decided_on  date,
  p_comments    text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ap     public.order_cad_approvals%rowtype;
  v_d      public.order_cad_dispatches%rowtype;
  v_a      public.order_cad_allocations%rowtype;
  v_style  text;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to record a CAD decision.';
  end if;
  if p_status not in ('approved', 'rework') then
    raise exception using errcode = 'P0001', message = 'A decision is Approved or Rework Required.';
  end if;

  select * into v_ap from public.order_cad_approvals where dispatch_id = p_dispatch for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That CAD dispatch no longer exists.';
  end if;
  if v_ap.status <> 'pending' then
    raise exception using errcode = 'P0001',
      message = 'The buyer''s decision on this CAD is already recorded — reopen it to change it.';
  end if;
  select * into v_d from public.order_cad_dispatches where id = p_dispatch;
  select * into v_a from public.order_cad_allocations where id = v_d.allocation_id;

  if p_decided_on is null then
    raise exception using errcode = 'P0001', message = 'Decision Date is required.';
  end if;
  if p_decided_on > public.work_flow_today() then
    raise exception using errcode = 'P0001', message = 'Decision Date cannot be in the future.';
  end if;
  if p_decided_on < v_d.dispatch_date then
    raise exception using errcode = 'P0001',
      message = format('Decision Date cannot be before the Dispatch Date (%s).', to_char(v_d.dispatch_date, 'DD/MM/YYYY'));
  end if;
  if p_status = 'rework' and nullif(btrim(coalesce(p_comments, '')), '') is null then
    raise exception using errcode = 'P0001',
      message = 'Enter the Buyer Alteration Comments — a Rework cannot be recorded without them.';
  end if;

  -- ITEM FORM VALIDATION (spec §7): the marker's layout must match the style's.
  if p_status = 'approved' then
    select s.layout_type into v_style
      from public.garment_order_amendment_styles s
     where s.amendment_id = v_a.garment_order_id
       and upper(btrim(s.style_ref_no)) = upper(btrim(v_a.style_ref_no))
     order by s.sno limit 1;
    if v_style is not null and v_d.layout_type is not null and v_style <> v_d.layout_type then
      raise exception using errcode = 'P0001',
        message = format('Layout mismatch: the CAD marker is %s but style %s is declared %s on the order. Correct the order''s Layout Type or send the CAD back for rework.',
                         case v_d.layout_type when 'open_width' then 'Open Width' else 'Tubular' end,
                         v_a.style_ref_no,
                         case v_style when 'open_width' then 'Open Width' else 'Tubular' end);
    end if;
  end if;

  update public.order_cad_approvals
     set status = p_status, decided_on = p_decided_on,
         buyer_comments = nullif(btrim(coalesce(p_comments, '')), ''),
         decided_by = auth.uid(), updated_at = now()
   where id = v_ap.id;
  update public.order_cad_allocations
     set is_submitted = (p_status = 'approved')
   where id = v_a.id;

  perform public.cad_work_flow_sync(v_a.garment_order_id);
end $$;

-- UNDO A DISPATCH recorded by mistake — only while the buyer has not answered.
-- Returns the storage paths so the caller can remove the objects.
create or replace function public.cad_undo_dispatch(p_dispatch uuid)
returns setof text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_status text;
  v_paths  text[];
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to undo a CAD dispatch.';
  end if;
  select ap.status into v_status from public.order_cad_approvals ap where ap.dispatch_id = p_dispatch for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'That CAD dispatch no longer exists.';
  end if;
  if v_status <> 'pending' then
    raise exception using errcode = 'P0001',
      message = 'The buyer''s decision is already recorded — reopen the decision before undoing the dispatch.';
  end if;
  select coalesce(array_agg(f.storage_path), '{}') into v_paths
    from public.order_cad_dispatch_files f where f.dispatch_id = p_dispatch;
  delete from public.order_cad_dispatches where id = p_dispatch;
  return query select unnest(v_paths);
end $$;

-- REOPEN A DECISION back to Pending — only while no later version exists
-- (a Rework already followed by v(n+1) is history the new version builds on).
create or replace function public.cad_reopen_decision(p_dispatch uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a public.order_cad_allocations%rowtype;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using errcode = '42501', message = 'You do not have permission to reopen a CAD decision.';
  end if;
  select a.* into v_a
    from public.order_cad_allocations a
    join public.order_cad_dispatches d on d.allocation_id = a.id
   where d.id = p_dispatch;
  if not found then
    raise exception using errcode = 'P0001', message = 'That CAD dispatch no longer exists.';
  end if;
  if exists (select 1 from public.order_cad_allocations n
              where n.garment_order_id = v_a.garment_order_id
                and upper(btrim(n.style_ref_no)) = upper(btrim(v_a.style_ref_no))
                and n.version_no > v_a.version_no) then
    raise exception using errcode = 'P0001',
      message = format('Version %s of style %s already exists — the decision on version %s can no longer be reopened.',
                       v_a.version_no + 1, v_a.style_ref_no, v_a.version_no);
  end if;
  update public.order_cad_approvals
     set status = 'pending', decided_on = null, decided_by = auth.uid(), updated_at = now()
   where dispatch_id = p_dispatch;
  update public.order_cad_allocations set is_submitted = false where id = v_a.id;
end $$;


-- ----------------------------------------------------------------------------
-- 8. THE FABRIC BOM GUARD (spec §7). On the TABLE, so the screen, the CAD
--    seed, a copy and any future import all meet it. Only CREATION is
--    refused — a Fabric BOM that already exists keeps saving.
--
--    It stands down for a revision REVERT in progress (0619's reverting_txid),
--    which re-inserts the approved V0 BOM exactly as it was.
-- ----------------------------------------------------------------------------
create or replace function public.cad_guard_fabric_bom()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_open text;
begin
  if exists (select 1 from public.order_budget_revisions r where r.reverting_txid = txid_current()) then
    return new;
  end if;
  if new.garment_order_id is null or public.cad_order_ready(new.garment_order_id) then
    return new;
  end if;
  select string_agg(s.style_ref_no || ' (' ||
           case s.state when 'not_allocated' then 'not allocated'
                        when 'allocated'     then 'not dispatched'
                        when 'pending'       then 'awaiting buyer'
                        when 'rework'        then 'rework required'
                        else s.state end || ')', ', ')
    into v_open
    from public.cad_style_states(new.garment_order_id) s
   where s.state <> 'approved';
  raise exception using errcode = 'P0001', hint = 'cad_not_submitted',
    message = 'The CAD is not approved for every style of this order, so a Fabric BOM cannot be created yet'
      || coalesce(' — ' || v_open, ' — the order has no styles')
      || '. Approve it on Orders ▸ CAD ▸ CAD Lifecycle first.';
end $$;

drop trigger if exists trg_ofb_cad_guard on public.order_fabric_boms;
create trigger trg_ofb_cad_guard
  before insert on public.order_fabric_boms
  for each row execute function public.cad_guard_fabric_bom();


-- ----------------------------------------------------------------------------
-- 9. Grants and RLS.
-- ----------------------------------------------------------------------------
revoke all on function public.cad_style_states(uuid)              from public, anon;
revoke all on function public.cad_order_ready(uuid)               from public, anon;
revoke all on function public.cad_allocation_before_write()       from public, anon, authenticated;
revoke all on function public.cad_allocation_before_delete()      from public, anon, authenticated;
revoke all on function public.cad_guard_fabric_bom()              from public, anon, authenticated;
revoke all on function public.cad_dispatch(uuid, date, text, timestamptz, text, text, jsonb) from public, anon;
revoke all on function public.cad_decide(uuid, text, date, text)  from public, anon;
revoke all on function public.cad_undo_dispatch(uuid)             from public, anon;
revoke all on function public.cad_reopen_decision(uuid)           from public, anon;
grant execute on function public.cad_style_states(uuid)              to authenticated;
grant execute on function public.cad_order_ready(uuid)               to authenticated;
grant execute on function public.cad_dispatch(uuid, date, text, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.cad_decide(uuid, text, date, text)  to authenticated;
grant execute on function public.cad_undo_dispatch(uuid)             to authenticated;
grant execute on function public.cad_reopen_decision(uuid)           to authenticated;

alter table public.order_cad_allocations    enable row level security;
alter table public.order_cad_dispatches     enable row level security;
alter table public.order_cad_dispatch_files enable row level security;
alter table public.order_cad_approvals      enable row level security;

drop policy if exists oca_read   on public.order_cad_allocations;
drop policy if exists oca_insert on public.order_cad_allocations;
drop policy if exists oca_update on public.order_cad_allocations;
drop policy if exists oca_delete on public.order_cad_allocations;
create policy oca_read   on public.order_cad_allocations for select to authenticated
  using (public.has_permission('orders','view'));
create policy oca_insert on public.order_cad_allocations for insert to authenticated
  with check (public.has_permission('orders','edit'));
create policy oca_update on public.order_cad_allocations for update to authenticated
  using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
create policy oca_delete on public.order_cad_allocations for delete to authenticated
  using (public.has_permission('orders','edit'));

drop policy if exists ocd_read on public.order_cad_dispatches;
create policy ocd_read on public.order_cad_dispatches for select to authenticated
  using (public.has_permission('orders','view'));
drop policy if exists ocdf_read on public.order_cad_dispatch_files;
create policy ocdf_read on public.order_cad_dispatch_files for select to authenticated
  using (public.has_permission('orders','view'));
drop policy if exists ocap_read on public.order_cad_approvals;
create policy ocap_read on public.order_cad_approvals for select to authenticated
  using (public.has_permission('orders','view'));

revoke all on public.order_cad_allocations, public.order_cad_dispatches,
              public.order_cad_dispatch_files, public.order_cad_approvals from anon;
revoke insert, update, delete on public.order_cad_dispatches, public.order_cad_dispatch_files,
                                 public.order_cad_approvals from authenticated;
grant select on public.order_cad_dispatches, public.order_cad_dispatch_files,
                public.order_cad_approvals to authenticated;
-- Allocations: the operator writes who / what / by when; the trigger owns the
-- version, the date and is_submitted.
revoke insert, update on public.order_cad_allocations from authenticated;
grant select, delete on public.order_cad_allocations to authenticated;
grant insert (garment_order_id, style_ref_no, pattern_maker_id, cad_type, target_date, remarks)
  on public.order_cad_allocations to authenticated;
grant update (pattern_maker_id, cad_type, target_date, remarks)
  on public.order_cad_allocations to authenticated;


-- ----------------------------------------------------------------------------
-- VERIFY (run by hand)
--   select * from public.work_flow_milestone_defaults();           -- 8 rows
--   select code, sn from public.order_work_flow_milestones order by sales_order_id, sn;
--   select proname, proacl from pg_proc where proname like 'cad\_%';  -- no anon
--   select public.cad_order_ready(id) from public.garment_order_amendments limit 5;
-- ----------------------------------------------------------------------------
