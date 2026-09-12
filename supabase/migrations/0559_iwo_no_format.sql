-- ============================================================================
-- Raagam ERP — 0559 The IWO number: IWO/U2/2627/0001
--
-- doc/order/update.md §1.2: "IWO numbers are system-generated to maintain a
-- unique audit trail. Numbering Logic: IWO/[Unit]/[YY-YY]/[Serial] (e.g.,
-- IWO/U2/26-27/0001)." Today's `internal_work_orders.code` is `IWO-0001`
-- from 0024's generic `assign_code('IWO', seq_internal_work_order)` — no
-- unit, no fiscal year, and a sequence that cannot reset in April, the exact
-- wall 0395 already hit and solved for the Sales Order SC No.
--
-- THIS IS 0395's PATTERN, EXTENDED, NOT REINVENTED. `public.fiscal_year_segment`,
-- the per-(location, fy) counter table, and one composer function are the same
-- three pieces 0395 built; only the segment ORDER and the literal differ
-- (IWO/unit/fy/serial here vs unit/RE/fy/serial there), because that is what
-- the client's own example spells.
--
-- THE FY SEGMENT HAS NO HYPHEN (2627, not 26-27) — operator decision,
-- 2026-09-12: match the existing SC No spelling rather than introduce a
-- second fiscal-year format into the app. `fiscal_year_segment()` already
-- returns '2627'; nothing about it changes here.
--
-- KEYED OFF `iwo_date` (0125), NOT `created_at` — the document's own date is
-- what decides which fiscal year it belongs to (0395's rule, restated): an
-- IWO dated 31 March keyed in on 2 April numbers into the OLD year.
--
-- NO PEEK FUNCTION. 0395 built `peek_sales_order_number()` because the New
-- Order form previews the SC No before Save; `new-iwo-form.tsx` shows no such
-- preview today, so a peek here would be unused code with nothing to call it
-- — add one if/when the form grows a preview.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The counter, keyed by (location, fiscal year) — same shape as
--    `sales_order_no_counters` (0395), same reasoning for why it is a real
--    table rather than a sequence: a sequence cannot reset every April, and
--    is not RLS-protected the way a table is.
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_no_counters (
  location_id uuid not null references public.locations(id),
  fy          text not null,
  last_no     int  not null default 0,
  primary key (location_id, fy)
);

alter table public.iwo_no_counters enable row level security;

drop policy if exists iwo_no_counters_read on public.iwo_no_counters;
create policy iwo_no_counters_read on public.iwo_no_counters
  for select to authenticated using (public.has_permission('orders', 'view'));

drop policy if exists iwo_no_counters_insert on public.iwo_no_counters;
create policy iwo_no_counters_insert on public.iwo_no_counters
  for insert to authenticated with check (public.has_permission('orders', 'create'));

drop policy if exists iwo_no_counters_update on public.iwo_no_counters;
create policy iwo_no_counters_update on public.iwo_no_counters
  for update to authenticated
  using (public.has_permission('orders', 'create'))
  with check (public.has_permission('orders', 'create'));

comment on table public.iwo_no_counters is
  'Running IWO number per (location, fiscal year), same shape as '
  'sales_order_no_counters (0395). Resets each April by virtue of a new fy '
  'key rather than by anything resetting it. No DELETE policy: dropping a '
  'row restarts that branch at 0001 and mints duplicates.';


-- ---------------------------------------------------------------------------
-- 2. The format, once. IMMUTABLE and total, same reasoning as
--    `sales_order_no_format` (0395): the assigner is the only caller today,
--    but a second caller (a future peek) must never be able to show a
--    different string from the one saved.
--
--    THE PAD IS A FLOOR, NOT A WIDTH, restating 0395's own caught bug:
--    `greatest(4, length(...))` is what stops `lpad` truncating a 5-digit
--    serial into a collision with an earlier one.
-- ---------------------------------------------------------------------------
create or replace function public.iwo_no_format(
  p_location_code text,
  p_fy            text,
  p_next          int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select 'IWO/' || p_location_code || '/' || p_fy || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.iwo_no_format(text, text, int) is
  'Composes an IWO number: U2 + 2627 + 1 -> IWO/U2/2627/0001 (doc/order/'
  'update.md §1.2). The 4-digit pad is a FLOOR, not a width — bare lpad() '
  'would truncate order 12345 to 1234 and duplicate an existing IWO number, '
  'the exact bug 0395''s sales_order_no_format caught on its first apply.';

revoke all on function public.iwo_no_format(text, text, int) from public, anon;
grant execute on function public.iwo_no_format(text, text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. The assigner — replaces 0024's `assign_code('IWO', ...)`.
--
-- SECURITY INVOKER, same reasoning as `assign_order_number()`: the counter
-- table's RLS is what actually gates who may number an IWO, so the function
-- itself needs no elevated privilege.
--
-- An explicitly supplied `code` is honoured and does NOT advance the
-- counter — same guard 0024's `assign_code()` and 0395's assigner both have,
-- and what lets a data import carry its own legacy IWO numbers.
-- ---------------------------------------------------------------------------
create or replace function public.assign_iwo_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  -- Refuse rather than invent a shared bucket — see 0395's header for why a
  -- fallback would collide with itself the moment a second location-less
  -- IWO was raised. `internal_work_orders.location_id` is stamped by
  -- `createInternalWorkOrder()` (lib/orders/internal-work-orders/actions.ts)
  -- from the session's own unit before this trigger runs, so this refusal
  -- fires only if that stamping is ever skipped.
  if new.location_id is null then
    raise exception
      'An Internal Work Order needs a Location before it can be numbered — '
      'the IWO number counts per location and restarts each April.'
      using errcode = '23502';
  end if;

  select l.code into v_loc
    from public.locations l
   where l.id = new.location_id;

  if v_loc is null or v_loc = '' then
    raise exception
      'Location % has no code, so it cannot start an IWO number.', new.location_id
      using errcode = '23502';
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.iwo_date, current_date));

  insert into public.iwo_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, 1)
  on conflict (location_id, fy) do update
    set last_no = c.last_no + 1
  returning c.last_no into v_next;

  new.code := public.iwo_no_format(v_loc, v_fy, v_next);
  return new;
