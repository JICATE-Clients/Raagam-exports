-- 0719 — Sample ▸ PD Request & Acknowledgement (client brief 2026-10-13,
-- "approval checkpoints" §3; doc/sample/sample-module-specification.md §7.1).
--
-- "When a merchandiser raises a sample creation request to the sample
-- department … the sample department reviews the request details, required
-- fabric/content specs and piece counts, then updates the status to
-- Acknowledged to accept the sample job." §7.1 adds the other answer, Not
-- Acknowledged, and that merchandising is told.
--
-- ONE ROW PER REQUEST, ON ITS OWN TABLE — not columns on `opportunities`.
-- An enquiry whose costing is approved is LOCKED (0716 `trg_sample_lock`), and
-- a PD request on a locked sample is still a legitimate thing to send; a
-- column on the locked row could not be written. A table also keeps the
-- history: a Not Acknowledged request can be followed by a new one, and both
-- stay on record. At most ONE is open at a time per enquiry.
--
-- THE SAMPLE DEPARTMENT ANSWERS IN THE APPROVALS INBOX. Workflow
-- 'sample_pd_request', subject 'sample_pd_requests': Approve = Acknowledged,
-- Reject (reason mandatory, enforced by the engine) = Not Acknowledged, and
-- the engine already tells the requester either way. Who answers is the flow's
-- step — seeded from Sample Costing's so it resolves on day one; Admin ▸
-- Approval Flows points it at the Sample Department role.
--
-- No location_id: `opportunities` is not unit-scoped, so neither is this.

create table if not exists public.sample_pd_requests (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  status          text not null default 'requested'
                  check (status in ('requested', 'acknowledged', 'not_acknowledged', 'cancelled')),
  note            text,
  decided_at      timestamptz,
  decided_by      uuid,
  decision_remark text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_sample_pd_requests_open
  on public.sample_pd_requests (opportunity_id) where status = 'requested';
create index if not exists ix_sample_pd_requests_opportunity
  on public.sample_pd_requests (opportunity_id, created_at desc);

alter table public.sample_pd_requests enable row level security;

create or replace function public.sample_pd_request_has_live_run(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.approval_runs r
     where r.subject_table = 'sample_pd_requests'
       and r.subject_id = p_id
       and r.status = 'in_progress')
$$;
revoke all on function public.sample_pd_request_has_live_run(uuid) from public, anon;
grant execute on function public.sample_pd_request_has_live_run(uuid) to authenticated;

drop policy if exists sample_pd_requests_read on public.sample_pd_requests;
create policy sample_pd_requests_read on public.sample_pd_requests
  for select to authenticated
  using (public.has_permission('sales', 'view'));

drop policy if exists sample_pd_requests_insert on public.sample_pd_requests;
create policy sample_pd_requests_insert on public.sample_pd_requests
  for insert to authenticated
  with check (public.has_permission('sales', 'edit') and status = 'requested' and decided_at is null);

-- Only the sender's own rollback when no approval could be started: a request
-- an approver already holds can never be pulled out from under them.
drop policy if exists sample_pd_requests_delete on public.sample_pd_requests;
create policy sample_pd_requests_delete on public.sample_pd_requests
  for delete to authenticated
  using (created_by = auth.uid() and status = 'requested'
         and not public.sample_pd_request_has_live_run(id));

-- No update policy: the status moves only through the decision below.
