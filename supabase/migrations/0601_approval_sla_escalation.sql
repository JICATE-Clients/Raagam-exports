-- ============================================================================
-- Raagam ERP — 0601 Approvals · SLA AND TIME-BASED ESCALATION
--
-- `doc/order/newfeature.md` §3, from the client recording:
--
--   "If a pending budget approval request sits idle past a defined SLA time
--    limit, the system must automatically escalate the request to the next
--    hierarchical authority. Level 1 (Initial) Factory Manager / Lead,
--    configurable 30–120 mins. Level 2 (Escalation) MD / Executive Approver,
--    on timeout exceeded."
--
-- This is Tier 2B of the `dynamic-approval-flow` skill
-- (`assets/sql/03_optional.sql`, SECTION B), applied to the engine 0500–0505
-- installed. The skill ships it "as one indivisible unit — the column, the
-- clock, the sweeper and the schedule. Do not apply half of it", and states why
-- in its key constraints:
--
--   "SLA columns and the SLA sweeper ship together or not at all. A column no
--    code reads is worse than a missing one: it lies to the admin who set it."
--
-- WHICH IS THE STATE THIS REPO IS IN TODAY. `lib/approvals/types.ts` has
-- carried `sla_hours` and `on_sla_breach` since 0500 marked "Tier 2", the flow
-- builder preserves them through its `rest` bag, and NOTHING anywhere reads
-- either one. An admin can set an SLA on a step and no clock starts.
--
--
-- ────────────────────────────────────────────────────────────────────────────
-- TWO DELIBERATE DEVIATIONS FROM THE SHIPPED ASSET, AND WHY
--
-- 1. `sla_minutes`, NOT `sla_hours`.
--
--    The client's matrix is "configurable (e.g. 30–120 mins)". The shipped
--    column is hours, and hours can carry it (`0.5`), but then the admin field
--    says minutes while the stored declaration says hours and something has to
--    convert between them. That is two vocabularies for one fact — the thing
--    AGENTS.md's "one declaration" sections exist to stop. Minutes is the unit
--    the business speaks, so minutes is what is stored.
--
--    `sla_hours` is REMOVED from `lib/approvals/types.ts` in the same change.
--    Leaving it settable beside `sla_minutes` would recreate the exact lie
--    quoted above, with two fields competing to be the one that works.
--
-- 2. `approval_sweep_sla()` RETURNS THE RUN IDS IT TOUCHED.
--
--    The shipped sweeper returns `{breached, escalated, swept_at}` and the
--    skill says "to notify rather than just record: add your notification
--    insert inside the loop". It cannot be done that way here. This app's
--    notification is `lib/notifications/notify.ts` — an in-app row AND a web
--    push signed with VAPID keys through the `web-push` npm package. There is
--    no SQL path to a push. So the sweeper reports WHICH runs moved and the
--    TypeScript half (`lib/approvals/sla.ts`) tells the people, using the
--    engine's own `approval_step_approvers` resolver rather than a second
--    answer to "who approves this".
--
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE CLOCK IS A TRIGGER, NOT AN EDIT TO `approval_act`
--
-- Straight from the skill, and the reason is worth keeping: it leaves
-- 0502_approval_core_functions.sql byte-identical, so SLA can be added or
-- removed without a diff to the engine's ONLY write path. `approval_runs` has
-- no UPDATE policy; every rule about who may advance a run lives in that file
-- and nowhere else.
--
--
-- ────────────────────────────────────────────────────────────────────────────
-- THE VALIDATOR GAINS TWO RULES, SO A MIS-SET SLA FAILS AT THE FLOW
--
-- AGENTS.md's "Stated vs enforced": a rule with nothing refusing it is
-- invisible. Both new rules refuse at `approval_flows` save time, where the
-- admin is looking, rather than at 3am inside a sweep nobody is watching:
--
--   * `sla_minutes` must be a positive number. `"30 mins"` typed into a text
--     box would otherwise cast-fail inside the trigger and take down a save of
--     the RUN, not of the flow.
--   * `on_sla_breach = 'escalate'` is REFUSED on the LAST step. There is
--     nowhere to escalate to, so the setting is dead data wearing the shape of
--     a policy — and the sweeper's own guard would silently do nothing. The
--     skill names this shape: "Escalating into a void is the stranding bug
--     wearing a different hat."
--
-- `approval_run_events.action` ALREADY allows 'sla_breach' (0501). Nothing to
-- widen; the event row is the hook point the skill describes.
-- ============================================================================


