-- ============================================================================
-- 0500 — Dynamic Approval Flow · THE RBAC SHIM
--
-- Ported from the `dynamic-approval-flow` skill, `assets/sql/00_rbac_shim.sql`.
-- That skill states, and this file honours, one rule: **the approval engine
-- never names a role table.** It reaches Raagam's RBAC through exactly four
-- functions in the `approval_rbac_` namespace, all defined here. Grep
-- `approval_rbac_` and you have the engine's complete dependency surface.
--
-- THIS IS THE ONLY FILE OF THE FOUR YOU EDIT. 0501 (schema) is edited only for
-- the scope columns; 0502 (functions) is copied verbatim. If you find yourself
-- editing 0502, the mistake is here.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHAT RAAGAM HAS THAT THE SKILL'S DEFAULTS DO NOT ASSUME
--
-- The skill binds by default to an `erp-rbac-permissions`-shaped host. Raagam
-- is close to that shape but differs in four ways, and every one of them is a
-- place a careless copy would compile and be wrong:
--
--   | The skill assumes            | Raagam has                              |
--   |------------------------------|-----------------------------------------|
--   | user_has_permission(uuid,text) with a  | has_permission(module, action, uid) |
--   |   single dotted key          |   — the key is TWO columns (0001)       |
--   | roles.role_key, roles.is_active | roles.name (unique); NO is_active    |
--   | user_roles.expires_at        | no expiry column at all                 |
--   | a user_scope_grants table     | user_roles.location_id — the scope     |
--   |   with a `dimension` column   |   lives ON the grant, one dimension     |
--
-- Each is handled below with a note. Nothing else about the engine changes.
-- ============================================================================


-- ─── 0. Target sentinel ─────────────────────────────────────────────────────
-- The skill's sentinel compares `current_database()` against a name confirmed
-- with the user. THAT GUARD DOES NOT DISCRIMINATE ON SUPABASE: every Supabase
-- project's database is called `postgres`, so the check would pass against any
-- project in the account — which is the exact failure it exists to prevent.
--
-- So the sentinel is rewritten to assert the guard's INTENT rather than its
-- letter: this database must actually be Raagam. Three tables no other project
-- in this account has, and the RBAC surface the shim binds to below. A missing
-- one means either the wrong project or an un-migrated one, and both are
-- reasons to refuse rather than to install an approval engine.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF to_regclass('public.garment_order_amendments') IS NULL THEN
        v_missing := array_append(v_missing, 'public.garment_order_amendments');
    END IF;
    IF to_regclass('public.locations') IS NULL THEN
        v_missing := array_append(v_missing, 'public.locations');
    END IF;
    IF to_regclass('public.user_roles') IS NULL THEN
        v_missing := array_append(v_missing, 'public.user_roles');
    END IF;
    IF to_regprocedure('public.has_permission(text, text, uuid)') IS NULL THEN
        v_missing := array_append(v_missing, 'public.has_permission(text, text, uuid)');
    END IF;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: refusing to apply — this does not look like the Raagam database (missing %). Check which Supabase project is linked before applying an approval engine to it.',
            array_to_string(v_missing, ', ');
    END IF;
END $$;


