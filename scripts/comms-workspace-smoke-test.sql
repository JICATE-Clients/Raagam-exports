-- ============================================================================
-- Communication Hub WORKSPACE (0750) — SMOKE TEST. Run by hand AFTER 0750.
--
-- Same idiom as scripts/comms-smoke-test.sql: ONE DO block that always ends in
-- `raise exception`, so every row it writes — the fixture roles, the
-- deactivation, the test messages — is rolled back. Read the result from the
-- error message:
--
--     DRY RUN (rolled back) — 0 FAIL, n SKIPPED: ok W1 ok W2 …
--
-- It impersonates real logins with `request.jwt.claims` (auth.uid() answers)
-- AND `set local role authenticated` (RLS and EXECUTE grants apply).
--
-- FIXTURES ARE PICKED, NOT TYPED: four ACTIVE, NON-super-admin logins holding
-- communication:view — A is made workspace OWNER, B ADMIN, C and D stay
-- members — plus, when they exist, one super admin (S) and one active login
-- WITHOUT communication:view (N). Those two are SKIPPED, not passed, when absent.
--
-- IDENTITY CHANGES HAPPEN OUTSIDE `begin … exception` blocks on purpose (a
-- subtransaction that aborts also reverts the role / claims set inside it).
--
-- Covers: authorised access, member listing and profile, admin vs member,
-- unauthorised role changes, self-changes, rank rules, deactivation (writes,
-- reads, directory, DMs, mentions, attribution), reactivation, duplicate
-- membership, missing / invalid records, the singleton (the "tenant"
-- boundary of a single-company database), anon and no-access callers, the
-- suspended workspace and the group-creation setting.
-- ============================================================================

do $smoke$
declare
  a uuid; b uuid; c uuid; d uuid; s uuid; n uuid;
  dm uuid; dm2 uuid; g uuid; md uuid;
  j jsonb;
  v_n integer;
  v_b boolean;
  v_t text;
  r text := '';
  nfail integer := 0;
  nskip integer := 0;