end;
$$;

comment on function public.assign_iwo_number() is
  'Assigns the IWO number IWO/<unit>/<fy>/<nnnn> on insert (0559, doc/order/'
  'update.md §1.2). Fiscal year comes from iwo_date; the running number is '
  'per (location, year) and resets each April. SECURITY INVOKER — the '
  'caller must hold orders:create, which is what iwo_no_counters'' policies '
  'require.';

revoke all on function public.assign_iwo_number() from public, anon;
grant execute on function public.assign_iwo_number() to authenticated;

-- Re-point the trigger from 0024's assign_code() onto this one. Same name,
-- same table, same "before insert" timing — only the function changes.
drop trigger if exists trg_iwo_code on public.internal_work_orders;
create trigger trg_iwo_code before insert on public.internal_work_orders
  for each row execute function public.assign_iwo_number();


-- ---------------------------------------------------------------------------
-- 4. EXISTING IWOs KEEP THEIR IWO-#### NUMBERS. Nothing is renumbered, same
--    reasoning 0395 gives for sales_orders: the number is the audit trail
--    the module exists to keep, so rewriting history would invalidate every
--    reference to it. `seq_internal_work_order` is left in place for the
--    same reason 0395 left `seq_sales_order` — the old codes stay explicable
--    and a rollback is a one-line trigger swap.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 5. Self-verification. `{"success": true}` means the SQL ran, not that it
--    achieved its stated goal (0383, 0386) — the counter test uses two
--    THROWAWAY locations rather than inserting real internal_work_orders,
--    same reasoning 0395 gives for not touching the audit log with rows for
--    records that never existed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn     text;
  v_loc_a  uuid;
  v_loc_b  uuid;
  v_n      int;
begin
  -- 5a. Nothing new is reachable without a login.
  foreach v_fn in array array[
    'public.iwo_no_format(text, text, int)',
    'public.assign_iwo_number()'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '0559: % is executable by anon — the revoke did not take', v_fn;
    end if;
  end loop;

  -- 5b. The composed string, and the pad-is-a-floor guarantee.
  if public.iwo_no_format('U2', '2627', 1) <> 'IWO/U2/2627/0001' then
    raise exception '0559: format(U2,2627,1) = %, expected IWO/U2/2627/0001',
      public.iwo_no_format('U2', '2627', 1);
  end if;
  if public.iwo_no_format('U2', '2627', 12345) <> 'IWO/U2/2627/12345' then
    raise exception '0559: format(U2,2627,12345) = %, expected IWO/U2/2627/12345 — the pad truncated',
      public.iwo_no_format('U2', '2627', 12345);
  end if;

  -- 5c. The trigger is on the new function, not still on 0024's assign_code().
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.internal_work_orders'::regclass
      and tgname  = 'trg_iwo_code'
      and tgfoid  = 'public.assign_iwo_number()'::regprocedure
  ) then
    raise exception '0559: internal_work_orders is not on the IWO number trigger';
  end if;

  -- 5d. The counter is writable by someone.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'iwo_no_counters'
  ) then
    raise exception '0559: iwo_no_counters has no policies — every IWO insert would be denied';
  end if;

  -- 5e. Two locations count INDEPENDENTLY, and a location resets each fy —
  --     the same two facts 0395 asserts for sales_order_no_counters, over
  --     the exact upsert statement the trigger runs.
  insert into public.locations (code, name)
       values ('ZZ-T3', 'IWO No self-test A') returning id into v_loc_a;
  insert into public.locations (code, name)
       values ('ZZ-T4', 'IWO No self-test B') returning id into v_loc_b;

  insert into public.iwo_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1;
  insert into public.iwo_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 2 then
    raise exception '0559: second IWO at one location got %, expected 2', v_n;
  end if;

  insert into public.iwo_no_counters as c (location_id, fy, last_no)
       values (v_loc_b, '2627', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 1 then
    raise exception '0559: a SECOND location started at %, expected 1 — the counter is not per-location', v_n;
  end if;

  insert into public.iwo_no_counters as c (location_id, fy, last_no)
       values (v_loc_a, '2728', 1)
       on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  if v_n <> 1 then
    raise exception '0559: the next fiscal year started at %, expected 1 — the counter does not reset', v_n;
  end if;

  delete from public.iwo_no_counters where location_id in (v_loc_a, v_loc_b);
  delete from public.locations where id in (v_loc_a, v_loc_b);
end $$;