-- ─── 1. Permission check ────────────────────────────────────────────────────
-- Takes an EXPLICIT p_user_id rather than reading auth.uid(): the engine's RPCs
-- are SECURITY DEFINER, and any sweeper added later runs under service_role
-- where auth.uid() is NULL.
--
-- ## THE KEY IS SPLIT HERE, AND THE MAP IS EXPLICIT ON PURPOSE
--
-- The engine owns three dotted keys; Raagam's catalog is `(module, action)`
-- with a fixed action vocabulary (view | create | edit | delete | approve |
-- export, seeded 0002). Deriving module and action by splitting the string
-- would invent actions like 'flow.manage' that are in no catalog — and the
-- anti-lesson the skill records is precisely that an UNRECOGNISED key silently
-- became "no restriction" in the system it was extracted from.
--
-- So the mapping is a CASE with an `ELSE false`. A key the engine adds later
-- and this file does not know DENIES rather than allows, and shows up as a
-- refusal rather than as a silent hole.
--
--   approvals.flow.manage  → ('approvals','edit')    edit flow definitions
--   approvals.run.act      → ('approvals','approve') act on a run
--   approvals.run.view_all → ('approvals','view')    see EVERY run
--
-- NOTE WHAT IS NOT HERE: seeing your OWN inbox needs no permission. The queue
-- RPC returns only rows the caller may act on, so the empty-handed case is an
-- empty list rather than a denial. `view` is the wider right — every run in the
-- business, for support — which is why it maps to view_all and not to the inbox.
CREATE OR REPLACE FUNCTION public.approval_rbac_user_has_permission(
    p_user_id        uuid,
    p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE p_permission_key
        WHEN 'approvals.flow.manage'  THEN public.has_permission('approvals', 'edit',    p_user_id)
        WHEN 'approvals.run.act'      THEN public.has_permission('approvals', 'approve', p_user_id)
        WHEN 'approvals.run.view_all' THEN public.has_permission('approvals', 'view',    p_user_id)
        ELSE false
    END;
$$;

COMMENT ON FUNCTION public.approval_rbac_user_has_permission(uuid, text) IS
  'RBAC adapter for the approval engine. Maps the engine''s three dotted keys onto Raagam''s (module, action) catalog. An unknown key returns false, never true. 0500.';


-- ─── 2. Super-admin check ───────────────────────────────────────────────────
-- Deliberately a SEPARATE symbol from the permission check even though a super
-- admin holds every permission: the engine uses it for break-glass cancel and
-- for breaking a zero-approver deadlock, and a host may want those answers to
-- differ from "holds everything".
--
-- Raagam's `is_super_admin` already reads `profiles.is_super_admin` (0001) and
-- takes an optional uid. Passing it explicitly is what makes this callable from
-- a definer context where auth.uid() is NULL.
CREATE OR REPLACE FUNCTION public.approval_rbac_is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT coalesce(public.is_super_admin(p_user_id), false);
$$;

COMMENT ON FUNCTION public.approval_rbac_is_super_admin(uuid) IS
  'RBAC adapter. Break-glass identity for the approval engine. 0500.';


-- ─── 3. Role → users.  THE ONE THAT WAS ACTUALLY REWRITTEN. ─────────────────
-- "Which users hold role X, scoped to Y?" The skill notes this function exists
-- in no RBAC layer it has met, and that where it was implemented twice the two
-- copies silently disagreed on all four questions below.
--
-- Raagam DOES have half of it — `users_with_role(p_name text)` (0040) — and
-- that half is not usable here, for reasons worth stating rather than
-- rediscovering:
--
--   * it takes NO SCOPE, so every unit's approvers answer for every unit;
--   * it does not exclude deactivated users, so a departed employee is still
--     returned and their run sits in a queue nobody opens;
--   * it does not exclude super admins, so the Administrator lands in every
--     queue in the business.
--
-- It is left alone — notifications (0040) is its caller and a queue is a
-- different question from a notification list.
--
-- ## THE FOUR SEMANTICS DECISIONS, AS THEY LAND ON RAAGAM
--
--   (a) SUPER ADMINS EXCLUDED (skill default, kept). Being able to approve is
--       not the same as being the person to nag. Raagam's Administrator holds
--       everything; in every queue it makes every queue useless. Flip
--       c_include_super_admins if the business disagrees — consciously.
--   (b) EXPIRED GRANTS EXCLUDED — MOOT HERE. `user_roles` has no `expires_at`
--       (0001), so there is nothing to honour. Stated rather than dropped: if a
--       grant expiry is ever added, this predicate is where it belongs, and a
--       reader who finds no mention would not know that.
--   (c) INACTIVE USERS EXCLUDED — `profiles.is_active`. Roles have no active
--       flag in Raagam, so only the user half of this decision exists.
--   (d) A NULL-SCOPE GRANT IS GLOBAL AND IS INCLUDED. This is the decision the
--       skill records as having produced real bugs, and Raagam's schema already
--       agrees with it by construction: `user_roles.location_id` is NULLABLE,
--       and a NULL there is exactly "this person holds the role everywhere".
--       Head office approvers are granted that way. Reading NULL as "matches
--       nothing" would drop them from every scoped queue.
--
-- ## SCOPE IS ONE DIMENSION AND IT IS THE UNIT
--
-- p_scope stays `jsonb` so a second dimension is a data change rather than a
-- signature change, but Raagam grants roles along exactly one axis today:
-- location. `{"location_id": "..."}` is the only key read. An unknown key is
-- ignored rather than failing — a flow that names a dimension this app does not
-- scope by should not silently return nobody.
CREATE OR REPLACE FUNCTION public.approval_rbac_users_with_role(
    p_role_key text,
    p_scope    jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- (a) flip to true only if super admins should appear in approval queues
    c_include_super_admins constant boolean := false;
    v_location text := p_scope->>'location_id';
BEGIN
    -- LOAD-BEARING GUARD. The engine calls this for EVERY step, including ones
    -- routed by named user or by resolver, so a blank key must be cheap and
    -- silent rather than an error or a full-table scan.
    IF p_role_key IS NULL OR p_role_key = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.roles    r ON r.id = ur.role_id
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE r.name = p_role_key                                 -- Raagam keys roles by name
      AND p.is_active                                         -- (c)
      AND (c_include_super_admins OR NOT p.is_super_admin)    -- (a)
      AND (
            -- no unit asked for → every holder of the role answers
            v_location IS NULL
            -- (d) a grant with no unit is GLOBAL and always answers
            OR ur.location_id IS NULL
            OR ur.location_id::text = v_location
          );
END $$;

COMMENT ON FUNCTION public.approval_rbac_users_with_role(text, jsonb) IS
  'RBAC adapter, and the one rewritten for Raagam. Users eligible to act on a step routed by role name, narrowed to a unit. A NULL user_roles.location_id is a GLOBAL grant and always matches. Excludes super admins and deactivated users. 0500.';


-- ─── 4. Dynamic resolvers ───────────────────────────────────────────────────
-- Reporting structure is host-specific and Raagam has none to speak of: there
-- is no `reports_to` on `profiles` and no department head table. So this ships
-- exactly as the skill ships it — with no working body, raising on everything.
--
-- RAISING RATHER THAN RETURNING EMPTY IS THE POINT. A resolver that quietly
-- returns zero rows creates a run that sits in nobody's queue, raises no error
-- and is never chased; the skill records that exact bug leaving 54 of 60 live
-- applications hanging. Fail loudly instead.
--
-- Nothing offers a resolver in the builder UI (0503 / the flow builder passes
-- no resolverOptions), so no flow can reference one until someone implements it
-- here first. That ordering is deliberate: a resolver you cannot choose cannot
-- strand a run.
CREATE OR REPLACE FUNCTION public.approval_rbac_resolve_dynamic(
    p_resolver_key text,
    p_requester    uuid,
    p_context      jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Without this guard the engine raises on every ordinary role-routed step:
    -- a set-returning function in a FROM clause is evaluated BEFORE any WHERE
    -- that would have skipped it.
    IF p_resolver_key IS NULL OR p_resolver_key = '' THEN
        RETURN;
    END IF;

    -- IF/ELSIF rather than CASE, deliberately: a plpgsql CASE whose every WHEN
    -- is commented out is a syntax error, so the shipped-empty state of this
    -- function would not compile.
    --
    -- When Raagam grows a reporting line, this is where it goes. A worked shape:
    --
    -- IF p_resolver_key = 'merchandiser_of_order' THEN
    --     RETURN QUERY
    --     SELECT e.profile_id
    --     FROM public.garment_order_amendments a
    --     JOIN public.employees e ON e.id = a.merchandiser_id
    --     WHERE a.id = (p_context->>'subject_id')::uuid
    --       AND e.profile_id IS NOT NULL;
    --     RETURN;
    -- END IF;

    RAISE EXCEPTION
        'approval_rbac_resolve_dynamic: resolver "%" is not implemented in Raagam. Implement it in the shim (0500) or stop referencing it from a flow step.',
        p_resolver_key
        USING ERRCODE = '0A000';
END $$;

COMMENT ON FUNCTION public.approval_rbac_resolve_dynamic(text, uuid, jsonb) IS
  'RBAC adapter. Ships raising, on purpose: an unimplemented resolver that returned empty would strand a run in nobody''s queue with no error. 0500.';


-- ─── 5. Permission keys owned by this engine ────────────────────────────────
-- Registered in Raagam's own catalog shape — `(module, action)`, unique on the
-- pair (0001) — rather than the skill's `(key, label, module, description)`.
-- The module is new; the three actions are the app's existing vocabulary, which
-- is what lets the Role screen render them with every other module's.
--
-- ONE NOTICE, NOT A WARNING: the skill warns when a host has no permissions
-- catalog, because unregistered keys make a typo silently disable enforcement.
-- Raagam has one, so the keys are real rows and a typo is a denial.
INSERT INTO public.permissions (module, action, description) VALUES
  ('approvals', 'view',    'View every approval run in the business, not only your own queue'),
  ('approvals', 'approve', 'Act on an approval run you are an eligible approver for'),
  ('approvals', 'edit',    'Create and edit approval flow definitions')
ON CONFLICT (module, action) DO NOTHING;


-- ─── 6. Who administers the engine ──────────────────────────────────────────
-- GATE 4 in the skill's integration guide, and it names the failure exactly:
-- "an engine installed and configured that nobody can administer" is the
-- lockout, and it is discovered at the worst possible moment.
--
-- Administrator and Managing Director are Raagam's two system-ish roles (0002);
-- both get all three. Manager gets `approve` only — it is a role that signs
-- things off, not one that decides who signs things off. Merchandiser gets
-- nothing: raising a request needs no approval permission at all.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.module = 'approvals'
 AND p.action IN ('view', 'approve', 'edit')
WHERE r.name IN ('Administrator', 'Managing Director')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.module = 'approvals' AND p.action = 'approve'
WHERE r.name = 'Manager'
ON CONFLICT DO NOTHING;


-- ─── 7. Self-test — a mis-bound shim must fail HERE, not at 2am ─────────────
-- The skill's own words: if this raises, STOP. Nothing downstream is meaningful
-- with a mis-bound shim, and the failure mode without this gate is a stranded
-- run discovered weeks later.
--
-- Two halves, and the second is the one that catches a real mistake: the
-- signatures must exist AND each binding must actually execute. A body that
-- names a column Raagam does not have compiles fine and fails on first call.
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_oid     regprocedure;
    v_admins  int;
BEGIN
    /* SIGNATURES LOOKED UP BY `to_regprocedure`, NOT BY COMPARING
       `pg_get_function_identity_arguments` TO A TYPE LIST — and this is a
       CORRECTION TO THE SKILL, verified against this database.

       That function returns the arguments WITH THEIR PARAMETER NAMES
       (`p_user_id uuid, p_permission_key text`), not the bare `uuid, text` the
       skill compares against. Every one of these four functions has named
       parameters, so the comparison never matched, the failure branch was taken
       every time, and — because of the `||` bug fixed above — the self-test died
       with "malformed array literal" instead of its own message.

       The file whose entire purpose is "a mis-bound shim must fail HERE, not at
       2am" therefore could not pass its own self-test on any host. Proved by
       running it: `pg_get_function_identity_arguments` on a two-argument probe
       returned `p_a uuid, p_b text`.

       `to_regprocedure` takes the signature in the form a human writes it and
       resolves types properly, so it is immune to how the catalog spells names.
       It is also what 0501 and 0503's own guards already use. */
    v_oid := to_regprocedure('public.approval_rbac_user_has_permission(uuid, text)');
    IF v_oid IS NULL OR pg_get_function_result(v_oid) IS DISTINCT FROM 'boolean' THEN
        v_missing := array_append(v_missing, 'approval_rbac_user_has_permission(uuid, text) -> boolean');
    END IF;

    v_oid := to_regprocedure('public.approval_rbac_is_super_admin(uuid)');
    IF v_oid IS NULL OR pg_get_function_result(v_oid) IS DISTINCT FROM 'boolean' THEN
        v_missing := array_append(v_missing, 'approval_rbac_is_super_admin(uuid) -> boolean');
    END IF;

    v_oid := to_regprocedure('public.approval_rbac_users_with_role(text, jsonb)');
    IF v_oid IS NULL OR pg_get_function_result(v_oid) IS DISTINCT FROM 'SETOF uuid' THEN
        v_missing := array_append(v_missing, 'approval_rbac_users_with_role(text, jsonb) -> SETOF uuid');
    END IF;

    v_oid := to_regprocedure('public.approval_rbac_resolve_dynamic(text, uuid, jsonb)');
    IF v_oid IS NULL OR pg_get_function_result(v_oid) IS DISTINCT FROM 'SETOF uuid' THEN
        v_missing := array_append(v_missing, 'approval_rbac_resolve_dynamic(text, uuid, jsonb) -> SETOF uuid');
    END IF;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'dynamic-approval-flow RBAC shim is incomplete. Missing or wrong signature: %',
            array_to_string(v_missing, ', ');
    END IF;

    -- The bindings must EXECUTE, not merely exist.
    PERFORM public.approval_rbac_user_has_permission(
        '00000000-0000-0000-0000-000000000000'::uuid, 'approvals.run.act');
    PERFORM public.approval_rbac_is_super_admin(
        '00000000-0000-0000-0000-000000000000'::uuid);
    PERFORM public.approval_rbac_users_with_role('__nonexistent_role__', '{}'::jsonb);
    PERFORM public.approval_rbac_users_with_role(
        '__nonexistent_role__',
        '{"location_id":"00000000-0000-0000-0000-000000000000"}'::jsonb);

    -- An unknown key must DENY. This is the anti-lesson, asserted.
    IF public.approval_rbac_user_has_permission(
         '00000000-0000-0000-0000-000000000000'::uuid, 'approvals.not.a.key') THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: the permission shim returns TRUE for an unknown key. That is the "unrecognised key means no restriction" bug this engine exists to avoid.';
    END IF;

    -- GATE 4, asserted rather than trusted: somebody must be able to administer
    -- the engine, or it is installed and unmanageable.
    SELECT count(*) INTO v_admins
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.module = 'approvals' AND p.action = 'edit';
    IF v_admins = 0 THEN
        RAISE EXCEPTION
            'dynamic-approval-flow: no role holds approvals:edit. The engine would be installed with nobody able to build a flow.';
    END IF;

    RAISE NOTICE 'dynamic-approval-flow: RBAC shim self-test PASSED (% role(s) may manage flows)', v_admins;
END $$;


-- ─── 8. Grants ──────────────────────────────────────────────────────────────
-- AGENTS.md, "Function grants (STANDING)": a new function is born callable by
-- TWO independent grants — Postgres's own EXECUTE TO PUBLIC and Supabase's
-- default privileges for `anon` — and revoking one leaves the other standing.
-- The skill's own file revokes from `anon` alone, which in this app is the
-- half-fix 0383 shipped and 0385 had to come back for. Both, in one statement.
revoke all on function public.approval_rbac_user_has_permission(uuid, text)    from public, anon;
revoke all on function public.approval_rbac_is_super_admin(uuid)               from public, anon;
revoke all on function public.approval_rbac_users_with_role(text, jsonb)       from public, anon;
revoke all on function public.approval_rbac_resolve_dynamic(text, uuid, jsonb) from public, anon;

grant execute on function public.approval_rbac_user_has_permission(uuid, text)    to authenticated;
grant execute on function public.approval_rbac_is_super_admin(uuid)               to authenticated;
grant execute on function public.approval_rbac_users_with_role(text, jsonb)       to authenticated;
grant execute on function public.approval_rbac_resolve_dynamic(text, uuid, jsonb) to authenticated;
