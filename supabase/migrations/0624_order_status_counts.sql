-- ORDER ENTRY'S STATUS-WISE COUNT, AS ONE ATOMIC QUERY
--
-- The Pending / Updated / Draft box above the Garment Order list carries a
-- figure per word, and since 2026-09-24 the list itself is narrowed in SQL by
-- `?status=`. That is what makes the figures a SERVER question: the rows on
-- screen are one word's worth, so counting them could only ever report the
-- other two as zero.
--
-- The service answered it with three separate `count(*)` reads. Correct, and
-- correct three times at three different instants: an order saved between them
-- is counted by some and not others, so the box can read "Pending 12" over a
-- list of 11 — a total that disagrees with the rows beneath it, which is the
-- kind of number that gets believed. One statement, one snapshot, one round
-- trip instead of three.
--
-- ## SECURITY INVOKER, DELIBERATELY
--
-- No `security definer`. The count must be of the orders THIS user can see, or
-- it contradicts the list beside it — RLS on `garment_order_amendments` applies
-- inside the function exactly as it does to the list query. A definer function
-- here would be both a wider count and, per AGENTS.md's standing rule, a hole
-- straight through RLS for anything that could reach it.
--
-- ## THE WORDS ARE THE APPLICATION'S, AND THIS IS THE SECOND PLACE THEY LIVE
--
-- `ORDER_QUICK_WHERE` in `lib/orders/amendments/types.ts` is the first, and
-- `scripts/check-order-status-filter.mts` asserts the row function and that
-- clause agree. The mapping below must say the same thing: draft first
-- (is_draft wins over any decision), then undecided, then decided. Change one
-- and change the other in the same commit.

create or replace function public.garment_order_status_counts()
returns table (status text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case
      when is_draft then 'draft'
      when approval_status = 'pending' then 'pending'
      else 'updated'
    end as status,
    count(*) as n
  from public.garment_order_amendments
  group by 1
$$;

comment on function public.garment_order_status_counts() is
  'Garment orders per Pending / Updated / Draft, for the Order Entry status box. '
  'SECURITY INVOKER so the figures match what the caller can list. Mirrors '
  'ORDER_QUICK_WHERE in lib/orders/amendments/types.ts — change both together.';

-- BOTH GRANTS, IN ONE STATEMENT (AGENTS.md "Function grants"). A new function
-- is born callable by `public` (Postgres's own EXECUTE TO PUBLIC) AND by `anon`
-- (Supabase's default privileges); revoking one leaves the other standing, and
-- the migration reads as a lockdown either way. This app has no logged-out
-- surface, so an anon-callable order count is a row count leaked to the anon
-- key. Verify from the catalog, never by reading this file:
-- `scripts/check-anon-grants.sql` must return zero rows.
revoke all on function public.garment_order_status_counts() from public, anon;
grant execute on function public.garment_order_status_counts() to authenticated;
