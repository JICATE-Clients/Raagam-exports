-- ============================================================================
-- 0502 — Dynamic Approval Flow · CORE FUNCTIONS
--
-- Ported from the `dynamic-approval-flow` skill, `assets/sql/02_core_functions.sql`.
-- 7 RPCs plus 2 internals. Apply AFTER 0500 (shim) and 0501 (schema).
--
-- THE SKILL SAYS "NO EDITS EXPECTED" IN THIS FILE, and that instruction is
-- load-bearing: "if you are editing 02_core_functions.sql, the shim is wrong."
-- Two changes were made anyway, and each is one the skill itself sanctions or
-- requires:
--
--   1. THE SCOPE PREDICATE in `approval_resolve_flow` (section 2). The skill's
--      schema ships three generic scope columns and says, where they are
--      renamed: "update the matching predicates in approval_resolve_flow if you
--      change the count." 0501 collapsed the three to one `location_id`, so the
--      three predicates here become one. Nothing else about resolution moves.
--
--   2. THE GRANTS (section 9). See the note there — the shipped revokes do not
--      achieve what they say, in a way that is specific to Postgres rather than
--      to this app.
--
-- THREE COSMETIC ACCOMMODATIONS were also made, all on 2026-09-01 while applying
-- this file through the Supabase MCP, and all so that THE FILE AND THE DATABASE
-- STAY THE SAME THING. None of them changes behaviour:
--
--   * two `CASE … END` expressions moved into a variable (see the long note on
--     the first). The MCP's statement splitter loses the function-body boundary
--     on an `END` followed by anything other than `IF;` / `LOOP;` / the closing
--     `$$`, and sends the BODY as a standalone statement — Postgres then answers
--     "syntax error at end of input". Reproduced down to a six-line function.
--   * the inner double quotes around `%` in four RAISE messages were dropped.
--
-- Applying this file through the Supabase SQL editor or the CLI needs none of
-- that. It is written this way because a migration that cannot be re-applied by
-- the tool that applied it is a migration nobody can reproduce.
--
-- Everything else is a verbatim copy, including every error code the service
-- layer maps on. `lib/approvals/service.ts` matches on the SQLSTATEs and the
-- message prefixes raised below; changing a message here silently degrades a
-- precise error into "something went wrong".
-- ============================================================================

