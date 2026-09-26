-- 0629 — HR STAFF FINE & SALARY DEDUCTION WORKFLOW (doc/order/punishment fine.md)
--
-- A fine is a DOCUMENT with a lifecycle, never an automatic trigger:
--
--   draft ──submit (confirmed)──▶ pending ──engine completes──▶ approved
--     │                             ├──────engine rejects──────▶ rejected
--     └──abandon──▶ abandoned ◀─────┴──requester cancels run───┘
--
-- Only `approved` rows are ever read by payroll. `rejected` / `abandoned` rows
-- stay for audit and are excluded from every sum by construction (the payroll
-- function filters on status = 'approved' and nothing else).
--
-- WHERE EACH RULE OF THE SPEC IS ENFORCED — in the database, so a stale tab,
-- a second window or a hand-written PostgREST call is refused the same way the
-- screen is ("the server refuses even if the screen is bypassed"):
--
--   §2 lock on submit ......... hr_fine_guard: a pending/approved/rejected/
--                               abandoned row's content never changes; the
--                               only ways OUT of pending are the engine's
--                               terminal trigger (approve/reject/cancel).
--   §3 confirmation toggle .... hr_fine_submit(p_confirmed) refuses false.
--   §3 mandatory remarks ...... CHECK (btrim(remarks) <> '').
--   §4 schema ................. hr_staff_fine_deductions + indexes.
--   §5 approver MD / HR Mgr ... flow step resolver 'md_or_hr_manager' AND a
--                               re-check inside hr_fine_apply_decision.
--   §5 payroll lock ........... advisory xact lock on (staff, month) + refusal
--                               when that month's staff payroll is already
--                               approved / locked / paid.
--   §5 inactive staff ......... refused on insert, edit, submit and approve.
--   §5 idempotency ............ partial unique index on (staff, incident ref)
--                               over live rows + a pre-flight at approval.
--   §5 amount ≤ 0 ............. CHECK (fine_amount > 0).
--   §6 net formula / cap ...... hr_payroll_apply_fines: net = gross − ESI −
--                               PF − approved fines, capped at
--                               payroll_settings.max_fine_pct of gross; the
--                               excess is NOT deducted and the line is flagged
--                               fine_review, so a net can never go negative.
--   §6 isolated recalculation . approval re-applies fines to that ONE staff
--                               line in any open (draft/calculated) run.
--   §7 immutable audit log .... hr_staff_fine_events, written by trigger with
--                               clock_timestamp(); UPDATE/DELETE refused.
--
-- `staff_incident_id` (spec §4) is realised as `incident_ref` + `incident_date`:
-- there is no incidents table to point a uuid at, and an operator cannot type
-- one. The uniqueness the spec wants ("prevents duplicate fines for the same
-- incident") is the partial unique index below.

-- ─── Settings / payroll columns ─────────────────────────────────────────────

alter table public.payroll_settings
  add column if not exists max_fine_pct numeric(5,2) not null default 25
    check (max_fine_pct > 0 and max_fine_pct <= 100);

alter table public.payroll_lines
  add column if not exists fine_deduction numeric(12,2) not null default 0,
  add column if not exists fine_over_cap  numeric(12,2) not null default 0,
  add column if not exists fine_review    boolean       not null default false;

-- A fine recovered from salary is income to the company, not a smaller wage
-- bill: the wage expense stays at gross and the recovery is credited here, so
-- the payroll journal still balances (Dr gross = Cr net + ESI + PF + fines).
insert into public.gl_accounts (code, name, account_type)
select '4100', 'Staff Fine Recoveries',
       coalesce((select account_type from public.gl_accounts where code = '4000'), 'income')
where not exists (select 1 from public.gl_accounts where code = '4100');

-- ─── The document ───────────────────────────────────────────────────────────

create sequence if not exists public.seq_hr_fine;

create table if not exists public.hr_staff_fine_deductions (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  staff_id         uuid not null references public.staff(id),
  incident_ref     text not null check (btrim(incident_ref) <> ''),
  incident_date    date not null,
  deduction_month  date not null check (deduction_month = date_trunc('month', deduction_month)::date),
  deduction_mode   text not null default 'direct'
                   check (deduction_mode in ('direct', 'days', 'percent')),
  days_of_pay      numeric(6,2) check (days_of_pay is null or days_of_pay > 0),
  pct_of_gross     numeric(5,2) check (pct_of_gross is null or (pct_of_gross > 0 and pct_of_gross <= 100)),
  basis_salary     numeric(12,2),
  fine_amount      numeric(10,2) not null check (fine_amount > 0),
  status           text not null default 'draft'
                   check (status in ('draft', 'pending', 'approved', 'rejected', 'abandoned')),
  is_submitted     boolean not null default false,
  remarks          text not null check (btrim(remarks) <> ''),
  decision_remark  text,
  submitted_by     uuid,
  submitted_at     timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  decided_by       uuid,
  decided_at       timestamptz,
  abandoned_by     uuid,
  abandoned_at     timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint hr_fine_submitted_matches_status check (is_submitted = (status <> 'draft')),
  constraint hr_fine_days_mode    check (deduction_mode <> 'days'    or days_of_pay  is not null),
  constraint hr_fine_percent_mode check (deduction_mode <> 'percent' or pct_of_gross is not null)
);

create index if not exists idx_fine_staff_id on public.hr_staff_fine_deductions (staff_id);
create index if not exists idx_fine_status   on public.hr_staff_fine_deductions (status);
create index if not exists idx_fine_month    on public.hr_staff_fine_deductions (deduction_month);

-- ONE LIVE FINE PER INCIDENT. Rejected and abandoned rows fall out of the index,
-- so an incident whose fine was thrown out can be raised again correctly —
-- and the thrown-out row is still there for the audit.
create unique index if not exists uq_hr_fine_incident
  on public.hr_staff_fine_deductions (staff_id, upper(btrim(incident_ref)))
  where status in ('draft', 'pending', 'approved');

drop trigger if exists trg_hr_fine_code on public.hr_staff_fine_deductions;
create trigger trg_hr_fine_code before insert on public.hr_staff_fine_deductions
  for each row execute function public.assign_code('FINE', 'public.seq_hr_fine');

-- ─── The immutable event log (§7) ───────────────────────────────────────────

create table if not exists public.hr_staff_fine_events (
  id           uuid primary key default gen_random_uuid(),
  fine_id      uuid not null,             -- no FK: a deleted draft keeps its log
  change_type  text not null check (change_type in (
                 'initial_entry', 'draft_edit', 'manager_review',
                 'approval', 'rejection_revert', 'abandon_revert', 'draft_deleted')),
  from_status  text,
  to_status    text,
  fine_amount  numeric(10,2),
  actor_id     uuid,
  remark       text,
  created_at   timestamptz not null default clock_timestamp()
);
create index if not exists idx_fine_events_fine on public.hr_staff_fine_events (fine_id, created_at);

create or replace function public.hr_fine_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'hr_staff_fine_events is an audit log — rows cannot be changed or removed'
    using errcode = '42501';
end $$;

drop trigger if exists trg_hr_fine_events_immutable on public.hr_staff_fine_events;
create trigger trg_hr_fine_events_immutable before update or delete on public.hr_staff_fine_events
  for each row execute function public.hr_fine_events_immutable();

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Refuses a fine against a staff member who is inactive or blocked (§5).
create or replace function public.hr_fine_assert_staff_active(p_staff_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_ok boolean;
begin
  select s.is_active and not coalesce(s.blocked, false) into v_ok
    from public.staff s where s.id = p_staff_id;
  if v_ok is null then
    raise exception 'Staff member not found' using errcode = '23503';
  end if;
  if not v_ok then
    raise exception 'This staff member is inactive — a fine cannot be raised or approved against them'
      using errcode = '23514';
  end if;
end $$;

-- The staff payroll for this person's month is past the point of change.
create or replace function public.hr_fine_payroll_closed(p_staff_id uuid, p_month date)
returns text language sql stable security definer set search_path = '' as $$
  select r.code
    from public.payroll_runs r
    join public.staff s on s.id = p_staff_id
   where r.run_kind = 'staff'
     and r.status in ('approved', 'locked', 'paid')
     and p_month between date_trunc('month', r.period_start)::date and r.period_end
     and (r.location_id is null or r.location_id = s.location_id)
   limit 1
$$;

-- ─── Guard: lock, derive, refuse (§2, §3, §5) ───────────────────────────────

create or replace function public.hr_fine_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_salary numeric;
  v_days   int;
  v_decide boolean := coalesce(current_setting('raagam.hr_fine_decision', true), '') = 'on';
  v_submit boolean := coalesce(current_setting('raagam.hr_fine_submit',   true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft fine can be deleted — a submitted fine is kept for the audit. Abandon it instead.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- A fine is BORN a draft. Nothing may insert an approved row directly.
    new.status       := 'draft';
    new.is_submitted := false;
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by  := null; new.approved_at  := null;
    new.decided_by   := null; new.decided_at   := null;
    new.abandoned_by := null; new.abandoned_at := null;
    new.decision_remark := null;
    new.created_by   := coalesce(new.created_by, auth.uid());
  else
    -- ── UPDATE ──
    if old.status in ('approved', 'rejected', 'abandoned') then
      raise exception 'This fine is % and locked — it is a read-only record now', old.status
        using errcode = '42501';
    end if;

    if old.status = 'pending' then
      if (new.staff_id, new.incident_ref, new.incident_date, new.deduction_month,
          new.deduction_mode, new.days_of_pay, new.pct_of_gross, new.fine_amount, new.remarks)
         is distinct from
         (old.staff_id, old.incident_ref, old.incident_date, old.deduction_month,
          old.deduction_mode, old.days_of_pay, old.pct_of_gross, old.fine_amount, old.remarks) then
        raise exception 'This fine is awaiting MD / HR Manager approval and is locked'
          using errcode = '42501';
      end if;
      if new.status is distinct from old.status and not v_decide then
        raise exception 'A submitted fine is decided only through its approval — approve, reject or cancel it there'
          using errcode = '42501';
      end if;
      if new.status = 'draft' then
        raise exception 'A submitted fine cannot go back to draft' using errcode = '42501';
      end if;
      new.updated_at := now();
      return new;
    end if;

    -- old.status = 'draft'
    if new.status = 'pending' and not v_submit then
      raise exception 'Submit a fine with hr_fine_submit — it records the confirmation and starts the approval together'
        using errcode = '42501';
    end if;
    if new.status in ('approved', 'rejected') then
      raise exception 'A draft fine must be submitted before it can be decided' using errcode = '42501';
    end if;
    if new.status = 'abandoned' then
      new.is_submitted := true;   -- abandoned is terminal; the flag marks "left draft"
      new.abandoned_by := coalesce(new.abandoned_by, auth.uid());
      new.abandoned_at := coalesce(new.abandoned_at, now());
      new.updated_at   := now();
      return new;
    end if;
    new.updated_at := now();
  end if;

  -- Content rules for a draft (insert, edit, or the submit itself).
  perform public.hr_fine_assert_staff_active(new.staff_id);
  new.incident_ref := upper(btrim(new.incident_ref));
  new.remarks      := upper(btrim(new.remarks));

  -- DIRECT vs CALCULATED (§3). The calculated modes DERIVE the amount here,
  -- from the salary on the staff master, so the screen's preview can never be
  -- the figure that is stored — the same rule as a BOM's computed columns.
  if new.deduction_mode = 'direct' then
    new.days_of_pay  := null;
    new.pct_of_gross := null;
    new.basis_salary := null;
  else
    select s.monthly_salary into v_salary from public.staff s where s.id = new.staff_id;
    if coalesce(v_salary, 0) <= 0 then
      raise exception 'This staff member has no monthly salary on the master, so a days / percentage fine cannot be calculated — enter a direct amount'
        using errcode = '23514';
    end if;
    new.basis_salary := v_salary;
    if new.deduction_mode = 'days' then
      new.pct_of_gross := null;
      v_days := extract(day from (new.deduction_month + interval '1 month - 1 day'))::int;
      new.fine_amount := round(v_salary / v_days * new.days_of_pay, 2);
    else
      new.days_of_pay := null;
      new.fine_amount := round(v_salary * new.pct_of_gross / 100, 2);
    end if;
  end if;

  if new.fine_amount is null or new.fine_amount <= 0 then
    raise exception 'The fine amount must be greater than zero' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_hr_fine_guard on public.hr_staff_fine_deductions;
create trigger trg_hr_fine_guard before insert or update or delete on public.hr_staff_fine_deductions
  for each row execute function public.hr_fine_guard();

-- ─── Event writer (§7) ──────────────────────────────────────────────────────

create or replace function public.hr_fine_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type  text;
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    v_type := 'initial_entry';
  elsif tg_op = 'DELETE' then
    insert into public.hr_staff_fine_events (fine_id, change_type, from_status, to_status, fine_amount, actor_id)
    values (old.id, 'draft_deleted', old.status, null, old.fine_amount, v_actor);
    return old;
  elsif new.status is distinct from old.status then
    v_type := case new.status
      when 'pending'   then 'manager_review'
      when 'approved'  then 'approval'
      when 'rejected'  then 'rejection_revert'
      when 'abandoned' then 'abandon_revert'
    end;
    v_actor := coalesce(case when new.status in ('approved','rejected') then new.decided_by end, v_actor);
  elsif row(new.*) is distinct from row(old.*) then
    v_type := 'draft_edit';
  else
    return new;
  end if;

  insert into public.hr_staff_fine_events (fine_id, change_type, from_status, to_status, fine_amount, actor_id, remark)
  values (new.id, v_type, case when tg_op = 'UPDATE' then old.status end, new.status, new.fine_amount, v_actor,
          case when v_type in ('approval','rejection_revert') then new.decision_remark end);
  return new;
end $$;

drop trigger if exists trg_hr_fine_log on public.hr_staff_fine_deductions;
create trigger trg_hr_fine_log after insert or update or delete on public.hr_staff_fine_deductions
  for each row execute function public.hr_fine_log();

-- ─── Payroll application (§6) ───────────────────────────────────────────────
--
-- ONE implementation of the fine arithmetic, called by the payroll calculation
-- (after it writes the lines) and by an approval (for the one staff member).
-- Idempotent: it recomputes from gross / ESI / PF, never from the stored net.

create or replace function public._hr_payroll_apply_fines(p_run_id uuid, p_staff_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pct numeric := coalesce((select max_fine_pct from public.payroll_settings limit 1), 25);
begin
  with lines as (
    select l.id, l.staff_id, l.actual_gross, l.esi, l.pf, l.extra_wage,
           r.period_start, r.period_end
      from public.payroll_lines l
      join public.payroll_runs r on r.id = l.payroll_run_id
     where l.payroll_run_id = p_run_id
       and l.staff_id is not null
       and (p_staff_id is null or l.staff_id = p_staff_id)
  ),
  agg as (
    select ln.id,
           coalesce(sum(f.fine_amount), 0)::numeric as fines,
           coalesce(jsonb_agg(f.code order by f.code) filter (where f.id is not null), '[]'::jsonb) as codes,
           -- THE CAP: the configured share of gross, and never more than what is
           -- left after statutory deductions — a net salary cannot go negative.
           greatest(least(round(ln.actual_gross * v_pct / 100, 2),
                          ln.actual_gross - ln.esi - ln.pf), 0) as cap
      from lines ln
      left join public.hr_staff_fine_deductions f
        on f.staff_id = ln.staff_id
       and f.status = 'approved'
       and f.deduction_month between date_trunc('month', ln.period_start)::date and ln.period_end
     group by ln.id, ln.actual_gross, ln.esi, ln.pf
  )
  update public.payroll_lines l
     set fine_deduction = least(a.fines, a.cap),
         fine_over_cap  = greatest(a.fines - a.cap, 0),
         fine_review    = a.fines > a.cap,
         actual_net     = round(l.actual_gross - l.esi - l.pf - least(a.fines, a.cap), 2),
         total_net      = round(l.actual_gross - l.esi - l.pf - least(a.fines, a.cap) + l.extra_wage, 2),
         details        = coalesce(l.details, '{}'::jsonb)
                          || jsonb_build_object('fines', a.codes, 'fine_cap_pct', v_pct)
    from agg a
   where l.id = a.id;
end $$;

-- The callable face: payroll-edit permission, open runs only.
create or replace function public.hr_payroll_apply_fines(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.has_permission('hr_payroll', 'edit') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select status into v_status from public.payroll_runs where id = p_run_id;
  if v_status is null then
    raise exception 'Payroll run not found' using errcode = '23503';
  end if;
  if v_status not in ('draft', 'calculated') then
    raise exception 'Fines can only be applied to a draft or calculated run' using errcode = '55000';
  end if;
  perform public._hr_payroll_apply_fines(p_run_id, null);
end $$;

-- ─── Submit (§2, §3) ────────────────────────────────────────────────────────
--
-- ONE statement for "lock it and put it in the approver's queue". The status
-- write and the run start share a transaction, so a fine can never be pending
-- with no run (the stranded document budgets have to roll back by hand).

create or replace function public.hr_fine_submit(p_fine_id uuid, p_confirmed boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  f        public.hr_staff_fine_deductions;
  v_closed text;
  v_name   text;
  v_loc    uuid;
  v_run    public.approval_runs;
begin
  if not (public.has_permission('hr_payroll', 'create') or public.has_permission('hr_payroll', 'edit')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce(p_confirmed, false) then
    raise exception 'Confirm the staff member and the amount (set the confirmation to YES) before submitting'
      using errcode = '23514';
  end if;

  select * into f from public.hr_staff_fine_deductions where id = p_fine_id for update;
  if f.id is null then
    raise exception 'Fine not found' using errcode = '23503';
  end if;
  if f.status <> 'draft' then
    raise exception 'Only a draft fine can be submitted (this one is %)', f.status using errcode = '55000';
  end if;
  if btrim(coalesce(f.remarks, '')) = '' then
    raise exception 'Remarks are mandatory' using errcode = '23514';
  end if;
  perform public.hr_fine_assert_staff_active(f.staff_id);

  v_closed := public.hr_fine_payroll_closed(f.staff_id, f.deduction_month);
  if v_closed is not null then
    raise exception 'Staff payroll % for % is already approved — move this fine to a later deduction month',
      v_closed, to_char(f.deduction_month, 'Mon YYYY') using errcode = '55000';
  end if;

  perform set_config('raagam.hr_fine_submit', 'on', true);
  update public.hr_staff_fine_deductions
     set status = 'pending', is_submitted = true,
         submitted_by = auth.uid(), submitted_at = now()
   where id = p_fine_id;
  perform set_config('raagam.hr_fine_submit', '', true);

  select s.name, s.location_id into v_name, v_loc from public.staff s where s.id = f.staff_id;

  v_run := public.approval_start_run(
    'hr_fine',
    'hr_staff_fine_deductions',
    p_fine_id,
    jsonb_build_object(
      'fine_amount', f.fine_amount,
      'staff_name', v_name,
      'code', f.code,
      'deduction_month', f.deduction_month,
      'deduction_mode', f.deduction_mode
    ),
    case when v_loc is null then '{}'::jsonb else jsonb_build_object('location_id', v_loc) end,
    null,
    auth.uid()
  );
  return v_run.id;
end $$;

-- ─── The decision (§5), called from approval_apply_terminal ─────────────────

create or replace function public.hr_fine_apply_decision(
  p_fine_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f        public.hr_staff_fine_deductions;
  v_closed text;
  v_loc    uuid;
  v_run    record;
begin
  select * into f from public.hr_staff_fine_deductions where id = p_fine_id for update;
  if f.id is null or f.status <> 'pending' then
    raise exception 'Fine % is not awaiting a decision, so this approval could not be applied. Reload — it may already have been decided.',
      p_fine_id using errcode = '55000';
  end if;

  perform set_config('raagam.hr_fine_decision', 'on', true);

  if p_run_status = 'completed' then
    -- 1. PERMISSION — MD or HR Manager (a super admin may override through the
    --    engine, which already demands a written reason for it).
    if not exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = p_actor and r.name in ('Managing Director', 'HR Manager'))
       and not coalesce((select is_super_admin from public.profiles where id = p_actor), false) then
      raise exception 'Only the Managing Director or an HR Manager can approve a fine' using errcode = '42501';
    end if;

    -- 2. PAYROLL LOCK for this staff member's month: serialises approvals and
    --    a concurrent calculation for the same person-month, and refuses a
    --    month whose payroll is already approved.
    perform pg_advisory_xact_lock(hashtextextended(f.staff_id::text || f.deduction_month::text, 0));
    v_closed := public.hr_fine_payroll_closed(f.staff_id, f.deduction_month);
    if v_closed is not null then
      raise exception 'Staff payroll % for % is already approved — reject this fine and raise it against a later month',
        v_closed, to_char(f.deduction_month, 'Mon YYYY') using errcode = '55000';
    end if;

    -- 3. ACTIVE STATUS.
    perform public.hr_fine_assert_staff_active(f.staff_id);

    -- 4. IDEMPOTENCY — never charge one incident twice. The unique index
    --    already refuses a second LIVE row; this pre-flight is the spec's own
    --    (staff, amount, incident) check, kept so the refusal names the cause.
    if exists (select 1 from public.hr_staff_fine_deductions o
                where o.id <> f.id and o.status = 'approved' and o.staff_id = f.staff_id
                  and upper(btrim(o.incident_ref)) = upper(btrim(f.incident_ref))) then
      raise exception 'An approved fine for this staff member and incident already exists — this would charge it twice'
        using errcode = '23505';
    end if;

    update public.hr_staff_fine_deductions
       set status = 'approved', approved_by = p_actor, approved_at = p_at,
           decided_by = p_actor, decided_at = p_at, decision_remark = p_remark
     where id = f.id;

    -- ISOLATED RECALCULATION: only this person's line, only in open runs.
    select location_id into v_loc from public.staff where id = f.staff_id;
    for v_run in
      select r.id from public.payroll_runs r
       where r.run_kind = 'staff' and r.status in ('draft', 'calculated')
         and f.deduction_month between date_trunc('month', r.period_start)::date and r.period_end
         and (r.location_id is null or r.location_id = v_loc)
    loop
      perform public._hr_payroll_apply_fines(v_run.id, f.staff_id);
    end loop;

  elsif p_run_status = 'rejected' then
    update public.hr_staff_fine_deductions
       set status = 'rejected', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark
     where id = f.id;

  elsif p_run_status = 'cancelled' then
    update public.hr_staff_fine_deductions
       set status = 'abandoned', abandoned_by = coalesce(auth.uid(), p_actor), abandoned_at = p_at,
           decision_remark = p_remark
     where id = f.id;
  end if;

  perform set_config('raagam.hr_fine_decision', '', true);
end $$;

-- ─── Engine: resolver + terminal branch ─────────────────────────────────────

create or replace function public.approval_rbac_resolve_dynamic(p_resolver_key text, p_requester uuid, p_context jsonb default '{}'::jsonb)
returns setof uuid language plpgsql stable security definer set search_path = '' as $function$
begin
    if p_resolver_key is null or p_resolver_key = '' then
        return;
    end if;

    -- 0629 — a fine is approved by the MD OR an HR Manager (doc/order/punishment
    -- fine.md §5). A step carries one role key, so "either role" is a resolver.
    if p_resolver_key = 'md_or_hr_manager' then
        return query
          select u from public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb) u
          union
          select u from public.approval_rbac_users_with_role('HR Manager', '{}'::jsonb) u;
        return;
    end if;

    raise exception
        'approval_rbac_resolve_dynamic: resolver "%" is not implemented in Raagam. Implement it in the shim (0500) or stop referencing it from a flow step.',
        p_resolver_key
        using errcode = '0A000';
end $function$;

-- Copied from the live definition (0619 lineage) with ONE branch added for
-- hr_staff_fine_deductions, ahead of the final RAISE.
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

    -- 0629 — HR staff fine. Completed → approved, rejected → rejected,
    -- cancelled (the requester withdrew it) → abandoned. Every refusal in
    -- hr_fine_apply_decision RAISES, so the approver's action fails whole
    -- rather than the run completing over an unapplied fine.
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

-- ─── Seed: the catch-all flow ───────────────────────────────────────────────

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'hr_fine', 'HR Fine — default',
       'Catch-all. Every submitted staff fine goes to the Managing Director or an HR Manager.',
       '{}'::jsonb,
       '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb,
       900, true
where not exists (select 1 from public.approval_flows where workflow_key = 'hr_fine');

-- ─── RLS + grants ───────────────────────────────────────────────────────────

alter table public.hr_staff_fine_deductions enable row level security;
alter table public.hr_staff_fine_events     enable row level security;

drop policy if exists hr_fine_read   on public.hr_staff_fine_deductions;
drop policy if exists hr_fine_insert on public.hr_staff_fine_deductions;
drop policy if exists hr_fine_update on public.hr_staff_fine_deductions;
drop policy if exists hr_fine_delete on public.hr_staff_fine_deductions;
create policy hr_fine_read   on public.hr_staff_fine_deductions for select using (public.has_permission('hr_payroll', 'view'));
create policy hr_fine_insert on public.hr_staff_fine_deductions for insert with check (public.has_permission('hr_payroll', 'create'));
create policy hr_fine_update on public.hr_staff_fine_deductions for update
  using (public.has_permission('hr_payroll', 'edit')) with check (public.has_permission('hr_payroll', 'edit'));
create policy hr_fine_delete on public.hr_staff_fine_deductions for delete using (public.has_permission('hr_payroll', 'delete'));

drop policy if exists hr_fine_events_read on public.hr_staff_fine_events;
create policy hr_fine_events_read on public.hr_staff_fine_events for select using (public.has_permission('hr_payroll', 'view'));
revoke insert, update, delete on public.hr_staff_fine_events from anon, authenticated;

revoke all on function public.hr_fine_events_immutable()                                 from public, anon;
revoke all on function public.hr_fine_assert_staff_active(uuid)                          from public, anon, authenticated;
revoke all on function public.hr_fine_payroll_closed(uuid, date)                         from public, anon;
revoke all on function public.hr_fine_guard()                                             from public, anon;
revoke all on function public.hr_fine_log()                                               from public, anon;
revoke all on function public._hr_payroll_apply_fines(uuid, uuid)                         from public, anon, authenticated;
revoke all on function public.hr_payroll_apply_fines(uuid)                                from public, anon;
revoke all on function public.hr_fine_submit(uuid, boolean)                               from public, anon;
revoke all on function public.hr_fine_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.approval_rbac_resolve_dynamic(text, uuid, jsonb)            from public, anon;
revoke all on function public.approval_apply_terminal()                                   from public, anon;

grant execute on function public.hr_fine_payroll_closed(uuid, date)  to authenticated;
grant execute on function public.hr_payroll_apply_fines(uuid)        to authenticated;
grant execute on function public.hr_fine_submit(uuid, boolean)       to authenticated;
