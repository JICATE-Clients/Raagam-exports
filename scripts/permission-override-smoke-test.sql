-- ============================================================================
-- Permission overrides — smoke test (spec §8 acceptance criteria)
-- ============================================================================
--
-- ONE DO BLOCK THAT ALWAYS ENDS IN `raise exception` — so every grant, commit
-- and profile change it makes is rolled back, and the live DB is untouched.
-- The dry-run pattern that caught the revision-revert bug (memory
-- raagam-revision-revert-fixed). Read the result from the error message:
--
--     DRY RUN (rolled back) — 0 FAIL: ok AC-14 … ok AC-10 …
--
-- Any "FAIL" in that list is a real failure. Run it with the Supabase MCP
-- `execute_sql`, or `psql -f`. It impersonates real users through
-- `request.jwt.claims` (auth.uid()) AND `set local role authenticated`, so the
-- function grants are exercised too, not only the function bodies.
--
-- Needs, in the live data (checked up front, and it says so if missing):
--   a manager login          admin@raagam.test        (Administrator + MD)
--   a second manager login   factory.audit@raagam.test (Administrator)
--   an order-editing login   merch.audit@raagam.test  (Merchandiser)
--   a non-editing login      store.audit@raagam.test  (Store Keeper)
--   one APPROVED order and one OPEN order.
--
-- Phase 2 covers the grant and commit doors. Phase 3 adds the lock-trigger
-- cases (AC-1, 2, 3, 7-write, 9, 15) once the triggers read the override.
-- ============================================================================

do $smoke$
declare
  u_admin   uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_factory uuid := (select id from public.profiles where lower(email) = 'factory.audit@raagam.test');
  u_merch   uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  u_store   uuid := (select id from public.profiles where lower(email) = 'store.audit@raagam.test');
  o_appr    uuid := (select id from public.garment_order_amendments where re_status = 'approved' order by created_at limit 1);
  o_open    uuid := (select id from public.garment_order_amendments where re_status = 'open'     order by created_at limit 1);
  r         text := '';
  nfail     int  := 0;
  v_n       int;
  v_id      uuid;
  v_id2     uuid;
  v_c1      uuid;
  v_c2      uuid;
  v_txt     text;
  v_keys    text[];
  v_scope   jsonb;
  v_out     jsonb;