-- NUMBERED 0601 AND NOT 0600 because a parallel session took 0600 for
-- `0600_approval_super_admin_role_holders.sql` earlier the same day — the same
-- clash 0505 records against 0504. Migrations apply in lexical order, so two
-- files sharing a number is not cosmetic; it is an undefined apply order
-- between them. That one rewrites `approval_rbac_users_with_role` so a super
-- admin who HOLDS a role resolves as an approver, which this file depends on:
-- without it the escalation step below would resolve to nobody and the sweeper
-- would decline every escalation, correctly and invisibly.


DO $$
BEGIN
    IF to_regclass('public.approval_runs') IS NULL THEN
        RAISE EXCEPTION '0601: apply 0500–0505 (the approval engine) first.';
    END IF;
END $$;


-- ─── 1. The columns ─────────────────────────────────────────────────────────

ALTER TABLE public.approval_runs
    ADD COLUMN IF NOT EXISTS current_step_started_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS sla_due_at              timestamptz,
    ADD COLUMN IF NOT EXISTS sla_breached_at         timestamptz;

COMMENT ON COLUMN public.approval_runs.sla_due_at IS
  'When the CURRENT step is due, from its sla_minutes. NULL = this step has no '
  'deadline. Recomputed by trg_approval_recompute_sla on every step change.';
COMMENT ON COLUMN public.approval_runs.sla_breached_at IS
  'Set once by approval_sweep_sla. Non-NULL is what makes the sweep idempotent '
  '— a run is never swept twice for the same step.';

-- PARTIAL, on exactly the sweep's predicate: the sweeper scans every open run
-- on a schedule, and this is the only index it needs.
CREATE INDEX IF NOT EXISTS approval_runs_sla_sweep_idx
    ON public.approval_runs (sla_due_at)
    WHERE status = 'in_progress' AND sla_breached_at IS NULL;

-- BACKFILL, for the runs already in flight. `current_step_started_at` defaults
-- to now() on the ALTER, which would date every open run from this migration —
-- harmless for the clock (no existing flow declares an SLA yet, so nothing is
-- due) but wrong in the log. `started_at` is the honest floor: the run has been
-- on SOME step since then.
UPDATE public.approval_runs
   SET current_step_started_at = started_at
 WHERE current_step_started_at > started_at;


-- ─── 2. The clock ───────────────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE OF current_step, status. Fires when a run is born,
-- when it advances, when a return sends it back, and when it ends.
CREATE OR REPLACE FUNCTION public.approval_recompute_sla()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_minutes numeric;
BEGIN
    -- An UPDATE that touched neither the step nor the status is not a move.
    -- (The trigger's own UPDATE OF clause narrows this already; the guard is
    -- what makes a multi-column UPDATE that merely mentions them a no-op.)
    IF TG_OP = 'UPDATE'
       AND NEW.current_step IS NOT DISTINCT FROM OLD.current_step
       AND NEW.status       IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    -- A finished run has no deadline. Leaving `sla_due_at` set on a completed
    -- run would keep it inside the sweep's partial index for ever.
    IF NEW.status <> 'in_progress' THEN
        NEW.sla_due_at := NULL;
        RETURN NEW;
    END IF;

    NEW.current_step_started_at := now();
    -- THE BREACH FLAG CLEARS ON EVERY MOVE. A return that sends a run back to
    -- step 1 gives step 1 a fresh deadline; carrying the old breach forward
    -- would mean the step could never be swept again.
    NEW.sla_breached_at := NULL;

    v_minutes := NULLIF(NEW.steps_snapshot -> (NEW.current_step - 1) ->> 'sla_minutes', '')::numeric;
    NEW.sla_due_at := CASE WHEN v_minutes IS NULL OR v_minutes <= 0 THEN NULL
                           ELSE now() + (v_minutes || ' minutes')::interval END;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_approval_recompute_sla ON public.approval_runs;
CREATE TRIGGER trg_approval_recompute_sla
    BEFORE INSERT OR UPDATE OF current_step, status ON public.approval_runs
    FOR EACH ROW EXECUTE FUNCTION public.approval_recompute_sla();


-- ─── 3. The validator ───────────────────────────────────────────────────────
-- 0501's function, with the two SLA rules appended. Rewritten whole rather than
-- patched, because it is one CREATE OR REPLACE and a partial copy would be a
-- second definition of the step contract.
CREATE OR REPLACE FUNCTION public.approval_validate_steps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_step      jsonb;
    v_idx       int := 0;
    v_count     int;
    v_sources   int;
    v_last_type text;
    v_breach    text;
    v_sla       text;
