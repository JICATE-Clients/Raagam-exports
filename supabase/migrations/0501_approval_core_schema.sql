-- ============================================================================
-- 0501 — Dynamic Approval Flow · CORE SCHEMA
--
-- Ported from the `dynamic-approval-flow` skill, `assets/sql/01_core_schema.sql`.
-- 3 tables, 1 view, 4 internal functions, RLS. Apply AFTER 0500 (the shim).
--
-- WHAT WAS EDITED, AND IT IS THE ONLY THING THE SKILL SANCTIONS EDITING HERE:
--
--   * the scope columns. The skill ships `scope_a_id / scope_b_id / scope_c_id`
--     to be renamed to the host's real dimensions. RAAGAM SCOPES ROLE GRANTS
--     ALONG EXACTLY ONE AXIS — `user_roles.location_id` (0001), the unit — so
--     the three become one `location_id`, and 0502's `approval_resolve_flow`
--     carries the matching single predicate. Adding a second dimension later is
--     a migration on two files; that is the cost the skill warns about and the
--     reason it is worth being sure there is only one.
--
--   * `created_by uuid DEFAULT auth.uid()`. AGENTS.md, "Created Date / Created
--     User": 154 tables carry the column and every one defaults to auth.uid()
--     (0383 · 0388). The skill ships it bare, which in this app would produce a
--     column of dashes on the flow listing.
--
--   * THE GRANTS AT THE BOTTOM. See section 9 — this is a real correction to
--     the skill, not a house-style change.
--
-- WHAT MUST NOT BE "FIXED":
--   * `approval_runs` has NO INSERT/UPDATE/DELETE POLICY. That is the whole
--     security thesis: the SECURITY DEFINER RPCs in 0502 are the only write
--     path, which is what makes the engine impossible to bypass via PostgREST.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ON MULTI-UNIT (0483–0489) — WHY THESE TABLES ARE NOT NARROWED TO A LOCATION
--
-- 392 policies were narrowed to `current_location()` on 2026-08-31, so a new
-- transactional table not doing the same looks like an omission. It is not.
-- An approval crosses units by design: a Managing Director sitting at Head
-- Office is exactly who signs off a Unit 2 order, and narrowing `approval_runs`
-- to the caller's current unit would empty their queue and strand every run
-- raised outside HO.
--
-- The unit still governs, in the one place where it is a routing question
-- rather than a visibility one: `approval_flows.location_id` picks WHICH flow a
-- unit's requests take, and the run's `scope` narrows WHO holds the approving
-- role. Visibility is by participation — requester, eligible approver, or
-- `approvals:view` — and that is deliberate.
-- ============================================================================

-- Guard: the shim must already be in place.
DO $$
BEGIN
    IF to_regprocedure('public.approval_rbac_users_with_role(text, jsonb)') IS NULL THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: apply 00_rbac_shim.sql before 01_core_schema.sql';
    END IF;
END $$;


-- ─── 1. approval_flows — the definitions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_flows (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- TEXT, never an enum. The source system gated workflow types behind a
    -- Postgres enum and every new workflow needed a migration plus a hand-synced
    -- TypeScript union. Keep this text.
    workflow_key  text NOT NULL,

    flow_name     text NOT NULL,
    description   text,

    -- RESERVED, ALWAYS NULL. Raagam is one business, not a tenanted platform.
    -- The column is kept rather than dropped because 0502 matches it with
    -- `f.tenant_id IS NULL OR f.tenant_id = p_tenant_id` — so a NULL here means
    -- "every caller", and removing it would mean editing the engine for no
    -- behavioural gain. Nothing writes it and no screen shows it.
    tenant_id     uuid,

    -- THE ONE SCOPE DIMENSION: the unit a flow belongs to. NULL is a WILDCARD
    -- and is the normal case — "this is how the business approves, everywhere".
    -- Set it only to give one unit a different chain from the rest.
    --
    -- Typed and FK'd rather than left in `criteria`, because scope is not a
    -- condition: it decides which flow applies, and it is the same value handed
    -- to `approval_rbac_users_with_role` to narrow who holds the approving role
    -- (0500). A criteria key could do neither.
    location_id   uuid REFERENCES public.locations(id),

    -- Untyped extras. Flat AND-of-conditions; see approval_criteria_matches.
    criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Ordered step array. Shape documented in references/architecture.md and
    -- validated by approval_validate_steps() below.
    steps         jsonb NOT NULL,

    -- Lower wins. ONE ordering, deliberately — the source system ran a 6-level
    -- specificity ladder alongside a priority column, and two independent
    -- orderings is ambiguity, not flexibility.
    priority      int NOT NULL DEFAULT 100,

    is_active     bool NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    -- AGENTS.md, Created Date / Created User: the app's 154 other tables all
    -- default this to auth.uid(). Without it the flow listing shows a dash.
    created_by    uuid DEFAULT auth.uid(),

    CONSTRAINT af_steps_is_array   CHECK (jsonb_typeof(steps) = 'array'),
    CONSTRAINT af_steps_non_empty  CHECK (jsonb_array_length(steps) > 0),
    CONSTRAINT af_criteria_object  CHECK (jsonb_typeof(criteria) = 'object')
);