-- ─── 1. Criteria matcher (private) ──────────────────────────────────────────
-- A FLAT AND-of-conditions. Deliberately not a nested boolean tree.
--
--   {}                                  matches anything (fallback flow)
--   {"category":"capex"}                scalar equality
--   {"category":{"in":["capex","opex"]}}
--   {"amount":{"gt":50000}}             also gte / lt / lte / ne
--   {"a":1,"b":2}                       both must hold
--
-- When you need OR, add a second flow at a higher priority. That keeps the
-- matcher explainable in the admin UI, which is worth more than expressiveness.
CREATE OR REPLACE FUNCTION public.approval_criteria_matches(
    p_criteria jsonb,
    p_context  jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    k text; v jsonb; ctx jsonb; op text; opv jsonb;
    v_cmp boolean;
BEGIN
    IF p_criteria IS NULL OR p_criteria = '{}'::jsonb THEN
        RETURN true;
    END IF;

    FOR k, v IN SELECT key, value FROM jsonb_each(p_criteria) LOOP
        ctx := p_context -> k;

        -- A criterion naming a key the context does not supply cannot match.
        -- Failing closed matters: the alternative routes a ₹10L request through
        -- the ₹10k flow because someone forgot to pass `amount`.
        IF ctx IS NULL OR jsonb_typeof(ctx) = 'null' THEN
            RETURN false;
        END IF;

        IF jsonb_typeof(v) = 'object' THEN
            FOR op, opv IN SELECT key, value FROM jsonb_each(v) LOOP
                IF op = 'in' THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(opv) e WHERE e = ctx
                    ) THEN RETURN false; END IF;

                ELSIF op = 'ne' THEN
                    IF ctx = opv THEN RETURN false; END IF;

                ELSIF op IN ('gt','gte','lt','lte') THEN
                    IF jsonb_typeof(ctx) <> 'number' OR jsonb_typeof(opv) <> 'number' THEN
                        RAISE EXCEPTION
                            'approval criteria: operator % on key % needs numbers, got % and %',
                            op, k, jsonb_typeof(ctx), jsonb_typeof(opv);
                    END IF;
                    /* THE CASE RESULT GOES INTO A VARIABLE FIRST, and this is
                       a TOOLING workaround, not a change of behaviour — the two
                       forms are identical to Postgres.

                       The skill ships this as `IF NOT CASE op WHEN … END THEN`,
                       which is valid plpgsql and which Postgres accepts. What
                       cannot read it is the Supabase MCP's statement splitter:
                       it tracks the function body by BEGIN/END and an `END` that
                       is followed by `THEN` rather than by `IF;`, `LOOP;` or the
                       closing `$$` makes it lose the boundary — it then sends the
                       BODY as a standalone statement and Postgres answers
                       "syntax error at end of input". Reproduced down to a
                       six-line function; `#>>`, plpgsql, DECLARE and `IMMUTABLE`
                       were each cleared individually first.

                       Applying this file through the Supabase SQL editor or the
                       CLI needs no such workaround. It is here so that the file
                       and the database stay byte-for-byte the same thing, which
                       matters more than keeping the file identical to the skill:
                       a migration that cannot be re-applied by the tool that
                       applied it is a migration nobody can reproduce. */
                    v_cmp := CASE op
                        WHEN 'gt'  THEN (ctx#>>'{}')::numeric >  (opv#>>'{}')::numeric
                        WHEN 'gte' THEN (ctx#>>'{}')::numeric >= (opv#>>'{}')::numeric
                        WHEN 'lt'  THEN (ctx#>>'{}')::numeric <  (opv#>>'{}')::numeric
                        WHEN 'lte' THEN (ctx#>>'{}')::numeric <= (opv#>>'{}')::numeric
                    END;
                    IF NOT v_cmp THEN RETURN false; END IF;

                ELSE
                    RAISE EXCEPTION
                        'approval criteria: unknown operator % on key %. Supported: in, ne, gt, gte, lt, lte.',
                        op, k;
                END IF;
            END LOOP;
        ELSE
            IF ctx <> v THEN RETURN false; END IF;
        END IF;
    END LOOP;

    RETURN true;
END $$;


-- ─── 2. approval_resolve_flow ───────────────────────────────────────────────
-- THE single selection point. One ordering: priority ASC, then created_at, then
-- first match wins. Returns NULL when nothing matches — callers decide whether
-- that is an error.
CREATE OR REPLACE FUNCTION public.approval_resolve_flow(
    p_workflow_key text,
    p_tenant_id    uuid  DEFAULT NULL,
    p_scope        jsonb DEFAULT '{}'::jsonb,
    p_context      jsonb DEFAULT '{}'::jsonb
)
RETURNS public.approval_flows
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_flow public.approval_flows;
BEGIN
    FOR v_flow IN
        SELECT * FROM public.approval_flows f
        WHERE f.workflow_key = p_workflow_key
          AND f.is_active
          AND (f.tenant_id  IS NULL OR f.tenant_id  = p_tenant_id)
          -- NULL on a scope column is a wildcard. Rename these alongside the
          -- columns in 01_core_schema.sql if you changed them.
          -- ONE DIMENSION, NOT THREE (0501). A flow with a NULL location_id is
          -- the wildcard and matches every unit; one naming a unit matches only
          -- requests raised there. A request that passes no location_id at all
          -- therefore matches only wildcard flows, which is the correct
          -- fail-closed reading: better the business-wide chain than a chain
          -- belonging to a unit nobody named.
          AND (f.location_id IS NULL OR f.location_id::text = p_scope->>'location_id')
        ORDER BY f.priority ASC, f.created_at ASC
    LOOP
        IF public.approval_criteria_matches(v_flow.criteria, p_context) THEN
            RETURN v_flow;
        END IF;
    END LOOP;

    RETURN NULL;
END $$;


-- ─── 3. approval_start_run ──────────────────────────────────────────────────
-- Resolves the flow, FREEZES its steps onto the run, and asserts step 1 has at
-- least one eligible approver before committing. Starting a run nobody can act
-- on is the failure this engine exists to prevent.
CREATE OR REPLACE FUNCTION public.approval_start_run(
    p_workflow_key  text,
    p_subject_table text,
    p_subject_id    uuid,
    p_context       jsonb DEFAULT '{}'::jsonb,
    p_scope         jsonb DEFAULT '{}'::jsonb,
    p_tenant_id     uuid  DEFAULT NULL,
    p_requested_by  uuid  DEFAULT auth.uid()
)
RETURNS public.approval_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_flow      public.approval_flows;
    v_run       public.approval_runs;
    v_step1     jsonb;
    v_approvers int;
BEGIN
    IF p_requested_by IS NULL THEN
        RAISE EXCEPTION 'approval_start_run: no requester (auth.uid() is NULL and p_requested_by not supplied)'
            USING ERRCODE = '42501';
    END IF;

    v_flow := public.approval_resolve_flow(p_workflow_key, p_tenant_id, p_scope, p_context);

    IF v_flow.id IS NULL THEN
        RAISE EXCEPTION
            'approval_start_run: no active flow matches workflow_key=% with context %. Create a fallback flow with criteria {} if every request should route somewhere.',
            p_workflow_key, p_context
            USING ERRCODE = '23503';
    END IF;

    v_step1 := v_flow.steps -> 0;

    SELECT count(*) INTO v_approvers
    FROM public.approval_step_approvers(v_step1, p_requested_by, p_scope, p_context);

    IF v_approvers = 0 THEN
        RAISE EXCEPTION
            'approval_start_run: flow % step 1 (%) resolves to zero eligible approvers for requester %. Refusing to create a run nobody can action.',
            v_flow.flow_name, v_step1->>'step_label', p_requested_by
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.approval_runs (
        workflow_key, subject_table, subject_id, flow_id,
        steps_snapshot, context, scope, tenant_id,
        current_step, status, requested_by
    ) VALUES (
        p_workflow_key, p_subject_table, p_subject_id, v_flow.id,
        v_flow.steps, p_context, p_scope, p_tenant_id,
        1, 'in_progress', p_requested_by
    )
    RETURNING * INTO v_run;

    INSERT INTO public.approval_run_events (run_id, step_order, step_key, action, actor_id, metadata)
    VALUES (v_run.id, 1, v_step1->>'step_key', 'submit', p_requested_by,
            jsonb_build_object('flow_id', v_flow.id, 'flow_name', v_flow.flow_name));

    RETURN v_run;
END $$;


-- ─── 4. approval_can_act ────────────────────────────────────────────────────
-- ONE implementation of the authority predicate, called by approval_act AND
-- reflected by approval_my_queue. Two copies of this logic drifting apart is
-- how a system ends up with a badge that says 3 and a list that shows 2.
--
-- Exposed to clients on purpose: a subject detail page needs "can I act on
-- this?" without fetching the whole inbox. Not a TOCTOU risk, because
-- approval_act re-checks inside its own transaction under FOR UPDATE.
CREATE OR REPLACE FUNCTION public.approval_can_act(
    p_run_id  uuid,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run  public.approval_runs;
    v_step jsonb;
    v_is_approver bool;
BEGIN
    SELECT * INTO v_run FROM public.approval_runs WHERE id = p_run_id;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('can_act', false, 'reason', 'run_not_found');
    END IF;

    IF v_run.status <> 'in_progress' THEN
        RETURN jsonb_build_object('can_act', false, 'reason', 'run_' || v_run.status,
                                  'status', v_run.status);
    END IF;

    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('can_act', false, 'reason', 'no_user');
    END IF;

    v_step := public.approval_current_step(v_run);

    SELECT EXISTS (
        SELECT 1 FROM public.approval_step_approvers(
            v_step, v_run.requested_by, v_run.scope, v_run.context) u
        WHERE u = p_user_id
    ) INTO v_is_approver;

    -- A step may additionally demand a permission key.
    IF v_is_approver
       AND NULLIF(v_step->>'required_permission','') IS NOT NULL
       AND NOT public.approval_rbac_user_has_permission(p_user_id, v_step->>'required_permission')
    THEN
        RETURN jsonb_build_object(
            'can_act', false, 'reason', 'missing_permission',
            'required_permission', v_step->>'required_permission',
            'step_order', v_run.current_step, 'step_label', v_step->>'step_label');
    END IF;

    IF v_is_approver THEN
        RETURN jsonb_build_object(
            'can_act', true, 'reason', 'assigned', 'is_override', false,
            'step_order', v_run.current_step, 'step_label', v_step->>'step_label',
            'lock_version', v_run.lock_version);
    END IF;

    -- Break-glass. Recorded as an override in the event log, and the RPC will
    -- demand a comment.
    IF public.approval_rbac_is_super_admin(p_user_id) THEN
        RETURN jsonb_build_object(
            'can_act', true, 'reason', 'super_admin_override', 'is_override', true,
            'step_order', v_run.current_step, 'step_label', v_step->>'step_label',
            'lock_version', v_run.lock_version);
    END IF;

    RETURN jsonb_build_object(
        'can_act', false, 'reason', 'not_an_approver',
        'step_order', v_run.current_step, 'step_label', v_step->>'step_label');
END $$;


-- ─── 5. approval_act — THE ONLY WRITE PATH ──────────────────────────────────
-- p_lock_version has NO DEFAULT. Optimistic concurrency only works if the
-- caller sends it, and no default makes it impossible to forget.
CREATE OR REPLACE FUNCTION public.approval_act(
    p_run_id       uuid,
    p_action       text,
    p_lock_version int,
    p_comment      text DEFAULT NULL
)
RETURNS public.approval_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run        public.approval_runs;
    v_step       jsonb;
    v_next       jsonb;
    v_verdict    jsonb;
    v_actor      uuid := auth.uid();
    v_override   bool;
    v_target     int;
    v_next_count int;
    v_total      int;
    v_reason     text;
BEGIN
    IF p_action NOT IN ('approve','reject','return') THEN
        RAISE EXCEPTION 'approval_act: unknown action %. Use approve, reject or return.', p_action
            USING ERRCODE = '22023';
    END IF;

    -- Serialise concurrent approvers on the same run.
    SELECT * INTO v_run FROM public.approval_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'approval_act: run % not found', p_run_id USING ERRCODE = '42704';
    END IF;

    IF v_run.status <> 'in_progress' THEN
        RAISE EXCEPTION 'approval_act: run % is already %', p_run_id, v_run.status
            USING ERRCODE = '55000';
    END IF;

    IF v_run.lock_version <> p_lock_version THEN
        RAISE EXCEPTION
            'approval_act: run % changed since you loaded it (expected version %, current %). Reload and retry.',
            p_run_id, p_lock_version, v_run.lock_version
            USING ERRCODE = '40001';
    END IF;

    v_verdict := public.approval_can_act(p_run_id, v_actor);
    IF NOT (v_verdict->>'can_act')::bool THEN
        RAISE EXCEPTION 'approval_act: not permitted (%)', v_verdict->>'reason'
            USING ERRCODE = '42501';
    END IF;
    v_override := COALESCE((v_verdict->>'is_override')::bool, false);

    -- A comment is mandatory whenever the outcome is negative or the normal
    -- routing was bypassed. An override with no explanation is an audit hole.
    IF (p_action IN ('reject','return') OR v_override)
       AND COALESCE(btrim(p_comment), '') = '' THEN
        -- Same tooling reason as the CASE in `approval_criteria_matches` above:
        -- the result goes into a variable so no `END` sits mid-statement.
        v_reason := CASE WHEN v_override THEN 'override' ELSE p_action END;
        RAISE EXCEPTION 'approval_act: a comment is required for % actions', v_reason
            USING ERRCODE = '22023';
    END IF;

    v_step  := public.approval_current_step(v_run);
    v_total := jsonb_array_length(v_run.steps_snapshot);

    INSERT INTO public.approval_run_events (
        run_id, step_order, step_key, action, actor_id, is_override,
        intended_approver_role_key, comment)
    VALUES (
        v_run.id, v_run.current_step, v_step->>'step_key', p_action, v_actor, v_override,
        v_step->>'approver_role_key', p_comment);

    IF p_action = 'reject' THEN
        UPDATE public.approval_runs
           SET status = 'rejected', completed_at = now(),
               final_actor_id = v_actor, lock_version = lock_version + 1
         WHERE id = v_run.id
        RETURNING * INTO v_run;
        RETURN v_run;
    END IF;

    IF p_action = 'return' THEN
        -- Validated at flow-save time to be strictly earlier than this step.
        v_target := COALESCE((v_step->>'on_return_restart_from_step')::int, 1);
        UPDATE public.approval_runs
           SET current_step = v_target, lock_version = lock_version + 1
         WHERE id = v_run.id
        RETURNING * INTO v_run;
        RETURN v_run;
    END IF;

    -- approve
    IF v_run.current_step >= v_total THEN
        UPDATE public.approval_runs
           SET status = 'completed', completed_at = now(),
               final_actor_id = v_actor, lock_version = lock_version + 1
         WHERE id = v_run.id
        RETURNING * INTO v_run;
        RETURN v_run;
    END IF;

    -- Resolve the NEXT step's approvers before advancing, in this same
    -- transaction. This is the structural fix for the defect that stranded 54
    -- of 60 live applications in the source system: it advanced the step
    -- pointer into a void and the run vanished from every queue.
    v_next := v_run.steps_snapshot -> v_run.current_step;   -- 0-based → next step

    SELECT count(*) INTO v_next_count
    FROM public.approval_step_approvers(
        v_next, v_run.requested_by, v_run.scope, v_run.context);

    IF v_next_count = 0 THEN
        RAISE EXCEPTION
            'approval_act: step % (%) has zero eligible approvers, so this approval would strand the run. Fix the flow or the role assignment, then retry.',
            v_run.current_step + 1, v_next->>'step_label'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.approval_runs
       SET current_step = current_step + 1, lock_version = lock_version + 1
     WHERE id = v_run.id
    RETURNING * INTO v_run;

    RETURN v_run;
END $$;


-- ─── 6. approval_cancel ─────────────────────────────────────────────────────
-- Separate from approval_act because the authority is different: the requester
-- withdraws their own request; an approver does not "cancel", they reject.
CREATE OR REPLACE FUNCTION public.approval_cancel(
    p_run_id uuid,
    p_reason text
)
RETURNS public.approval_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run   public.approval_runs;
    v_actor uuid := auth.uid();
BEGIN
    IF COALESCE(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION 'approval_cancel: a reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_run FROM public.approval_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'approval_cancel: run % not found', p_run_id USING ERRCODE = '42704';
    END IF;
    IF v_run.status <> 'in_progress' THEN
        RAISE EXCEPTION 'approval_cancel: run % is already %', p_run_id, v_run.status
            USING ERRCODE = '55000';
    END IF;

    IF v_run.requested_by <> v_actor
       AND NOT public.approval_rbac_is_super_admin(v_actor)
       AND NOT public.approval_rbac_user_has_permission(v_actor, 'approvals.run.view_all') THEN
        RAISE EXCEPTION 'approval_cancel: only the requester or an administrator may cancel'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.approval_run_events (run_id, step_order, action, actor_id, comment)
    VALUES (v_run.id, v_run.current_step, 'cancel', v_actor, p_reason);

    UPDATE public.approval_runs
       SET status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
     WHERE id = v_run.id
    RETURNING * INTO v_run;

    RETURN v_run;
END $$;


-- ─── 7. approval_my_queue ───────────────────────────────────────────────────
-- The inbox. Returns total_count on every row rather than shipping a second
-- count RPC whose predicate could drift from this one.
-- Pagination is server-side; the source system's two inbox RPCs both fetched
-- everything and sliced in JavaScript.
CREATE OR REPLACE FUNCTION public.approval_my_queue(
    p_workflow_key text DEFAULT NULL,
    p_tenant_id    uuid DEFAULT NULL,
    p_limit        int  DEFAULT 50,
    p_offset       int  DEFAULT 0,
    p_user_id      uuid DEFAULT auth.uid()
)
RETURNS TABLE (
    run_id        uuid,
    workflow_key  text,
    subject_table text,
    subject_id    uuid,
    step_order    int,
    step_label    text,
    requested_by  uuid,
    started_at    timestamptz,
    waiting_hours numeric,
    lock_version  int,
    total_count   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH mine AS (
        SELECT r.*
        FROM public.approval_runs r
        WHERE r.status = 'in_progress'
          AND (p_workflow_key IS NULL OR r.workflow_key = p_workflow_key)
          AND (p_tenant_id    IS NULL OR r.tenant_id    = p_tenant_id)
          AND p_user_id IS NOT NULL
          -- Same predicate as approval_can_act, via the same helper.
          AND EXISTS (
              SELECT 1 FROM public.approval_step_approvers(
                  public.approval_current_step(r.*), r.requested_by, r.scope, r.context) u
              WHERE u = p_user_id
          )
    )
    SELECT
        m.id,
        m.workflow_key,
        m.subject_table,
        m.subject_id,
        m.current_step,
        public.approval_current_step(m.*) ->> 'step_label',
        m.requested_by,
        m.started_at,
        round(EXTRACT(epoch FROM (now() - m.started_at)) / 3600.0, 1),
        m.lock_version,
        count(*) OVER ()
    FROM mine m
    ORDER BY m.started_at ASC
    LIMIT  GREATEST(COALESCE(p_limit, 50), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;


-- ─── 8. approval_timeline ───────────────────────────────────────────────────
-- One query powers every stepper and history panel. Left-joins the FROZEN
-- snapshot against the event log, so a flow edited after this run started still
-- renders the steps this run is actually following.
CREATE OR REPLACE FUNCTION public.approval_timeline(p_run_id uuid)
RETURNS TABLE (
    step_order   int,
    step_label   text,
    step_key     text,
    approver_hint text,
    is_current   bool,
    action       text,
    actor_id     uuid,
    is_override  bool,
    comment      text,
    acted_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH r AS (
        SELECT * FROM public.approval_runs WHERE id = p_run_id
    ),
    steps AS (
        SELECT
            (s.value->>'step_order')::int AS step_order,
            s.value->>'step_label'        AS step_label,
            s.value->>'step_key'          AS step_key,
            COALESCE(
                NULLIF(s.value->>'approver_role_key',''),
                NULLIF(s.value->>'approver_resolver',''),
                CASE WHEN COALESCE(jsonb_array_length(s.value->'approver_user_ids'),0) > 0
                     THEN 'named approver(s)' END,
                'unassigned')             AS approver_hint
        FROM r, jsonb_array_elements(r.steps_snapshot) s
    ),
    decisions AS (
        SELECT DISTINCT ON (e.step_order)
               e.step_order, e.action, e.actor_id, e.is_override, e.comment, e.created_at
        FROM public.approval_run_events e
        WHERE e.run_id = p_run_id AND e.action <> 'submit'
        ORDER BY e.step_order, e.created_at DESC
    )
    SELECT
        s.step_order, s.step_label, s.step_key, s.approver_hint,
        (s.step_order = r.current_step AND r.status = 'in_progress'),
        d.action, d.actor_id, COALESCE(d.is_override, false), d.comment, d.created_at
    FROM steps s
    CROSS JOIN r
    LEFT JOIN decisions d ON d.step_order = s.step_order
    ORDER BY s.step_order;
$$;


-- ─── 9. Grants ──────────────────────────────────────────────────────────────
-- REWRITTEN, AND NOT FOR HOUSE STYLE. The skill's own revokes read
-- `REVOKE ... FROM anon` and `FROM authenticated, anon`, and neither achieves
-- what it says: a new function is executable through TWO independent grants —
-- Postgres's built-in EXECUTE TO PUBLIC and Supabase's separate direct grant to
-- `anon` — and `anon` is a member of PUBLIC. Revoking the direct grant leaves
-- the PUBLIC one standing, so every RPC below would remain callable without a
-- login while the migration reads as a lockdown.
--
-- This app has been here twice: 0383 revoked from `public` alone and left
-- `creator_names()` an unauthenticated name oracle until 0385; 0386 then found
-- eight more. AGENTS.md, "Function grants (STANDING)", states the idiom — always
-- both, in one statement — and it is what is written below.
--
-- Verify from the catalog, never by reading this file. `{"success": true}` means
-- the SQL ran, not that it achieved its stated goal: run
-- `scripts/check-anon-grants.sql` and require zero rows from BOTH checks.
GRANT EXECUTE ON FUNCTION public.approval_resolve_flow(text, uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_start_run(text, text, uuid, jsonb, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_can_act(uuid, uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_act(uuid, text, int, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_cancel(uuid, text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_my_queue(text, uuid, int, int, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.approval_timeline(uuid)                         TO authenticated;

-- Engine internals stay internal.
REVOKE ALL ON FUNCTION public.approval_criteria_matches(jsonb, jsonb) FROM public, authenticated, anon;
REVOKE ALL ON FUNCTION public.approval_step_approvers(jsonb, uuid, jsonb, jsonb) FROM public, authenticated, anon;

REVOKE ALL ON FUNCTION public.approval_resolve_flow(text, uuid, jsonb, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_start_run(text, text, uuid, jsonb, jsonb, uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_can_act(uuid, uuid)                    FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_act(uuid, text, int, text)             FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_cancel(uuid, text)                     FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_my_queue(text, uuid, int, int, uuid)   FROM public, anon;
REVOKE ALL ON FUNCTION public.approval_timeline(uuid)                         FROM public, anon;


-- ─── 10. Post-install assert: somebody can administer this ──────────────────
-- An engine whose admin permission is held by nobody is a lockout waiting to
-- be discovered at the worst moment.
DO $$
BEGIN
    IF to_regclass('public.roles') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.roles
            WHERE is_active AND (permissions ->> 'approvals.flow.manage')::boolean IS TRUE
        ) THEN
            RAISE WARNING
                'dynamic-approval-flow: no active role holds approvals.flow.manage. Nobody can create approval flows. Grant it before going live.';
        END IF;
    END IF;
END $$;
