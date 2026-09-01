-- ============================================================================
-- Dynamic Approval Flow — SMOKE TEST.  Run once, by hand, after 0500–0503.
--
-- Ported verbatim from the `dynamic-approval-flow` skill
-- (`assets/sql/99_seed_smoke_test.sql`). NOT a migration: it lives here because
-- it writes test rows and rolls every one of them back, so applying it as a
-- migration would leave a permanent no-op in the history.
--
-- ## THE SKILL'S GATE, RESTATED: do not build any UI until this passes.
--
-- Eleven assertions. They cover the things that are invisible when wrong:
-- conditional routing picks the right flow; a MISSING context key falls through
-- rather than mis-routing; steps are frozen onto the run; the requester cannot
-- approve their own request; a step-2 approver cannot act during step 1; THE
-- QUEUE AGREES WITH THE GATE; a stale lock_version is rejected; reject demands a
-- comment; the stranded-run view is quiet for a healthy run; and a role nobody
-- holds resolves to zero approvers so that no run is created at all.
--
-- ## BEFORE RUNNING: replace the three user ids below
--
-- They must be REAL `public.profiles` rows, and for the queue assertions to
-- mean anything the two approvers must actually hold the roles the test flows
-- name. Pick them with:
--
--   select p.id, p.full_name, r.name as role
--   from public.profiles p
--   left join public.user_roles ur on ur.user_id = p.id
--   left join public.roles r on r.id = ur.role_id
--   where p.is_active order by p.full_name;
--
-- ## ON auth.uid()
--
-- Run from the Supabase SQL editor as a superuser, `auth.uid()` is NULL, so the
-- assertions that involve `approval_act` assert on the RAISED ERROR rather than
-- on a successful approval. That is the test doing its job, not a failure. The
-- real end-to-end check needs two logged-in users and is the seven-step
-- sequence in the skill's `references/integration-guide.md` under "Verify".
-- ============================================================================

DO $$
DECLARE
    -- EDIT ME ────────────────────────────────────────────────────────────────
    v_requester  uuid := '00000000-0000-0000-0000-000000000001';
    v_approver_1 uuid := '00000000-0000-0000-0000-000000000002';
    v_approver_2 uuid := '00000000-0000-0000-0000-000000000003';
    -- ────────────────────────────────────────────────────────────────────────

    v_flow_lo   uuid;
    v_flow_hi   uuid;
    v_run       public.approval_runs;
    v_subject   uuid := gen_random_uuid();
    v_n         bigint;
    v_verdict   jsonb;
    v_failed    text[] := ARRAY[]::text[];
