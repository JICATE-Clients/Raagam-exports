-- ============================================================================
-- Raagam ERP — 0768 Vehicle & Transport: trigger functions are not RPCs
--
-- Supabase's security advisor, run right after 0766 (2026-10-29), flagged
-- `transport_assign_no()` and `transport_trips_sync()` as SECURITY DEFINER
-- functions `authenticated` can execute via /rest/v1/rpc. Both are trigger
-- functions (`returns trigger`) — Postgres refuses to run one outside a trigger,
-- so this was never exploitable — but nothing should hold EXECUTE on them.
--
-- Safe for the triggers: EXECUTE on a trigger function is checked when the
-- trigger is CREATED, never when it fires.
--
-- The two `lv_transport_*` predicates the advisor listed beside them KEEP their
-- grant to `authenticated` on purpose: RLS policies call them as the signed-in
-- user, the shape every 0680 `lv_*` predicate has.
-- ============================================================================

revoke execute on function public.transport_assign_no() from authenticated;
revoke execute on function public.transport_trips_sync() from authenticated;

do $assert$
begin
  if has_function_privilege('authenticated', 'public.transport_assign_no()', 'execute')
     or has_function_privilege('authenticated', 'public.transport_trips_sync()', 'execute') then
    raise exception '0768: a transport trigger function is still executable by authenticated';
  end if;
end $assert$;
