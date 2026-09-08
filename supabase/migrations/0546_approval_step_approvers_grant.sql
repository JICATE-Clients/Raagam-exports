-- ============================================================================
-- Raagam ERP — 0546 `approval_step_approvers` was never granted to `authenticated`
--
-- Live error, 2026-09-07: every authenticated user hit
--   permission denied for function approval_step_approvers
-- opening /approvals — `getStrandedRuns()` (`lib/approvals/service.ts`) reads
-- the `approval_stranded_runs` VIEW, whose defining query calls
-- `approval_step_approvers(...)` directly. A view's SELECT on a table runs as
-- the view's owner, but a FUNCTION CALL inside a view's query is checked
-- against the QUERYING role's own EXECUTE privilege — table access and
-- function access are governed differently, and this function fell through
-- that gap.
--
-- CONFIRMED FROM THE CATALOG (never from reading the migration that created
-- it, AGENTS.md "Function grants"): every sibling RPC this same feature
-- shipped with — `approval_act`, `approval_can_act`, `approval_my_queue`,
-- `approval_resolve_flow`, `approval_start_run`, `approval_timeline`, … —
-- already has `authenticated` execute. `approval_step_approvers` is the one
-- that does not; its migration simply omitted the grant this one function
-- needed, the same class of one-function gap 0386 found eight of on the
-- OTHER side of this same rule (functions left anon-callable that should not
-- have been — this is a function left UNCALLABLE that should have been).
--
-- `approval_criteria_matches` is NOT part of this fix. It has no
-- `authenticated` grant either, but it is never called directly by app code
-- or by any view — only from inside other SECURITY DEFINER functions
-- (`approval_resolve_flow`), which execute as their own owner and need no
-- separate grant on what they call internally. Granting it anyway would not
-- be wrong, only unnecessary; it is left alone so this migration fixes
-- exactly the one function the stack trace named.
-- ============================================================================

grant execute on function public.approval_step_approvers(jsonb, uuid, jsonb, jsonb)
  to authenticated;


-- ---------- assertions ------------------------------------------------------
--
-- `{"success": true}` on a GRANT proves the statement ran, not that the
-- caller who hit the bug can now do the thing that failed — checked from
-- `has_function_privilege`, the same probe used to find the gap.

do $assert$
begin
  if not has_function_privilege(
    'authenticated',
    'public.approval_step_approvers(jsonb, uuid, jsonb, jsonb)',
    'execute'
  ) then
    raise exception '0546: authenticated still cannot execute approval_step_approvers';
  end if;

  -- anon must still be shut out — AGENTS.md "Function grants": no function in
  -- schema public is executable by anon, and fixing one gap must not open another.
  if has_function_privilege(
    'anon',
    'public.approval_step_approvers(jsonb, uuid, jsonb, jsonb)',
    'execute'
  ) then
    raise exception '0546: approval_step_approvers became anon-callable';
  end if;
end $assert$;