-- `location_id` joins the key because `approval_resolve_flow` filters on it in
-- the same breath as `workflow_key`, and a flow list is scanned per request.
CREATE INDEX IF NOT EXISTS approval_flows_lookup_idx
    ON public.approval_flows (workflow_key, tenant_id, location_id, priority)
    WHERE is_active;

COMMENT ON COLUMN public.approval_flows.steps IS
  'Ordered array of step objects. Required per step: step_order (1-based, '
  'contiguous), step_label, and exactly one approver source of '
  'approver_role_key / approver_user_ids / approver_resolver.';


-- ─── 2. approval_runs — one live instance per subject ───────────────────────
CREATE TABLE IF NOT EXISTS public.approval_runs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    workflow_key   text NOT NULL,
    subject_table  text NOT NULL,   -- 'purchase_orders'
    subject_id     uuid NOT NULL,   -- no FK: subject_table varies

    flow_id        uuid NOT NULL REFERENCES public.approval_flows(id) ON DELETE RESTRICT,

    -- FROZEN at start. Editing a flow never rewrites work already in flight.
    -- Never re-read the flow to "keep this current" — frozen-at-start is the
    -- entire reason flow edits are safe.
    steps_snapshot jsonb NOT NULL,

    -- What criteria were matched against, kept for audit and for resolvers.
    context        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Passed to approval_rbac_users_with_role for every step of this run.
    scope          jsonb NOT NULL DEFAULT '{}'::jsonb,

    tenant_id      uuid,

    current_step   int  NOT NULL DEFAULT 1,   -- 1-based, always
    status         text NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','completed','rejected','cancelled')),

    -- Optimistic concurrency. approval_act takes this with NO DEFAULT so a
    -- caller cannot forget it.
    lock_version   int NOT NULL DEFAULT 0,

    requested_by   uuid NOT NULL,
    started_at     timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,
    final_actor_id uuid,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ar_completed_consistency CHECK (
        (status = 'in_progress' AND completed_at IS NULL)
        OR (status <> 'in_progress' AND completed_at IS NOT NULL)
    )
);

-- PARTIAL, not total. A total unique constraint (what the source system used)
-- permanently blocks re-submitting a rejected request.
CREATE UNIQUE INDEX IF NOT EXISTS approval_runs_one_open_per_subject
    ON public.approval_runs (subject_table, subject_id)
    WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS approval_runs_subject_idx
    ON public.approval_runs (subject_table, subject_id);
CREATE INDEX IF NOT EXISTS approval_runs_open_idx
    ON public.approval_runs (workflow_key, tenant_id, current_step)
    WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS approval_runs_requester_idx
    ON public.approval_runs (requested_by, status);


