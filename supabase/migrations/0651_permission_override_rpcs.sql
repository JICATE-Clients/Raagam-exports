-- ============================================================================
-- 0651 · PERMISSION OVERRIDES — Phase 2: resolution, grants, commits
-- ============================================================================
--
-- Spec: doc/email role system.md. Plan + findings:
-- doc/order/permission-override-findings.md. Schema: 0650.
--
-- Three groups of functions, and still NOTHING that changes what a write may
-- do — the lock triggers read `order_override_scope()` / `budget_override_commit()`
-- from Phase 3 on. Until then an open commit lets nothing through (AC-17).
--
--   RESOLUTION (R-2, R-10, R-11) — every answer computed per call against the
--   database clock, never cached:
--     permission_override_keys_active(uid)  internal: a user's live keys
--     my_active_overrides()                 the caller's live keys + expiry (screens)
--     order_override_scope(order, so)       what the caller may write on this RE
--                                           right now, and under which commit
--     budget_override_commit(budget)        the same question for a budget
--
--   GRANTS (R-12 … R-15, D-3, D-5) — one transaction each, history in the same:
--     override_grantee_candidates()         the admin screen's user picker
--     grant_permission_override(...)        grant or renew (upsert, R-13)
--     revoke_permission_override(...)       soft revoke (R-12)
--
--   COMMITS (R-7, R-16, C-5) — one save under an override:
--     override_commit_open(...)             carries the mandatory reason
--     override_commit_close(...)            derives the field-level audit rows
--
-- WHY A COMMIT AT ALL. A grant says "may"; the commit says "is, now, for this
-- reason". Without one, a user holding a grant would write to an approved order
-- from any stale tab with no reason recorded — the grant would be a standing
-- key. The trigger honours a grant only through an OPEN commit on that RE, no
-- older than `override_commit_ttl()`, opened by the same user.
--
-- WHY STAND DOWN WHILE AMENDING (findings C-3). A revision's Reject restores
-- whole modules from the V0 snapshot (`order_amendment_revert`), so an override
-- edit made while the RE reads `amending` would be erased by a Reject or folded
-- silently into the revision by an Approve. The revision is the channel then.
-- ============================================================================

-- ─── Constants (the TS twin holds the same numbers; check:permission-overrides)

create or replace function public.override_commit_ttl()
returns interval language sql immutable set search_path = '' as $$ select interval '30 minutes' $$;

create or replace function public.override_max_days()
returns int language sql immutable set search_path = '' as $$ select 30 $$;

-- The columns a recalculation writes (BOM_DERIVED_SCOPE, amendment-entry.ts).
-- A changed field here is labelled "(recalc)" in the audit (spec §5 step 6):
-- the user did not type it, their edit moved it.
create or replace function public.override_is_recalc(p_table text, p_field text)
returns boolean language sql immutable set search_path = '' as $$
  select p_table in ('order_fabric_bom_requirements', 'material_bom_amendment_requirements')
      or (p_table = 'order_fabric_bom_yarns'       and p_field in ('purchase_qty', 'uom_id', 'refusal_reason'))
      or (p_table = 'order_fabric_bom_yarn_stages' and p_field in ('process_qty', 'uom_id', 'refusal_reason'))
      or (p_table in ('order_fabric_boms', 'material_bom_amendments')
          and p_field in ('computed_at', 'computed_for_qty', 'computed_basis_hash'));
$$;

-- Which of a commit's keys opened this table — the one key whose seed names it,
-- or NULL when several do (price_change and combo_colour_change both open
-- price_details; the audit row then says so by naming neither).
create or replace function public.override_key_for_table(p_keys text[], p_table text)
returns text language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(k) end
    from unnest(p_keys) k
   where exists (select 1 from public.order_amendment_scopes s
                  where s.amendment_type = public.permission_override_kind(k)
                    and s.table_name::text = p_table);
$$;

-- ─── Resolution ─────────────────────────────────────────────────────────────

-- R-2 in one query: active profile, can_edit, not revoked, not expired — the
-- expiry against now(), the database clock (R-11). INTERNAL: it takes a uid.
create or replace function public.permission_override_keys_active(uid uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct o.module_key order by o.module_key), '{}'::text[])
    from public.profiles p
    join public.user_email_permission_overrides o on o.user_email = lower(btrim(p.email))
   where p.id = uid
     and p.is_active
     and o.can_edit
     and o.revoked_at is null
     and o.override_expiry > now();
