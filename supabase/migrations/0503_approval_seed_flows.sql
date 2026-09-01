-- ============================================================================
-- 0503 — Dynamic Approval Flow · THE CATCH-ALL FLOWS
--
-- Apply AFTER 0500 (shim), 0501 (schema), 0502 (functions).
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS AT ALL
--
-- `approval_start_run` RAISES when no flow matches. That is the right default —
-- the skill's alternative, creating a run with no chain, is how a request ends
-- up in nobody's queue — but it means an engine installed with an empty
-- `approval_flows` table refuses every request in the business. The skill's own
-- troubleshooting table gives the answer in one line: "Add a flow with
-- `criteria = {}` at the highest priority number."
--
-- So: one catch-all per workflow key, at priority 900. Lower numbers win, so a
-- real flow built later in the admin screen (priority 100 by default) takes
-- precedence over these without anyone having to delete them.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
--
-- SEEDED: a ONE-STEP flow per document, routed to Managing Director.
--
-- That is not an invented chain. `roles` (0002) describes Managing Director, in
-- the app's own seed data, as "Approves amendments, POs, budgets, payroll" —
-- which is this list. Reading the business's existing declaration is the only
-- honest thing to seed.
--
-- NOT SEEDED: multi-step chains, value thresholds, per-unit variations. Those
-- are the business's to decide and the builder's to capture; guessing a
-- threshold here would put a number nobody chose in front of an approver, and
-- the engine exists precisely so that such a number is data rather than a
-- migration. A worked example of the conditional shape is in the comment at the
-- bottom of this file rather than in a row.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ADDING A FIFTH WORKFLOW IS AN INSERT, NOT A MIGRATION
--
-- `workflow_key` is TEXT, deliberately — the skill records that the system it
-- was extracted from gated workflow types behind a Postgres enum, so every new
-- workflow cost a migration plus a hand-synced TypeScript union. Nothing here
-- constrains the key. To approve something new: name a key, insert a flow, and
-- call `startRun` from that screen's submit action. The TypeScript side names
-- the four below in `lib/approvals/workflows.ts` so the builder can offer them
-- in a dropdown — that list is a convenience for the UI, never a gate.
-- ============================================================================


-- Guard: the engine must be in place, or these rows would be validated by a
-- trigger that does not exist yet and the step shapes would go unchecked.
DO $$
BEGIN
    IF to_regprocedure('public.approval_start_run(text, text, uuid, jsonb, jsonb, uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: apply 0500, 0501 and 0502 before 0503.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Managing Director') THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: the "Managing Director" role (0002) is missing, so the catch-all flows would route to a role nobody holds and every run would strand at step 1.';
    END IF;
END $$;


-- ─── The four documents Raagam approves today ───────────────────────────────
-- Each is a screen that already exists and already has an approve/reject
-- action over a status column. The engine replaces the ROUTING, not the screen:
-- who signs, in what order, under what conditions. The status column stays put
-- and is written by the terminal callback.
--
--   workflow_key      subject_table               the screen today
--   ────────────────  ──────────────────────────  ─────────────────────────────
--   order_budget      order_budgets               /orders/budget-approval
--   order_amendment   garment_order_amendments    /orders/approve-amendments
--   purchase_indent   purchase_indents            /purchase/indents/approval
--   purchase_order    purchase_orders             /purchase/orders
--
-- `steps` shape is validated by `approval_validate_steps` (0501) on insert, so
-- a malformed step fails HERE rather than when someone submits at month end.
-- Required per step: contiguous 1-based `step_order`, a `step_label`, and
-- exactly one approver source.
INSERT INTO public.approval_flows
    (workflow_key, flow_name, description, criteria, steps, priority, is_active)