BEGIN
    v_count := jsonb_array_length(NEW.steps);

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

        -- ── 0601: the SLA half ──────────────────────────────────────────────
        v_sla := NULLIF(v_step->>'sla_minutes', '');
        IF v_sla IS NOT NULL THEN
            -- A NUMBER, not a sentence. "30 mins" typed into the box would cast
            -- -fail inside approval_recompute_sla instead — taking down the save
            -- of a RUN, with a message about a column the admin never saw.
            IF jsonb_typeof(v_step->'sla_minutes') <> 'number' OR (v_sla)::numeric <= 0 THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % has sla_minutes "%" — it must be a number of minutes greater than zero',
                    v_idx, v_sla;
            END IF;
        END IF;

        v_breach := NULLIF(v_step->>'on_sla_breach', '');
        IF v_breach IS NOT NULL THEN
            IF v_breach NOT IN ('none','notify','escalate') THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % has on_sla_breach "%" — expected none, notify or escalate',
                    v_idx, v_breach;
            END IF;
            -- NOWHERE TO ESCALATE TO. The sweeper guards this at run time and
            -- would quietly do nothing; refusing it here is what stops the
            -- setting existing as a policy that never fires.
            IF v_breach = 'escalate' AND v_idx = v_count THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % is the last step, so on_sla_breach cannot be "escalate" — there is no step above it. Use notify, or add the step it should escalate to.',
                    v_idx;
            END IF;
            IF v_sla IS NULL AND v_breach <> 'none' THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % sets on_sla_breach "%" with no sla_minutes — nothing would ever trigger it',
                    v_idx, v_breach;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END $$;


