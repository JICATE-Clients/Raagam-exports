-- 0716 — Sample ▸ Revision (doc/sample/sample revion.md, user 2026-10-12).
--
-- ONCE A SAMPLE'S COSTING IS APPROVED, THE SAMPLE IS LOCKED. A buyer's change
-- after that — a GSM, a trim, a quantity, a rate — is raised as a Sample
-- Revision (SMP-REV/26-27/000n) that unlocks only the modules it names, keeps
-- the approved V0 to go back to, and goes to the MD.
--
-- THE SPEC MAPPED ONTO WHAT IS STORED. Its `samples` / `sample_fabric_boms` /
-- `sample_costings` tables do not exist here. A sample is an SMP entry —
-- `opportunities` + `styles` and their child tables, written only by
-- `save_sample_entry` — and its costing is `cost_sheets` (costing_type
-- 'sample'), which already keeps versions: a revision of an approved sheet is
-- version n+1 under the same CST number, the parent set 'superseded' (0688 /
-- 0701). The four modules:
--
--   sample_info  — the SMP entry itself (qty, dates, sizes, quantities …)
--   fabric_spec  — the costing's fabrics, yarn mix, processes, garment weights
--   trims        — the costing's trims
--   costing      — every rate on the costing (fabric, yarn, process, CMT,
--                  overheads, extra charges, quotes)
--
-- A costing module makes the next costing revision when the revision is
-- raised (the app calls the existing save path with the parent's id); which
-- FIELDS of it may change is the app's rule (lib/sales/sample-revisions), and
-- this file locks the rest: the SMP entry outright, and the costing's two
-- doors — superseding an approved sheet, and approving / submitting one.
--
-- THE SWO PLANS ARE NOT IN SCOPE, on purpose. The spec's fabric and trim
-- "BOMs" here are per SWO (several samples batched), not per sample, and lock
-- through their own IWO budget (0595). A sample's fabric and trim SPEC is its
-- costing, which is what a revision opens.
--
-- WHAT LOCKS: an opportunity with a sample costing in status 'approved' and no
-- open revision. An open revision ('draft' while being worked, 'pending' while
-- with the MD) is the only door, and only its own modules pass it.
--
-- THE RESTORE (reject / abandon) stands the lock down for its own
-- transaction only — `reverting_txid = txid_current()`, the Order Revision
-- rule (0619) — and the costing status guard reads a transaction-local
-- setting only this file's functions set.

-- ---------------------------------------------------------------------------
-- 1. The revision
-- ---------------------------------------------------------------------------
create table if not exists public.sample_revisions (
  id              uuid primary key default gen_random_uuid(),
  revision_code   text not null unique,
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  -- 1, 2, 3 … per sample: "Rev 1" is the first change after the approved V0.
  revision_no     int  not null,
  origin          text not null default 'customer' check (origin in ('customer', 'internal')),
  kinds           text[] not null
                    check (cardinality(kinds) > 0
                           and kinds <@ array['sample_info', 'fabric_spec', 'trims', 'costing']::text[]),
  remarks         text not null check (btrim(remarks) <> ''),
  status          text not null default 'draft'
                    check (status in ('draft', 'pending', 'approved', 'rejected', 'abandoned')),
  -- V0 of the SMP entry: the exact `save_sample_entry` payload it was saved
  -- with, so the restore is one call of the same writer.
  entry_snapshot  jsonb,
  -- [{ "parent_id": <approved V0 sheet>, "proposed_id": <its revision> }]
  costing_pairs   jsonb not null default '[]'::jsonb,
  -- The cost heads V0 vs proposed, frozen when it is sent to the MD.
  v0_kpis         jsonb,
  proposed_kpis   jsonb,
  submitted_at    timestamptz,
  submitted_by    uuid,
  decided_at      timestamptz,
  decided_by      uuid,
  decision_remark text,
  revert_error    text,
  reverting_txid  bigint,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_sample_revisions_opp on public.sample_revisions(opportunity_id);
-- ONE OPEN REVISION PER SAMPLE — a second would have two V0s to go back to.
create unique index if not exists uq_sample_revisions_one_open
  on public.sample_revisions(opportunity_id) where status in ('draft', 'pending');

alter table public.sample_revisions enable row level security;
drop policy if exists sample_revisions_read on public.sample_revisions;
create policy sample_revisions_read on public.sample_revisions
  for select to authenticated using (public.has_permission('sales', 'view', auth.uid()));
-- No insert / update / delete policy: every write is one of the functions below.

-- ---------------------------------------------------------------------------
-- 2. Numbering — SMP-REV/<fy yy-yy>/000n, April–March in Asia/Kolkata
-- ---------------------------------------------------------------------------
create or replace function public.next_sample_revision_no()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with fy as (
    select case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
                then extract(year from (now() at time zone 'Asia/Kolkata'))::int
                else extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1
           end as y
  ),
  yy as (
    select to_char(y % 100, 'FM00') || '-' || to_char((y + 1) % 100, 'FM00') as tag from fy
  )
  select 'SMP-REV/' || yy.tag || '/'
         || to_char(coalesce(max(substring(r.revision_code from '(\d+)$')::int), 0) + 1, 'FM0000')
    from yy
    left join public.sample_revisions r on r.revision_code like 'SMP-REV/' || yy.tag || '/%'
   group by yy.tag;
$$;

-- ---------------------------------------------------------------------------
-- 3. The lock — one answer, read by the triggers and the app
-- ---------------------------------------------------------------------------
create or replace function public.sample_open_revision(p_opp uuid)
returns public.sample_revisions
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.sample_revisions r
   where r.opportunity_id = p_opp and r.status in ('draft', 'pending')
   limit 1;
$$;

create or replace function public.sample_is_approved(p_opp uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cost_sheets c
     where c.opportunity_id = p_opp and c.costing_type = 'sample' and c.status = 'approved'
  );
$$;

/** Why a write to this sample's ENTRY is refused, or NULL when it may proceed. */
create or replace function public.sample_entry_refusal(p_opp uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rev  public.sample_revisions;
  v_code text;
begin
  if p_opp is null then return null; end if;
  v_rev := public.sample_open_revision(p_opp);
  if v_rev.id is not null then
    -- The restore itself.
    if v_rev.reverting_txid = txid_current() then return null; end if;
    select o.code into v_code from public.opportunities o where o.id = p_opp;
    if v_rev.status = 'pending' then
      return format('%s is with the MD under Sample Revision %s — nothing in it can change until it is decided.',
                    coalesce(v_code, 'This sample'), v_rev.revision_code);
    end if;
    if not ('sample_info' = any (v_rev.kinds)) then
      return format('Sample Revision %s does not open Sample Info & Qty — add that module to the revision to change the sample entry.',
                    v_rev.revision_code);
    end if;
    return null;
  end if;
  if public.sample_is_approved(p_opp) then
    select o.code into v_code from public.opportunities o where o.id = p_opp;
    return format('%s is approved and locked — raise a Sample Revision (Sample ▸ Revision) to change it.',
                  coalesce(v_code, 'This sample'));
  end if;
  return null;
end;
$$;

create or replace function public.refuse_when_sample_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_opp uuid;
  v_why text;
begin
  if tg_table_name = 'opportunities' then
    v_opp := coalesce(new.id, old.id);
    -- Bookkeeping only (the always-'enquiry' stage, the touch) is not an edit.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - array['updated_at', 'stage']) = (to_jsonb(old) - array['updated_at', 'stage']) then
      return new;
    end if;
  else
    v_opp := coalesce(new.opportunity_id, old.opportunity_id);
  end if;
  v_why := public.sample_entry_refusal(v_opp);
  if v_why is not null then
    raise exception '%', v_why using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sample_lock on public.opportunities;
create trigger trg_sample_lock before update or delete on public.opportunities
  for each row execute function public.refuse_when_sample_locked();
drop trigger if exists trg_sample_lock on public.styles;
create trigger trg_sample_lock before insert or update or delete on public.styles
  for each row execute function public.refuse_when_sample_locked();

/**
 * THE COSTING'S TWO DOORS.
 *   - Superseding an approved sample sheet IS revising it (0701 sets the
 *     parent 'superseded', then inserts version n+1): only inside an open
 *     revision, still being worked, that names a costing module.
 *   - A sheet a revision proposes is submitted and approved by the revision
 *     (its own Submit would auto-approve above the margin floor, or start a
 *     second approval): only this file's functions, which set the flag.
 */
create or replace function public.guard_sample_costing_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rev  public.sample_revisions;
  v_code text;
begin
  if new.costing_type is distinct from 'sample' or new.status is not distinct from old.status then
    return new;
  end if;
  v_rev := public.sample_open_revision(new.opportunity_id);

  if old.status = 'approved' and new.status = 'superseded' then
    if v_rev.id is null or v_rev.status <> 'draft'
       or not (v_rev.kinds && array['fabric_spec', 'trims', 'costing']::text[]) then
      select o.code into v_code from public.opportunities o where o.id = new.opportunity_id;
      raise exception '% is approved and locked — raise a Sample Revision (Sample ▸ Revision) with a costing module to revise its costing.',
        coalesce(v_code, 'This sample') using errcode = '55000';
    end if;
    return new;
  end if;

  if new.status in ('submitted', 'approved')
     and v_rev.id is not null
     and exists (select 1 from jsonb_array_elements(v_rev.costing_pairs) p where (p ->> 'proposed_id')::uuid = new.id)
     and coalesce(current_setting('raagam.sample_revision', true), '') <> 'on' then
    raise exception 'This costing is part of Sample Revision % — send it to the MD from Sample ▸ Revision.',
      v_rev.revision_code using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sample_costing_revision on public.cost_sheets;
create trigger trg_sample_costing_revision before update of status on public.cost_sheets
  for each row execute function public.guard_sample_costing_revision();

-- ---------------------------------------------------------------------------
-- 4. Raise, attach, submit, withdraw, abandon
-- ---------------------------------------------------------------------------
create or replace function public.raise_sample_revision(
  p_opp uuid, p_origin text, p_kinds text[], p_remarks text, p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_no   int;
  v_id   uuid;
  v_smp  text;
begin
  if not public.has_permission('sales', 'edit', auth.uid()) then
    raise exception 'You do not have permission to raise a sample revision.' using errcode = '42501';
  end if;
  select o.code into v_smp from public.opportunities o where o.id = p_opp;
  if v_smp is null then raise exception 'This sample no longer exists.' using errcode = 'P0002'; end if;
  if (public.sample_open_revision(p_opp)).id is not null then
    raise exception '% already has an open Sample Revision (%).', v_smp, (public.sample_open_revision(p_opp)).revision_code
      using errcode = '23505';
  end if;
  if not public.sample_is_approved(p_opp) then
    raise exception '% has no approved costing — it is not locked, so edit it directly.', v_smp using errcode = '22023';
  end if;
  if btrim(coalesce(p_remarks, '')) = '' then
    raise exception 'Enter the remarks — why the sample is being revised.' using errcode = '23502';
  end if;
  if 'sample_info' = any (p_kinds) and p_snapshot is null then
    raise exception 'Sample Info & Qty needs the entry as approved (V0) to go back to.' using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtext('sample_revisions'));
  v_code := public.next_sample_revision_no();
  select coalesce(max(r.revision_no), 0) + 1 into v_no from public.sample_revisions r where r.opportunity_id = p_opp;

  insert into public.sample_revisions (revision_code, opportunity_id, revision_no, origin, kinds, remarks, entry_snapshot)
  values (v_code, p_opp, v_no, coalesce(p_origin, 'customer'), p_kinds, btrim(p_remarks), p_snapshot)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

/** The costing revisions the app made for it (after `raise_sample_revision`). */
create or replace function public.set_sample_revision_costings(p_id uuid, p_pairs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('sales', 'edit', auth.uid()) then
    raise exception 'You do not have permission to change a sample revision.' using errcode = '42501';
  end if;
  update public.sample_revisions
     set costing_pairs = coalesce(p_pairs, '[]'::jsonb), updated_at = now()
   where id = p_id and status = 'draft';
  if not found then raise exception 'This revision is not open for changes.' using errcode = '55000'; end if;
end;
$$;

/** Send to MD: the revision 'pending', its costing revisions 'submitted'. The
 *  approval run is started by the app right after (startApproval). */
create or replace function public.submit_sample_revision(p_id uuid, p_v0 jsonb, p_proposed jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.sample_revisions;
begin
  if not public.has_permission('sales', 'edit', auth.uid()) then
    raise exception 'You do not have permission to send a sample revision.' using errcode = '42501';
  end if;
  select * into v_rev from public.sample_revisions where id = p_id for update;
  if v_rev.id is null or v_rev.status <> 'draft' then
    raise exception 'This revision is not a draft — it may already be with the MD.' using errcode = '55000';
  end if;
  perform set_config('raagam.sample_revision', 'on', true);
  update public.cost_sheets c
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
   where c.id in (select (p ->> 'proposed_id')::uuid from jsonb_array_elements(v_rev.costing_pairs) p)
     and c.status = 'draft';
  update public.sample_revisions
     set status = 'pending', submitted_at = now(), submitted_by = auth.uid(),
         v0_kpis = p_v0, proposed_kpis = p_proposed, updated_at = now()
   where id = p_id;
end;
$$;

/** Back to draft — a run that did not start, or one the approver cancelled. */
create or replace function public.withdraw_sample_revision(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.sample_revisions;
begin
  select * into v_rev from public.sample_revisions where id = p_id for update;
  if v_rev.id is null or v_rev.status <> 'pending' then return; end if;
  update public.cost_sheets c
     set status = 'draft', submitted_at = null, submitted_by = null, updated_at = now()
   where c.id in (select (p ->> 'proposed_id')::uuid from jsonb_array_elements(v_rev.costing_pairs) p)
     and c.status = 'submitted';
  update public.sample_revisions
     set status = 'draft', submitted_at = null, submitted_by = null, updated_at = now()
   where id = p_id;
end;
$$;

/**
 * THE RESTORE — V0 back, exactly: the SMP entry re-saved from its snapshot by
 * its own writer, each proposed costing revision removed and its approved
 * parent approved again (any SWO line that took the proposal's id is pointed
 * back at the parent first). Stands the locks down for this transaction only.
 */
create or replace function public.sample_revision_revert(p_id uuid, p_outcome text, p_remark text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev  public.sample_revisions;
  v_pair jsonb;
begin
  select * into v_rev from public.sample_revisions where id = p_id for update;
  if v_rev.id is null or v_rev.status not in ('draft', 'pending') then
    raise exception 'This revision is already closed.' using errcode = '55000';
  end if;
  update public.sample_revisions set reverting_txid = txid_current() where id = p_id;
  perform set_config('raagam.sample_revision', 'on', true);

  if 'sample_info' = any (v_rev.kinds) and v_rev.entry_snapshot is not null then
    perform public.save_sample_entry(v_rev.opportunity_id, v_rev.entry_snapshot);
  end if;

  for v_pair in select * from jsonb_array_elements(v_rev.costing_pairs) loop
    update public.sample_group_items
       set cost_sheet_id = (v_pair ->> 'parent_id')::uuid
     where cost_sheet_id = (v_pair ->> 'proposed_id')::uuid;
    delete from public.cost_sheets where id = (v_pair ->> 'proposed_id')::uuid;
    update public.cost_sheets
       set status = 'approved', updated_at = now()
     where id = (v_pair ->> 'parent_id')::uuid and status = 'superseded';
  end loop;

  update public.sample_revisions
     set status = p_outcome, decision_remark = p_remark, decided_at = now(), decided_by = p_actor,
         reverting_txid = null, revert_error = null, updated_at = now()
   where id = p_id;
end;
$$;

create or replace function public.abandon_sample_revision(p_id uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.has_permission('sales', 'edit', auth.uid()) then
    raise exception 'You do not have permission to abandon a sample revision.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_remark, '')) = '' then
    raise exception 'Enter why the revision is being abandoned.' using errcode = '23502';
  end if;
  select status into v_status from public.sample_revisions where id = p_id;
  if v_status is distinct from 'draft' then
    raise exception 'Only a revision still being worked can be abandoned — one with the MD is decided there.' using errcode = '55000';
  end if;
  perform public.sample_revision_revert(p_id, 'abandoned', btrim(p_remark), auth.uid());
end;
$$;

/** The MD's decision, from `approval_apply_terminal`. */
create or replace function public.sample_revision_apply_decision(p_id uuid, p_status text, p_actor uuid, p_remark text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.sample_revisions;
begin
  select * into v_rev from public.sample_revisions where id = p_id for update;
  if v_rev.id is null or v_rev.status <> 'pending' then return; end if;

  if p_status = 'cancelled' then
    perform public.withdraw_sample_revision(p_id);
    return;
  end if;

  if p_status = 'completed' then
    perform set_config('raagam.sample_revision', 'on', true);
    update public.cost_sheets c
       set status = 'approved', approved_by = p_actor, approved_at = now(),
           decided_at = now(), decided_by = p_actor, decision_remark = p_remark, updated_at = now()
     where c.id in (select (p ->> 'proposed_id')::uuid from jsonb_array_elements(v_rev.costing_pairs) p)
       and c.status = 'submitted';
    update public.sample_revisions
       set status = 'approved', decided_at = now(), decided_by = p_actor, decision_remark = p_remark, updated_at = now()
     where id = p_id;
    return;
  end if;

  if p_status = 'rejected' then
    -- A restore that cannot finish never loses the reject: the revision stays
    -- pending and says why (the Order Revision rule, 0619).
    begin
      perform public.sample_revision_revert(p_id, 'rejected', p_remark, p_actor);
    exception when others then
      update public.sample_revisions
         set revert_error = sqlerrm, decision_remark = p_remark, reverting_txid = null, updated_at = now()
       where id = p_id;
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants — every function here runs behind a login only
-- ---------------------------------------------------------------------------
revoke all on function public.next_sample_revision_no() from public, anon;
revoke all on function public.sample_open_revision(uuid) from public, anon;
revoke all on function public.sample_is_approved(uuid) from public, anon;
revoke all on function public.sample_entry_refusal(uuid) from public, anon;
revoke all on function public.raise_sample_revision(uuid, text, text[], text, jsonb) from public, anon;
revoke all on function public.set_sample_revision_costings(uuid, jsonb) from public, anon;
revoke all on function public.submit_sample_revision(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.withdraw_sample_revision(uuid) from public, anon;
revoke all on function public.abandon_sample_revision(uuid, text) from public, anon;
-- The restore and the decision are reached only through the functions above
-- and the approval callback — never called by a client.
revoke all on function public.sample_revision_revert(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.sample_revision_apply_decision(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.sample_entry_refusal(uuid) to authenticated;
grant execute on function public.raise_sample_revision(uuid, text, text[], text, jsonb) to authenticated;
grant execute on function public.set_sample_revision_costings(uuid, jsonb) to authenticated;
grant execute on function public.submit_sample_revision(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.withdraw_sample_revision(uuid) to authenticated;
grant execute on function public.abandon_sample_revision(uuid, text) to authenticated;

