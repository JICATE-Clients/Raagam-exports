-- ============================================================================
-- 0653 · PERMISSION OVERRIDES — Phase 3: the lock triggers learn the override
-- ============================================================================
--
-- Spec: doc/email role system.md. Findings: doc/order/permission-override-findings.md.
-- Schema 0650, RPCs 0651. (0652 is the parallel session's pending-MD lock; it
-- widened `order_lock_message`, which this migration reads and does not touch.)
--
-- THIS IS THE MIGRATION THAT CHANGES WHAT A WRITE MAY DO — and only for a user
-- holding a live grant WITH an open override commit on an approved RE. For
-- everyone else every write takes exactly the path it took before (AC-17):
--
--   refuse_when_order_locked()   the live 0619 body, verbatim, with ONE branch
--                                added INSIDE its hard-lock step: when the lock
--                                sentence is about to be raised, ask
--                                `order_override_scope()` first. The override
--                                is therefore consulted ONLY for a write the
--                                lock was already refusing — an open order's
--                                save does not make one extra lookup.
--   refuse_when_budget_approved() the live 0576 body with the same branch for
--                                `budget_override_commit()`.
--
-- Either way a write let through is logged to `override_row_log` IN THE SAME
-- STATEMENT (R-7): the insert is part of the trigger, so it cannot land without
-- its audit row, and if the insert fails the write fails with it.
--
-- Plus three smaller pieces:
--   log_budget_override_edit()   an APPROVED budget's HEADER row is not locked
--                                in the database (only its lines / order links
--                                are; the header is guarded in TypeScript). So
--                                an override edit to it would go unaudited.
--                                This AFTER trigger LOGS such an edit and never
--                                refuses anything — no path that writes a
--                                header today can be broken by it.
--   refuse_revision_during_override()  a revision cannot be raised on an RE
--                                while an override commit is open on it (C-5):
--                                the revision's V0 snapshot would capture a
--                                half-saved override edit.
--   order_override_scope / override_commit_open — redefined from 0651 with the
--                                0652 pending state: an order whose budget is
--                                with the MD is never overridden (C-3), and the
--                                commit door says so in those words.
--
-- D-6 direction: a Delivery Date Extension only moves the date LATER — checked
-- here, on the one header column. Quantity direction is the server action's
-- (the grids are delete-and-reinsert; no single statement sees a total).
-- ============================================================================

-- ─── 1. Resolution, now pending-aware (0651 bodies + the 0652 state) ────────

