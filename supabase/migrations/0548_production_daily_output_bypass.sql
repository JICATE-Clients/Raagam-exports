-- ============================================================================
-- Raagam ERP — 0548 Daily Production Output & Bypass
--
-- Floor departments run concurrently, not in the sequential blocks a T&A
-- calendar draws: Sewing's first 500 pieces reach Checking the same day, long
-- before Sewing's own block finishes. `garment_order_amendment_ta_activities`
-- already has a word for this — `bypassed_qty`/`bypassed_at` (0540) — but it is
-- a hand-typed running total capped only against the order's total pieces, with
-- no comparison against what the upstream department has actually produced.
--
-- This migration widens the ALREADY-LIVE daily-output ledger
-- (`production_entries`, 0011) from 3 departments to the 5 the floor actually
-- runs (Checking/Ironing exist as T&A activities since 0539 but were never
-- production stages), re-points it at the amendment model instead of the
-- pre-amendment `sales_orders` FK it was built against, and adds the one
-- function both the write-time WIP guard and the T&A worklist's DERIVED bypass
-- figure share — one place that answers "how much has this stage produced",
-- never two.
--
-- `production_entries` is ALTERED IN PLACE, not dropped and recreated — same
-- rule 0481's header states for every live child table in this app.
-- ============================================================================

-- ---------- 1. widen the stage list -----------------------------------------

alter table public.production_entries
  drop constraint if exists production_entries_stage_check;

alter table public.production_entries
  add constraint production_entries_stage_check
  check (stage in ('cutting','sewing','checking','ironing','packing'));

-- ---------- 2. re-point at the amendment model ------------------------------

alter table public.production_entries
  add column if not exists amendment_id uuid
    references public.garment_order_amendments(id) on delete cascade;

comment on column public.production_entries.amendment_id is
  'The garment order amendment this output belongs to — the same document '
  'garment_order_amendment_ta_activities.amendment_id scopes T&A to. '
  'production_entries predates the amendment model and FK''d to sales_order_id '
  'directly; new rows are written against amendment_id, sales_order_id stays '
  'for the rows this backfill could not resolve.';

-- Backfill: the latest amendment per sales order, same tie-break
-- `lib/ta/worklist.ts` already implements inline (amend_date, then created_at —
-- see its own "Latest amendment per order" step). This project's database
-- carries 0 production_entries rows today (checked before writing this
-- migration), so this backfill is a no-op here and only matters for a database
-- that already has floor history.
with latest as (
  select distinct on (sales_order_id)
    sales_order_id, id
  from public.garment_order_amendments
  where sales_order_id is not null
  order by sales_order_id, amend_date desc nulls last, created_at desc
)
update public.production_entries pe
set amendment_id = latest.id
from latest
where pe.sales_order_id = latest.sales_order_id
  and pe.amendment_id is null;

create index if not exists idx_proden_amendment on public.production_entries(amendment_id);

-- ---------- 3. shift ---------------------------------------------------------

alter table public.production_entries
  add column if not exists shift_code text not null default 'SHIFT_1'
    check (shift_code in ('SHIFT_1','SHIFT_2'));

comment on column public.production_entries.shift_code is
  'No shift master exists in this schema (checked: no shifts/shift_masters '
  'table) — a plain two-value enum, same shape as stage, not a lookup.';

-- ---------- 4. the one cumulative answer, shared by the WIP guard and the ---
-- ---------- T&A worklist's derived bypass. ----------------------------------
--
-- Deliberately NOT confirmed-only, unlike summariseProgress()'s dashboard
-- totals (lib/production/types.ts) — a piece a supervisor has physically
-- recorded already exists on the floor and can already be bypassed downstream;
-- waiting for a manager's confirmation to unlock the next department is the
-- sequential-blocking assumption this whole feature exists to remove. Manager
-- confirmation still gates the payroll-facing dashboards; it does not gate WIP.
--
-- SECURITY DEFINER: the T&A worklist is read by every signed-in user regardless
-- of whether they hold the `production` permission that gates
-- `production_entries` RLS, and this function answers with a single aggregate
-- number, never a row — nothing production_entries' own RLS protects is
-- exposed by it. Per AGENTS.md "Function grants": born callable by `anon` via
-- Postgres's own PUBLIC EXECUTE grant AND Supabase's separate `anon` default,
-- so both are revoked in one statement before the scoped grant.
create or replace function public.stage_cumulative_good_qty(
  p_amendment_id uuid,
  p_stage text
) returns table (cumulative_qty numeric, last_entry_date date)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(good_qty), 0)::numeric, max(entry_date)
  from public.production_entries
  where amendment_id = p_amendment_id
    and stage = p_stage;
$$;

revoke all on function public.stage_cumulative_good_qty(uuid, text) from public, anon;
grant execute on function public.stage_cumulative_good_qty(uuid, text) to authenticated;

-- ---------- 5. verify --------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'production_entries'
      and column_name = 'amendment_id'
  ) then
    raise exception '0548: amendment_id was not added to production_entries';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'production_entries'
      and column_name = 'shift_code'
  ) then
    raise exception '0548: shift_code was not added to production_entries';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'production_entries_stage_check'
  ) then
    raise exception '0548: the widened stage CHECK was not created';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stage_cumulative_good_qty'
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception '0548: stage_cumulative_good_qty is still callable by anon';
  end if;
end $$;
