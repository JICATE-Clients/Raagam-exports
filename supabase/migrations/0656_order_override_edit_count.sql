-- ============================================================================
-- 0656 · PERMISSION OVERRIDES — Phase 6: how many override edits an order has
-- ============================================================================
--
-- Spec: doc/email role system.md §7.3 — a report printed for an approved order
-- says so when that version carries post-approval override edits: "This version
-- includes N post-approval override edit(s). See Override Edit Report."
--
-- The note must reach EVERY reader of the report, not only the MD and the
-- admins who can read the audit tables (0650's RLS). So this is SECURITY
-- DEFINER and returns NUMBERS ONLY — how many committed override saves touched
-- the order's RE No and how many fields they changed. Who, what and why stay
-- behind the audit tables' RLS, in the Override Edit Report.
--
-- The grain is the RE No, as the lock and the commits are (0576, 0651): a
-- sibling document of the same RE counts. `failed` and `expired` commits are
-- excluded — a save that did not complete is in the report, and is not what
-- "this version includes" means.
-- ============================================================================

create or replace function public.order_override_edit_count(p_order uuid)
returns table (commits int, fields int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with me as (
    select a.id, a.sales_order_id from public.garment_order_amendments a where a.id = p_order
  ),
  c as (
    select oc.id, oc.closed_at
      from public.override_commits oc, me
     where oc.status = 'committed'
       and (oc.garment_order_id = me.id or (me.sales_order_id is not null and oc.sales_order_id = me.sales_order_id))
       and exists (select 1 from public.override_audit_trail t where t.commit_id = oc.id)
  )
  select (select count(*) from c)::int,
         (select count(*) from public.override_audit_trail t where t.commit_id in (select id from c))::int,
         (select max(closed_at) from c);
$$;

revoke all on function public.order_override_edit_count(uuid) from public, anon;
grant execute on function public.order_override_edit_count(uuid) to authenticated;
