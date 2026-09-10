-- ============================================================================
-- Raagam ERP — 0547 Orders ▸ T&A ▸ per-activity staff ownership + on-time KPI
--
-- `lib/ta/worklist.ts` already answers "what does MY DEPARTMENT owe today" —
-- this migration is what lets it also answer "what do *I, personally* owe
-- today", and what lets a manager ask "how on-time has this person's work
-- been this month" for the MRM review.
--
-- ## `assigned_staff_id` IS A REFINEMENT OF THE EXISTING SCOPE, NOT A NEW ONE
--
-- The department mapping (`ta_department_assign_lines` / `ta_activities.
-- department`, see `activityDepartments()` in worklist.ts) stays exactly as
-- it is and is NOT superseded: a row with `assigned_staff_id is null` is
-- still every eligible department member's row, same as today. Setting this
-- column narrows ONE row to ONE person; it never widens past what the
-- department mapping already allowed, and it is never required — an order
-- can be scheduled and worked with nobody ever claiming a row by name.
--
-- References `employees`, never `profiles`. `profiles` is the login;
-- `employees` is the person, and `ta_department_assign_lines` /
-- `garment_order_amendments.merchandiser_id` (0478) both already point there
-- for the same reason — see 0478's own header on why the other two
-- candidates lose. `on delete set null`, the same call `activity_id` already
-- makes on this table: an employee record leaving must not silently delete a
-- step out of a live order's ladder, taking its history with it.
--
-- ## `delay_attribution` IS A CHECK CONSTRAINT, THE SAME SHAPE AS `status`
--
-- Four spellings, not a Postgres ENUM — copying 0481's own choice for
-- `status` on this exact table, for the same reason: a CHECK is exercised
-- and asserted from the catalog the same way, where an ENUM's members are a
-- second place this vocabulary could drift from `status`'s. `none` is the
-- default: most activities finish on or before `target_date` and never need
-- an opinion about who caused a delay that did not happen.
--
-- NOT a new `status` value. 0481's header and 0540 (bypass tracking) both
-- already made this argument once each for this table — a completed-but-late
-- activity is still `status = 'done'`; delay_attribution is an independent
-- fact ABOUT a completion, not a replacement for one.
--
-- ## NO `delay_days` COLUMN
--
-- `actual_date - target_date` on a `done` row. This repo's house rule
-- (`chain.ts`, and 0481's own header quoting it: "a value that can be
-- derived is derived") — there is no dashboard query here of the shape
-- `target_date` exists for ("what is due today across every open order,
-- without loading every order's schedule"), so nothing forces a stored
-- copy. `staff_ta_kpi` below computes it on the fly.
--
-- ## `staff_ta_kpi` — COMPUTED ON DEMAND, NEVER A STORED MONTHLY SNAPSHOT
--
-- Same house rule again, at the feature level this time rather than the
-- column level: a monthly aggregate table needs a job to keep it in sync and
-- a reconciliation story for the day that job does not run. This aggregates
-- `garment_order_amendment_ta_activities` directly for whatever range is
-- asked for, so there is nothing to fall out of sync with the rows it reads.
--
-- Evaluated ONLY over COMPLETED rows (`actual_date is not null`) — a row
-- still open has not produced an outcome yet, and folding it into the
-- denominator as neither a pass nor a fail would understate the score for no
-- reason connected to performance. `still_open` is returned alongside so a
-- 100% score over 2 completed rows and 41 still pending reads as the
-- provisional figure it is, rather than a confident one — the same "an empty
-- result must say why" discipline `worklist.ts` already applies to a zero
-- row.
--
-- `on_time_score_percentage` EXCLUDES buyer-attributed delays from the
-- denominator (the spec's own formula: staff should not be marked down for a
-- buyer sitting on an approval). `avg_delay_days` does NOT exclude them — it
-- answers a different, attribution-blind question ("how many days late is
-- work actually landing"), and folding the same exclusion into both figures
-- would make a genuine operational lag invisible everywhere at once.
--
-- ## THE PERMISSION CHECK IS IN THE FUNCTION, NOT IN RLS
--
-- `garment_order_amendment_ta_activities`'s RLS (0481) is a single blanket
-- `has_permission('orders','view')` for SELECT — it does not scope rows to
-- the caller's own department or assignment, that narrowing is application
-- code (`worklist.ts`). So a `SECURITY INVOKER` function would let anyone
-- with plain `orders:view` pass any `p_staff_id` and read a colleague's
-- score. This function is `SECURITY DEFINER` instead and enforces the rule
-- itself: a caller may always ask for their OWN figure; asking for someone
-- else's, or for every staff member's (`p_staff_id` null), requires
-- `orders:export` — already held by Manager / Managing Director /
-- Administrator and not by Merchandiser or ordinary staff (0002 seed), so
-- this needed no new permission row.
--
-- `SECURITY DEFINER` is also why `profiles`/`employees` are safely joined
-- inside it: `profiles` is admin-only-readable RLS (see
-- `ta-user-rights/service.ts`'s own comment), and resolving "which employee
-- is the CALLER" needs to read the caller's own `profiles` row regardless of
-- that policy — the same reason `has_permission()` itself is
-- `SECURITY DEFINER`.
-- ============================================================================

alter table public.garment_order_amendment_ta_activities
  add column if not exists assigned_staff_id uuid
    references public.employees(id) on delete set null,
  add column if not exists delay_attribution text not null default 'none';

comment on column public.garment_order_amendment_ta_activities.assigned_staff_id is
  'The one person this row is on today, if anyone has claimed it (0547). NULL = every eligible department member''s row, exactly as before this column existed — see ta_department_assign_lines / activityDepartments() in lib/ta/worklist.ts, which this REFINES and does not replace.';

comment on column public.garment_order_amendment_ta_activities.delay_attribution is
  'none | internal_staff | buyer_delay | material_supplier (0547). Set when the activity is completed LATE; meaningless while actual_date is null or actual_date <= target_date. Independent of status, the same way bypassed_qty (0540) is — never a 5th status value.';

alter table public.garment_order_amendment_ta_activities
  drop constraint if exists garment_order_amendment_ta_activities_delay_attribution_check;

alter table public.garment_order_amendment_ta_activities
  add constraint garment_order_amendment_ta_activities_delay_attribution_check
  check (delay_attribution in ('none','internal_staff','buyer_delay','material_supplier'));

-- THE PERSONAL-QUEUE INDEX, the same reason idx_goa_ta_activities_due (0481)
-- exists: "what is due today, FOR ME" over every open order must not be a
-- sequential scan of every activity ever entered.
create index if not exists idx_goa_ta_activities_assignee
  on public.garment_order_amendment_ta_activities (assigned_staff_id, target_date);


-- ----------------------------------------------------------------------------
-- staff_ta_kpi — on demand, per staff or, with orders:export, for everyone.
-- ----------------------------------------------------------------------------

create or replace function public.staff_ta_kpi(
  p_from      date,
  p_to        date,
  p_staff_id  uuid default null,
  p_caller_id uuid default auth.uid()
)
returns table (
  staff_id                    uuid,
  staff_name                  text,
  total_assigned              int,
  still_open                  int,
  completed_on_time           int,
  completed_late              int,
  buyer_attributed_delays     int,
  on_time_score_percentage    numeric,
  avg_delay_days              numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_employee_id uuid;
  v_can_see_others     boolean;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'staff_ta_kpi: p_from/p_to must be a valid, non-empty date range'
      using errcode = '22007';
  end if;

  select e.id into v_caller_employee_id
    from public.profiles pr
    join public.employees e on e.code = pr.employee_code
   where pr.id = p_caller_id
   limit 1;

  v_can_see_others := public.has_permission('orders', 'export', p_caller_id);

  if p_staff_id is not null
     and p_staff_id is distinct from v_caller_employee_id
     and not v_can_see_others then
    raise exception 'staff_ta_kpi: not permitted to view another staff member''s KPI'
      using errcode = '42501';
  end if;

  if p_staff_id is null and not v_can_see_others then
    -- No blanket view permitted: fall back to the caller's own figure rather
    -- than refusing outright — an unlinked login (no employee_code) legally
    -- gets zero rows back, same "absent, not denied" shape worklist.ts uses
    -- for a profile with no department.
    p_staff_id := v_caller_employee_id;
  end if;

  -- LEFT JOIN, deliberately: a specific staff member with zero assigned
  -- activities in range must still come back as one row of zeros/nulls, not
  -- as an empty result set the caller cannot tell apart from a broken query
  -- ("an empty result must say why" — see worklist.ts). Every filter below
  -- therefore tests `t.id is not null` explicitly rather than relying on
  -- `t.actual_date is null` to mean "still open" — for the synthetic
  -- no-match row LEFT JOIN produces, t.actual_date is ALSO null, and without
  -- the t.id guard that row would misreport itself as one open task.
  return query
  select
    e.id,
    e.name,
    count(t.id)::int as total_assigned,
    count(*) filter (where t.id is not null and t.actual_date is null)::int as still_open,
    count(*) filter (where t.actual_date is not null and t.actual_date <= t.target_date)::int as completed_on_time,
    count(*) filter (where t.actual_date is not null and t.actual_date > t.target_date)::int as completed_late,
    count(*) filter (
      where t.actual_date is not null and t.actual_date > t.target_date
        and t.delay_attribution = 'buyer_delay'
    )::int as buyer_attributed_delays,
    case
      when count(*) filter (
        where t.actual_date is not null
          and not (t.actual_date > t.target_date and t.delay_attribution = 'buyer_delay')
      ) = 0 then null
      else round(
        100.0 * count(*) filter (where t.actual_date is not null and t.actual_date <= t.target_date)
        / count(*) filter (
            where t.actual_date is not null
              and not (t.actual_date > t.target_date and t.delay_attribution = 'buyer_delay')
          ),
        2
      )
    end as on_time_score_percentage,
    case
      when count(*) filter (where t.actual_date is not null and t.actual_date > t.target_date) = 0 then null
      else round(
        avg(t.actual_date - t.target_date) filter (
          where t.actual_date is not null and t.actual_date > t.target_date
        ),
        2
      )
    end as avg_delay_days
  from public.employees e
  left join public.garment_order_amendment_ta_activities t
    on t.assigned_staff_id = e.id
   and t.target_date between p_from and p_to
  where (p_staff_id is null and e.inactive = false) or e.id = p_staff_id
  group by e.id, e.name
  -- A specific target always comes back, even with nothing assigned; the
  -- "everyone" listing (p_staff_id null) drops anyone with no assigned row
  -- in range rather than padding the MRM report with the whole employee
  -- roster.
  having p_staff_id is not null or count(t.id) > 0
  order by e.name;
end;
$$;

comment on function public.staff_ta_kpi(date, date, uuid, uuid) is
  'On-time completion KPI for T&A activities assigned to a staff member, over [p_from, p_to] by target_date, computed on demand (0547) — never a stored snapshot. p_staff_id null: every staff member if the caller holds orders:export, else the caller''s own row only. SECURITY DEFINER — enforces that visibility rule itself, since this table''s RLS is a blanket orders:view with no per-row scoping.';

-- AGENTS.md, "Function grants (STANDING)" — always both, in one statement,
-- verified from the catalog and never assumed from the migration having run.
revoke all on function public.staff_ta_kpi(date, date, uuid, uuid) from public, anon;
grant execute on function public.staff_ta_kpi(date, date, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- assertions
-- ---------------------------------------------------------------------------

do $assert$
declare
  col_count int;
begin
  select count(*) into col_count
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'garment_order_amendment_ta_activities'
     and column_name  in ('assigned_staff_id', 'delay_attribution');
  if col_count <> 2 then
    raise exception '0547: expected both new columns, found %', col_count;
  end if;

  -- status (0481) and the bypass columns (0540) must be untouched.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_ta_activities'::regclass
       and conname  = 'garment_order_amendment_ta_activities_status_check'
       and pg_get_constraintdef(oid) = $$CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'done'::text])))$$
  ) then
    raise exception '0547: the status CHECK changed shape — delay_attribution must never become a 4th status value';
  end if;

  -- a 5th delay_attribution spelling must be refused. Read the constraint's
  -- own definition rather than probing with a write — `where false` never
  -- reaches a row, so an UPDATE that matches nothing would prove nothing.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_ta_activities'::regclass
       and conname  = 'garment_order_amendment_ta_activities_delay_attribution_check'
       and pg_get_constraintdef(oid) = $$CHECK ((delay_attribution = ANY (ARRAY['none'::text, 'internal_staff'::text, 'buyer_delay'::text, 'material_supplier'::text])))$$
  ) then
    raise exception '0547: the delay_attribution CHECK does not name exactly the four expected values';
  end if;

  if not has_function_privilege('authenticated', 'public.staff_ta_kpi(date,date,uuid,uuid)', 'execute') then
    raise exception '0547: authenticated cannot execute staff_ta_kpi';
  end if;
  if has_function_privilege('anon', 'public.staff_ta_kpi(date,date,uuid,uuid)', 'execute') then
    raise exception '0547: staff_ta_kpi is anon-callable';
  end if;

  -- `has_function_privilege` takes a real role name — 'public' is a pseudo-
  -- role, not a row in pg_roles, and passing it as a role argument raises
  -- rather than answers. `scripts/check-anon-grants.sql` (CHECK 2) makes the
  -- same point: the only way to know the implicit PUBLIC-EXECUTE default was
  -- actually revoked, rather than merely intended, is that the function's
  -- ACL is no longer NULL — a null proacl IS the built-in default with PUBLIC
  -- still holding EXECUTE.
  if not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'staff_ta_kpi' and p.proacl is not null
  ) then
    raise exception '0547: staff_ta_kpi has no explicit ACL — the built-in PUBLIC EXECUTE default was never revoked';
  end if;

  raise notice '0547: ok — assigned_staff_id + delay_attribution added, status CHECK untouched, staff_ta_kpi defined and granted to authenticated only';
end $assert$;