VALUES
  ('order_budget',
   'Order Budget — default',
   'Catch-all. Every submitted order budget goes to the Managing Director unless a more specific flow matches first.',
   '{}'::jsonb,
   '[{"step_order": 1,
      "step_label": "Managing Director",
      "step_type": "final",
      "approver_role_key": "Managing Director"}]'::jsonb,
   900, true),

  ('order_amendment',
   'Order Amendment — default',
   'Catch-all. Every raised amendment goes to the Managing Director unless a more specific flow matches first.',
   '{}'::jsonb,
   '[{"step_order": 1,
      "step_label": "Managing Director",
      "step_type": "final",
      "approver_role_key": "Managing Director"}]'::jsonb,
   900, true),

  ('purchase_indent',
   'Purchase Indent — default',
   'Catch-all. Every raised indent goes to the Managing Director unless a more specific flow matches first.',
   '{}'::jsonb,
   '[{"step_order": 1,
      "step_label": "Managing Director",
      "step_type": "final",
      "approver_role_key": "Managing Director"}]'::jsonb,
   900, true),

  ('purchase_order',
   'Purchase Order — default',
   'Catch-all. Every submitted purchase order goes to the Managing Director unless a more specific flow matches first.',
   '{}'::jsonb,
   '[{"step_order": 1,
      "step_label": "Managing Director",
      "step_type": "final",
      "approver_role_key": "Managing Director"}]'::jsonb,
   900, true)
ON CONFLICT DO NOTHING;


-- ─── Post-install assert: a catch-all that routes to nobody is worse than none ─
-- The single highest-cost defect the skill records is a stranded run: one
-- sitting in nobody's queue, raising no error, chased by no one. A catch-all
-- routed to a role with zero holders IS that defect, seeded four times over,
-- and it would only surface the first time somebody submitted a budget.
--
-- `approval_rbac_users_with_role` is the same predicate the queue and the gate
-- both use (0500), so asking it here asks exactly what an approver will be
-- asked later. A WARNING rather than an EXCEPTION: on a fresh database nobody
-- holds any role yet, and refusing to install the engine because the business
-- has not assigned its roles would be the wrong failure. It must be read, though
-- — an unheeded warning here is four dead workflows.
DO $$
DECLARE
    v_mds int;
BEGIN
    SELECT count(*) INTO v_mds
    FROM public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb);

    IF v_mds = 0 THEN
        RAISE WARNING
            'dynamic-approval-flow: nobody currently holds the "Managing Director" role, so all four catch-all flows resolve to zero approvers. Every run started against them will RAISE at step 1 rather than strand — assign the role before anyone submits. Check public.approval_stranded_runs after go-live.';
    ELSE
        RAISE NOTICE
            'dynamic-approval-flow: 4 catch-all flows seeded; % user(s) hold Managing Director', v_mds;
    END IF;
END $$;


-- ============================================================================
-- WORKED EXAMPLE — the conditional routing this engine exists for.
-- Not applied. Build this in the admin screen instead, where the step shapes
-- are validated as you type and the zero-holder warning is visible.
--
-- "A budget over ₹10 lakh needs the Managing Director AFTER the Manager;
--  anything smaller only needs the Manager."
--
--   INSERT INTO public.approval_flows
--       (workflow_key, flow_name, criteria, steps, priority)
--   VALUES (
--     'order_budget',
--     'Order Budget — high value',
--     -- Flat AND-of-conditions. No nesting: when you need OR, add another flow
--     -- at a lower priority number. The criteria stay renderable as an English
--     -- sentence, and an admin who can read the sentence catches a mis-built
--     -- flow before production.
--     '{"total_value": {"op": "gte", "value": 1000000}}'::jsonb,
--     '[{"step_order": 1, "step_label": "Manager",           "approver_role_key": "Manager"},
--       {"step_order": 2, "step_label": "Managing Director", "step_type": "final",
--        "approver_role_key": "Managing Director",
--        "on_return_restart_from_step": 1}]'::jsonb,
--     100);   -- lower than the catch-all's 900, so this wins when it matches
--
-- The calling screen must then pass `total_value` in `context`. A MISSING
-- CONTEXT KEY DOES NOT MATCH — it falls through to the catch-all rather than
-- mis-routing, which is the fail-closed behaviour the smoke test asserts.
-- ============================================================================
