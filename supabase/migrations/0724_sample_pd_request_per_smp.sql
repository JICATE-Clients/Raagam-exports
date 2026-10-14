-- 0724 — Sample ▸ PD Request is raised per SMP again, not per SWO (user 2026-10-14:
-- "The PD request is for smp not for swo").
--
-- 0723 moved the request onto the SWO (`group_id`) the same day. That is
-- reversed: a request names ONE sample entry (`opportunity_id`), and the
-- department acknowledges that sample. What stays from 0723:
--   * `group_id` and its index — the SWO request already acknowledged keeps
--     reading its SWO as history; nothing new writes the column;
--   * `sample_pd_requests_subject_chk` (group or opportunity) — that history
--     row has no opportunity.
-- 0719's `uq_sample_pd_requests_open` (one OPEN request per SMP) never left.
--
-- No data moves: 0723 withdrew the one per-SMP request that was waiting, and a
-- withdrawn request may be followed by a new one (`canRaisePd`).

drop policy if exists sample_pd_requests_insert on public.sample_pd_requests;
create policy sample_pd_requests_insert on public.sample_pd_requests
  for insert to authenticated
  with check (public.has_permission('sales', 'edit') and status = 'requested' and decided_at is null
              and opportunity_id is not null and group_id is null);