create or replace function public.order_override_scope(p_order uuid, p_so uuid default null)
returns table (commit_id uuid, keys text[], scope jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_so    uuid;
  v_cid   uuid;
  v_ckeys text[];
  v_keys  text[];
begin
  if v_uid is null or p_order is null then
    return;
  end if;
  v_so := coalesce(p_so, (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order));

  -- A revision in progress on the RE: stand down (C-3).
  if exists (select 1 from public.garment_order_amendments a
              where a.re_status = 'amending'
                and (a.id = p_order or (v_so is not null and a.sales_order_id = v_so))) then
    return;
  end if;
  -- A budget with the MD (0652): stand down (C-3) — the MD is reading figures
  -- computed from these rows.
  if exists (select 1 from public.order_pending_of(p_order, v_so)) then
    return;
  end if;
  -- Not approved: nothing to override — the ordinary rules apply.
  if not exists (select 1 from public.order_lock_of(p_order, v_so)) then
    return;
  end if;

  select oc.id, oc.module_keys into v_cid, v_ckeys
    from public.override_commits oc
   where oc.user_id = v_uid
     and oc.closed_at is null
     and oc.opened_at > now() - public.override_commit_ttl()
     and (oc.garment_order_id = p_order or (v_so is not null and oc.sales_order_id = v_so))
   order by oc.opened_at desc
   limit 1;
  if v_cid is null then
    return;
  end if;

  select array_agg(k order by k) into v_keys
    from unnest(v_ckeys) k
   where k = any(public.permission_override_keys_active(v_uid));
  if v_keys is null then
    return;
  end if;

  return query
    select v_cid, v_keys,
           public.order_amendment_scope_union(array(select public.permission_override_kind(k) from unnest(v_keys) k));
end;
$$;

create or replace function public.override_commit_open(
  p_order uuid, p_keys text[], p_reason text, p_client_ip text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := public.my_override_email();
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_active  text[];
  v_keys    text[];
  v_so      uuid;
  v_state   text;
  v_entry   text;
  v_budget  uuid;
  v_version int;
  v_other   record;
  v_id      uuid;
  k         text;
begin
  if v_uid is null or v_email is null then
    raise exception 'Your account is not active.' using errcode = '42501', hint = 'override_inactive';
  end if;
  if not public.has_permission('orders', 'edit') then
    raise exception 'You cannot edit orders — an override only lifts the approval lock.'
      using errcode = '42501', hint = 'override_no_role';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters.' using errcode = 'P0001', hint = 'override_reason';
  end if;

  select array_agg(distinct x order by x) into v_keys
    from unnest(coalesce(p_keys, '{}'::text[])) x where btrim(x) <> '';
  if v_keys is null then
    raise exception 'Name the modules this save changes.' using errcode = 'P0001', hint = 'override_keys';
  end if;
  v_active := public.permission_override_keys_active(v_uid);
  foreach k in array v_keys loop
    if not (k = any(v_active)) then
      raise exception 'Your override access for "%" has expired or been revoked.', k
        using errcode = '42501', hint = 'override_inactive_key';
    end if;
  end loop;

  select a.sales_order_id, a.re_status into v_so, v_state
    from public.garment_order_amendments a where a.id = p_order;
  if not found then
    raise exception 'That order no longer exists.' using errcode = 'P0001', hint = 'override_order';
  end if;

  select r.entry_no into v_entry
    from public.garment_order_amendments a
    join public.order_budget_revisions r on r.id = a.re_amendment_id
   where a.re_status = 'amending' and (a.id = p_order or (v_so is not null and a.sales_order_id = v_so))
   limit 1;
  if found then
    raise exception 'This order is under revision % — make the change inside that revision.', coalesce(v_entry, '')
      using errcode = 'P0001', hint = 'override_amending';
  end if;

  if exists (select 1 from public.order_pending_of(p_order, v_so)) then
    raise exception 'This order''s budget is with the MD for approval — wait for the decision before editing it.'
      using errcode = 'P0001', hint = 'override_pending';
  end if;

  select l.budget_id into v_budget from public.order_lock_of(p_order, v_so) l;
  if not found then
    raise exception 'This order is not approved — edit it directly; no override is needed.'
      using errcode = 'P0001', hint = 'override_not_needed';
  end if;
  if 'order_budget' = any(v_keys) and v_budget is null then
    raise exception 'This order has no approved budget to edit.' using errcode = 'P0001', hint = 'override_no_budget';
  end if;

  -- Stale commits on this RE are closed (and audited) before anything else.
  for v_other in
    select oc.id from public.override_commits oc
     where oc.closed_at is null and oc.opened_at <= now() - public.override_commit_ttl()
       and (oc.sales_order_id = v_so or oc.garment_order_id = p_order)
  loop
    perform public._override_commit_finalize(v_other.id, 'expired');
  end loop;

  select oc.id, oc.user_id, oc.user_email into v_other
    from public.override_commits oc
   where oc.closed_at is null and (oc.sales_order_id = v_so or oc.garment_order_id = p_order)
   limit 1;
  if found then
    if v_other.user_id = v_uid then
      -- Your own earlier save never closed (a closed tab, a double submit):
      -- close it as failed — audited — and open this one in its place.
      perform public._override_commit_finalize(v_other.id, 'failed');
    else
      raise exception '% is saving an override edit on this order right now — try again in a moment.', v_other.user_email
        using errcode = 'P0001', hint = 'override_busy';
    end if;
  end if;

  select count(*) into v_version
    from public.order_budget_revisions r
   where r.garment_order_id = p_order and r.outcome = 'reapproved';

  begin
    insert into public.override_commits
           (sales_order_id, garment_order_id, module_keys, reason, user_id, user_email,
            order_version, order_state, client_ip)
    values (coalesce(v_so, p_order), p_order, v_keys, v_reason, v_uid, v_email,
            'V' || v_version, coalesce(v_state, 'approved'), nullif(btrim(coalesce(p_client_ip, '')), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Someone else started an override edit on this order a moment ago — try again.'
      using errcode = 'P0001', hint = 'override_busy';
  end;
  return v_id;
end;
$$;

-- ─── 2. The order lock — 0619's body, plus the override inside step 1 ───────

create or replace function public.refuse_when_order_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allow constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason', 'updated_at'
  ];
  v_rows    jsonb[];
  v_row     jsonb;
  v_msg     text;
  v_order   uuid;
  v_so      uuid;
  v_changed text[];
  v_am      record;
  v_ovr     record;   -- 0653
  v_log     uuid;     -- 0653: the commit this write is let through under
begin
  if TG_OP = 'UPDATE' then
    if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then
      return NEW;
    end if;
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(to_jsonb(NEW)) as k
     where not (k = any(v_allow))
       and (to_jsonb(NEW) -> k) is distinct from (to_jsonb(OLD) -> k);
    v_rows := array[to_jsonb(OLD), to_jsonb(NEW)];
  elsif TG_OP = 'INSERT' then
    v_rows := array[to_jsonb(NEW)];
  else
    v_rows := array[to_jsonb(OLD)];
  end if;

  foreach v_row in array v_rows loop
    if TG_TABLE_NAME = 'garment_order_amendments' then
      v_order := (v_row ->> 'id')::uuid;
      v_so    := (v_row ->> 'sales_order_id')::uuid;
    else
      v_order := public.order_lock_row_order(v_row, TG_ARGV);
      v_so    := null;
    end if;

    if v_order is not null and exists (
         select 1 from public.order_budget_revisions r
           join public.garment_order_amendments a on a.re_amendment_id = r.id
          where r.reverting_txid = txid_current() and a.id = v_order) then
      continue;
    end if;

    v_msg := public.order_lock_message(v_order, v_so);
    if v_msg is not null then
      -- 0653 · A PERMISSION OVERRIDE. Asked only now, when the lock is about
      -- to refuse: the caller's open commit on this approved RE, its keys
      -- still live this instant, and the write inside those keys' seed scope
      -- (no whole-document overlay, R-17). No row → the lock refuses exactly
      -- as before (R-3). A row but the write outside it → refused in the
      -- override's own words, so the operator knows the grant was read.
      select s.commit_id, s.keys, s.scope into v_ovr
        from public.order_override_scope(v_order, v_so) s;
      if v_ovr.commit_id is not null then
        if public.order_amendment_refusal(
             '', '', coalesce(v_ovr.scope, '{}'::jsonb), TG_TABLE_NAME, TG_OP, v_changed) is not null then
          raise exception using
            message = format('Your override access (%s) does not open %s — raise an Order Revision for this change.',
                             public.order_amendment_types_label(
                               array(select public.permission_override_kind(k) from unnest(v_ovr.keys) k)),
                             public.order_amendment_area_label(TG_TABLE_NAME::name)),
            errcode = 'P0001', hint = 'order_out_of_override_scope';
        end if;
        -- D-6: a Delivery Date Extension moves the date later, never earlier.
        if TG_TABLE_NAME = 'garment_order_amendments' and TG_OP = 'UPDATE'
           and 'delivery_date' = any(coalesce(v_changed, '{}'::text[]))
           and ((to_jsonb(NEW) ->> 'delivery_date') is null
                or (to_jsonb(OLD) ->> 'delivery_date') is not null
                   and (to_jsonb(NEW) ->> 'delivery_date')::date < (to_jsonb(OLD) ->> 'delivery_date')::date) then
          raise exception using
            message = 'A Delivery Date Extension only moves the delivery date later — raise an Order Revision to bring it forward.',
            errcode = 'P0001', hint = 'override_direction';
        end if;
        v_log := v_ovr.commit_id;
        continue;
      end if;
      raise exception using message = v_msg, errcode = 'P0001', hint = 'order_locked';
    end if;

    select * into v_am from public.order_amendment_of(v_order, v_so);
    if v_am.entry_id is not null then
      v_msg := public.order_amendment_refusal(
        v_am.entry_no,
        public.order_amendment_types_label(v_am.amendment_types),
        coalesce(v_am.scope, '{}'::jsonb),
        TG_TABLE_NAME, TG_OP, v_changed
      );
      if v_msg is not null then
        raise exception using message = v_msg, errcode = 'P0001', hint = 'order_out_of_amendment_scope';
      end if;
    end if;
  end loop;

  -- 0653 · R-7: the write and its audit row, one statement.
  if v_log is not null then
    insert into public.override_row_log (commit_id, table_name, op, row_id, old_row, new_row)
    values (v_log, TG_TABLE_NAME, TG_OP,
            case when TG_OP = 'DELETE' then to_jsonb(OLD) ->> 'id' else to_jsonb(NEW) ->> 'id' end,
            case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
            case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end);
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

-- ─── 3. The budget lock — 0576's body, plus the override ────────────────────

create or replace function public.refuse_when_budget_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids    uuid[];
  v_b      uuid;
  v_c      uuid;
  v_log    uuid;   -- 0653
begin
  if TG_OP = 'INSERT' then
    v_ids := array[NEW.budget_id];
  elsif TG_OP = 'DELETE' then
    v_ids := array[OLD.budget_id];
  else
    v_ids := array[OLD.budget_id, NEW.budget_id];
  end if;
  if exists (select 1 from public.order_budgets b where b.id = any (v_ids) and b.status = 'approved') then
    -- 0653 · A PERMISSION OVERRIDE: every approved budget this row touches must
    -- be under the caller's open `order_budget` commit, or the lock refuses
    -- exactly as before.
    for v_b in select b.id from public.order_budgets b where b.id = any (v_ids) and b.status = 'approved' loop
      v_c := public.budget_override_commit(v_b);
      if v_c is null then
        v_log := null;
        exit;
      end if;
      v_log := v_c;
    end loop;
    if v_log is null then
      raise exception using
        message = 'An approved budget cannot be changed. Reopen it (Amendment Protocol) to revise it',
        errcode = 'P0001';
    end if;
    insert into public.override_row_log (commit_id, table_name, op, row_id, old_row, new_row)
    values (v_log, TG_TABLE_NAME, TG_OP,
            case when TG_OP = 'DELETE' then to_jsonb(OLD) ->> 'id' else to_jsonb(NEW) ->> 'id' end,
            case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
            case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end);
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

-- ─── 4. The approved budget's header: log an override edit, refuse nothing ──

create or replace function public.log_budget_override_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_c uuid;
begin
  if (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') then
    return null;
  end if;
  v_c := public.budget_override_commit(NEW.id);
  if v_c is not null then
    insert into public.override_row_log (commit_id, table_name, op, row_id, old_row, new_row)
    values (v_c, TG_TABLE_NAME, 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_ob_override_log on public.order_budgets;
create trigger trg_ob_override_log after update on public.order_budgets
  for each row when (old.status = 'approved' and new.status = 'approved')
  execute function public.log_budget_override_edit();

-- ─── 5. No revision raised over an open override commit (C-5) ───────────────

create or replace function public.refuse_revision_during_override()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.override_commits oc
              where oc.closed_at is null
                and oc.opened_at > now() - public.override_commit_ttl()
                and (oc.garment_order_id = NEW.id
                     or (NEW.sales_order_id is not null and oc.sales_order_id = NEW.sales_order_id))) then
    raise exception using
      message = 'An override edit is being saved on this order right now — raise the revision in a moment.',
      errcode = 'P0001', hint = 'override_busy';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_goa_override_guard on public.garment_order_amendments;
create trigger trg_goa_override_guard before update of re_status on public.garment_order_amendments
  for each row when (new.re_status = 'amending' and old.re_status is distinct from 'amending')
  execute function public.refuse_revision_during_override();

-- ─── Grants (STANDING: always `from public, anon`) ──────────────────────────

revoke all on function public.order_override_scope(uuid, uuid)               from public, anon;
revoke all on function public.override_commit_open(uuid, text[], text, text) from public, anon;
revoke all on function public.refuse_when_order_locked()                     from public, anon, authenticated;
revoke all on function public.refuse_when_budget_approved()                  from public, anon, authenticated;
revoke all on function public.log_budget_override_edit()                     from public, anon, authenticated;
revoke all on function public.refuse_revision_during_override()              from public, anon, authenticated;

grant execute on function public.order_override_scope(uuid, uuid)               to authenticated;
grant execute on function public.override_commit_open(uuid, text[], text, text) to authenticated;
