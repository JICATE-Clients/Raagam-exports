-- ============================================================================
-- Communication Hub CHANNEL MANAGEMENT (0751) — SMOKE TEST. Run AFTER 0751.
--
-- One DO block that always ends in `raise exception`, so everything it writes
-- is rolled back. Read the result from the message:
--
--     DRY RUN (rolled back) — 0 FAIL: ok C1 ok C1b …
--
-- Impersonates real logins (request.jwt.claims + `set local role
-- authenticated`), the idiom of scripts/comms-smoke-test.sql. Fixtures are
-- PICKED: five active, non-super-admin logins holding communication:view.
--   A — made a workspace admin for the run, so may create channels; owns them
--   B — becomes the public channel's moderator, later its owner
--   C — an ordinary member
--   D — an outsider to the private channel
--   E — a workspace admin who is in NEITHER channel (the governor)
-- Identity changes happen outside `begin … exception` blocks (a rolled-back
-- subtransaction also rolls back the role and claims set inside it).
-- ============================================================================

do $smoke$
declare
  a uuid; b uuid; c uuid; d uuid; e uuid;
  pub uuid; pub2 uuid; priv uuid; k uuid := gen_random_uuid(); tag text := substr(md5(random()::text), 1, 6);
  j jsonb; v_n integer; v_b boolean; v_t text;
  r text := ''; nfail integer := 0;
