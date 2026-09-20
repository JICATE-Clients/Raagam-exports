-- ============================================================================
-- Raagam ERP — 0603 Approvals · "Tell the approver who missed it", per step
--
-- 0601 built the escalation and deliberately told the missed approver NOTHING.
-- The user reviewed that choice, endorsed it as the DEFAULT, and asked for it
-- to be configurable — in their words:
--
--   "Stick with Option B as the system default, but offer it as a configurable
--    setting for the client. … If managers feel penalized or nagged by SLA
--    breach notifications, they tend to blindly hit Approve just to clear the
--    notification clock — defeating the purpose of budget oversight. … However,
--    we can toggle 'Notify Missed Approver' ON if you prefer strict SLA
--    visibility for your team."
--
--
-- 1. IT IS A PROPERTY OF THE STEP, NOT AN APP SETTING
--
-- The ask reads as one global switch, and a global switch is what this file
-- deliberately does not build. Three reasons, in order of weight:
--
--   * THE ENGINE ALREADY HAS EXACTLY ONE PLACE WHERE "how this approval
--     behaves" is declared, and this is that kind of fact. `sla_minutes` and
--     `on_sla_breach` live on the step; a sibling policy living somewhere else
--     is two places to look and two places to keep true — the same "two
--     vocabularies for one fact" 0601's header refuses for `sla_hours`.
--
--   * A RUN FREEZES ITS STEPS (`steps_snapshot`). A policy on the step is
--     therefore frozen WITH the request, so a budget escalating tonight behaves
--     the way the flow said when it was submitted. A global setting read at
--     sweep time would silently change the rules under 200 requests in flight,
--     which is the precise failure `steps_snapshot` exists to prevent.
--
--   * "STRICT SLA VISIBILITY FOR YOUR TEAM" IS PER TEAM. The phrase in the
--     recommendation is itself scoped — a factory manager step and a finance
--     step are not obviously the same call. Per step, "globally on" is simply
--     "ticked on the steps you mean", and the Flows screen shows which.
--
-- DEFAULT OFF, and absent means off. Nothing in this migration changes how a
-- single existing flow behaves.
--
--
-- 2. `true` IS REFUSED UNLESS THE STEP ESCALATES
--
-- On a `notify` breach the reminder already goes to the CURRENT approvers —
-- who, since the run has not moved, are the people who missed it. Ticking this
-- there would send the same people a second message about the same thing.
-- On `none` the admin has said chase nobody.
--
-- So it is only meaningful beside `escalate`, where the item leaves their queue
-- and they would otherwise never hear. Anything else is the setting existing as
-- a policy that never fires — the shape AGENTS.md's "Stated vs enforced" and
-- 0601's own two validator rules both refuse at flow-save time, where the admin
-- is looking.
--
--
-- 3. THE SWEEPER RESOLVES WHO THEY WERE, BECAUSE ONLY IT STILL CAN
--
-- By the time `lib/approvals/sla.ts` reads the result, `current_step` has
-- already advanced — so asking "who are this run's approvers?" then returns the
-- people it escalated TO, not the people it escalated FROM. The breached step's
-- approvers are resolved inside the loop, through
-- `approval_step_approvers` — the same predicate `approval_can_act` and
-- `approval_my_queue` use, never a second answer to "who approves this".
--
-- They come back as `missed_approvers` on the run's payload, populated ONLY
-- when the step asked and the run actually moved. A declined escalation (the
-- void guard) leaves it empty: nobody lost anything, so nobody is told they did.
-- ============================================================================


DO $$
BEGIN
    IF to_regclass('public.approval_runs') IS NULL
       OR to_regclass('public.approval_flows') IS NULL THEN
        RAISE EXCEPTION '0603: apply 0500–0505 and 0601 first.';
    END IF;
END $$;