-- ─── 4. The sweeper ─────────────────────────────────────────────────────────
-- ONE GENERIC JOB, not one cron per module. The skill records why: the source
-- system's only working escalation was a Vercel cron that hardcoded 72 hours
-- and a single workflow, leaving the SLA on every other stage as dead data.
CREATE OR REPLACE FUNCTION public.approval_sweep_sla(p_limit int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run       public.approval_runs;
    v_step      jsonb;
    v_action    text;
    v_escalated bool;
    v_breached  int := 0;
    v_count_esc int := 0;
    v_runs      jsonb := '[]'::jsonb;
BEGIN
    FOR v_run IN
        SELECT * FROM public.approval_runs
        WHERE status = 'in_progress'
          AND sla_due_at IS NOT NULL
          AND sla_due_at < now()
          AND sla_breached_at IS NULL
        ORDER BY sla_due_at
        LIMIT GREATEST(COALESCE(p_limit, 500), 1)
        FOR UPDATE SKIP LOCKED
    LOOP
        v_step   := public.approval_current_step(v_run);
        v_action := COALESCE(v_step->>'on_sla_breach', 'notify');
        v_escalated := false;

        -- IDEMPOTENT. Setting sla_breached_at is what stops a run being swept
        -- twice for one step; the clock clears it again on the next move.
        UPDATE public.approval_runs SET sla_breached_at = now() WHERE id = v_run.id;
        v_breached := v_breached + 1;

        INSERT INTO public.approval_run_events (run_id, step_order, step_key, action, metadata)
        VALUES (v_run.id, v_run.current_step, v_step->>'step_key', 'sla_breach',
                jsonb_build_object(
                    'on_sla_breach', v_action,
                    'due_at',        v_run.sla_due_at,
                    'step_label',    v_step->>'step_label'));

        IF v_action = 'escalate'
           AND v_run.current_step < jsonb_array_length(v_run.steps_snapshot) THEN
            -- ONLY IF THE NEXT STEP HAS SOMEBODY. Escalating into a void is the
            -- stranding bug wearing a different hat: the run would advance to a
            -- step in nobody's queue and stop being actionable at all. The
            -- validator refuses 'escalate' on a last step; this covers the
            -- other case — a next step whose ROLE has no holders today.
            IF EXISTS (
                SELECT 1 FROM public.approval_step_approvers(
                    v_run.steps_snapshot -> v_run.current_step,
                    v_run.requested_by, v_run.scope, v_run.context)
            ) THEN
                UPDATE public.approval_runs
                   SET current_step = current_step + 1,
                       lock_version = lock_version + 1
                 WHERE id = v_run.id;
                v_escalated := true;
                v_count_esc := v_count_esc + 1;
            END IF;
        END IF;

        -- WHAT THE TYPESCRIPT HALF NEEDS. See the header: the push cannot be
        -- sent from here, so the ids go back with enough context to word the
        -- message without re-reading the run.
        v_runs := v_runs || jsonb_build_object(
            'run_id',       v_run.id,
            'workflow_key', v_run.workflow_key,
            'subject_id',   v_run.subject_id,
            'on_breach',    v_action,
            'escalated',    v_escalated,
            'step_order',   v_run.current_step,
            'step_label',   v_step->>'step_label',
            'due_at',       v_run.sla_due_at,
            'requested_by', v_run.requested_by);
    END LOOP;

    RETURN jsonb_build_object(
        'breached',  v_breached,
        'escalated', v_count_esc,
        'runs',      v_runs,
        'swept_at',  now());
END $$;

-- SERVICE ROLE ONLY. It advances runs past an approver who has not acted, which
-- is the one power no signed-in user may hold. `lib/approvals/sla.ts` reaches it
-- through the admin client; the cron route is the only caller.
--
-- BOTH GRANTS, IN ONE STATEMENT — AGENTS.md "Function grants": a new function is
-- born anon-callable twice over (Postgres's built-in EXECUTE TO PUBLIC and
-- Supabase's own default privilege), and revoking one leaves the other standing.
REVOKE ALL ON FUNCTION public.approval_sweep_sla(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approval_sweep_sla(int) TO service_role;

COMMENT ON FUNCTION public.approval_sweep_sla(int) IS
  'Tier 2B sweeper. Marks every open run past its sla_due_at as breached, logs '
  'an sla_breach event, and advances the ones whose step says escalate. Returns '
  'the runs it touched so the caller can notify. service_role only.';


-- ─── 5. The queue carries the deadline ──────────────────────────────────────
-- The inbox has to be able to say "overdue" from the read that builds it. A
-- second query against `approval_runs` for the same rows is a second predicate
-- to keep in step with this one — the drift the engine's "ONE predicate" note
-- (0502 §7) exists to prevent.
--
-- DROP then CREATE, not CREATE OR REPLACE: Postgres cannot change a function's
-- OUT parameters in place. The grant is re-issued below because DROP takes it.
DROP FUNCTION IF EXISTS public.approval_my_queue(text, uuid, int, int, uuid);

CREATE FUNCTION public.approval_my_queue(
    p_workflow_key text DEFAULT NULL,
    p_tenant_id    uuid DEFAULT NULL,
    p_limit        int  DEFAULT 50,
    p_offset       int  DEFAULT 0,
    p_user_id      uuid DEFAULT auth.uid()
)
RETURNS TABLE (
    run_id          uuid,
    workflow_key    text,
    subject_table   text,
    subject_id      uuid,
    step_order      int,
    step_label      text,
    requested_by    uuid,
    started_at      timestamptz,
    waiting_hours   numeric,
    lock_version    int,
    sla_due_at      timestamptz,
    sla_breached_at timestamptz,
    is_overdue      boolean,
    total_count     bigint
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
        m.sla_due_at,
        m.sla_breached_at,
        -- ANSWERED HERE, NOT IN THE BROWSER. Two reasons, and the second is the
        -- one that decides it: `Date.now()` during a React render is impure and
        -- the React Compiler refuses it outright — but even allowed, it is the
        -- WRONG CLOCK. A phone whose time is days out would paint half the queue
        -- red or none of it, and an SLA is a claim about the business's clock.
        -- This is the same `now()` `approval_sweep_sla` breaches by, so the
        -- colour on the card and the escalation that follows it cannot disagree.
        (m.sla_due_at IS NOT NULL AND m.sla_due_at < now()),
        count(*) OVER ()
    -- OVERDUE FIRST, then oldest. The original ordering was `started_at ASC`
    -- alone; with a deadline on the row, a request that is late is the one the
    -- approver has to see without scrolling.
    FROM mine m
    ORDER BY (m.sla_due_at IS NOT NULL AND m.sla_due_at < now()) DESC,
             m.sla_due_at ASC NULLS LAST,
             m.started_at ASC
    LIMIT  GREATEST(COALESCE(p_limit, 50), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.approval_my_queue(text, uuid, int, int, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approval_my_queue(text, uuid, int, int, uuid) TO authenticated;
