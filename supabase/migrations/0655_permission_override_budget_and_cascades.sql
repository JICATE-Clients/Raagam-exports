-- ============================================================================
-- 0655 · PERMISSION OVERRIDES — two gaps 0653 left, found reading the save paths
-- ============================================================================
--
-- Spec: doc/email role system.md. 0650 schema · 0651 RPCs · 0653 enforcement.
-- (0652 and 0654 are the parallel session's; neither touches these functions.)
--
-- 1. A BUDGET OVERRIDE SAVE COULD NEVER SUCCEED.
--    `budget_override_commit()` (0651) found the caller's commit THROUGH
--    `order_budget_orders` — and the budget save (`writeChildren`,
--    lib/orders/budget/actions.ts) deletes lines, deletes order links, then
--    INSERTS the links again. At that insert the budget has no links at all,
--    so the lookup found no commit and the lock refused the very row the
--    override was opened to write. The commit now records the approved budget
--    it was opened against (`override_commits.budget_id`, set by
--    `override_commit_open` from `order_lock_of`), and the budget lock finds
--    it by that — never through the table being rewritten.
--
--    And while an approved budget's links are open to an override, one thing
--    stays shut: linking an order that ANOTHER approved budget already locks.
--    That would put one RE under two approved budgets, which the approval
--    guard (0576) refuses at approve time and nothing would refuse here.
--
-- 2. CASCADED DELETES WENT UNLOGGED.
--    Deleting a parent grid row (an assort line, a combo) cascades to its
--    children (the sizes, the components). Those cascaded deletes reach
--    `refuse_when_order_locked` AFTER their parent is gone, so the order walk
--    ends in NULL and the row passes as "not locked" (0576's accepted rule) —
--    unlogged. Under a quantity or combo override the audit then showed the
--    reinserted children as "(row added)" with no matching removals. Now a
--    DELETE whose order cannot be resolved is logged to the caller's open
--    commit when they have exactly one: it can only be the cascade of a write
--    that commit let through. LOGGING ONLY — it grants nothing; the row was
--    passing before and still passes.
-- ============================================================================

alter table public.override_commits add column if not exists budget_id uuid;

comment on column public.override_commits.budget_id is
  '0655: the approved budget locking the RE when the commit opened (order_lock_of). budget_override_commit() finds the commit by this, not through order_budget_orders, which a budget save rewrites.';

-- ─── 1a. The commit door records the budget ─────────────────────────────────
-- 0653's body; the one change is `budget_id` on the insert (marked 0655).

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
            order_version, order_state, client_ip, budget_id)                      -- 0655: budget_id
    values (coalesce(v_so, p_order), p_order, v_keys, v_reason, v_uid, v_email,
            'V' || v_version, coalesce(v_state, 'approved'), nullif(btrim(coalesce(p_client_ip, '')), ''),
            v_budget)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Someone else started an override edit on this order a moment ago — try again.'
      using errcode = 'P0001', hint = 'override_busy';
  end;
  return v_id;
end;
$$;

-- ─── 1b. The budget's commit, found by the budget it was opened against ─────

create or replace function public.budget_override_commit(p_budget uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select oc.id
    from public.order_budgets b
    join public.override_commits oc on oc.budget_id = b.id
   where b.id = p_budget
     and b.status = 'approved'
     and auth.uid() is not null
     and oc.user_id = auth.uid()
     and oc.closed_at is null
     and oc.opened_at > now() - public.override_commit_ttl()
     and 'order_budget' = any(oc.module_keys)
     and 'order_budget' = any(public.permission_override_keys_active(auth.uid()))
   order by oc.opened_at desc
   limit 1;
$$;

-- ─── 1c. The budget lock: 0653's body + the double-coverage refusal ─────────

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
  v_other  uuid;   -- 0655
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
    -- 0655 · never link an order another APPROVED budget already locks.
    if TG_TABLE_NAME = 'order_budget_orders' and TG_OP <> 'DELETE' then
      select l.budget_id into v_other
        from public.order_lock_of((to_jsonb(NEW) ->> 'garment_order_id')::uuid) l;
      if v_other is not null and v_other <> NEW.budget_id then
        raise exception using
          message = 'That order is already locked by another approved budget — an override cannot put it under two.',
          errcode = 'P0001', hint = 'order_out_of_override_scope';
      end if;
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

-- ─── 2. The order lock: 0653's body + logging a cascaded delete ─────────────

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
  v_orphan  boolean := false;   -- 0655: a row whose order the walk could not resolve
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
    if v_order is null then
      v_orphan := true;   -- 0655
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

  -- 0655 · A CASCADED DELETE (its parent already gone, so no order resolved)
  -- is logged to the caller's open commit when they hold exactly one — it can
  -- only be the cascade of a write that commit let through. Logging only.
  if v_log is null and v_orphan and TG_OP = 'DELETE' and auth.uid() is not null then
    select min(oc.id::text)::uuid into v_log
      from public.override_commits oc
     where oc.user_id = auth.uid()
       and oc.closed_at is null
       and oc.opened_at > now() - public.override_commit_ttl()
    having count(*) = 1;
  end if;

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

-- ─── Grants (STANDING: always `from public, anon`) ──────────────────────────

revoke all on function public.override_commit_open(uuid, text[], text, text) from public, anon;
revoke all on function public.budget_override_commit(uuid)                   from public, anon;
revoke all on function public.refuse_when_budget_approved()                  from public, anon, authenticated;
revoke all on function public.refuse_when_order_locked()                     from public, anon, authenticated;

grant execute on function public.override_commit_open(uuid, text[], text, text) to authenticated;
grant execute on function public.budget_override_commit(uuid)                   to authenticated;