begin
  -- ---------- fixtures (as the owner of the database) ----------
  select p.id into a from public.profiles p
   where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;
  select p.id into b from public.profiles p
   where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false) and p.id <> a
     and public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;
  select p.id into c from public.profiles p
   where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false) and p.id not in (a, b)
     and public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;
  select p.id into d from public.profiles p
   where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false) and p.id not in (a, b, c)
     and public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;
  select p.id into s from public.profiles p
   where coalesce(p.is_active, true) and coalesce(p.is_super_admin, false)
   order by p.created_at limit 1;
  select p.id into n from public.profiles p
   where coalesce(p.is_active, true) and not public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;

  if a is null or b is null or c is null or d is null then
    raise exception 'SMOKE SKIPPED — need four active non-super-admin logins with communication:view: a=% b=% c=% d=%', a, b, c, d;
  end if;

  -- A known starting state, whatever the live rows say (all rolled back).
  delete from public.comm_workspace_members where user_id in (a, b, c, d);
  insert into public.comm_workspace_members (user_id, role) values (a, 'owner'), (b, 'admin');
  update public.comm_workspace set status = 'active', members_can_create_groups = true;

  -- W33 the singleton: a second workspace is refused.
  begin
    insert into public.comm_workspace (name) values ('smoke second workspace');
    r := r || 'FAIL W33 (second workspace accepted) '; nfail := nfail + 1;
  exception when unique_violation then r := r || 'ok W33 '; end;

  -- D writes a DM to C BEFORE being deactivated, for the attribution tests.
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  dm := public.comm_open_direct(c);
  j  := public.comm_send_message(dm, gen_random_uuid(), 'from D, before deactivation');
  md := (j ->> 'id')::uuid;

  -- ======================= AN ORDINARY MEMBER (C) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W1 sees the workspace and its own place in it
  j := public.comm_workspace_me();
  if j ->> 'my_role' = 'member' and j ->> 'my_status' = 'active' and j ->> 'name' is not null then r := r || 'ok W1 ';
  else r := r || 'FAIL W1 (' || j::text || ') '; nfail := nfail + 1; end if;

  -- W2 lists the active members, owners first
  select count(*), bool_or(x.id = a and x.role = 'owner') and bool_or(x.id = b and x.role = 'admin')
    into v_n, v_b from public.comm_workspace_people(null, 'active', 500, 0) x;
  if v_n >= 4 and v_b then r := r || 'ok W2 '; else r := r || 'FAIL W2 (' || v_n || ') '; nfail := nfail + 1; end if;

  -- W3 cannot list the deactivated
  begin
    perform * from public.comm_workspace_people(null, 'deactivated', 50, 0);
    r := r || 'FAIL W3 (member listed deactivated) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W3 '; end;

  -- W4 opens a profile, without the administrator-only fields
  select count(*), bool_and(x.erp_owner is null and x.deactivated_reason is null)
    into v_n, v_b from public.comm_workspace_person(b) x;
  if v_n = 1 and v_b then r := r || 'ok W4 '; else r := r || 'FAIL W4 '; nfail := nfail + 1; end if;

  -- W4b an unknown id is "not found" (22023), never a crash
  begin
    perform * from public.comm_workspace_person(gen_random_uuid());
    r := r || 'FAIL W4b '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok W4b '; end;

  -- W5 a member cannot change a role
  begin
    perform public.comm_workspace_set_role(d, 'admin');
    r := r || 'FAIL W5 (member changed a role) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W5 '; end;

  -- W5b …nor promote themselves
  begin
    perform public.comm_workspace_set_role(c, 'owner');
    r := r || 'FAIL W5b (member self-promoted) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W5b '; end;

  -- W6 a member cannot change the settings
  begin
    perform public.comm_workspace_update('Hijacked', null, 'active', true);
    r := r || 'FAIL W6 '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W6 '; end;

  -- W7 no direct write past the RPCs
  begin
    insert into public.comm_workspace_members (user_id, role) values (c, 'owner');
    r := r || 'FAIL W7 (direct insert accepted) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W7 '; end;
  begin
    update public.comm_workspace set name = 'Hijacked';
    get diagnostics v_n = row_count;
    if v_n = 0 then r := r || 'ok W7b '; else r := r || 'FAIL W7b (direct update) '; nfail := nfail + 1; end if;
  exception when insufficient_privilege then r := r || 'ok W7b '; end;

  -- W8 the internal helpers are not callable from a session
  begin
    perform public.comm_workspace_role(a);
    r := r || 'FAIL W8 (internal helper callable) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W8 '; end;
  begin
    perform * from public.comm_workspace_people_rows(null, null, true);
    r := r || 'FAIL W8b (admin rows callable with p_admin=true) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W8b '; end;

  -- ======================= AN ADMIN (B) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W9 promote a member; W9b the same change again is a no-op, one row
  v_b := public.comm_workspace_set_role(d, 'admin');
  if v_b then r := r || 'ok W9 '; else r := r || 'FAIL W9 '; nfail := nfail + 1; end if;
  -- (as B the repeat is refused outright: D is an admin now, and an admin
  --  manages members only — so the repeat is the OWNER's)
  begin
    perform public.comm_workspace_set_role(d, 'admin');
    r := r || 'FAIL W9a (admin changed an admin) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W9a '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_b := public.comm_workspace_set_role(d, 'admin');
  select count(*) into v_n from public.comm_workspace_people(null, 'all', 500, 0) x where x.id = d;
  if not v_b and v_n = 1 then r := r || 'ok W9b '; else r := r || 'FAIL W9b (duplicate) '; nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W10 an admin cannot make an owner
  begin
    perform public.comm_workspace_set_role(c, 'owner');
    r := r || 'FAIL W10 '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W10 '; end;

  -- W11 an admin cannot touch an owner, nor another admin
  begin
    perform public.comm_workspace_set_role(a, 'member');
    r := r || 'FAIL W11 (admin demoted owner) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W11 '; end;
  begin
    perform public.comm_workspace_set_active(d, false, null);
    r := r || 'FAIL W11b (admin deactivated an admin) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W11b '; end;

  -- W12 nobody changes themselves
  begin
    perform public.comm_workspace_set_role(b, 'owner');
    r := r || 'FAIL W12 '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W12 '; end;
  begin
    perform public.comm_workspace_set_active(b, false, null);
    r := r || 'FAIL W12b (self-deactivation) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W12b '; end;

  -- W13 a missing member; W14 an invalid role
  begin
    perform public.comm_workspace_set_role(gen_random_uuid(), 'admin');
    r := r || 'FAIL W13 '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok W13 '; end;
  begin
    perform public.comm_workspace_set_role(c, 'guest');
    r := r || 'FAIL W14 '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok W14 '; end;

  -- W15 an admin cannot pause the workspace (owners only), but can rename it
  begin
    perform public.comm_workspace_update('Smoke workspace', 'desc', 'suspended', true);
    r := r || 'FAIL W15 (admin paused) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W15 '; end;
  perform public.comm_workspace_update('Smoke workspace', 'desc', 'active', true);
  if (select w.name from public.comm_workspace w) = 'Smoke workspace' then r := r || 'ok W15b ';
  else r := r || 'FAIL W15b '; nfail := nfail + 1; end if;

  -- ======================= THE OWNER (A) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W16 an owner demotes an admin
  if public.comm_workspace_set_role(d, 'member') then r := r || 'ok W16 '; else r := r || 'FAIL W16 '; nfail := nfail + 1; end if;

  -- W36 a super admin is an owner nobody here can change
  if s is null then
    r := r || 'SKIP W36 '; nskip := nskip + 1;
  else
    begin
      perform public.comm_workspace_set_role(s, 'member');
      r := r || 'FAIL W36 (super admin demoted) '; nfail := nfail + 1;
    exception when insufficient_privilege then r := r || 'ok W36 '; end;
  end if;

  -- W17 pause the workspace
  perform public.comm_workspace_update('Smoke workspace', 'desc', 'suspended', true);

  -- W18 paused: a member cannot write; W19 an admin can
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.comm_send_message(dm, gen_random_uuid(), 'while paused');
    r := r || 'FAIL W18 (member wrote while paused) '; nfail := nfail + 1;
  exception when sqlstate '55000' then r := r || 'ok W18 '; end;
  -- …but can still read
  select count(*) into v_n from public.comm_messages where conversation_id = dm;
  if v_n >= 1 then r := r || 'ok W18b '; else r := r || 'FAIL W18b (paused hid history) '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    dm2 := public.comm_open_direct(c);
    r := r || 'ok W19 ';
  exception when others then r := r || 'FAIL W19 (' || sqlerrm || ') '; nfail := nfail + 1; end;

  -- resume, and switch member groups off (W37)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_workspace_update('Smoke workspace', 'desc', 'active', false);

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.has_permission('communication', 'create') then
    r := r || 'SKIP W37 (C holds communication:create) '; nskip := nskip + 1;
  else
    begin
      perform public.comm_create_group('smoke group', array[a, b]);
      r := r || 'FAIL W37 (member made a group with the setting off) '; nfail := nfail + 1;
    exception when insufficient_privilege then r := r || 'ok W37 '; end;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    g := public.comm_create_group('smoke group', array[a, c]);
    r := r || 'ok W37b ';
  exception when others then r := r || 'FAIL W37b (' || sqlerrm || ') '; nfail := nfail + 1; end;

  -- ======================= DEACTIVATION (B deactivates D) =======================
  -- W20 deactivate, W20b again is a no-op
  v_b := public.comm_workspace_set_active(d, false, 'smoke: left the company');
  if v_b then r := r || 'ok W20 '; else r := r || 'FAIL W20 '; nfail := nfail + 1; end if;
  if not public.comm_workspace_set_active(d, false, null) then r := r || 'ok W20b '; else r := r || 'FAIL W20b '; nfail := nfail + 1; end if;

  -- W30 the admin lists D among the deactivated, with who and why
  select count(*) into v_n from public.comm_workspace_people(null, 'deactivated', 500, 0) x
   where x.id = d and x.deactivated_reason = 'smoke: left the company' and x.deactivated_by_name is not null;
  if v_n = 1 then r := r || 'ok W30 '; else r := r || 'FAIL W30 '; nfail := nfail + 1; end if;

  -- as D, deactivated
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W21 cannot write
  begin
    perform public.comm_send_message(dm, gen_random_uuid(), 'after deactivation');
    r := r || 'FAIL W21 (deactivated wrote) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W21 '; end;
  -- W22 has no conversations; W23 reads no message, even their own
  select count(*) into v_n from public.comm_my_conversations(null);
  if v_n = 0 then r := r || 'ok W22 '; else r := r || 'FAIL W22 (' || v_n || ') '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_messages where conversation_id = dm;
  if v_n = 0 then r := r || 'ok W23 '; else r := r || 'FAIL W23 (deactivated read ' || v_n || ') '; nfail := nfail + 1; end if;
  -- W24 is told so; W25 cannot list members
  j := public.comm_workspace_me();
  if j ->> 'my_status' = 'deactivated' then r := r || 'ok W24 '; else r := r || 'FAIL W24 '; nfail := nfail + 1; end if;
  begin
    perform * from public.comm_workspace_people(null, 'active', 50, 0);
    r := r || 'FAIL W25 '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W25 '; end;

  -- as C, who corresponded with D
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- W26 D is not offered in the directory
  select count(*) into v_n from public.comm_directory(null, 50) x where x.id = d;
  if v_n = 0 then r := r || 'ok W26 '; else r := r || 'FAIL W26 '; nfail := nfail + 1; end if;
  -- W27 D's message is still there, under D's name
  select g2.author_id = d, (select cn.full_name from public.creator_names(array[d]) cn limit 1)
    into v_b, v_t from public.comm_messages g2 where g2.id = md;
  if v_b and v_t is not null then r := r || 'ok W27 '; else r := r || 'FAIL W27 (attribution lost) '; nfail := nfail + 1; end if;
  -- W28 D cannot be messaged afresh
  begin
    perform public.comm_open_direct(d);
    r := r || 'FAIL W28 '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok W28 '; end;
  -- W29 a mention of D mentions nobody
  if coalesce(array_length(public.comm_parse_mentions(dm, '<@' || d::text || '>', c), 1), 0) = 0 then r := r || 'ok W29 ';
  else r := r || 'FAIL W29 '; nfail := nfail + 1; end if;
  -- W29b D cannot be added to a group
  if coalesce(array_length(public.comm_active_profiles(array[d], c), 1), 0) = 0 then r := r || 'ok W29b ';
  else r := r || 'FAIL W29b '; nfail := nfail + 1; end if;

  -- W31 reactivate (as B); W32 D is back in exactly their conversations
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.comm_workspace_set_active(d, true, null) then r := r || 'ok W31 '; else r := r || 'FAIL W31 '; nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.comm_my_conversations(null) x where x.id = dm;
  if v_n = 1 then r := r || 'ok W32 '; else r := r || 'FAIL W32 '; nfail := nfail + 1; end if;

  -- ======================= OUTSIDERS =======================
  -- W35 a login without communication:view
  if n is null then
    r := r || 'SKIP W35 '; nskip := nskip + 1;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', n, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform * from public.comm_workspace_people(null, 'active', 50, 0);
      r := r || 'FAIL W35 (no-access login listed members) '; nfail := nfail + 1;
    exception when insufficient_privilege then r := r || 'ok W35 '; end;
  end if;

  -- W34 anonymous: no EXECUTE at all
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform public.comm_workspace_me();
    r := r || 'FAIL W34 (anon reached the workspace) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok W34 '; end;
  -- (no grant → an error; a grant → the policy is `to authenticated`, so 0 rows)
  begin
    select count(*) into v_n from public.comm_workspace;
    if v_n = 0 then r := r || 'ok W34b '; else r := r || 'FAIL W34b (anon read the workspace row) '; nfail := nfail + 1; end if;
  exception when insufficient_privilege then r := r || 'ok W34b '; end;
  reset role;

  raise exception 'DRY RUN (rolled back) — % FAIL, % SKIPPED: %', nfail, nskip, r;
end $smoke$;
