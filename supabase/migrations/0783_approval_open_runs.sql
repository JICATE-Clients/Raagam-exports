-- 0783 — Super Admin "All open" view on My Approvals.
--
-- `approval_my_queue` (0601) answers "what is waiting on ME" and must keep
-- answering only that: the menu badge counts it, and its rows are actionable by
-- definition. A Super Admin can act on ANY run (approval_can_act's override
-- branch, 0502), but had no way to SEE the runs waiting on other people. This is
-- that read — a second reader, never a second predicate for the inbox.
--
-- WHO MAY CALL IT: a real Super Admin only, checked here (42501 otherwise). The
-- page also hides the toggle, but the function is the guard.
--
-- THE UNIT comes from the run's SUBJECT — approval_runs has no location_id.
-- `approval_subject_location` reads `<subject_table>.location_id` when that
-- table has one, and answers NULL otherwise (sample_pd_requests, cost_sheets…)
-- rather than guessing.

CREATE OR REPLACE FUNCTION public.approval_subject_location(p_table text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_loc uuid;
BEGIN
    IF p_table IS NULL OR p_id IS NULL THEN
        RETURN NULL;
    END IF;
    -- Only a real public table carrying a uuid location_id — the name comes
    -- from approval_runs (engine-written) and is quoted with %I regardless.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = p_table
          AND column_name = 'location_id' AND data_type = 'uuid'
    ) THEN
        RETURN NULL;
    END IF;
    EXECUTE format('SELECT location_id FROM public.%I WHERE id = $1', p_table)
        INTO v_loc USING p_id;
    RETURN v_loc;
END;
$$;

-- Internal helper: called only from approval_open_runs (which runs as owner).
REVOKE ALL ON FUNCTION public.approval_subject_location(text, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approval_open_runs()
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
    total_count     bigint,
    approver_names  text[],
    unit_code       text,
    unit_name       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.is_super_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only a Super Admin can see every open approval'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.workflow_key,
        r.subject_table,
        r.subject_id,
        r.current_step,
        public.approval_current_step(r.*) ->> 'step_label',
        r.requested_by,
        r.started_at,
        round(EXTRACT(epoch FROM (now() - r.started_at)) / 3600.0, 1),
        r.lock_version,
        r.sla_due_at,
        r.sla_breached_at,
        (r.sla_due_at IS NOT NULL AND r.sla_due_at < now()),
        count(*) OVER (),
        -- The same resolver approval_my_queue and approval_can_act use, so
        -- "Waiting on" names exactly the people whose inbox holds the row.
        -- Empty = stranded (nobody holds the step's role today).
        COALESCE((
            SELECT array_agg(n.who ORDER BY n.who)
            FROM (
                SELECT COALESCE(NULLIF(p.full_name, ''), p.email, 'Unknown user') AS who
                FROM public.approval_step_approvers(
                    public.approval_current_step(r.*),
                    r.requested_by, r.scope, r.context) u
                JOIN public.profiles p ON p.id = u
            ) n
        ), ARRAY[]::text[]),
        l.code,
        l.name
    FROM public.approval_runs r
    LEFT JOIN LATERAL (
        SELECT public.approval_subject_location(r.subject_table, r.subject_id) AS loc_id
    ) s ON true
    LEFT JOIN public.locations l ON l.id = s.loc_id
    WHERE r.status = 'in_progress'
    ORDER BY (r.sla_due_at IS NOT NULL AND r.sla_due_at < now()) DESC,
             r.sla_due_at ASC NULLS LAST,
             r.started_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.approval_open_runs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approval_open_runs() TO authenticated;
