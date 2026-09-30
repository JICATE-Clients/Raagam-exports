-- ============================================================================
-- 0650 · EMAIL-BASED PERMISSION OVERRIDES — Phase 1: the schema
-- ============================================================================
--
-- Spec: doc/email role system.md (Jicate v1.0, 29-09-2026). Findings and the
-- spec → Raagam mapping: doc/order/permission-override-findings.md.
--
-- An administrator grants a named user (by EMAIL) a time-limited right to edit
-- specific modules of an APPROVED order in place — no revision, no MD approval —
-- with every edit audited. This migration lays down only the STORAGE: the
-- grants, their history, the commits a save runs under, and the two audit
-- tables. Nothing here changes what any write is allowed to do yet; the lock
-- triggers learn about overrides in Phase 3. Until then every table below is
-- inert, and the order lock behaves exactly as 0619 left it (AC-17).
--
-- THE MODULE KEYS ARE THE RAISE REVISION KINDS (spec §3.1 says to reuse them):
-- the five Order Entry kinds as they are, plus the three module keys of
-- `AMENDMENT_MODULES`. `permission_override_kind()` maps each key to the kind
-- whose seed in `order_amendment_scopes` says which tables and columns it
-- opens — the §4.4 field map already exists, as 0604's seed, and is read as it
-- stands, WITHOUT 0627's whole-document overlay (that overlay is what a
-- revision does; an override is exactly as narrow as its key, R-17).
--   TS twin: lib/orders/overrides/override-modules.ts
--   Held together by: npm run check:permission-overrides
--
-- POSTGRES, NOT THE SPEC'S MYSQL: uuid keys, timestamptz (stored UTC, compared
-- against now() — the database clock, R-11). Emails are stored lower-cased and
-- trimmed and a CHECK refuses anything else (R-1); there is no FK to profiles,
-- because profiles.email is neither unique nor lower-cased (findings §2).
--
-- NO FOREIGN KEYS FROM THE AUDIT TABLES, deliberately: an order document that is
-- later deleted keeps its override history (same rule as hr_staff_fine_events,
-- 0629). And no FK to profiles for granted_by / revoked_by: two FKs to one table
-- would make every bare PostgREST embed PGRST201-ambiguous (AGENTS.md), and
-- names resolve through creator_names() anyway, since profiles is own-row RLS.
-- ============================================================================

-- ─── The key catalog (the one SQL literal; check:permission-overrides) ─────

create or replace function public.permission_override_kind(p_key text)
returns text language sql immutable set search_path = '' as $$
  select case p_key
    when 'qty_addition'        then 'qty_addition'
    when 'qty_cancellation'    then 'qty_cancellation'
    when 'price_change'        then 'price_change'
    when 'delivery_date_ext'   then 'delivery_date_ext'
    when 'combo_colour_change' then 'combo_colour_change'
    when 'material_bom'        then 'material_bom_revision'
    when 'fabric_bom'          then 'fabric_bom_revision'
    when 'order_budget'        then 'budget_revision'
    else null   -- an unknown key opens NOTHING — never "no restriction"
  end;
$$;

-- ─── Who may manage, who may read (R-15, D-7) ───────────────────────────────

-- Manage = system_admin:edit (a super admin passes has_permission) or the
-- Managing Director role. The approval engine keys the MD by roles.name too.
create or replace function public.can_manage_permission_overrides(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('system_admin', 'edit', uid)
      or exists (select 1
                   from public.user_roles ur
                   join public.roles r on r.id = ur.role_id
                  where ur.user_id = uid and r.name = 'Managing Director');
$$;

create or replace function public.can_view_permission_overrides(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_permission_overrides(uid)
      or public.has_permission('system_admin', 'view', uid);
$$;

-- The caller's own email as the override tables store it (R-1). NULL for an
-- inactive profile, so a deactivated user reads as having no grants (R-2).
create or replace function public.my_override_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(btrim(p.email))
    from public.profiles p
   where p.id = auth.uid() and p.is_active;
$$;

-- ─── 1. The grants ──────────────────────────────────────────────────────────

create table if not exists public.user_email_permission_overrides (
  id               uuid primary key default gen_random_uuid(),
  user_email       text not null check (user_email <> '' and user_email = lower(btrim(user_email))),
  module_key       text not null check (module_key in (
                     'qty_addition', 'qty_cancellation', 'price_change',
                     'delivery_date_ext', 'combo_colour_change',
                     'material_bom', 'fabric_bom', 'order_budget')),
  can_edit         boolean not null default true,
  can_approve      boolean not null default false,   -- stored, no effect in v1 (R-20, D-4)
  override_expiry  timestamptz not null,             -- always set, ≤ 30 days (D-3); checked by the grant RPC
  reason           text not null check (char_length(btrim(reason)) >= 10),   -- R-16
  granted_by       uuid not null,
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,                      -- soft revoke, never deleted (R-12)
  revoked_by       uuid,
  revoke_reason    text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_override_email_module unique (user_email, module_key),   -- R-13: re-grant updates, never duplicates
  constraint override_revoke_complete check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null
        and char_length(btrim(coalesce(revoke_reason, ''))) >= 10))
);
create index if not exists idx_override_expiry on public.user_email_permission_overrides (override_expiry);

