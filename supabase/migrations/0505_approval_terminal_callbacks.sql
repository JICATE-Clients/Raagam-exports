-- ============================================================================
-- 0505 — Dynamic Approval Flow · THE TERMINAL CALLBACK
--
-- Apply AFTER 0500–0503.
--
-- NUMBERED 0505 AND NOT 0504 because a parallel branch of work took 0504 for
-- `0504_fabric_bom_yarn_stages.sql` two minutes earlier. Migrations apply in
-- lexical order, so two files sharing a number is not a cosmetic clash — it is
-- an undefined apply order between them. The gap is deliberate; nothing is
-- missing.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A TRIGGER, NOT THE `onDecided` CALLBACK — and the skill says why
--
-- Phase 4 of the integration guide offers two seams for "the run finished, now
-- change the document", and picks between them without hedging:
--
--   * a trigger on `approval_runs.status` — "Preferred: it cannot be forgotten,
--     and it keeps 'approved' and 'applied' from diverging";
--   * the `onDecided` callback in the action bar — "Simpler, but it does not
--     fire when the SLA sweeper escalates or when an admin cancels."
--
-- The second reason is the decisive one here. `approval_act` is not the only way
-- a run reaches a terminal state: `approval_cancel` is a separate RPC, and any
-- Tier-2 sweeper added later runs under `service_role` with no browser
-- anywhere. A callback in the action bar would cover the happy path and leave
-- the budget saying "submitted" for ever in the two cases nobody is watching.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ONE FUNCTION, A BRANCH PER DOCUMENT
--
-- Written as a single trigger with a CASE on `subject_table` rather than one
-- trigger per document. Wiring the second workflow is then a branch here, and
-- the "did anything happen?" guard at the bottom is shared — which is what stops
-- a new document being wired into the app, approved by a real person, and
-- silently not applied because somebody forgot the second half.
--
-- Only `order_budget` is wired today. The other three declared workflows
-- (`order_amendment`, `purchase_indent`, `purchase_order`) reach the ELSE branch
-- and RAISE, deliberately — see the note there.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHAT `cancelled` DOES: NOTHING, AND THAT IS A DECISION TO REVISIT
--
-- The skill names `completed` and `rejected` as the terminal states a callback
-- must handle. `cancelled` is the third, and Raagam has no honest answer for it
-- yet: 0428's `canTransition` says a submitted budget may go only to `approved`
-- or `rejected`, so sending it back to `draft` would invent a transition the
-- business has not agreed to, and 0428's own comment is emphatic that an
-- approved budget never reopens because purchase is already acting on it.
--
-- So a cancelled run leaves the budget `submitted` with no live approval. That
-- is a document nobody is being asked about — visible in the Budget list as
-- submitted, and absent from every queue. It is the honest state rather than a
-- guessed one, but it IS a loose end: ask the client whether cancelling an
-- approval should return the budget to draft, and add the branch when they say.
-- ============================================================================


DO $$
BEGIN
    IF to_regclass('public.approval_runs') IS NULL THEN
        RAISE EXCEPTION 'dynamic-approval-flow: apply 0500–0503 before 0504.';
    END IF;
END $$;


CREATE OR REPLACE FUNCTION public.approval_apply_terminal()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER because the subject's own RLS would otherwise decide whether
-- the decision applies. The approver who just approved a budget may well hold no
-- write permission on `order_budgets` at all — approving is not editing — and on
-- a cancel or a sweeper escalation there is no user in the session to check.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_remark text;
    v_rows   int;
