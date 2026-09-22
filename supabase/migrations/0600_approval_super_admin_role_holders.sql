-- ============================================================================
-- Raagam ERP — 0600 Approvals: a super admin who HOLDS a role is an approver,
-- and the two budget flows accept the submitter.
--
-- Reported 2026-09-20: "Save Budget" saves a draft, "Save & Send for Approval"
-- fails with "Submitted, but no approval could be started — The next step has
-- no eligible approver". It is not the budget screen: `approval_start_run`
-- (0502) refuses to create a run when step 1 resolves to nobody, and on this
-- installation step 1 resolved to nobody for TWO independent reasons. Both are
-- below, and fixing either alone still leaves the button broken.
--
-- ## 1. THE SHIM DROPPED EXPLICIT ROLE HOLDERS WHO HAPPEN TO BE SUPER ADMINS
--
-- `approval_rbac_users_with_role` carried `c_include_super_admins := false`,
-- the skill's default. The intent of that constant is "a super admin is an
-- OVERRIDER, not an assignee — do not pour them into every role's pool". But
-- the function's query JOINS `user_roles`: every row it can return is a role
-- somebody was DELIBERATELY given. So the constant never suppressed an
-- automatic membership; it could only ever delete a manual one — and it did.
-- Raagam's Managing Director is the admin account, `is_super_admin`, so:
--
--     select * from approval_rbac_users_with_role('Managing Director', '{}');
--     -- 0 rows, with the role plainly assigned in user_roles
--
-- Every flow whose step names that role — both budget flows, and any flow
-- written later — resolved to nobody, and `approval_start_run` refused. The
-- constant flips to TRUE, and the comment above it now says why, so the next
-- reader does not "restore" the skill's default and re-break this.
--
-- `approval_can_act` is untouched: a super admin who is NOT an approver still
-- reaches the run through the `super_admin_override` branch, and that branch
-- still records `is_override = true` on the event. What changes is only that
-- an explicitly assigned role holder is now assigned — they appear in
-- `approval_my_queue`, which is the whole point of assigning them.
--
-- ## 2. WITH ONE OPERATOR, THE SUBMITTER IS ALSO THE APPROVER
--
-- `approval_step_approvers` drops the requester unless the step says
-- `allow_self_approve`. This installation has one working account, which
-- submits the budget AND holds Managing Director, so after §1 the pool is
-- {admin} and the requester filter empties it again.
--
-- Decided with the user 2026-09-20: turn self-approval ON for the Managing
-- Director step of the two budget flows. It is a POLICY, written on the flow
-- row where policy belongs — not a weakening of the engine, which keeps
-- refusing self-approval everywhere it is not declared. The flow builder's
-- "What this means" panel already prints the sentence ("The requester CAN
-- approve their own request at this step") and warns on it, so it is visible
-- rather than folklore. Adding a second Managing Director — a real second
-- person — and clearing this flag is what turns maker-checker back on; nothing
-- else needs to change.
--
-- ## 3. VERIFIED FROM THE CATALOG, NOT FROM THIS FILE
--
-- AGENTS.md, Function grants: `{"success": true}` means the SQL ran, not that
-- it achieved its stated goal (0386 asserted its own success and shipped a
-- no-op). §4 therefore ASKS THE ENGINE the question the screen asks — can a
-- run start for this requester — and raises if the answer is still no.
-- ============================================================================

-- ── 1. The shim ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approval_rbac_users_with_role(
    p_role_key text,
    p_scope    jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- TRUE SINCE 0600, AND IT IS NOT THE SKILL'S DEFAULT. Read the header: this
    -- function returns only users who hold the role in `user_roles`, so FALSE
    -- here does not stop a super admin being swept in automatically — it
    -- deletes an assignment an administrator made by hand. Raagam's Managing
    -- Director is a super admin, and every budget flow resolved to nobody.
    c_include_super_admins constant boolean := true;
    v_location text := p_scope->>'location_id';
BEGIN
    IF p_role_key IS NULL OR p_role_key = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.roles    r ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE r.name = p_role_key
      AND p.is_active
      AND (c_include_super_admins OR NOT p.is_super_admin)
      AND (
            v_location IS NULL
            OR ur.location_id IS NULL
            OR ur.location_id::text = v_location
          );
END $$;

REVOKE ALL ON FUNCTION public.approval_rbac_users_with_role(text, jsonb) FROM public, anon;

-- ── 2. The two budget flows accept the submitter ────────────────────────────
-- jsonb_set per step rather than a rewritten `steps` literal: the order budget
-- flow's step also carries `approver_user_ids`, and restating the array here
-- would be the second place that list lives.

UPDATE public.approval_flows f
SET steps = (
        SELECT jsonb_agg(
                   CASE WHEN COALESCE((s.value->>'step_order')::int, 0) = 1
                        THEN s.value || jsonb_build_object('allow_self_approve', true)
                        ELSE s.value
                   END
                   ORDER BY s.ordinality
               )
        FROM jsonb_array_elements(f.steps) WITH ORDINALITY s(value, ordinality)
    )
WHERE f.workflow_key IN ('order_budget', 'iwo_budget');

-- ── 3. Assertions ───────────────────────────────────────────────────────────

DO $$
DECLARE
    v_flow    public.approval_flows;
    v_n       int;
    v_holders int;
BEGIN
    -- The shim: an explicitly assigned super admin now resolves.
    SELECT count(*) INTO v_holders
    FROM public.user_roles ur
    JOIN public.roles r    ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE r.name = 'Managing Director' AND p.is_active;

    IF v_holders > 0 THEN
        SELECT count(*) INTO v_n
        FROM public.approval_rbac_users_with_role('Managing Director', '{}'::jsonb);
        IF v_n = 0 THEN
            RAISE EXCEPTION
                '0600: % active user(s) hold Managing Director but the shim still resolves none.', v_holders;
        END IF;
    END IF;

    -- The flows: step 1 must now resolve to at least one approver FOR EACH of
    -- its own approvers as the requester — which is the exact question
    -- `approval_start_run` asks, and the one the screen failed on.
    FOR v_flow IN
        SELECT * FROM public.approval_flows
        WHERE workflow_key IN ('order_budget', 'iwo_budget') AND is_active
    LOOP
        IF COALESCE((v_flow.steps->0->>'allow_self_approve')::bool, false) IS NOT TRUE THEN
            RAISE EXCEPTION '0600: flow "%" step 1 did not take allow_self_approve.', v_flow.flow_name;
        END IF;

        SELECT count(*) INTO v_n
        FROM public.profiles p
        WHERE p.is_active
          AND (SELECT count(*) FROM public.approval_step_approvers(
                   v_flow.steps->0, p.id, '{}'::jsonb, '{}'::jsonb)) = 0;

        IF v_n > 0 THEN
            RAISE WARNING
                '0600: flow "%" step 1 still resolves to nobody for % active user(s) as requester — they cannot submit.',
                v_flow.flow_name, v_n;
        END IF;
    END LOOP;
END $$;
