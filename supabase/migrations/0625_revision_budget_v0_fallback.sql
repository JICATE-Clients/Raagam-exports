-- 0625 — A REVISION ALWAYS CARRIES THE APPROVED BUDGET IT CAN RETURN TO (user
-- 2026-09-24, audio record-1790225167386: abandoning a draft revision must put
-- the order back to its latest approved version; instead the order was left
-- open with a draft budget and vanished from Raise Revision's order picker).
--
-- THE CAUSE. 0619 added `budget_snapshot` (V0 of the budget — what a reject or
-- abandon restores) and took it on a FIRST raise only. A SUPERSEDING raise
-- (0618) copies its predecessor's snapshot, so an entry raised BEFORE 0619 —
-- AMD/26-27/0001, 2026-09-22 — handed its missing snapshot down the whole chain:
-- 0002, 0003 and 0004 all carried NULL. Abandoning 0004 then found nothing to
-- restore, and `abandon_order_amendment` took its "reopened" branch: the entry
-- closed, the order was NOT reverted (it kept the revision's combo and quantity
-- changes), and the budget stayed draft — so the order read open, and the
-- picker, which offers only orders with an approved budget, dropped it.
--
-- THE FIX. V0 of the budget can be REBUILT, exactly, from what every entry
-- already holds: its `baseline.lines` are the approved `order_budget_lines`
-- column for column (checked: 32 of 32 keys, 0 missing, 0 extra), and a
-- superseding raise copies `baseline` too, so every entry of a chain carries the
-- approved lines of the chain's root. The budget ROW is today's row with its
-- decision put back (`approved`, by and at the entry's
-- `baseline_approved_by/at`, `submitted_summary` = the baseline's KPIs); the
-- order links are today's, which a revision never edits.
--
--   1. `order_amendment_budget_v0(...)` builds that snapshot.
--   2. A BEFORE INSERT trigger fills `budget_snapshot` whenever a door leaves it
--      NULL — every door, including any written later, so this cannot recur by
--      a supersede copying a gap forward.
--   3. The entries already missing one are backfilled.

-- ---------- 1. The builder ------------------------------------------------------

create or replace function public.order_amendment_budget_v0(
  p_budget   uuid,
  p_baseline jsonb,
  p_by       uuid,
  p_at       timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_baseline is null or jsonb_typeof(p_baseline -> 'lines') is distinct from 'array'
      or not exists (select 1 from public.order_budgets b where b.id = p_budget)
    then null
    else jsonb_build_object(
      'budget', (
        select to_jsonb(b)
               || jsonb_build_object('status', 'approved', 'decided_by', p_by, 'decided_at', p_at)
               || case when jsonb_typeof(p_baseline -> 'kpis') = 'object'
                       then jsonb_build_object('submitted_summary', p_baseline -> 'kpis')
                       else '{}'::jsonb end
          from public.order_budgets b where b.id = p_budget
      ),
      'lines', p_baseline -> 'lines',
      'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
                   from public.order_budget_orders o where o.budget_id = p_budget),
      'rebuilt_from', 'baseline'
    )
  end;
$$;

comment on function public.order_amendment_budget_v0(uuid, jsonb, uuid, timestamptz) is
  'V0 of a budget rebuilt from an entry''s frozen baseline (approved lines + '
  'KPIs) when no snapshot was taken at raise. Same shape as '
  'order_amendment_budget_snapshot, plus rebuilt_from. Internal. 0625.';

revoke all on function public.order_amendment_budget_v0(uuid, jsonb, uuid, timestamptz) from public, anon, authenticated;

-- ---------- 2. Every new entry carries one ------------------------------------

create or replace function public.order_amendment_fill_budget_v0()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.budget_snapshot is null and new.garment_order_id is not null then
    new.budget_snapshot := public.order_amendment_budget_v0(
      new.budget_id, new.baseline, new.baseline_approved_by, new.baseline_approved_at);
  end if;
  return new;
end;
$$;

revoke all on function public.order_amendment_fill_budget_v0() from public, anon, authenticated;

drop trigger if exists trg_obr_fill_budget_v0 on public.order_budget_revisions;
create trigger trg_obr_fill_budget_v0
  before insert on public.order_budget_revisions
  for each row execute function public.order_amendment_fill_budget_v0();

-- ---------- 3. Backfill -----------------------------------------------------------

update public.order_budget_revisions r
   set budget_snapshot = public.order_amendment_budget_v0(
         r.budget_id, r.baseline, r.baseline_approved_by, r.baseline_approved_at)
 where r.budget_snapshot is null
   and r.garment_order_id is not null;

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
    from public.order_budget_revisions r
   where r.garment_order_id is not null
     and jsonb_typeof(r.baseline -> 'lines') = 'array'
     and (r.budget_snapshot is null or jsonb_typeof(r.budget_snapshot -> 'budget') is distinct from 'object');
  if v_missing > 0 then
    raise exception '0625: % order entries still have no budget V0 to revert to', v_missing;
  end if;
end $$;

-- ---------- Applied once by hand, 2026-09-24, NOT part of this migration ----------
--
-- HO/RE/26-27/0001 was repaired after 0625 and 0626 were applied: AMD/26-27/0004
-- (abandoned 05:10 UTC without a revert — see the header) was reopened inside
-- one transaction, `order_amendment_revert(entry, 'abandoned')` restored V0, and
-- the entry was re-closed with its original closed_at / closed_by. Dry-run first
-- (rolled back), then live. Result: order approved, budget approved (decided
-- 2026-09-22 09:50 UTC), 1 combo, 32 budget lines. One save touched the order
-- after the abandon (05:13 UTC): its header was unchanged and its one
-- attachment was the same image (same storage path) under a new id. Its child
-- rows were restored to V0 with the rest — the client's rule for an abandoned
-- revision — so anything that save changed in them is not kept.
-- Not written as SQL here: it named one entry and must never replay on another
-- database.
