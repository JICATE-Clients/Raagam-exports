-- 0723 — Sample ▸ PD Request is raised per SWO, not per SMP (user 2026-10-14).
--
-- 0719 put one request on each SMP (`opportunity_id`). The flow the client
-- confirmed is: Sample Entry (SMP) → Grouping (SWO — every sample gets one,
-- even an SWO holding a single SMP) → PD Request on that SWO → the Sample
-- Department acknowledges the whole batch. So:
--   * `group_id` → sample_product_groups names the SWO the request is for;
--   * `opportunity_id` stays only for the requests 0719 already recorded
--     (history), and is no longer written;
--   * one OPEN request per SWO (the partial unique index, as 0719 had per SMP);
--   * a NEW request must name an SWO (the insert policy).
--
-- A second FK on this table is to a DIFFERENT target (sample_product_groups),
-- so the existing `opportunities` embeds stay unambiguous.

alter table public.sample_pd_requests
  add column if not exists group_id uuid references public.sample_product_groups(id) on delete cascade;

alter table public.sample_pd_requests alter column opportunity_id drop not null;

alter table public.sample_pd_requests drop constraint if exists sample_pd_requests_subject_chk;
alter table public.sample_pd_requests
  add constraint sample_pd_requests_subject_chk check (group_id is not null or opportunity_id is not null);

create unique index if not exists uq_sample_pd_requests_open_group
  on public.sample_pd_requests (group_id) where status = 'requested' and group_id is not null;
create index if not exists ix_sample_pd_requests_group
  on public.sample_pd_requests (group_id, created_at desc);

drop policy if exists sample_pd_requests_insert on public.sample_pd_requests;
create policy sample_pd_requests_insert on public.sample_pd_requests
  for insert to authenticated
  with check (public.has_permission('sales', 'edit') and status = 'requested' and decided_at is null
              and group_id is not null);

-- A per-SMP request still waiting withdraws: the department is asked per SWO
-- now, and an SMP-level item left in their inbox would be answered against
-- nothing. Cancelling the run fires approval_apply_terminal, which marks the
-- request `cancelled` (0719b); the second update covers one with no live run.
-- approval_cancel's own write (0502), without its auth.uid() requester check —
-- a migration has no caller.
insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
select r.id, r.current_step, 'cancel', null, 'PD Requests are raised per SWO since 0723.'
  from public.approval_runs r
 where r.subject_table = 'sample_pd_requests'
   and r.status = 'in_progress'
   and r.subject_id in (select id from public.sample_pd_requests where group_id is null and status = 'requested');

update public.approval_runs r
   set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
 where r.subject_table = 'sample_pd_requests'
   and r.status = 'in_progress'
   and r.subject_id in (select id from public.sample_pd_requests where group_id is null and status = 'requested');

update public.sample_pd_requests
   set status = 'cancelled', decided_at = now(), decision_remark = 'Withdrawn — PD Requests are raised per SWO since 0723.', updated_at = now()
 where group_id is null and status = 'requested';
