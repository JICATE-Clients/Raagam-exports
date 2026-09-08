-- ============================================================================
-- Raagam ERP — 0544 The REWORK archive: a frozen copy of every rejected
-- approval attempt (doc/approval.md §4.2)
--
-- `markRework()` never deletes the live row in `garment_order_amendment_
-- ta_approvals` — it freezes a COPY of it here first, then resets the live
-- row for the next attempt (0543's own header explains why the live row's
-- CHECK still has to admit `rework` even though it never rests there: this
-- table is the other half of that same vocabulary).
--
-- ONE ROW PER REJECTED ATTEMPT, NEVER UPDATED. `archived_at` is the only
-- interesting timestamp; the row is written once, by `markRework()`, and
-- read only — there is no update path and no reason for one. `source_row_id`
-- points at the STILL-LIVE row (never deleted), so "show me every rejection
-- this approval has been through" is one `where source_row_id = $1 order by
-- version` query, newest last.
--
-- `status` reuses the SAME check vocabulary as the live table for a single
-- reason: a rejection is always recorded as `rework` here, and that has to be
-- one of the values `garment_order_amendment_ta_approvals` itself declares
-- legal, not a private spelling this table invents alone.
-- ============================================================================

create table if not exists public.garment_order_amendment_ta_approval_history (
  id                   uuid primary key default gen_random_uuid(),
  source_row_id        uuid not null references public.garment_order_amendment_ta_approvals(id) on delete cascade,
  amendment_id         uuid not null references public.garment_order_amendments(id) on delete cascade,
  approval_id          uuid references public.ta_approvals(id) on delete set null,

  -- The FROZEN version number this snapshot WAS, before markRework() bumped
  -- the live row past it.
  version              integer not null,

  target_date          date,
  actual_sent_date     date,
  actual_received_date date,
  proof_path           text,
  mime_type            text,
  size_bytes           bigint,

  status               text not null check (status in ('pending', 'sent', 'approved', 'rework')),
  -- Mandatory at the APPLICATION layer when status = 'rework' (the doc's own
  -- rule: "the system makes Remarks strictly mandatory") — not a NOT NULL
  -- here, because a future archive reason other than rework should not be
  -- forced to invent one. `markRework()` refuses with no insert at all if
  -- this is blank, same shape as every other mandatory-field rule in this
  -- app (AGENTS.md: "one declaration", not a hand-stamped marker).
  remarks              text,

  created_by           uuid references public.profiles(id),
  archived_at          timestamptz not null default now()
);

create index if not exists idx_goa_ta_approval_history_source
  on public.garment_order_amendment_ta_approval_history(source_row_id);
create index if not exists idx_goa_ta_approval_history_amendment
  on public.garment_order_amendment_ta_approval_history(amendment_id);

alter table public.garment_order_amendment_ta_approval_history enable row level security;

drop policy if exists goa_ta_approval_history_read   on public.garment_order_amendment_ta_approval_history;
drop policy if exists goa_ta_approval_history_insert on public.garment_order_amendment_ta_approval_history;

-- READ and INSERT only — this table is written once by markRework() and never
-- updated or deleted; there is no update/delete policy because there is no
-- legitimate caller of either.
create policy goa_ta_approval_history_read on public.garment_order_amendment_ta_approval_history
  for select to authenticated
  using (public.has_permission('orders', 'view'));

create policy goa_ta_approval_history_insert on public.garment_order_amendment_ta_approval_history
  for insert to authenticated
  with check (public.has_permission('orders', 'edit'));

comment on table public.garment_order_amendment_ta_approval_history is
  'Frozen snapshots of rejected approval submissions (0544/doc/approval.md §4.2) — one row per REWORK, written by markRework() and never updated. source_row_id is the still-live tracker row; version is what it was AT THE TIME of this rejection.';


-- ---------- assertions ------------------------------------------------------

do $assert$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_ta_approval_history'
  ) then
    raise exception '0544: garment_order_amendment_ta_approval_history was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename = 'garment_order_amendment_ta_approval_history') <> 2 then
    raise exception '0544: expected exactly 2 policies (read, insert — no update/delete)';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.garment_order_amendment_ta_approval_history'::regclass
       and contype = 'f'
       and confrelid = 'public.garment_order_amendment_ta_approvals'::regclass
  ) then
    raise exception '0544: source_row_id does not reference garment_order_amendment_ta_approvals';
  end if;
end $assert$;