begin
  if u_admin is null or u_factory is null or u_merch is null or u_store is null or o_appr is null or o_open is null then
    raise exception 'SMOKE SKIPPED — missing fixture: admin=% factory=% merch=% store=% approved=% open=%',
      u_admin, u_factory, u_merch, u_store, o_appr, o_open;
  end if;

  -- ── AC-14: a non-manager cannot grant ──────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.grant_permission_override('store.audit@raagam.test', '{price_change}', now() + interval '1 day', 'smoke test reason');
    r := r || 'FAIL AC-14 (non-manager granted) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok AC-14 ';
  end;
  begin
    perform * from public.override_grantee_candidates();
    r := r || 'FAIL AC-14b (non-manager listed candidates) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok AC-14b ';
  end;
  reset role;

  -- ── As the manager ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- AC-11 / D-5: never to yourself
  begin
    perform public.grant_permission_override('Admin@Raagam.test', '{price_change}', now() + interval '1 day', 'smoke test reason');
    r := r || 'FAIL AC-11 '; nfail := nfail + 1;
  exception when others then
    r := r || case when sqlerrm like '%yourself%' then 'ok AC-11 ' else 'FAIL AC-11 (' || sqlerrm || ') ' end;
    if sqlerrm not like '%yourself%' then nfail := nfail + 1; end if;
  end;
  -- C-4: the grantee must already edit orders
  begin
    perform public.grant_permission_override('store.audit@raagam.test', '{price_change}', now() + interval '1 day', 'smoke test reason');
    r := r || 'FAIL C-4 '; nfail := nfail + 1;
  exception when others then
    r := r || case when sqlerrm like '%cannot edit orders%' then 'ok C-4 ' else 'FAIL C-4 (' || sqlerrm || ') ' end;
    if sqlerrm not like '%cannot edit orders%' then nfail := nfail + 1; end if;
  end;
  -- D-3: expiry window; R-16: reason
  begin
    perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() + interval '31 days', 'smoke test reason');
    r := r || 'FAIL D-3 (31 days) '; nfail := nfail + 1;
  exception when others then r := r || 'ok D-3-max ';
  end;
  begin
    perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() - interval '1 second', 'smoke test reason');
    r := r || 'FAIL D-3 (past) '; nfail := nfail + 1;
  exception when others then r := r || 'ok D-3-past ';
  end;
  begin
    perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() + interval '1 day', 'too short');
    r := r || 'FAIL R-16 '; nfail := nfail + 1;
  exception when others then r := r || 'ok R-16 ';
  end;
  begin
    perform public.grant_permission_override('merch.audit@raagam.test', '{bom_revision}', now() + interval '1 day', 'smoke test reason');
    r := r || 'FAIL unknown-key '; nfail := nfail + 1;
  exception when others then r := r || 'ok unknown-key ';
  end;

  -- AC-12: a messy email resolves; two keys granted
  v_n := public.grant_permission_override('  Merch.Audit@Raagam.TEST ', '{price_change,fabric_bom,price_change}', now() + interval '3 days', 'smoke test reason');
  if v_n = 2 then r := r || 'ok AC-12 '; else r := r || format('FAIL AC-12 (n=%s) ', v_n); nfail := nfail + 1; end if;

  -- the manager can see the grant rows (RLS read)
  select count(*) into v_n from public.user_email_permission_overrides where user_email = 'merch.audit@raagam.test';
  if v_n = 2 then r := r || 'ok RLS-read-manager '; else r := r || format('FAIL RLS-read-manager (%s) ', v_n); nfail := nfail + 1; end if;

  -- AC-10 / R-12 / R-13 / R-14: revoke, then re-grant updates the same row
  select id into v_id from public.user_email_permission_overrides
   where user_email = 'merch.audit@raagam.test' and module_key = 'price_change';
  perform public.revoke_permission_override(v_id, 'smoke revoke reason');
  begin
    perform public.revoke_permission_override(v_id, 'smoke revoke reason');
    r := r || 'FAIL double-revoke '; nfail := nfail + 1;
  exception when others then r := r || 'ok double-revoke ';
  end;
  perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() + interval '3 days', 'smoke regrant reason');
  select id into v_id2 from public.user_email_permission_overrides
   where user_email = 'merch.audit@raagam.test' and module_key = 'price_change' and revoked_at is null;
  select count(*) into v_n from public.override_grant_history where override_id = v_id;
  if v_id2 = v_id and v_n = 3
     and (select string_agg(action, ',' order by action_timestamp) from public.override_grant_history where override_id = v_id) = 'GRANT,REVOKE,RENEW'
  then r := r || 'ok AC-10 ';
  else r := r || format('FAIL AC-10 (same=%s hist=%s) ', v_id2 = v_id, v_n); nfail := nfail + 1;
  end if;

  -- factory also gets price_change (for the concurrency case below)
  perform public.grant_permission_override('factory.audit@raagam.test', '{price_change}', now() + interval '1 day', 'smoke test reason');
  reset role;

  -- ── As the grantee ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select array_agg(module_key order by module_key) into v_keys from public.my_active_overrides();
  if v_keys = '{fabric_bom,price_change}' then r := r || 'ok my-active '; else r := r || format('FAIL my-active (%s) ', v_keys); nfail := nfail + 1; end if;

  -- a grantee reads their own grants, not the history (RLS)
  select count(*) into v_n from public.user_email_permission_overrides;
  if v_n = 2 then r := r || 'ok RLS-read-own '; else r := r || format('FAIL RLS-read-own (%s) ', v_n); nfail := nfail + 1; end if;
  select count(*) into v_n from public.override_grant_history;
  if v_n = 0 then r := r || 'ok RLS-history-hidden '; else r := r || format('FAIL RLS-history-hidden (%s) ', v_n); nfail := nfail + 1; end if;

  -- R-16: a commit needs a reason
  begin
    perform public.override_commit_open(o_appr, '{price_change}', 'short');
    r := r || 'FAIL commit-reason '; nfail := nfail + 1;
  exception when others then r := r || 'ok commit-reason ';
  end;
  -- an OPEN order needs no override
  begin
    perform public.override_commit_open(o_open, '{price_change}', 'smoke commit reason');
    r := r || 'FAIL not-needed '; nfail := nfail + 1;
  exception when others then
    r := r || case when sqlerrm like '%not approved%' then 'ok not-needed ' else 'FAIL not-needed (' || sqlerrm || ') ' end;
    if sqlerrm not like '%not approved%' then nfail := nfail + 1; end if;
  end;
  -- a key the user does not hold
  begin
    perform public.override_commit_open(o_appr, '{material_bom}', 'smoke commit reason');
    r := r || 'FAIL ungranted-key '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok ungranted-key ';
  end;

  -- no commit → no scope, even holding a grant (R-16: the grant is not a standing key)
  select count(*) into v_n from public.order_override_scope(o_appr);
  if v_n = 0 then r := r || 'ok no-commit-no-scope '; else r := r || 'FAIL no-commit-no-scope '; nfail := nfail + 1; end if;

  -- open a commit; the scope is price_change's seed and nothing wider (R-17)
  v_c1 := public.override_commit_open(o_appr, '{price_change}', 'smoke commit reason', '10.0.0.1');
  select s.keys, s.scope into v_keys, v_scope from public.order_override_scope(o_appr) s;
  if v_keys = '{price_change}'
     and v_scope ? 'garment_order_amendment_style_prices'
     and not (v_scope ? 'garment_order_amendment_quantities')
     and not (v_scope ? 'garment_order_amendment_styles')
     and (v_scope -> 'garment_order_amendments' -> 'columns') <> 'null'::jsonb
  then r := r || 'ok scope-R-17 ';
  else r := r || format('FAIL scope-R-17 (keys=%s) ', v_keys); nfail := nfail + 1;
  end if;
  -- the commit is stamped with the version and state
  select order_version || '/' || order_state || '/' || coalesce(client_ip, '-') into v_txt from public.override_commits where id = v_c1;
  if v_txt like 'V%/approved/10.0.0.1' then r := r || 'ok commit-stamp '; else r := r || format('FAIL commit-stamp (%s) ', v_txt); nfail := nfail + 1; end if;

  -- re-opening your own replaces the stale one (closed failed, audited)
  v_c2 := public.override_commit_open(o_appr, '{price_change,fabric_bom}', 'smoke commit reason two');
  select status into v_txt from public.override_commits where id = v_c1;
  if v_txt = 'failed' and v_c2 <> v_c1 then r := r || 'ok reopen-own '; else r := r || format('FAIL reopen-own (%s) ', v_txt); nfail := nfail + 1; end if;
  reset role;

  -- ── C-5: someone else's open commit blocks a second one on the same RE ─────
  perform set_config('request.jwt.claims', json_build_object('sub', u_factory, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.override_commit_open(o_appr, '{price_change}', 'smoke commit reason');
    r := r || 'FAIL C-5 busy '; nfail := nfail + 1;
  exception when others then
    r := r || case when sqlerrm like '%right now%' then 'ok C-5-busy ' else 'FAIL C-5 (' || sqlerrm || ') ' end;
    if sqlerrm not like '%right now%' then nfail := nfail + 1; end if;
  end;
  -- and cannot close it
  begin
    perform public.override_commit_close(v_c2, 'committed');
    r := r || 'FAIL close-not-owner '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok close-not-owner ';
  end;
  reset role;

  -- ── AC-5: a revoke narrows the very next resolution ────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.revoke_permission_override(
    (select id from public.user_email_permission_overrides where user_email = 'merch.audit@raagam.test' and module_key = 'fabric_bom'),
    'smoke revoke mid-commit');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select s.keys into v_keys from public.order_override_scope(o_appr) s;
  if v_keys = '{price_change}' then r := r || 'ok AC-5 '; else r := r || format('FAIL AC-5 (%s) ', v_keys); nfail := nfail + 1; end if;
  reset role;

  -- ── AC-4: an expiry one second ago ends it (database clock) ────────────────
  update public.user_email_permission_overrides set override_expiry = now() - interval '1 second'
   where user_email = 'merch.audit@raagam.test' and module_key = 'price_change';
  set local role authenticated;
  select count(*) into v_n from public.order_override_scope(o_appr);
  if v_n = 0 then r := r || 'ok AC-4 '; else r := r || 'FAIL AC-4 '; nfail := nfail + 1; end if;
  reset role;
  update public.user_email_permission_overrides set override_expiry = now() + interval '1 day'
   where user_email = 'merch.audit@raagam.test' and module_key = 'price_change';

  -- ── AC-13: a deactivated user holds nothing ────────────────────────────────
  update public.profiles set is_active = false where id = u_merch;
  set local role authenticated;
  select count(*) into v_n from public.my_active_overrides();
  if v_n = 0 and not exists (select 1 from public.order_override_scope(o_appr))
  then r := r || 'ok AC-13 '; else r := r || 'FAIL AC-13 '; nfail := nfail + 1; end if;
  reset role;
  update public.profiles set is_active = true where id = u_merch;

  -- ── the owner closes; the commit is audited and final ──────────────────────
  set local role authenticated;
  v_out := public.override_commit_close(v_c2, 'committed');
  if v_out ->> 'status' = 'committed' and (select status from public.override_commits where id = v_c2) = 'committed'
     and not exists (select 1 from public.order_override_scope(o_appr))
  then r := r || 'ok close-owner ';
  else r := r || format('FAIL close-owner (%s) ', v_out); nfail := nfail + 1;
  end if;
  reset role;

  -- ── C-3: a revision in progress stands the override down ───────────────────
  update public.garment_order_amendments
     set re_status = 'amending',
         re_amendment_id = (select r2.id from public.order_budget_revisions r2 order by r2.entry_no desc nulls last limit 1)
   where id = o_appr;
  set local role authenticated;
  begin
    perform public.override_commit_open(o_appr, '{price_change}', 'smoke commit reason');
    r := r || 'FAIL C-3 '; nfail := nfail + 1;
  exception when others then
    r := r || case when sqlerrm like '%under revision%' then 'ok C-3 ' else 'FAIL C-3 (' || sqlerrm || ') ' end;
    if sqlerrm not like '%under revision%' then nfail := nfail + 1; end if;
  end;
  reset role;

  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke$;

-- ============================================================================
-- Phase 3 — the lock triggers (0653). Same rules: always rolled back.
-- ============================================================================
-- Every write is made AS merch.audit (a Merchandiser who can see and write the
-- fixture orders — RLS filters an UPDATE to 0 rows WITHOUT an error, so each
-- case also checks the row count and the stored value, never just "no error").
--
--   AC-1 / AC-15  approved order, grant but no commit → refused 'order_locked', no log row
--   AC-2          price_change commit → header ex_rate write lands, one log row,
--                 re_status still approved
--   AC-7          price_change only → deleting a quantity row refused
--                 'order_out_of_override_scope'
--   D-6           delivery date earlier → refused 'override_direction'; later → lands
--   R-17          a Fabric BOM write under a price-only commit → refused; with
--                 fabric_bom → lands
--   budget        approved budget line: refused without an order_budget commit,
--                 lands with one; the header edit is LOGGED (it is never refused)
--   C-5           raising a revision while a commit is open → refused 'override_busy'
--   AC-9          the audit insert forced to fail → the write fails with it
--   AC-17         an OPEN order saves exactly as before, nothing logged; a super
--                 admin with no commit is still refused on the approved order
--   close         the commit's field-level audit names exactly the fields changed
-- ============================================================================

do $smoke3$
declare
  u_admin  uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_merch  uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  o_appr   uuid;
  o_open   uuid;
  v_so     uuid;
  v_budget uuid;
  v_fbom   uuid;
  v_line   uuid;
  r        text := '';
  nfail    int  := 0;
  n        int;
  v_hint   text;
  v_c      uuid;
  v_rate   numeric;
  v_date   date;
  v_txt    text;
begin
  -- the approved order the merch login can write, with an approved budget and a Fabric BOM
  select a.id, a.sales_order_id, l.budget_id into o_appr, v_so, v_budget
    from public.garment_order_amendments a
    cross join lateral public.order_lock_of(a.id, a.sales_order_id) l
   where a.re_status = 'approved'
     and exists (select 1 from public.order_fabric_boms b where b.garment_order_id = a.id)
     and exists (select 1 from public.garment_order_amendment_quantities q where q.amendment_id = a.id)
   order by a.created_at limit 1;
  select id into o_open from public.garment_order_amendments where re_status = 'open' order by created_at limit 1;
  select id into v_fbom from public.order_fabric_boms where garment_order_id = o_appr limit 1;
  select id into v_line from public.order_budget_lines where budget_id = v_budget order by sno limit 1;
  if u_admin is null or u_merch is null or o_appr is null or o_open is null or v_budget is null or v_fbom is null or v_line is null then
    raise exception 'SMOKE3 SKIPPED — missing fixture: approved=% open=% budget=% fbom=% line=%', o_appr, o_open, v_budget, v_fbom, v_line;
  end if;

  -- grants (as the manager)
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_permission_override('merch.audit@raagam.test',
    '{price_change,delivery_date_ext,fabric_bom,order_budget}', now() + interval '1 day', 'smoke phase three');

  -- AC-17: a super admin with NO commit is still refused on the approved order
  begin
    update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 1 where id = o_appr;
    r := r || 'FAIL AC-17-sa '; nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'order_locked' then r := r || 'ok AC-17-sa '; else r := r || 'FAIL AC-17-sa (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;
  reset role;

  -- ── as the grantee ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- AC-17: an OPEN order saves exactly as before (no grant needed, nothing logged)
  update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 1 where id = o_open;
  get diagnostics n = row_count;
  if n = 1 and not exists (select 1 from public.override_row_log) then r := r || 'ok AC-17-open ';
  else r := r || format('FAIL AC-17-open (rows=%s) ', n); nfail := nfail + 1; end if;

  -- AC-1 / AC-15: holding a grant but NO commit → refused, nothing logged
  begin
    update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 1 where id = o_appr;
    r := r || 'FAIL AC-1 '; nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'order_locked' and not exists (select 1 from public.override_row_log) then r := r || 'ok AC-1/AC-15 ';
    else r := r || 'FAIL AC-1 (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;

  -- AC-2: open a price_change + delivery commit; the header rate lands
  v_c := public.override_commit_open(o_appr, '{price_change,delivery_date_ext}', 'smoke phase three commit');
  select ex_rate into v_rate from public.garment_order_amendments where id = o_appr;
  update public.garment_order_amendments set ex_rate = coalesce(v_rate, 0) + 1.5 where id = o_appr;
  get diagnostics n = row_count;
  -- the log is RLS-hidden from a non-manager (correctly), so it is read as the owner
  reset role;
  if n = 1
     and (select ex_rate from public.garment_order_amendments where id = o_appr) = coalesce(v_rate, 0) + 1.5
     and (select re_status from public.garment_order_amendments where id = o_appr) = 'approved'
     and (select count(*) from public.override_row_log where commit_id = v_c and table_name = 'garment_order_amendments' and op = 'UPDATE') = 1
  then r := r || 'ok AC-2 ';
  else r := r || format('FAIL AC-2 (rows=%s) ', n); nfail := nfail + 1; end if;
  set local role authenticated;

  -- AC-7: price_change cannot change a quantity (an UPDATE — the Merchandiser
  -- role holds orders:edit but not orders:delete, and a DELETE RLS filters to
  -- 0 rows would fire no trigger and prove nothing)
  begin
    update public.garment_order_amendment_quantities set po_qty = coalesce(po_qty, 0) + 1 where amendment_id = o_appr;
    get diagnostics n = row_count;
    r := r || format('FAIL AC-7 (rows=%s) ', n); nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'order_out_of_override_scope' then r := r || 'ok AC-7 '; else r := r || 'FAIL AC-7 (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;

  -- D-6: earlier refused, later lands
  select delivery_date into v_date from public.garment_order_amendments where id = o_appr;
  begin
    update public.garment_order_amendments set delivery_date = v_date - 1 where id = o_appr;
    r := r || 'FAIL D-6-earlier '; nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'override_direction' then r := r || 'ok D-6-earlier '; else r := r || 'FAIL D-6-earlier (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;
  update public.garment_order_amendments set delivery_date = v_date + 7 where id = o_appr;
  get diagnostics n = row_count;
  if n = 1 and (select delivery_date from public.garment_order_amendments where id = o_appr) = v_date + 7
  then r := r || 'ok D-6-later '; else r := r || 'FAIL D-6-later '; nfail := nfail + 1; end if;

  -- R-17: the Fabric BOM is not open to this commit
  begin
    update public.order_fabric_boms set remark = coalesce(remark, '') || ' x' where id = v_fbom;
    r := r || 'FAIL R-17-fbom '; nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'order_out_of_override_scope' then r := r || 'ok R-17-fbom-shut '; else r := r || 'FAIL R-17-fbom (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;
  -- nor the approved budget's lines
  begin
    update public.order_budget_lines set rate = coalesce(rate, 0) + 1 where id = v_line;
    r := r || 'FAIL budget-shut '; nfail := nfail + 1;
  exception when others then r := r || 'ok budget-shut ';
  end;

  -- C-5: no revision raised while this commit is open
  reset role;
  begin
    update public.garment_order_amendments
       set re_status = 'amending',
           re_amendment_id = (select r2.id from public.order_budget_revisions r2 order by r2.entry_no desc nulls last limit 1)
     where id = o_appr;
    r := r || 'FAIL C-5-raise '; nfail := nfail + 1;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint = 'override_busy' then r := r || 'ok C-5-raise '; else r := r || 'FAIL C-5-raise (' || coalesce(v_hint, sqlerrm) || ') '; nfail := nfail + 1; end if;
  end;
  set local role authenticated;

  -- close → field-level audit (read as the owner)
  perform public.override_commit_close(v_c, 'committed');
  reset role;
  select string_agg(field_name, ',' order by field_name) into v_txt
    from public.override_audit_trail where commit_id = v_c and entity_table = 'garment_order_amendments';
  if v_txt = 'delivery_date,ex_rate' then r := r || 'ok close-audit ';
  else r := r || format('FAIL close-audit (%s) ', v_txt); nfail := nfail + 1; end if;
  set local role authenticated;

  -- a closed commit lets nothing more through
  begin
    update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 1 where id = o_appr;
    r := r || 'FAIL closed-commit '; nfail := nfail + 1;
  exception when others then r := r || 'ok closed-commit ';
  end;

  -- a fabric_bom + order_budget commit: the BOM header and a budget line land
  v_c := public.override_commit_open(o_appr, '{fabric_bom,order_budget}', 'smoke phase three second commit');
  update public.order_fabric_boms set remark = coalesce(remark, '') || ' x' where id = v_fbom;
  get diagnostics n = row_count;
  if n = 1 then r := r || 'ok fbom-open '; else r := r || format('FAIL fbom-open (rows=%s) ', n); nfail := nfail + 1; end if;
  update public.order_budget_lines set rate = coalesce(rate, 0) + 1 where id = v_line;
  get diagnostics n = row_count;
  update public.order_budgets set remark = coalesce(remark, '') || ' x' where id = v_budget;
  reset role;
  if n = 1 and exists (select 1 from public.override_row_log where commit_id = v_c and table_name = 'order_budget_lines')
  then r := r || 'ok budget-line '; else r := r || format('FAIL budget-line (rows=%s) ', n); nfail := nfail + 1; end if;
  if exists (select 1 from public.override_row_log where commit_id = v_c and table_name = 'order_budgets')
  then r := r || 'ok budget-header-logged '; else r := r || 'FAIL budget-header-logged '; nfail := nfail + 1; end if;
  -- AC-17's "nothing logged" for the open-order save, now read as the owner
  if exists (select 1 from public.override_row_log l where l.new_row ->> 'id' = o_open::text or l.old_row ->> 'id' = o_open::text)
  then r := r || 'FAIL AC-17-open-logged '; nfail := nfail + 1; else r := r || 'ok AC-17-open-unlogged '; end if;

  -- AC-9: the audit insert fails → the write fails with it
  create function pg_temp.smoke_refuse() returns trigger language plpgsql as $f$
  begin
    raise exception 'smoke: audit insert refused';
  end $f$;
  create trigger smoke_refuse_log before insert on public.override_row_log
    for each row execute function pg_temp.smoke_refuse();
  set local role authenticated;
  select remark into v_txt from public.order_fabric_boms where id = v_fbom;
  begin
    update public.order_fabric_boms set remark = coalesce(remark, '') || ' y' where id = v_fbom;
    r := r || 'FAIL AC-9 '; nfail := nfail + 1;
  exception when others then
    if sqlerrm like '%audit insert refused%'
       and (select remark from public.order_fabric_boms where id = v_fbom) is not distinct from v_txt
    then r := r || 'ok AC-9 '; else r := r || 'FAIL AC-9 (' || sqlerrm || ') '; nfail := nfail + 1; end if;
  end;
  reset role;

  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke3$;

-- ============================================================================
-- Phase 3 — the pending-MD edge (0652 × 0653). Always rolled back.
-- ============================================================================
-- An approved order that a SECOND budget has just sent to the MD: the MD is
-- reading figures computed from these rows, so the override must stand down
-- even though a commit is already open. (Flipping the approved budget itself
-- to 'submitted' would NOT test this — its sync trigger re-opens the order and
-- the override stands down for the other reason.)

do $smoke_pending$
declare
  u_admin uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_merch uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  o_appr  uuid := (select id from public.garment_order_amendments where re_status = 'approved' order by created_at limit 1);
  v_b2 uuid; n int; r text := ''; nfail int := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() + interval '1 day', 'smoke pending case');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.override_commit_open(o_appr, '{price_change}', 'smoke pending commit');
  select count(*) into n from public.order_override_scope(o_appr);
  if n = 1 then r := r || 'ok scope-before-pending '; else r := r || 'FAIL scope-before-pending '; nfail := nfail + 1; end if;
  reset role;

  insert into public.order_budgets (budget_date, status, submitted_at, location_id, currency_code)
  values (current_date, 'submitted', now(),
          (select location_id from public.order_budgets where id = (select l.budget_id from public.order_lock_of(o_appr) l)), 'USD')
  returning id into v_b2;
  insert into public.order_budget_orders (budget_id, garment_order_id, sales_value) values (v_b2, o_appr, 0);

  set local role authenticated;
  select count(*) into n from public.order_override_scope(o_appr);
  if n = 0 then r := r || 'ok pending-stands-down '; else r := r || 'FAIL pending-stands-down '; nfail := nfail + 1; end if;
  begin
    update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 1 where id = o_appr;
    r := r || 'FAIL pending-write '; nfail := nfail + 1;
  exception when others then r := r || 'ok pending-write-refused ';
  end;
  begin
    perform public.override_commit_open(o_appr, '{price_change}', 'smoke pending commit two');
    r := r || 'FAIL pending-open '; nfail := nfail + 1;
  exception when others then
    if sqlerrm like '%with the MD%' then r := r || 'ok pending-open-refused '; else r := r || 'FAIL pending-open (' || sqlerrm || ') '; nfail := nfail + 1; end if;
  end;
  reset role;
  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke_pending$;

-- ============================================================================
-- 0655 — the budget save's real sequence, and cascaded deletes. Rolled back.
-- ============================================================================
-- These two run with merch's IDENTITY (request.jwt.claims, so every trigger
-- sees auth.uid() = merch) but WITHOUT `set local role authenticated`, so RLS
-- does not filter the deletes. That is deliberate and it is not a shortcut
-- around the rule under test: the Merchandiser role holds orders:edit but not
-- orders:delete, and the budget lines / order links delete policies demand
-- orders:delete — so as merch under RLS the save's DELETEs affect 0 rows
-- silently and its INSERTs then duplicate every line. That is a PRE-EXISTING
-- defect of every delete-and-reinsert save for a role without delete (findings
-- §12), independent of overrides; these blocks test the TRIGGERS.