BEGIN
    -- Only a transition INTO a terminal state, and only once. `approval_act`
    -- updates the run on every step (current_step, lock_version), so without
    -- this the body would run on each approval of a multi-step chain and stamp
    -- the document as decided at step 1.
    IF NEW.status = OLD.status OR NEW.status = 'in_progress' THEN
        RETURN NEW;
    END IF;

    -- THE DECIDER'S OWN WORDS, carried onto the document. `approval_act` demands
    -- a comment for a rejection, so this is never empty on the path where it
    -- matters most — and "rejected" with no reason on the budget screen sends
    -- the merchandiser back to the approver to ask what was wrong.
    SELECT e.comment INTO v_remark
    FROM public.approval_run_events e
    WHERE e.run_id = NEW.id
      AND e.action IN ('approve', 'reject', 'cancel')
    ORDER BY e.created_at DESC
    LIMIT 1;

    IF NEW.subject_table = 'order_budgets' THEN
        -- `cancelled` deliberately falls through and writes nothing — see the
        -- header. The budget stays `submitted`.
        IF NEW.status NOT IN ('completed', 'rejected') THEN
            RETURN NEW;
        END IF;

        UPDATE public.order_budgets b
        SET status = CASE NEW.status WHEN 'completed' THEN 'approved' ELSE 'rejected' END,
            -- BOTH HALVES OR NEITHER — `chk_ob_decision` (0428) refuses a row
            -- that says it was approved by nobody, or at no time, and
            -- `chk_ob_decision_matches_status` refuses a decided timestamp on an
            -- undecided status. Writing the three together is what satisfies both.
            decided_at      = COALESCE(NEW.completed_at, now()),
            decided_by      = NEW.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        WHERE b.id = NEW.subject_id
          -- IDEMPOTENT BY PREDICATE. A re-run, a replayed event or a second
          -- trigger firing cannot overwrite a decision that is already recorded,
          -- and cannot move an approved budget purchase is already acting on.
          AND b.status = 'submitted';

        GET DIAGNOSTICS v_rows = ROW_COUNT;

        -- A DECISION THAT APPLIED TO NOTHING IS THE FAILURE THIS WHOLE FILE
        -- EXISTS TO PREVENT: the run says approved, the document still says
        -- submitted, and the two never reconcile. Raising rolls the decision
        -- back, so the approver is told rather than the divergence being stored.
        --
        -- It fires when the budget was decided by some other path while the run
        -- was open, or was deleted. Both are real, and both are worth a refusal.
        IF v_rows = 0 THEN
            RAISE EXCEPTION
                'approval_apply_terminal: order_budget % is not awaiting a decision, so this approval could not be applied. Reload the budget — it may already have been decided another way.',
                NEW.subject_id
                USING ERRCODE = '55000';
        END IF;

        RETURN NEW;
    END IF;

    -- THE ELSE BRANCH RAISES, and that is the same decision the RBAC shim's
    -- `approval_rbac_resolve_dynamic` makes for an unimplemented resolver.
    --
    -- A workflow whose terminal callback silently did nothing would let a real
    -- person approve a real document and change nothing about it — an approval
    -- that exists only in the audit log, discovered whenever somebody finally
    -- asks why the indent is still pending. Wiring the start call without the
    -- terminal is the easy half to forget, so it fails loudly at the moment the
    -- FIRST such run is decided, in front of the person who decided it.
    RAISE EXCEPTION
        'approval_apply_terminal: no terminal callback is implemented for subject_table "%". Add a branch in 0505 before starting runs for it.',
        NEW.subject_table
        USING ERRCODE = '0A000';
END $$;

COMMENT ON FUNCTION public.approval_apply_terminal() IS
  'Applies a finished approval run to its subject document. One branch per subject_table; an unwired table raises rather than silently doing nothing. 0505.';


DROP TRIGGER IF EXISTS trg_approval_apply_terminal ON public.approval_runs;
CREATE TRIGGER trg_approval_apply_terminal
    -- AFTER, not BEFORE: the run's own row must be committed as decided before
    -- anything downstream reads it, and an exception here still rolls both back
    -- because they are one statement in one transaction.
    --
    -- `OF status` narrows it to the column that matters, so the ordinary
    -- step-advance update (current_step, lock_version) does not even enter the
    -- function.
    AFTER UPDATE OF status ON public.approval_runs
    FOR EACH ROW EXECUTE FUNCTION public.approval_apply_terminal();


-- AGENTS.md, "Function grants (STANDING)": both grants, in one statement. A
-- trigger function is not callable through PostgREST, but it is still born with
-- Postgres's built-in EXECUTE TO PUBLIC and Supabase's separate `anon` grant —
-- and this one is SECURITY DEFINER and writes to `order_budgets`.
revoke all on function public.approval_apply_terminal() from public, anon;