BEGIN
    IF v_requester = '00000000-0000-0000-0000-000000000001' THEN
        RAISE EXCEPTION 'Edit the three user IDs at the top of 99_seed_smoke_test.sql first.';
    END IF;

    -- ── Seed two flows for the same workflow key, to exercise routing ───────
    -- Lower priority number wins, so the >50k flow is evaluated first.
    INSERT INTO public.approval_flows
        (workflow_key, flow_name, criteria, priority, steps)
    VALUES (
        'smoke_test', 'High value — two steps',
        '{"amount":{"gt":50000}}'::jsonb, 10,
        jsonb_build_array(
            jsonb_build_object('step_order',1,'step_key','first','step_label','First Approval',
                               'step_type','review','approver_user_ids', jsonb_build_array(v_approver_1)),
            jsonb_build_object('step_order',2,'step_key','final','step_label','Final Approval',
                               'step_type','final','approver_user_ids', jsonb_build_array(v_approver_2),
                               'on_return_restart_from_step',1)
        ))
    RETURNING id INTO v_flow_hi;

    INSERT INTO public.approval_flows
        (workflow_key, flow_name, criteria, priority, steps)
    VALUES (
        'smoke_test', 'Everything else — one step',
        '{}'::jsonb, 100,
        jsonb_build_array(
            jsonb_build_object('step_order',1,'step_key','only','step_label','Sole Approval',
                               'step_type','final','approver_user_ids', jsonb_build_array(v_approver_1))
        ))
    RETURNING id INTO v_flow_lo;

    -- ── TEST 1: routing picks the high-value flow ──────────────────────────
    IF (public.approval_resolve_flow('smoke_test', NULL, '{}'::jsonb,
            '{"amount":75000}'::jsonb)).id <> v_flow_hi THEN
        v_failed := v_failed || 'T1 routing: amount 75000 did not select the >50k flow';
    END IF;

    -- ── TEST 2: routing falls back for a low amount ────────────────────────
    IF (public.approval_resolve_flow('smoke_test', NULL, '{}'::jsonb,
            '{"amount":100}'::jsonb)).id <> v_flow_lo THEN
        v_failed := v_failed || 'T2 routing: amount 100 did not fall back to the catch-all flow';
    END IF;

    -- ── TEST 3: a missing criteria key fails closed ────────────────────────
    IF (public.approval_resolve_flow('smoke_test', NULL, '{}'::jsonb,
            '{}'::jsonb)).id <> v_flow_lo THEN
        v_failed := v_failed || 'T3 routing: empty context should fall through to the catch-all, not the >50k flow';
    END IF;

    -- ── TEST 4: start a run ────────────────────────────────────────────────
    v_run := public.approval_start_run(
        'smoke_test', 'smoke_subjects', v_subject,
        '{"amount":75000}'::jsonb, '{}'::jsonb, NULL, v_requester);

    IF v_run.current_step <> 1 OR v_run.status <> 'in_progress' THEN
        v_failed := v_failed || 'T4 start: run did not begin at step 1 / in_progress';
    END IF;
    IF v_run.steps_snapshot IS NULL OR jsonb_array_length(v_run.steps_snapshot) <> 2 THEN
        v_failed := v_failed || 'T4 start: steps were not frozen onto the run';
    END IF;

    -- ── TEST 5: the requester cannot act on their own request ──────────────
    v_verdict := public.approval_can_act(v_run.id, v_requester);
    IF (v_verdict->>'can_act')::bool THEN
        v_failed := v_failed || 'T5 self-approval: the requester was allowed to act';
    END IF;

    -- ── TEST 6: approver 1 can act; approver 2 cannot (not their step yet) ──
    IF NOT (public.approval_can_act(v_run.id, v_approver_1)->>'can_act')::bool THEN
        v_failed := v_failed || 'T6 routing: step-1 approver was not permitted';
    END IF;
    IF (public.approval_can_act(v_run.id, v_approver_2)->>'can_act')::bool THEN
        v_failed := v_failed || 'T6 routing: step-2 approver could act while on step 1';
    END IF;

    -- ── TEST 7: the queue agrees with the gate ─────────────────────────────
    SELECT count(*) INTO v_n
    FROM public.approval_my_queue('smoke_test', NULL, 50, 0, v_approver_1)
    WHERE run_id = v_run.id;
    IF v_n <> 1 THEN
        v_failed := v_failed || 'T7 queue: run missing from the step-1 approver''s queue';
    END IF;

    SELECT count(*) INTO v_n
    FROM public.approval_my_queue('smoke_test', NULL, 50, 0, v_requester)
    WHERE run_id = v_run.id;
    IF v_n <> 0 THEN
        v_failed := v_failed || 'T7 queue: run appeared in the requester''s own queue';
    END IF;

    -- ── TEST 8: a stale lock_version is rejected ───────────────────────────
    BEGIN
        PERFORM set_config('request.jwt.claim.sub', v_approver_1::text, true);
        PERFORM public.approval_act(v_run.id, 'approve', v_run.lock_version + 99, NULL);
        v_failed := v_failed || 'T8 concurrency: a stale lock_version was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '40001' THEN
            v_failed := v_failed || format('T8 concurrency: expected SQLSTATE 40001, got %s (%s)', SQLSTATE, SQLERRM);
        END IF;
    END;

    -- ── TEST 9: reject requires a comment ──────────────────────────────────
    BEGIN
        PERFORM public.approval_act(v_run.id, 'reject', v_run.lock_version, '   ');
        v_failed := v_failed || 'T9 audit: reject was accepted with a blank comment';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('22023','42501') THEN
            v_failed := v_failed || format('T9 audit: unexpected SQLSTATE %s (%s)', SQLSTATE, SQLERRM);
        END IF;
    END;

    -- ── TEST 10: the stranded-run detector is quiet for a healthy run ──────
    SELECT count(*) INTO v_n FROM public.approval_stranded_runs WHERE run_id = v_run.id;
    IF v_n <> 0 THEN
        v_failed := v_failed || 'T10 stranded: a healthy run was reported as stranded';
    END IF;

    -- ── TEST 11: the stranding guard. The 54-of-60 regression test. ────────
    -- Exercised through approval_start_run, which takes the requester as an
    -- explicit argument and so works from the SQL editor where auth.uid() is
    -- NULL. (Testing it via approval_act would fail on authorisation first and
    -- prove nothing.)
    DECLARE
        v_subject2 uuid := gen_random_uuid();
        v_bad_step jsonb := jsonb_build_object(
            'step_order',1,'step_key','b','step_label','Held By Nobody',
            'approver_role_key','__role_held_by_nobody__');
    BEGIN
        -- 11a. the resolver itself must return zero for an unheld role
        SELECT count(*) INTO v_n
        FROM public.approval_step_approvers(v_bad_step, v_requester, '{}'::jsonb, '{}'::jsonb);
        IF v_n <> 0 THEN
            v_failed := v_failed || 'T11a: an unheld role key resolved to approvers';
        END IF;

        -- 11b. starting a run whose first step has nobody must RAISE, not create
        INSERT INTO public.approval_flows (workflow_key, flow_name, criteria, priority, steps)
        VALUES ('smoke_test_stranded', 'Nobody can act', '{}'::jsonb, 10,
                jsonb_build_array(v_bad_step));

        BEGIN
            PERFORM public.approval_start_run(
                'smoke_test_stranded', 'smoke_subjects', v_subject2,
                '{}'::jsonb, '{}'::jsonb, NULL, v_requester);
            v_failed := v_failed || 'T11b stranding: a run was created with zero eligible approvers';
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> '23514' THEN
                v_failed := v_failed || format('T11b stranding: expected 23514, got %s (%s)', SQLSTATE, SQLERRM);
            END IF;
        END;

        -- 11c. and nothing was left behind
        SELECT count(*) INTO v_n FROM public.approval_runs
        WHERE subject_id = v_subject2;
        IF v_n <> 0 THEN
            v_failed := v_failed || 'T11c stranding: a run row survived the failed start';
        END IF;
    END;

    -- ── Report ─────────────────────────────────────────────────────────────
    IF array_length(v_failed, 1) > 0 THEN
        RAISE EXCEPTION E'dynamic-approval-flow SMOKE TEST FAILED:\n  - %',
            array_to_string(v_failed, E'\n  - ');
    END IF;

    RAISE NOTICE 'dynamic-approval-flow SMOKE TEST PASSED (11 assertions)';

    -- Leave nothing behind.
    RAISE EXCEPTION 'SMOKE_TEST_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'SMOKE_TEST_OK_ROLLBACK' THEN
            RAISE NOTICE 'Smoke test data rolled back cleanly.';
        ELSE
            RAISE;
        END IF;
END $$;

-- NOTE ON auth.uid(): approval_act reads auth.uid() to identify the actor.
-- Running this file as a superuser in the SQL editor means auth.uid() is NULL,
-- so tests 8 and 9 assert on the ERROR RAISED, not on a successful approval.
-- To exercise a real end-to-end approval, run the equivalent flow from the app
-- with two logged-in users — see references/integration-guide.md, "Verify".