do $smoke_budget$
declare
  u_admin uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_merch uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  o_appr uuid; v_budget uuid; v_c uuid; n_lines int; n_del int; n int; r text := ''; nfail int := 0;
  v_other_budget uuid; v_other_order uuid;
begin
  select a.id, l.budget_id into o_appr, v_budget
    from public.garment_order_amendments a cross join lateral public.order_lock_of(a.id, a.sales_order_id) l
   where a.re_status = 'approved' order by a.created_at limit 1;
  select count(*) into n_lines from public.order_budget_lines where budget_id = v_budget;
  create temp table snap_lines on commit drop as select * from public.order_budget_lines where budget_id = v_budget;
  create temp table snap_orders on commit drop as select * from public.order_budget_orders where budget_id = v_budget;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_permission_override('merch.audit@raagam.test', '{order_budget}', now() + interval '1 day', 'smoke budget rewrite');
  reset role;

  -- the save's exact sequence (lib/orders/budget/actions.ts writeChildren):
  -- delete lines, delete links, INSERT LINKS (the step 0651's lookup failed on), insert lines
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  v_c := public.override_commit_open(o_appr, '{order_budget}', 'smoke budget rewrite commit');
  delete from public.order_budget_lines where budget_id = v_budget;
  get diagnostics n_del = row_count;
  delete from public.order_budget_orders where budget_id = v_budget;
  insert into public.order_budget_orders select * from snap_orders;
  insert into public.order_budget_lines
    select (x).* from (select jsonb_populate_record(null::public.order_budget_lines,
             to_jsonb(s) || jsonb_build_object('id', gen_random_uuid())
             || case when s.sno = (select min(sno) from snap_lines) then jsonb_build_object('rate', coalesce(s.rate,0) + 2) else '{}'::jsonb end) as x
           from snap_lines s) q;
  get diagnostics n = row_count;
  if n = n_lines and n_del = n_lines then r := r || format('ok budget-rewrite (%s lines) ', n);
  else r := r || format('FAIL budget-rewrite (del=%s ins=%s of %s) ', n_del, n, n_lines); nfail := nfail + 1; end if;
  perform public.override_commit_close(v_c, 'committed');
  -- 64 row writes and the order links collapse to the one field that moved
  select count(*) into n from public.override_audit_trail where commit_id = v_c;
  if n = 1 and exists (select 1 from public.override_audit_trail where commit_id = v_c and entity_table = 'order_budget_lines' and field_name = 'rate')
  then r := r || 'ok budget-audit-exactly-one-field ';
  else r := r || format('FAIL budget-audit (%s rows) ', n); nfail := nfail + 1; end if;
  if (select status from public.order_budgets where id = v_budget) = 'approved'
  then r := r || 'ok budget-stays-approved '; else r := r || 'FAIL budget-stays-approved '; nfail := nfail + 1; end if;

  -- an order another approved budget locks cannot be linked in
  select a.id, l.budget_id into v_other_order, v_other_budget
    from public.garment_order_amendments a cross join lateral public.order_lock_of(a.id, a.sales_order_id) l
   where a.re_status = 'approved' and l.budget_id <> v_budget limit 1;
  if v_other_order is not null then
    v_c := public.override_commit_open(o_appr, '{order_budget}', 'smoke double coverage');
    begin
      insert into public.order_budget_orders (budget_id, garment_order_id, sales_value) values (v_budget, v_other_order, 0);
      r := r || 'FAIL double-coverage '; nfail := nfail + 1;
    exception when others then
      if sqlerrm like '%another approved budget%' then r := r || 'ok double-coverage-refused '; else r := r || 'FAIL double-coverage (' || sqlerrm || ') '; nfail := nfail + 1; end if;
    end;
  else
    r := r || 'skip double-coverage ';
  end if;
  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke_budget$;

do $smoke_cascade$
declare
  u_admin uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_merch uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  o_appr uuid; v_c uuid; n_q int; n_l int; n_z int; g_q int; g_l int; g_z int; r text := ''; nfail int := 0;
begin
  select a.id into o_appr from public.garment_order_amendments a
   where a.re_status = 'approved'
     and exists (select 1 from public.garment_order_amendment_quantities q
                   join public.garment_order_amendment_assort_lines l on l.quantity_id = q.id
                  where q.amendment_id = a.id)
   limit 1;
  if o_appr is null then raise exception 'CASCADE TEST SKIPPED — no approved order with assort lines'; end if;
  select count(*) into n_q from public.garment_order_amendment_quantities where amendment_id = o_appr;
  select count(*) into n_l from public.garment_order_amendment_assort_lines l
    join public.garment_order_amendment_quantities q on q.id = l.quantity_id where q.amendment_id = o_appr;
  select count(*) into n_z from public.garment_order_amendment_assort_line_sizes z
    join public.garment_order_amendment_assort_lines l on l.id = z.line_id
    join public.garment_order_amendment_quantities q on q.id = l.quantity_id where q.amendment_id = o_appr;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_permission_override('merch.audit@raagam.test', '{qty_addition}', now() + interval '1 day', 'smoke cascade test');
  reset role;
  -- quantities → assort lines → sizes: two levels of cascade, each logged
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  v_c := public.override_commit_open(o_appr, '{qty_addition}', 'smoke cascade commit');
  delete from public.garment_order_amendment_quantities where amendment_id = o_appr;
  select count(*) filter (where table_name = 'garment_order_amendment_quantities'),
         count(*) filter (where table_name = 'garment_order_amendment_assort_lines'),
         count(*) filter (where table_name = 'garment_order_amendment_assort_line_sizes')
    into g_q, g_l, g_z
    from public.override_row_log where commit_id = v_c and op = 'DELETE';
  if g_q = n_q and g_l = n_l and g_z = n_z
  then r := r || format('ok cascade-logged (quantities %s, assort lines %s, sizes %s) ', n_q, n_l, n_z);
  else r := r || format('FAIL cascade (q %s/%s, lines %s/%s, sizes %s/%s) ', g_q, n_q, g_l, n_l, g_z, n_z); nfail := nfail + 1; end if;
  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke_cascade$;

-- ============================================================================
-- Phase 6 — the report's reads (0656). Rolled back.
-- ============================================================================
--   count-zero-before   an order with no override edit gives the note nothing to say
--   merch               a Merchandiser reads the COUNT (the report footer note is
--                       for every reader) but not one audit row (RLS, D-7)
--   AC-16               the MD / admin reads the edit with everything the Override
--                       Edit Report shows: user, field, old, new, reason, outcome
--   re-no               the RE No the report prints resolves from the commit

do $smoke_report$
declare
  u_admin uuid := (select id from public.profiles where lower(email) = 'admin@raagam.test');
  u_merch uuid := (select id from public.profiles where lower(email) = 'merch.audit@raagam.test');
  o_appr uuid := (select id from public.garment_order_amendments where re_status = 'approved' order by created_at limit 1);
  v_c uuid; n int; v_cnt record; r text := ''; nfail int := 0; v_txt text;
begin
  select * into v_cnt from public.order_override_edit_count(o_appr);
  if v_cnt.commits = 0 then r := r || 'ok count-zero-before '; else r := r || 'FAIL count-before '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.grant_permission_override('merch.audit@raagam.test', '{price_change}', now() + interval '1 day', 'smoke phase six');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_merch, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_c := public.override_commit_open(o_appr, '{price_change}', 'smoke phase six commit');
  update public.garment_order_amendments set ex_rate = coalesce(ex_rate, 0) + 3 where id = o_appr;
  perform public.override_commit_close(v_c, 'committed');

  select * into v_cnt from public.order_override_edit_count(o_appr);
  select count(*) into n from public.override_audit_trail;
  if v_cnt.commits = 1 and v_cnt.fields = 1 and n = 0 then r := r || 'ok merch-count-visible-audit-hidden ';
  else r := r || format('FAIL merch (commits=%s fields=%s audit_rows=%s) ', v_cnt.commits, v_cnt.fields, n); nfail := nfail + 1; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select format('%s|%s|%s|%s|%s|%s', t.user_email, t.field_name,
                (t.old_value is not null)::text, (t.new_value is not null)::text, t.reason, c.status)
    into v_txt
    from public.override_audit_trail t join public.override_commits c on c.id = t.commit_id
   where t.commit_id = v_c;
  if v_txt = 'merch.audit@raagam.test|ex_rate|true|true|smoke phase six commit|committed' then r := r || 'ok AC-16-admin-reads-edit ';
  else r := r || format('FAIL AC-16 (%s) ', v_txt); nfail := nfail + 1; end if;
  select count(*) into n from public.sales_orders where id = (select sales_order_id from public.override_commits where id = v_c);
  if n = 1 then r := r || 'ok re-no-resolvable '; else r := r || 'FAIL re-no '; nfail := nfail + 1; end if;
  reset role;
  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke_report$;