-- ─── 1. The validator gains the third SLA rule ──────────────────────────────
-- 0601's function with one block appended. Rewritten whole rather than patched:
-- it is one CREATE OR REPLACE, and a partial copy would be a second definition
-- of the step contract.
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
            IF jsonb_typeof(v_step->'sla_minutes') <> 'number' OR (v_sla)::numeric <= 0 THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % has sla_minutes "%" - it must be a number of minutes greater than zero',
                    v_idx, v_sla;
            END IF;
        END IF;

        v_breach := NULLIF(v_step->>'on_sla_breach', '');
        IF v_breach IS NOT NULL THEN
            IF v_breach NOT IN ('none','notify','escalate') THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % has on_sla_breach "%" - expected none, notify or escalate',
                    v_idx, v_breach;
            END IF;
            IF v_breach = 'escalate' AND v_idx = v_count THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % is the last step, so on_sla_breach cannot be "escalate" - there is no step above it. Use notify, or add the step it should escalate to.',
                    v_idx;
            END IF;
            IF v_sla IS NULL AND v_breach <> 'none' THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % sets on_sla_breach "%" with no sla_minutes - nothing would ever trigger it',
                    v_idx, v_breach;
            END IF;
        END IF;

        -- ── 0603: telling the approver who missed it ────────────────────────
        IF v_step ? 'notify_missed_approver' THEN
            IF jsonb_typeof(v_step->'notify_missed_approver') <> 'boolean' THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % has notify_missed_approver "%" - it must be true or false',
                    v_idx, v_step->>'notify_missed_approver';
            END IF;
            -- See the header, section 2: anywhere but 'escalate' it is either a
            -- duplicate of the reminder those same people already get, or a
            -- contradiction of "chase nobody".
            IF (v_step->>'notify_missed_approver')::boolean
               AND COALESCE(v_breach, 'notify') <> 'escalate' THEN
                RAISE EXCEPTION
                    'approval_flows.steps: step % asks to tell the missed approver, but it does not escalate - on a reminder they are already the ones told, and on "none" nobody is chased. Set on_sla_breach to "escalate", or untick it.',
                    v_idx;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END $$;


-- ─── 2. The sweeper reports who lost the item ───────────────────────────────
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
    v_missed    uuid[];
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
        v_missed := ARRAY[]::uuid[];

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
            IF EXISTS (
                SELECT 1 FROM public.approval_step_approvers(
                    v_run.steps_snapshot -> v_run.current_step,
                    v_run.requested_by, v_run.scope, v_run.context)
            ) THEN
                /* RESOLVED BEFORE THE ADVANCE, and only if asked. After the
                   UPDATE below, "this run's approvers" means the people it went
                   TO — the ones it came FROM are unreachable without the step
                   object, which only this loop still holds (0603, §3). */
                IF COALESCE((v_step->>'notify_missed_approver')::boolean, false) THEN
                    SELECT COALESCE(array_agg(u), ARRAY[]::uuid[]) INTO v_missed
                    FROM public.approval_step_approvers(
                        v_step, v_run.requested_by, v_run.scope, v_run.context) u;
                END IF;

                UPDATE public.approval_runs
                   SET current_step = current_step + 1,
                       lock_version = lock_version + 1
                 WHERE id = v_run.id;
                v_escalated := true;
                v_count_esc := v_count_esc + 1;
            END IF;
        END IF;

        v_runs := v_runs || jsonb_build_object(
            'run_id',          v_run.id,
            'workflow_key',    v_run.workflow_key,
            'subject_id',      v_run.subject_id,
            'on_breach',       v_action,
            'escalated',       v_escalated,
            'step_order',      v_run.current_step,
            'step_label',      v_step->>'step_label',
            'due_at',          v_run.sla_due_at,
            'requested_by',    v_run.requested_by,
            -- EMPTY unless the step asked AND the run actually moved. A
            -- declined escalation cost nobody anything, so nobody is told it
            -- did.
            'missed_approvers', to_jsonb(v_missed));
    END LOOP;

    RETURN jsonb_build_object(
        'breached',  v_breached,
        'escalated', v_count_esc,
        'runs',      v_runs,
        'swept_at',  now());
END $$;

REVOKE ALL ON FUNCTION public.approval_sweep_sla(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approval_sweep_sla(int) TO service_role;


-- ─── 3. The seeded chain leaves it OFF, in writing ──────────────────────────
-- The default is absence, so this changes nothing about behaviour. It is set
-- explicitly so the Flows screen shows the switch in its OFF position rather
-- than showing nothing — the client's decision is a decision, and a reader of
-- the flow should see that it was made.
UPDATE public.approval_flows f
   SET steps = jsonb_set(f.steps, '{0,notify_missed_approver}', to_jsonb(false), true)
 WHERE f.workflow_key = 'order_budget'
   AND f.steps -> 0 ->> 'on_sla_breach' = 'escalate'
   AND NOT (f.steps -> 0 ? 'notify_missed_approver');