$$;

create or replace function public.my_active_overrides()
returns table (module_key text, override_expiry timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.module_key, o.override_expiry
    from public.profiles p
    join public.user_email_permission_overrides o on o.user_email = lower(btrim(p.email))
   where p.id = auth.uid()
     and p.is_active
     and o.can_edit
     and o.revoked_at is null
     and o.override_expiry > now()
   order by o.module_key;
$$;

-- What the caller may write on this RE right now, under which commit. No row =
-- the override does not apply, and the lock refuses exactly as before (R-3).
-- The keys are the commit's keys STILL ACTIVE at this instant, so a revoke or
-- an expiry mid-save narrows the very next statement (AC-4, AC-5). The scope is
-- the per-kind seed union — never 0627's whole-document overlay (R-17).
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
  -- Not locked: nothing to override — the ordinary rules apply.
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

-- The budget's twin: an APPROVED budget, the caller's live `order_budget` key,
-- and their open commit on any RE the budget covers.
create or replace function public.budget_override_commit(p_budget uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select oc.id
    from public.order_budgets b
    join public.order_budget_orders bo on bo.budget_id = b.id
    join public.garment_order_amendments a on a.id = bo.garment_order_id
    join public.override_commits oc
      on oc.garment_order_id = a.id or oc.sales_order_id = a.sales_order_id
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

-- ─── Grants ─────────────────────────────────────────────────────────────────

-- The picker (findings C-8): active logins, with the Staff Master department
-- and designation where profiles.employee_code links one. `can_edit_orders`
-- lets the screen say WHY a user cannot be chosen (C-4) instead of hiding them.
create or replace function public.override_grantee_candidates()
returns table (
  user_id uuid, email text, full_name text,
  employee_name text, department text, designation text,
  can_edit_orders boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_permission_overrides() then
    raise exception 'Only an administrator or the Managing Director can manage override access.'
      using errcode = '42501', hint = 'override_forbidden';
  end if;
  return query
    select p.id, lower(btrim(p.email)), p.full_name,
           e.name, d.name, g.name,
           public.has_permission('orders', 'edit', p.id)
      from public.profiles p
      left join lateral (
        select e.name, e.department_id, e.designation_id
          from public.employees e
         where p.employee_code is not null
           and upper(btrim(e.code)) = upper(btrim(p.employee_code))
         limit 1
      ) e on true
      left join public.config_lookups d on d.id = e.department_id
      left join public.config_lookups g on g.id = e.designation_id
     where p.is_active
       and coalesce(btrim(p.email), '') <> ''
       and p.id <> auth.uid()          -- D-5: never offer yourself
     order by lower(coalesce(p.full_name, p.email));
end;
$$;

-- Grant or renew, one row per key (R-13: the unique key makes a re-grant an
-- UPDATE, clearing any revoke), one history row per key (R-14), one transaction.
create or replace function public.grant_permission_override(
  p_email text, p_keys text[], p_expiry timestamptz, p_reason text
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_n       int;
  v_target  uuid;
  v_actor   text;
  v_keys    text[];
  k         text;
  v_id      uuid;
  v_existed boolean;
  v_count   int := 0;
begin
  if not public.can_manage_permission_overrides() then
    raise exception 'Only an administrator or the Managing Director can grant override access.'
      using errcode = '42501', hint = 'override_forbidden';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters.' using errcode = 'P0001', hint = 'override_reason';
  end if;
  if p_expiry is null or p_expiry <= now() then
    raise exception 'The expiry must be in the future.' using errcode = 'P0001', hint = 'override_expiry';
  end if;
  if p_expiry > now() + make_interval(days => public.override_max_days()) then
    raise exception 'Access can be granted for at most % days.', public.override_max_days()
      using errcode = 'P0001', hint = 'override_expiry';
  end if;

  select array_agg(distinct x order by x) into v_keys
    from unnest(coalesce(p_keys, '{}'::text[])) x
   where btrim(x) <> '';
  if v_keys is null then
    raise exception 'Choose at least one module.' using errcode = 'P0001', hint = 'override_keys';
  end if;
  foreach k in array v_keys loop
    if public.permission_override_kind(k) is null then
      raise exception 'Unknown module "%".', k using errcode = 'P0001', hint = 'override_keys';
    end if;
  end loop;

  select count(*), (array_agg(p.id))[1] into v_n, v_target
    from public.profiles p
   where p.is_active and lower(btrim(p.email)) = v_email;
  if v_n = 0 then
    raise exception 'No active user has the email %.', v_email using errcode = 'P0001', hint = 'override_user';
  elsif v_n > 1 then
    raise exception 'More than one user has the email % — correct the user list first.', v_email
      using errcode = 'P0001', hint = 'override_user';
  end if;
  if v_target = auth.uid() or v_email = public.my_override_email() then
    raise exception 'You cannot grant override access to yourself.' using errcode = 'P0001', hint = 'override_self';
  end if;
  if not public.has_permission('orders', 'edit', v_target) then
    raise exception '% cannot edit orders at all. An override only lifts the approval lock — give them an order-editing role first.', v_email
      using errcode = 'P0001', hint = 'override_no_role';
  end if;

  select lower(btrim(p.email)) into v_actor from public.profiles p where p.id = auth.uid();

  foreach k in array v_keys loop
    select exists (select 1 from public.user_email_permission_overrides o
                    where o.user_email = v_email and o.module_key = k) into v_existed;
    insert into public.user_email_permission_overrides
           (user_email, module_key, can_edit, can_approve, override_expiry, reason, granted_by)
    values (v_email, k, true, false, p_expiry, v_reason, auth.uid())
    on conflict (user_email, module_key) do update
       set can_edit      = true,
           override_expiry = excluded.override_expiry,
           reason        = excluded.reason,
           granted_by    = excluded.granted_by,
           granted_at    = now(),
           revoked_at    = null,
           revoked_by    = null,
           revoke_reason = null
    returning id into v_id;

    insert into public.override_grant_history
           (override_id, action, user_email, module_key, can_edit, override_expiry, reason, actor_id, actor_email)
    values (v_id, case when v_existed then 'RENEW' else 'GRANT' end, v_email, k, true, p_expiry, v_reason,
            auth.uid(), v_actor);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.revoke_permission_override(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  g        public.user_email_permission_overrides%rowtype;
begin
  if not public.can_manage_permission_overrides() then
    raise exception 'Only an administrator or the Managing Director can revoke override access.'
      using errcode = '42501', hint = 'override_forbidden';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters.' using errcode = 'P0001', hint = 'override_reason';
  end if;
  select * into g from public.user_email_permission_overrides where id = p_id for update;
  if not found then
    raise exception 'That override no longer exists.' using errcode = 'P0001', hint = 'override_missing';
  end if;
  if g.revoked_at is not null then
    raise exception 'That override is already revoked.' using errcode = 'P0001', hint = 'override_revoked';
  end if;

  update public.user_email_permission_overrides
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason
   where id = p_id;

  insert into public.override_grant_history
         (override_id, action, user_email, module_key, can_edit, override_expiry, reason, actor_id, actor_email)
  values (g.id, 'REVOKE', g.user_email, g.module_key, g.can_edit, g.override_expiry, v_reason,
          auth.uid(), (select lower(btrim(p.email)) from public.profiles p where p.id = auth.uid()));
end;
$$;

-- ─── Commits ────────────────────────────────────────────────────────────────

-- Close a commit and turn its raw row log into field-level audit rows. Shared by
-- the owner's close and the stale sweep (an abandoned save is still audited).
--
-- THE DIFF, in three passes over the net effect per (table, row id) — first
-- event's OLD, last event's NEW, so a row touched twice counts once and a row
-- inserted then deleted inside the save counts not at all:
--   1. same row id on both sides → one audit row per changed column;
--   2. delete-and-reinsert twins → bodies compared with the volatile keys
--      stripped (0618's list: own id, parent links, timestamps) and identical
--      bodies cancel, as `order_amendment_changes_of` v2 does;
--   3. what is left is PAIRED by position within the table when both sides
--      have the same count (the grid was rewritten row for row — a changed
--      price on one of ten lines leaves exactly one of each), and otherwise
--      reported as "(row removed)" / "(row added)" with the whole row.
create or replace function public._override_commit_finalize(
  p_commit uuid, p_status text, p_breach boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c        public.override_commits%rowtype;
  v_bk     constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason', 'updated_at', 'created_at', 'created_by'
  ];
  v_vol    constant text[] := array[
    'id', 'created_at', 'updated_at', 'created_by',
    'amendment_id', 'bom_id', 'entry_id', 'combo_id', 'structure_id', 'quantity_id',
    'line_id', 'yarn_id', 'combination_id', 'item_line_id', 'garment_order_id'
  ];
  v_fields int := 0;
begin
  select * into c from public.override_commits where id = p_commit for update;
  if not found then
    raise exception 'Override commit % not found.', p_commit using errcode = 'P0001', hint = 'override_commit';
  end if;
  if c.closed_at is not null then
    return jsonb_build_object('status', c.status, 'fields', 0, 'already_closed', true);
  end if;

  with ev as (
    select l.id, l.table_name, coalesce(l.row_id, '') as rid, l.old_row, l.new_row
      from public.override_row_log l
     where l.commit_id = p_commit
  ),
  net as (
    select table_name, rid,
           (array_agg(old_row order by id))[1]      as o,
           (array_agg(new_row order by id desc))[1] as n,
           min(id) as first_id
      from ev
     group by table_name, rid
  ),
  upd as (select table_name, rid, o - v_bk as o, n - v_bk as n from net where o is not null and n is not null),
  del as (select table_name, rid, o - v_bk as body, (o - v_bk) - v_vol as shape, first_id from net where o is not null and n is null),
  ins as (select table_name, rid, n - v_bk as body, (n - v_bk) - v_vol as shape, first_id from net where o is null and n is not null),
  d_k as (select d.*, row_number() over (partition by d.table_name, d.shape order by d.first_id) as k from del d),
  i_k as (select i.*, row_number() over (partition by i.table_name, i.shape order by i.first_id) as k from ins i),
  d_rest as (select d.* from d_k d
              where not exists (select 1 from i_k i where i.table_name = d.table_name and i.shape = d.shape and i.k = d.k)),
  i_rest as (select i.* from i_k i
              where not exists (select 1 from d_k d where d.table_name = i.table_name and d.shape = i.shape and d.k = i.k)),
  d_pos as (select d.*, row_number() over (partition by d.table_name order by d.first_id) as p,
                   count(*) over (partition by d.table_name) as cnt from d_rest d),
  i_pos as (select i.*, row_number() over (partition by i.table_name order by i.first_id) as p,
                   count(*) over (partition by i.table_name) as cnt from i_rest i),
  paired as (
    select d.table_name, i.rid, d.shape as o, i.shape as n
      from d_pos d join i_pos i on i.table_name = d.table_name and i.p = d.p and i.cnt = d.cnt
  ),
  changes as (
    select u.table_name, u.rid, kk.k as field, u.o -> kk.k as ov, u.n -> kk.k as nv
      from upd u
      cross join lateral (select jsonb_object_keys(u.n) as k union select jsonb_object_keys(u.o)) kk
     where (u.n -> kk.k) is distinct from (u.o -> kk.k)
    union all
    select p.table_name, p.rid, kk.k, p.o -> kk.k, p.n -> kk.k
      from paired p
      cross join lateral (select jsonb_object_keys(p.n) as k union select jsonb_object_keys(p.o)) kk
     where (p.n -> kk.k) is distinct from (p.o -> kk.k)
    union all
    select d.table_name, d.rid, '(row removed)', d.body, null::jsonb
      from d_pos d
     where not exists (select 1 from i_pos i where i.table_name = d.table_name and i.cnt = d.cnt)
    union all
    select i.table_name, i.rid, '(row added)', null::jsonb, i.body
      from i_pos i
     where not exists (select 1 from d_pos d where d.table_name = i.table_name and d.cnt = i.cnt)
  )
  insert into public.override_audit_trail
         (commit_id, sales_order_id, garment_order_id, order_version, order_state, user_id, user_email,
          module_key, entity_table, entity_row_id, field_name, old_value, new_value, reason, client_ip)
  select c.id, c.sales_order_id, c.garment_order_id, c.order_version, c.order_state, c.user_id, c.user_email,
         public.override_key_for_table(c.module_keys, ch.table_name),
         ch.table_name, nullif(ch.rid, ''),
         ch.field || case when public.override_is_recalc(ch.table_name, ch.field) then ' (recalc)' else '' end,
         ch.ov #>> '{}', ch.nv #>> '{}', c.reason, c.client_ip
    from changes ch;
  get diagnostics v_fields = row_count;

  update public.override_commits
     set status = p_status, closed_at = now(), direction_breach = direction_breach or coalesce(p_breach, false)
   where id = p_commit;

  return jsonb_build_object('status', p_status, 'fields', v_fields, 'already_closed', false);
end;
$$;

-- Open a commit: the caller's live keys, the RE approved and not amending, the
-- mandatory reason (R-16), one open commit per RE (C-5). Returns its id.
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

create or replace function public.override_commit_close(
  p_commit uuid, p_status text, p_direction_breach boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if p_status not in ('committed', 'failed') then
    raise exception 'A commit closes as committed or failed, not %.', p_status using errcode = 'P0001';
  end if;
  select oc.user_id into v_owner from public.override_commits oc where oc.id = p_commit;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Only the user who opened an override commit can close it.'
      using errcode = '42501', hint = 'override_forbidden';
  end if;
  return public._override_commit_finalize(p_commit, p_status, p_direction_breach);
end;
$$;

-- ─── Grants (STANDING: always `from public, anon`) ──────────────────────────

revoke all on function public.override_commit_ttl()                                   from public, anon;
revoke all on function public.override_max_days()                                     from public, anon;
revoke all on function public.override_is_recalc(text, text)                          from public, anon;
revoke all on function public.override_key_for_table(text[], text)                    from public, anon, authenticated;
revoke all on function public.permission_override_keys_active(uuid)                   from public, anon, authenticated;
revoke all on function public.my_active_overrides()                                   from public, anon;
revoke all on function public.order_override_scope(uuid, uuid)                        from public, anon;
revoke all on function public.budget_override_commit(uuid)                            from public, anon;
revoke all on function public.override_grantee_candidates()                           from public, anon;
revoke all on function public.grant_permission_override(text, text[], timestamptz, text) from public, anon;
revoke all on function public.revoke_permission_override(uuid, text)                  from public, anon;
revoke all on function public._override_commit_finalize(uuid, text, boolean)          from public, anon, authenticated;
revoke all on function public.override_commit_open(uuid, text[], text, text)          from public, anon;
revoke all on function public.override_commit_close(uuid, text, boolean)              from public, anon;

-- Every function granted here answers only about the CALLER (auth.uid()) or is
-- gated by can_manage_permission_overrides() inside; the two that take a uid or
-- write the audit directly stay internal above.
grant execute on function public.override_commit_ttl()                                to authenticated;
grant execute on function public.override_max_days()                                  to authenticated;
grant execute on function public.override_is_recalc(text, text)                       to authenticated;
grant execute on function public.my_active_overrides()                                to authenticated;
grant execute on function public.order_override_scope(uuid, uuid)                     to authenticated;
grant execute on function public.budget_override_commit(uuid)                         to authenticated;
grant execute on function public.override_grantee_candidates()                        to authenticated;
grant execute on function public.grant_permission_override(text, text[], timestamptz, text) to authenticated;
grant execute on function public.revoke_permission_override(uuid, text)               to authenticated;
grant execute on function public.override_commit_open(uuid, text[], text, text)       to authenticated;
grant execute on function public.override_commit_close(uuid, text, boolean)           to authenticated;

-- ─── $verify$ — the diff, rolled back ───────────────────────────────────────
-- A synthetic commit whose raw log holds the shapes a real save produces: a
-- header column updated, a 3-row grid deleted and reinserted with ONE price
-- changed, a row inserted then deleted inside the save, and a requirements row
-- rewritten by a recalculation. Expected audit: 1 header field, 1 paired grid
-- field, 1 "(recalc)" row pair — and nothing for the untouched twins or the
-- transient row.
do $verify$
declare
  v_c    uuid := gen_random_uuid();
  v_out  jsonb;
  n_all  int; n_hdr int; n_price int; n_recalc int; n_trans int;
begin
  begin
    insert into public.override_commits (id, sales_order_id, garment_order_id, module_keys, reason, user_id, user_email, order_version, order_state)
    values (v_c, gen_random_uuid(), gen_random_uuid(), '{price_change}', 'verify reason', gen_random_uuid(), 'v@x.y', 'V0', 'approved');

    insert into public.override_row_log (commit_id, table_name, op, row_id, old_row, new_row) values
      (v_c, 'garment_order_amendments', 'UPDATE', 'h1', '{"id":"h1","ex_rate":84,"updated_at":"a"}', '{"id":"h1","ex_rate":85,"updated_at":"b"}'),
      (v_c, 'garment_order_amendment_style_prices', 'DELETE', 'p1', '{"id":"p1","amendment_id":"h1","style":"A","fob":1.10}', null),
      (v_c, 'garment_order_amendment_style_prices', 'DELETE', 'p2', '{"id":"p2","amendment_id":"h1","style":"B","fob":2.20}', null),
      (v_c, 'garment_order_amendment_style_prices', 'DELETE', 'p3', '{"id":"p3","amendment_id":"h1","style":"C","fob":3.30}', null),
      (v_c, 'garment_order_amendment_style_prices', 'INSERT', 'q1', null, '{"id":"q1","amendment_id":"h1","style":"A","fob":1.10}'),
      (v_c, 'garment_order_amendment_style_prices', 'INSERT', 'q2', null, '{"id":"q2","amendment_id":"h1","style":"B","fob":2.45}'),
      (v_c, 'garment_order_amendment_style_prices', 'INSERT', 'q3', null, '{"id":"q3","amendment_id":"h1","style":"C","fob":3.30}'),
      (v_c, 'garment_order_amendment_charges',      'INSERT', 't1', null, '{"id":"t1","amount":5}'),
      (v_c, 'garment_order_amendment_charges',      'DELETE', 't1', '{"id":"t1","amount":5}', null),
      (v_c, 'order_fabric_bom_requirements', 'DELETE', 'r1', '{"id":"r1","bom_id":"b","qty":10}', null),
      (v_c, 'order_fabric_bom_requirements', 'INSERT', 'r2', null, '{"id":"r2","bom_id":"b","qty":12}');

    v_out := public._override_commit_finalize(v_c, 'committed');

    select count(*) into n_all from public.override_audit_trail where commit_id = v_c;
    select count(*) into n_hdr from public.override_audit_trail
     where commit_id = v_c and entity_table = 'garment_order_amendments' and field_name = 'ex_rate'
       and old_value = '84' and new_value = '85';
    select count(*) into n_price from public.override_audit_trail
     where commit_id = v_c and entity_table = 'garment_order_amendment_style_prices'
       and field_name = 'fob' and old_value = '2.20' and new_value = '2.45' and entity_row_id = 'q2'
       and module_key = 'price_change';
    select count(*) into n_recalc from public.override_audit_trail
     where commit_id = v_c and field_name = 'qty (recalc)' and old_value = '10' and new_value = '12';
    select count(*) into n_trans from public.override_audit_trail
     where commit_id = v_c and entity_table = 'garment_order_amendment_charges';

    if n_hdr <> 1 or n_price <> 1 or n_recalc <> 1 or n_trans <> 0 or n_all <> 3
       or (v_out ->> 'fields')::int <> 3
       or (select status from public.override_commits where id = v_c) <> 'committed' then
      raise exception using message = format('0651 diff wrong: all=%s hdr=%s price=%s recalc=%s transient=%s out=%s',
                                             n_all, n_hdr, n_price, n_recalc, n_trans, v_out),
                            errcode = 'P0652';
    end if;
    -- A second close is a no-op, not a second set of audit rows.
    v_out := public._override_commit_finalize(v_c, 'failed');
    if (v_out ->> 'already_closed')::boolean is not true then
      raise exception using message = '0651: a closed commit was finalized twice', errcode = 'P0652';
    end if;

    raise exception using message = '0651 rollback', errcode = 'P0651';
  exception when others then
    if sqlerrm <> '0651 rollback' then raise exception '0651 verify failed: %', sqlerrm; end if;
  end;
  raise notice '0651: verified — header field, paired grid field, recalc label, transient row dropped, idempotent close';
end $verify$;