drop trigger if exists trg_override_updated_at on public.user_email_permission_overrides;
create trigger trg_override_updated_at before update on public.user_email_permission_overrides
  for each row execute function public.set_updated_at();

-- ─── 2. Grant history (R-14) — append-only ──────────────────────────────────

create table if not exists public.override_grant_history (
  id               uuid primary key default gen_random_uuid(),
  override_id      uuid not null,
  action           text not null check (action in ('GRANT', 'RENEW', 'REVOKE')),
  user_email       text not null,
  module_key       text not null,
  can_edit         boolean not null,
  override_expiry  timestamptz,
  reason           text not null,
  actor_id         uuid not null,
  actor_email      text,
  action_timestamp timestamptz not null default clock_timestamp()
);
create index if not exists idx_grant_hist_override on public.override_grant_history (override_id, action_timestamp);

-- ─── 3. Override commits — one save under an override ───────────────────────
--
-- The spec's commit_id. A save opens one (carrying the mandatory reason, R-16),
-- every write the trigger lets through stamps it, and the save closes it. One
-- OPEN commit per RE at a time: that is the concurrency control, since no save
-- in this app is one transaction and a SELECT … FOR UPDATE cannot span a series
-- of PostgREST calls (findings C-5).

create table if not exists public.override_commits (
  id               uuid primary key default gen_random_uuid(),
  sales_order_id   uuid not null,             -- the RE No: the lock is per RE (0576 order_lock_of)
  garment_order_id uuid not null,             -- the document the save started from
  module_keys      text[] not null check (cardinality(module_keys) > 0),
  reason           text not null check (char_length(btrim(reason)) >= 10),
  user_id          uuid not null,
  user_email       text not null,
  order_version    text,                      -- "V{n}" at open, as v-final.ts counts it
  order_state      text not null,             -- re_status at open ('approved')
  client_ip        text,
  status           text not null default 'open'
                   check (status in ('open', 'committed', 'failed', 'expired')),
  direction_breach boolean not null default false,   -- D-6 qty direction, flagged for the report
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  constraint override_commit_closed check ((status = 'open') = (closed_at is null))
);
create unique index if not exists uq_override_commit_open_per_re
  on public.override_commits (sales_order_id) where closed_at is null;
create index if not exists idx_override_commits_user on public.override_commits (user_id, opened_at);
create index if not exists idx_override_commits_re   on public.override_commits (sales_order_id, opened_at);

-- ─── 4. The raw row log — written by the lock trigger (Phase 3) ─────────────
--
-- The R-7 guarantee lives here: the trigger that lets an override write through
-- inserts this row IN THE SAME STATEMENT, so no write under an override can land
-- without it — if this insert fails, the write fails with it.

create table if not exists public.override_row_log (
  id         bigint generated always as identity primary key,
  commit_id  uuid not null,
  table_name text not null,
  op         text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id     text,
  old_row    jsonb,
  new_row    jsonb,
  at         timestamptz not null default clock_timestamp()
);
create index if not exists idx_override_row_log_commit on public.override_row_log (commit_id, id);

-- ─── 5. The field-level audit trail (spec §3.2) — derived at commit close ───
--
-- One row per changed field, what the MD's Override Edit Report reads (R-18).
-- Derived from the raw log when the commit closes, because the grids are saved
-- by delete-and-reinsert: pairing a deleted row with its reinserted twin is a
-- set operation over the whole save, not something one row trigger can see.

create table if not exists public.override_audit_trail (
  id               uuid primary key default gen_random_uuid(),
  commit_id        uuid not null,
  sales_order_id   uuid not null,
  garment_order_id uuid not null,
  order_version    text,
  order_state      text not null,
  user_id          uuid not null,
  user_email       text not null,
  module_key       text,                      -- the key that opened the table; null if several
  entity_table     text not null,
  entity_row_id    text,
  field_name       text not null,             -- '… (recalc)' for a recalculated side effect
  old_value        text,
  new_value        text,
  reason           text not null,
  client_ip        text,
  is_bypass_flag   boolean not null default true,
  action_timestamp timestamptz not null default clock_timestamp()
);
create index if not exists idx_override_audit_commit on public.override_audit_trail (commit_id);
create index if not exists idx_override_audit_re     on public.override_audit_trail (sales_order_id, action_timestamp);
create index if not exists idx_override_audit_user   on public.override_audit_trail (user_email, action_timestamp);