begin
  select p.id into a from public.profiles p where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id) order by p.created_at limit 1;
  select p.id into b from public.profiles p where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id) and p.id <> a order by p.created_at limit 1;
  select p.id into c from public.profiles p where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id) and p.id not in (a, b) order by p.created_at limit 1;
  select p.id into d from public.profiles p where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id) and p.id not in (a, b, c) order by p.created_at limit 1;
  select p.id into e from public.profiles p where coalesce(p.is_active, true) and not coalesce(p.is_super_admin, false)
     and public.has_permission('communication', 'view', p.id) and p.id not in (a, b, c, d) order by p.created_at limit 1;
  if e is null then
    raise exception 'SMOKE SKIPPED — need five active non-super-admin logins with communication:view';
  end if;

  -- Known state: no workspace overrides for the five, A and E workspace admins,
  -- B / C / D not holding communication:create through a role is NOT assumed —
  -- the create tests run as A only.
  delete from public.comm_workspace_members where user_id in (a, b, c, d, e);
  insert into public.comm_workspace_members (user_id, role) values (a, 'admin'), (e, 'admin');
  update public.comm_workspace set status = 'active';

  -- ======================= CREATE (A) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  pub := public.comm_create_channel('  Smoke Pub ' || tag, 'public', 'first topic', null, '{}', 'what it is for', k);
  select c2.name into v_t from public.comm_conversations c2 where c2.id = pub;
  if v_t = 'smoke-pub-' || tag then r := r || 'ok C1 '; else r := r || 'FAIL C1 (' || coalesce(v_t, 'null') || ') '; nfail := nfail + 1; end if;
  -- C1b a retry with the same key returns the same channel, and makes no second
  if public.comm_create_channel('smoke pub ' || tag, 'public', null, null, '{}', null, k) = pub
     and (select count(*) from public.comm_conversations c2 where c2.create_key = k) = 1 then r := r || 'ok C1b ';
  else r := r || 'FAIL C1b (retry duplicated) '; nfail := nfail + 1; end if;
  -- C1c the creator is the owner; the channel is in the workspace
  if exists (select 1 from public.comm_members m where m.conversation_id = pub and m.user_id = a and m.role = 'owner' and m.removed_at is null)
     and (select c2.workspace_id from public.comm_conversations c2 where c2.id = pub) = (select w.id from public.comm_workspace w) then r := r || 'ok C1c ';
  else r := r || 'FAIL C1c '; nfail := nfail + 1; end if;
  -- C2 invalid name, duplicate name (case-folded), over-long name
  begin
    perform public.comm_create_channel('#bad name', 'public', null, null, '{}', null, gen_random_uuid());
    r := r || 'FAIL C2 (invalid name accepted) '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok C2 '; end;
  begin
    perform public.comm_create_channel('SMOKE-PUB-' || upper(tag), 'public', null, null, '{}', null, gen_random_uuid());
    r := r || 'FAIL C2b (duplicate accepted) '; nfail := nfail + 1;
  exception when unique_violation then r := r || 'ok C2b '; end;
  begin
    perform public.comm_create_channel(repeat('x', 81), 'public', null, null, '{}', null, gen_random_uuid());
    r := r || 'FAIL C2c (81 chars accepted) '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok C2c '; end;

  priv := public.comm_create_channel('smoke-priv-' || tag, 'private', null, null, array[b], 'secret plans', gen_random_uuid());
  perform public.comm_set_member_role(pub, a, 'owner');

  -- C3 an ordinary member (C) without communication:create cannot create
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.has_permission('communication', 'create') then
    r := r || 'SKIP C3 ';
  else
    begin
      perform public.comm_create_channel('smoke-c-' || tag, 'public', null, null, '{}', null, gen_random_uuid());
      r := r || 'FAIL C3 (unauthorised create) '; nfail := nfail + 1;
    exception when insufficient_privilege then r := r || 'ok C3 '; end;
  end if;

  -- ======================= DISCOVERY / PRIVATE (C, an outsider to priv) =======================
  select count(*) into v_n from public.comm_discover_channels(tag, 'active', 50, 0) x;
  if v_n = 1 then r := r || 'ok C4 '; else r := r || 'FAIL C4 (saw ' || v_n || ', private leaked?) '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_discover_channels('secret plans', 'active', 50, 0) x;
  if v_n = 0 then r := r || 'ok C4b '; else r := r || 'FAIL C4b (private matched by description) '; nfail := nfail + 1; end if;
  select x.member_count, x.description = 'what it is for' into v_n, v_b from public.comm_discover_channels(tag, 'active', 50, 0) x where x.id = pub;
  if v_n = 1 and v_b then r := r || 'ok C4c '; else r := r || 'FAIL C4c '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_conversations c2 where c2.id = priv;
  if v_n = 0 then r := r || 'ok C5 '; else r := r || 'FAIL C5 (private row readable) '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_members m where m.conversation_id = priv;
  if v_n = 0 then r := r || 'ok C5b '; else r := r || 'FAIL C5b (private members readable) '; nfail := nfail + 1; end if;
  begin
    perform public.comm_channel_abilities(priv);
    r := r || 'FAIL C5c (abilities of a private channel) '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok C5c '; end;
  -- C6 join public (twice = still one row); joining private refused
  perform public.comm_join_channel(pub);
  perform public.comm_join_channel(pub);
  select count(*) into v_n from public.comm_members m where m.conversation_id = pub and m.user_id = c;
  if v_n = 1 then r := r || 'ok C6 '; else r := r || 'FAIL C6 (duplicate membership) '; nfail := nfail + 1; end if;
  begin
    perform public.comm_join_channel(priv);
    r := r || 'FAIL C6b (joined private) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C6b '; end;
  begin
    perform public.comm_set_conversation_prefs(priv, true, null);
    r := r || 'FAIL C6c (prefs on a channel not joined) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C6c '; end;

  -- ======================= MODERATOR (A makes B moderator, B acts) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_add_members(pub, array[b]);
  perform public.comm_set_member_role(pub, b, 'admin');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_update_channel(pub, 'smoke-pub-' || tag, 'new description', 'new topic');
  if (select c2.topic from public.comm_conversations c2 where c2.id = pub) = 'new topic' then r := r || 'ok C7 '; else r := r || 'FAIL C7 '; nfail := nfail + 1; end if;
  begin
    perform public.comm_update_channel(pub, 'renamed-' || tag, 'new description', 'new topic');
    r := r || 'FAIL C7b (moderator renamed) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C7b '; end;
  perform public.comm_add_members(pub, array[d]);
  perform public.comm_remove_member(pub, d);
  r := r || 'ok C7c ';
  begin
    perform public.comm_remove_member(pub, a);
    r := r || 'FAIL C7d (moderator removed owner) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C7d '; end;
  begin
    perform public.comm_set_member_role(pub, b, 'owner');
    r := r || 'FAIL C7e (moderator self-promoted) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C7e '; end;
  begin
    perform public.comm_set_channel_archived(pub, true);
    r := r || 'FAIL C7f (moderator archived) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C7f '; end;
  begin
    perform public.comm_transfer_channel_ownership(pub, c, 'admin');
    r := r || 'FAIL C7g (moderator transferred) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C7g '; end;
  -- the abilities the screen reads agree
  j := public.comm_channel_abilities(pub);
  if (j ->> 'edit_info')::boolean and not (j ->> 'rename')::boolean and not (j ->> 'archive')::boolean
     and (j ->> 'add_members')::boolean and not (j ->> 'set_roles')::boolean then r := r || 'ok C7h ';
  else r := r || 'FAIL C7h (' || j::text || ') '; nfail := nfail + 1; end if;

  -- ======================= MEMBER (C) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.comm_update_channel(pub, 'smoke-pub-' || tag, 'x', 'member topic');
    r := r || 'FAIL C8 (member edited) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C8 '; end;
  begin
    perform public.comm_add_members(pub, array[d]);
    r := r || 'FAIL C8b (member added) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C8b '; end;
  begin
    perform public.comm_remove_member(pub, b);
    r := r || 'FAIL C8c (member removed) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C8c '; end;

  -- ======================= GOVERNOR (E: workspace admin, in neither channel) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_update_channel(pub, 'smoke-pub-' || tag, 'governed', 'governed topic');
  r := r || 'ok C9 ';
  begin
    perform public.comm_add_members(priv, array[e]);
    r := r || 'FAIL C9b (admin added self to a private channel) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C9b '; end;
  begin
    perform public.comm_set_channel_archived(priv, true);
    r := r || 'FAIL C9c (admin archived a private channel) '; nfail := nfail + 1;
  exception when sqlstate '22023' then r := r || 'ok C9c '; end;
  select count(*) into v_n from public.comm_messages g where g.conversation_id = priv;
  if v_n = 0 then r := r || 'ok C9d '; else r := r || 'FAIL C9d '; nfail := nfail + 1; end if;

  -- ======================= OWNERSHIP (A hands pub to B) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_transfer_channel_ownership(pub, b, 'admin');
  if (select m.role from public.comm_members m where m.conversation_id = pub and m.user_id = b and m.removed_at is null) = 'owner'
     and (select m.role from public.comm_members m where m.conversation_id = pub and m.user_id = a and m.removed_at is null) = 'admin'
  then r := r || 'ok C10 '; else r := r || 'FAIL C10 '; nfail := nfail + 1; end if;
  begin
    perform public.comm_transfer_channel_ownership(pub, d, 'admin');
    r := r || 'FAIL C10b (transfer to a non-member) '; nfail := nfail + 1;
  exception when others then r := r || 'ok C10b '; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.comm_remove_member(pub, b);
    r := r || 'FAIL C10c (last owner left) '; nfail := nfail + 1;
  exception when sqlstate '55000' then r := r || 'ok C10c '; end;

  -- ======================= ARCHIVE / RESTORE (B, owner) =======================
  if public.comm_set_channel_archived(pub, true) and not public.comm_set_channel_archived(pub, true) then r := r || 'ok C11 ';
  else r := r || 'FAIL C11 '; nfail := nfail + 1; end if;
  if (select c2.archived_by from public.comm_conversations c2 where c2.id = pub) = b then r := r || 'ok C11b '; else r := r || 'FAIL C11b '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.comm_discover_channels(tag, 'active', 50, 0) x where x.id = pub;
  if v_n = 0 then r := r || 'ok C11c '; else r := r || 'FAIL C11c (archived in discovery) '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_discover_channels(tag, 'archived', 50, 0) x where x.id = pub;
  if v_n = 1 then r := r || 'ok C11d '; else r := r || 'FAIL C11d '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_sidebar_channels() x where x.id = pub;
  if v_n = 0 then r := r || 'ok C11e '; else r := r || 'FAIL C11e (archived in sidebar) '; nfail := nfail + 1; end if;
  begin
    perform public.comm_send_message(pub, gen_random_uuid(), 'into an archived channel');
    r := r || 'FAIL C11f (posted while archived) '; nfail := nfail + 1;
  exception when sqlstate '55000' then r := r || 'ok C11f '; end;
  -- history and membership survive
  select count(*) into v_n from public.comm_members m where m.conversation_id = pub and m.removed_at is null;
  if v_n >= 3 then r := r || 'ok C11g '; else r := r || 'FAIL C11g '; nfail := nfail + 1; end if;
  begin
    perform public.comm_set_channel_archived(pub, false);
    r := r || 'FAIL C11h (member restored) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C11h '; end;

  -- C12 restoring into a name now taken is refused, then a clean restore works
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pub2 := public.comm_create_channel('smoke-pub-' || tag, 'public', null, null, '{}', null, gen_random_uuid());
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.comm_set_channel_archived(pub, false);
    r := r || 'FAIL C12 (restored into a duplicate name) '; nfail := nfail + 1;
  exception when unique_violation then r := r || 'ok C12 '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_set_channel_archived(pub2, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.comm_set_channel_archived(pub, false) then r := r || 'ok C12b '; else r := r || 'FAIL C12b '; nfail := nfail + 1; end if;

  -- ======================= PREFERENCES (C) =======================
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_set_conversation_prefs(pub, true, 'none');
  select x.pinned_at is not null and x.notify_level = 'none' into v_b from public.comm_sidebar_channels() x where x.id = pub;
  if v_b and (select m.muted from public.comm_members m where m.conversation_id = pub and m.user_id = c and m.removed_at is null) then r := r || 'ok C13 ';
  else r := r || 'FAIL C13 '; nfail := nfail + 1; end if;
  select x.id = pub into v_b from public.comm_sidebar_channels() x limit 1;
  if v_b then r := r || 'ok C13b '; else r := r || 'FAIL C13b (pinned not first) '; nfail := nfail + 1; end if;
  perform public.comm_set_muted(pub, false);
  if (select m.notify_level from public.comm_members m where m.conversation_id = pub and m.user_id = c and m.removed_at is null) = 'all' then r := r || 'ok C13c ';
  else r := r || 'FAIL C13c (mute and level drifted) '; nfail := nfail + 1; end if;
  -- C13d a pin is personal: B sees it unpinned
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select x.pinned_at is null into v_b from public.comm_sidebar_channels() x where x.id = pub;
  if v_b then r := r || 'ok C13d '; else r := r || 'FAIL C13d (pin leaked) '; nfail := nfail + 1; end if;

  -- ======================= ISOLATION =======================
  reset role;
  begin
    insert into public.comm_conversations (kind, name, visibility, workspace_id) values ('channel', 'smoke-x-' || tag, 'public', gen_random_uuid());
    r := r || 'FAIL C14 (channel in a workspace that does not exist) '; nfail := nfail + 1;
  exception when foreign_key_violation then r := r || 'ok C14 '; end;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    perform * from public.comm_discover_channels(null, 'active', 10, 0);
    r := r || 'FAIL C15 (anon discovered channels) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok C15 '; end;
  reset role;

  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end $smoke$;
