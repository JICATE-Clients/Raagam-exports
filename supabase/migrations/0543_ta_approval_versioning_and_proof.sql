-- ============================================================================
-- Raagam ERP — 0543 An order's approval tracker gets versioning and real proof
-- metadata (doc/approval.md §4)
--
-- Three additions to the live per-order ledger, `garment_order_amendment_ta_approvals`:
--
-- 1. `active_version` — the resubmission counter. A rejected sample is not a
--    deleted row; it is Version 1 of a story that continues, and the Approvals
--    Worklist needs to say "v2" at a glance.
-- 2. `mime_type` / `size_bytes` alongside the already-existing `proof_path`,
--    mirroring `garment_order_amendment_files` (0416) exactly, so a file
--    attached here can be shown (name/size) without inventing a second
--    metadata shape for what is still, in the end, one uploaded object.
-- 3. `status` widens from `('pending','sent','received')` to
--    `('pending','sent','approved','rework')`.
--
-- ## `rework` IS A VALUE THIS COLUMN IS DOCUMENTED TO NEVER REST ON
--
-- That is not a contradiction — it is why the CHECK needs the 4th value at
-- all. `markRework()` (the Approvals Worklist action, `lib/ta/
-- approvals-worklist-actions.ts`) freezes the CURRENT row into
-- `garment_order_amendment_ta_approval_history` with `status = 'rework'` —
-- that is the archive table's own record of what happened — and then resets
-- THIS row back to `pending` for the next attempt. So the live table's CHECK
-- has to admit `rework` because the shared vocabulary is used by both tables
-- (the history table reuses this exact CHECK, see 0544), while the
-- application code is the thing that guarantees the live row itself never
-- actually holds it. A reader who finds a live row with `status = 'rework'`
-- has found an application bug, not a database one — the CHECK cannot express
-- "this value is legal on my sibling table but not on me".
--
-- `received` → `approved`: the doc's own vocabulary is PENDING / SENT /
-- APPROVED / REWORK, and "received" was ambiguous on exactly the question that
-- matters — a buyer can receive a sample and reject it. Renaming is safe: the
-- branch this table came from is unmerged and has no production data.
-- ============================================================================

alter table public.garment_order_amendment_ta_approvals
  add column if not exists active_version integer not null default 1,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint;

comment on column public.garment_order_amendment_ta_approvals.active_version is
  'Resubmission counter (0543/doc/approval.md §4.2). Starts at 1; markRework() increments it and archives the prior attempt into garment_order_amendment_ta_approval_history rather than deleting anything.';
comment on column public.garment_order_amendment_ta_approvals.mime_type is
  'Mirrors garment_order_amendment_files.mime_type — the uploaded proof file''s type, for display only.';
comment on column public.garment_order_amendment_ta_approvals.size_bytes is
  'Mirrors garment_order_amendment_files.size_bytes.';

alter table public.garment_order_amendment_ta_approvals
  drop constraint if exists garment_order_amendment_ta_approvals_status_check;

update public.garment_order_amendment_ta_approvals
   set status = 'approved'
 where status = 'received';

alter table public.garment_order_amendment_ta_approvals
  add constraint garment_order_amendment_ta_approvals_status_check
  check (status in ('pending', 'sent', 'approved', 'rework'));


-- ---------- assertions ------------------------------------------------------

do $assert$
declare
  probe_amend uuid;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approvals'
       and column_name  = 'active_version'
  ) then
    raise exception '0543: active_version was not added';
  end if;

  if exists (
    select 1 from public.garment_order_amendment_ta_approvals where status = 'received'
  ) then
    raise exception '0543: a row still holds the retired "received" status';
  end if;

  -- A REAL amendment id, so the CHECK is what fires — not the FK.
  select id into probe_amend from public.garment_order_amendments limit 1;
  if probe_amend is not null then
    begin
      insert into public.garment_order_amendment_ta_approvals (amendment_id, row_uid, status)
      values (probe_amend, gen_random_uuid(), 'approved_typo');
      raise exception '0543: status CHECK admitted an unknown value';
    exception when check_violation then
      null; -- expected
    end;
  end if;
end $assert$;