-- ─── Append-only: history, raw log and audit trail ──────────────────────────

create or replace function public.override_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is an audit log — rows cannot be changed or removed', TG_TABLE_NAME
    using errcode = 'P0001', hint = 'override_audit_immutable';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['override_grant_history', 'override_row_log', 'override_audit_trail'] loop
    execute format('drop trigger if exists trg_%1$s_immutable on public.%1$I', t);
    execute format('create trigger trg_%1$s_immutable before update or delete on public.%1$I
                      for each row execute function public.override_audit_immutable()', t);
  end loop;
end $$;

-- ─── RLS: read by managers / viewers (and your own), write by nobody ────────
--
-- Every write goes through a SECURITY DEFINER RPC (Phase 2) or the lock trigger
-- (Phase 3); there is deliberately no insert / update / delete policy, and the
-- table grants are revoked too, so a direct PostgREST write is refused twice.

alter table public.user_email_permission_overrides enable row level security;
alter table public.override_grant_history          enable row level security;
alter table public.override_commits                enable row level security;
alter table public.override_row_log                enable row level security;
alter table public.override_audit_trail            enable row level security;

drop policy if exists override_grants_read on public.user_email_permission_overrides;
create policy override_grants_read on public.user_email_permission_overrides for select
  using (public.can_view_permission_overrides() or user_email = public.my_override_email());

drop policy if exists override_history_read on public.override_grant_history;
create policy override_history_read on public.override_grant_history for select
  using (public.can_view_permission_overrides());

drop policy if exists override_commits_read on public.override_commits;
create policy override_commits_read on public.override_commits for select
  using (public.can_view_permission_overrides() or user_id = auth.uid());

drop policy if exists override_row_log_read on public.override_row_log;
create policy override_row_log_read on public.override_row_log for select
  using (public.can_view_permission_overrides());

drop policy if exists override_audit_read on public.override_audit_trail;
create policy override_audit_read on public.override_audit_trail for select
  using (public.can_view_permission_overrides());

revoke insert, update, delete, truncate on public.user_email_permission_overrides from anon, authenticated;
revoke insert, update, delete, truncate on public.override_grant_history          from anon, authenticated;
revoke insert, update, delete, truncate on public.override_commits                from anon, authenticated;
revoke insert, update, delete, truncate on public.override_row_log                from anon, authenticated;
revoke insert, update, delete, truncate on public.override_audit_trail            from anon, authenticated;
revoke all on public.user_email_permission_overrides from anon;
revoke all on public.override_grant_history          from anon;
revoke all on public.override_commits                from anon;
revoke all on public.override_row_log                from anon;
revoke all on public.override_audit_trail            from anon;

-- ─── Function grants (STANDING: always `from public, anon`) ─────────────────

revoke all on function public.permission_override_kind(text)              from public, anon;
revoke all on function public.can_manage_permission_overrides(uuid)       from public, anon;
revoke all on function public.can_view_permission_overrides(uuid)         from public, anon;
revoke all on function public.my_override_email()                         from public, anon;
revoke all on function public.override_audit_immutable()                  from public, anon, authenticated;

-- The RLS policies above call these as the querying user, so authenticated
-- needs EXECUTE; the screens also read the manage gate.
grant execute on function public.permission_override_kind(text)           to authenticated;
grant execute on function public.can_manage_permission_overrides(uuid)    to authenticated;
grant execute on function public.can_view_permission_overrides(uuid)      to authenticated;
grant execute on function public.my_override_email()                      to authenticated;

-- ─── Self-check: the catalog opens real seed rows, and only real ones ───────

do $$
declare
  k text;
  v_kind text;
  v_keys text[] := array['qty_addition', 'qty_cancellation', 'price_change',
                         'delivery_date_ext', 'combo_colour_change',
                         'material_bom', 'fabric_bom', 'order_budget'];
begin
  foreach k in array v_keys loop
    v_kind := public.permission_override_kind(k);
    if v_kind is null then
      raise exception '0650: key % maps to no kind', k;
    end if;
    if not exists (select 1 from public.order_amendment_scopes where amendment_type = v_kind) then
      raise exception '0650: key % maps to kind %, which has no seed rows — it would open nothing', k, v_kind;
    end if;
  end loop;
  if public.permission_override_kind('bom_revision') is not null
     or public.permission_override_kind('anything') is not null then
    raise exception '0650: an unknown key must map to NULL';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in ('user_email_permission_overrides', 'override_grant_history',
                                  'override_commits', 'override_row_log', 'override_audit_trail')
                and not c.relrowsecurity) then
    raise exception '0650: an override table was left without RLS';
  end if;
end $$;