-- ─── 3. approval_run_events — history as ROWS ───────────────────────────────
-- Rows, not a JSONB history blob: queryable, indexable, and RLS-able. The
-- source system used a JSONB array and could not answer "what did this user
-- approve last quarter" without a full scan.
CREATE TABLE IF NOT EXISTS public.approval_run_events (
    id            bigserial PRIMARY KEY,
    run_id        uuid NOT NULL REFERENCES public.approval_runs(id) ON DELETE CASCADE,

    step_order    int  NOT NULL,
    step_key      text,
    action        text NOT NULL CHECK (action IN
                    ('submit','approve','reject','return','cancel','delegate','sla_breach')),

    actor_id      uuid,          -- NULL for system-generated events
    actor_role_key text,
    is_override   bool NOT NULL DEFAULT false,

    -- Preserved even when an override bypasses normal routing, so the audit
    -- trail still records who SHOULD have acted.
    intended_approver_role_key text,
    intended_approver_user_ids uuid[],

    comment       text,
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_run_events_run_idx
    ON public.approval_run_events (run_id, created_at);
CREATE INDEX IF NOT EXISTS approval_run_events_actor_idx
    ON public.approval_run_events (actor_id, created_at DESC);


-- ─── 4. Step-shape validation ───────────────────────────────────────────────
-- Runs on INSERT/UPDATE of approval_flows. A malformed flow must fail when it
-- is saved, not when someone submits a request against it at month end.
CREATE OR REPLACE FUNCTION public.approval_validate_steps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_step      jsonb;
    v_idx       int := 0;
    v_sources   int;
    v_last_type text;
BEGIN
    FOR v_step IN SELECT * FROM jsonb_array_elements(NEW.steps) LOOP
        v_idx := v_idx + 1;

        IF COALESCE((v_step->>'step_order')::int, -1) <> v_idx THEN
            RAISE EXCEPTION
                'approval_flows.steps: step_order must be 1-based and contiguous. Position % has step_order %',
                v_idx, v_step->>'step_order';
        END IF;

        IF COALESCE(v_step->>'step_label', '') = '' THEN
            RAISE EXCEPTION 'approval_flows.steps: step % has no step_label', v_idx;
        END IF;

        v_sources :=
              (COALESCE(v_step->>'approver_role_key','') <> '')::int
            + (COALESCE(jsonb_array_length(v_step->'approver_user_ids'), 0) > 0)::int
            + (COALESCE(v_step->>'approver_resolver','') <> '')::int;

        IF v_sources = 0 THEN
            RAISE EXCEPTION
                'approval_flows.steps: step % names no approver. Set approver_role_key, approver_user_ids or approver_resolver.',
                v_idx;
        END IF;

        v_last_type := v_step->>'step_type';
        IF v_last_type IS NOT NULL AND v_last_type NOT IN ('review','final') THEN
            RAISE EXCEPTION 'approval_flows.steps: step % has invalid step_type "%"', v_idx, v_last_type;
        END IF;

        IF v_step ? 'on_return_restart_from_step'
           AND (v_step->>'on_return_restart_from_step')::int >= v_idx THEN
            RAISE EXCEPTION
                'approval_flows.steps: step % can only return to an EARLIER step (got %)',
                v_idx, v_step->>'on_return_restart_from_step';
        END IF;
    END LOOP;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_approval_validate_steps ON public.approval_flows;
CREATE TRIGGER trg_approval_validate_steps
    BEFORE INSERT OR UPDATE OF steps ON public.approval_flows
    FOR EACH ROW EXECUTE FUNCTION public.approval_validate_steps();


-- ─── 5. updated_at ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_approval_flows_touch ON public.approval_flows;
CREATE TRIGGER trg_approval_flows_touch BEFORE UPDATE ON public.approval_flows
    FOR EACH ROW EXECUTE FUNCTION public.approval_touch_updated_at();

DROP TRIGGER IF EXISTS trg_approval_runs_touch ON public.approval_runs;
CREATE TRIGGER trg_approval_runs_touch BEFORE UPDATE ON public.approval_runs
    FOR EACH ROW EXECUTE FUNCTION public.approval_touch_updated_at();


-- ─── 6. Private helpers ─────────────────────────────────────────────────────
-- These live here rather than in 02_core_functions.sql because the RLS policies
-- and the stranded-runs view below both depend on them. Neither is granted to
-- `authenticated`: they are engine internals.

-- The step object the run is currently sitting on.
CREATE OR REPLACE FUNCTION public.approval_current_step(p_run public.approval_runs)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT p_run.steps_snapshot -> (p_run.current_step - 1);
$$;

-- Resolve one step to the concrete set of users who may act on it.
--
-- PRECEDENCE, and it matters:
--   1. approver_user_ids non-empty  → exactly those users, role ignored.
--      OR logic — first to act wins. This is the one thing the source system's
--      service-request module got right that the other four lacked.
--   2. approver_resolver set        → delegate to the host app's shim.
--   3. approver_role_key set        → role holders, scoped.
-- A step may combine 1 and 3; the union is returned.
--
-- Self-approval is filtered here, not in the client, so scripts and admin
-- tooling cannot bypass it. Per-step opt-out via allow_self_approve.
CREATE OR REPLACE FUNCTION public.approval_step_approvers(
    p_step      jsonb,
    p_requester uuid,
    p_scope     jsonb DEFAULT '{}'::jsonb,
    p_context   jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allow_self bool := COALESCE((p_step->>'allow_self_approve')::bool, false);
BEGIN
    IF p_step IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH named AS (
        SELECT (e.value #>> '{}')::uuid AS user_id
        FROM jsonb_array_elements(COALESCE(p_step->'approver_user_ids', '[]'::jsonb)) e
    ),
    -- NOTE: a WHERE clause here would NOT prevent these calls — a set-returning
    -- function in FROM is evaluated before the filter. Both shim functions
    -- therefore return empty on a NULL/'' key, and that guard is load-bearing:
    -- without it, approval_rbac_resolve_dynamic would raise on every ordinary
    -- role-routed step.
    by_role AS (
        SELECT u AS user_id
        FROM public.approval_rbac_users_with_role(
                 NULLIF(p_step->>'approver_role_key', ''), p_scope) u
    ),
    dynamic AS (
        SELECT u AS user_id
        FROM public.approval_rbac_resolve_dynamic(
                 NULLIF(p_step->>'approver_resolver', ''), p_requester, p_context) u
    ),
    combined AS (
        SELECT user_id FROM named
        UNION
        SELECT user_id FROM by_role
        UNION
        SELECT user_id FROM dynamic
    )
    SELECT c.user_id
    FROM combined c
    WHERE c.user_id IS NOT NULL
      AND (v_allow_self OR c.user_id <> p_requester);
END $$;

COMMENT ON FUNCTION public.approval_step_approvers(jsonb, uuid, jsonb, jsonb) IS
  'Engine internal. Resolves one step to eligible users. Not granted to '
  'authenticated — callers reach it through approval_can_act / approval_my_queue.';


-- ─── 7. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.approval_flows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_run_events ENABLE ROW LEVEL SECURITY;

-- Flows: readable by anyone who can act on approvals (the builder preview and
-- the timeline both need step labels); writable only with flow.manage.
DROP POLICY IF EXISTS approval_flows_read ON public.approval_flows;
CREATE POLICY approval_flows_read ON public.approval_flows
    FOR SELECT TO authenticated
    USING (
        public.approval_rbac_user_has_permission(auth.uid(), 'approvals.run.act')
        OR public.approval_rbac_user_has_permission(auth.uid(), 'approvals.flow.manage')
        OR public.approval_rbac_user_has_permission(auth.uid(), 'approvals.run.view_all')
    );

DROP POLICY IF EXISTS approval_flows_write ON public.approval_flows;
CREATE POLICY approval_flows_write ON public.approval_flows
    FOR ALL TO authenticated
    USING      (public.approval_rbac_user_has_permission(auth.uid(), 'approvals.flow.manage'))
    WITH CHECK (public.approval_rbac_user_has_permission(auth.uid(), 'approvals.flow.manage'));

-- Runs: SELECT = the requester, OR an eligible approver on the current step,
-- OR a support user with view_all. Deliberately NOT as tight as the write path
-- — an engine nobody can see is an engine nobody can debug.
DROP POLICY IF EXISTS approval_runs_read ON public.approval_runs;
CREATE POLICY approval_runs_read ON public.approval_runs
    FOR SELECT TO authenticated
    USING (
        requested_by = auth.uid()
        OR public.approval_rbac_user_has_permission(auth.uid(), 'approvals.run.view_all')
        OR auth.uid() IN (
            SELECT public.approval_step_approvers(
                public.approval_current_step(approval_runs.*),
                approval_runs.requested_by,
                approval_runs.scope,
                approval_runs.context)
        )
    );

-- NO INSERT, NO UPDATE, NO DELETE POLICY ON approval_runs. Deliberate.
-- approval_start_run / approval_act / approval_cancel are SECURITY DEFINER and
-- are the only write path. Adding an UPDATE policy here reopens the hole that
-- let any user with mere view permission advance any run in the source system.

DROP POLICY IF EXISTS approval_run_events_read ON public.approval_run_events;
CREATE POLICY approval_run_events_read ON public.approval_run_events
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.approval_runs r WHERE r.id = run_id));
    -- approval_runs' own SELECT policy does the real filtering here.

-- No INSERT policy on events either — only approval_act writes them.


-- ─── 8. Stranded-run detector ───────────────────────────────────────────────
-- Open runs whose current step resolves to zero eligible approvers. Cheap, and
-- it pays for itself the first time it fires: the single highest-cost defect in
-- the source system was stranded runs sitting unnoticed for months.
-- Surfaced as an admin banner by my-approvals-inbox.tsx.
CREATE OR REPLACE VIEW public.approval_stranded_runs AS
SELECT
    r.id AS run_id,
    r.workflow_key,
    r.subject_table,
    r.subject_id,
    r.current_step,
    public.approval_current_step(r.*) ->> 'step_label' AS step_label,
    r.started_at,
    now() - r.started_at AS age
FROM public.approval_runs r
WHERE r.status = 'in_progress'
  AND NOT EXISTS (
      SELECT 1 FROM public.approval_step_approvers(
          public.approval_current_step(r.*), r.requested_by, r.scope, r.context)
  );

COMMENT ON VIEW public.approval_stranded_runs IS
  'Open runs with zero eligible approvers on the current step. Should always be '
  'empty; a non-empty result is an incident, not a report.';


GRANT SELECT ON public.approval_flows      TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.approval_flows TO authenticated; -- gated by RLS
GRANT SELECT ON public.approval_runs       TO authenticated;
GRANT SELECT ON public.approval_run_events TO authenticated;
GRANT SELECT ON public.approval_stranded_runs TO authenticated;


-- ─── 9. Function grants — A CORRECTION TO THE SKILL, NOT HOUSE STYLE ────────
-- AGENTS.md, "Function grants (STANDING)": no function in schema `public` may
-- be executable by `anon`, and a new function is born callable by TWO
-- independent grants — Postgres's own built-in EXECUTE TO PUBLIC, and
-- Supabase's default privileges for `anon`. Revoking one leaves the other
-- standing, and the migration reads as a lockdown either way. That is 0383's
-- bug, which 0385 had to come back for, and which 0386 then found in eight more
-- functions. Always both, in one statement.
--
-- THE SKILL'S SCHEMA FILE REVOKES NOTHING AT ALL, and one of these is not a
-- style point. `approval_step_approvers` is SECURITY DEFINER and its own
-- comment says it is an engine internal "not granted to authenticated" — but
-- saying so in a comment is not saying so to Postgres. As shipped it is
-- callable by `anon`, and it takes the step JSON as an ARGUMENT: an
-- unauthenticated caller could hand it a fabricated step naming any role and
-- read back the user ids who hold it. That is an approver-roster oracle reachable
-- without a login, which is the same shape as `creator_names()` before 0385.
--
-- 0387 closed the global default for functions created after it, but only in
-- its GLOBAL form and only for grants Supabase issues — Postgres's own
-- PUBLIC EXECUTE still applies. Verify from the catalog with
-- `scripts/check-anon-grants.sql`, never by reading this file: both bugs above
-- applied cleanly and reported success.
revoke all on function public.approval_validate_steps()                         from public, anon;
revoke all on function public.approval_touch_updated_at()                       from public, anon;
revoke all on function public.approval_current_step(public.approval_runs)       from public, anon;
revoke all on function public.approval_step_approvers(jsonb, uuid, jsonb, jsonb) from public, anon;

-- `approval_current_step` and `approval_step_approvers` are NOT granted to
-- `authenticated` either — that is the skill's own design and it is right.
-- Callers reach them through `approval_can_act` / `approval_my_queue` (0502),
-- which decide what a caller is allowed to ask. They still execute inside the
-- RLS policies and the stranded-runs view above, because a policy runs as the
-- view/table owner rather than as the caller.
