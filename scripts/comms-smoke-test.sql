-- ============================================================================
-- Communication Hub (0737) — SMOKE TEST.  Run by hand AFTER 0737 is applied.
--
-- ONE DO BLOCK THAT ALWAYS ENDS IN `raise exception`, so every row it writes is
-- rolled back. Read the result from the error message:
--
--     DRY RUN (rolled back) — 0 FAIL: ok T1 ok T1b … ok T20
--
-- Any "FAIL" in that list is a real failure. Run it in the Supabase SQL editor
-- (or the MCP execute_sql tool) as the project owner. It impersonates real
-- logins by setting `request.jwt.claims` (so auth.uid() answers) AND
-- `set local role authenticated` (so RLS applies) — the idiom
-- scripts/permission-override-smoke-test.sql uses.
--
-- FIXTURES ARE PICKED, NOT TYPED: three ACTIVE, NON-super-admin logins holding
-- communication:view (A, B, C); for the channel tests one login that holds
-- communication:create (X; a super admin counts); and for T21 one active login
-- WITHOUT communication:view (N). Missing fixtures are reported as SKIPPED
-- rather than passing silently.
--
-- IDENTITY CHANGES HAPPEN OUTSIDE `begin … exception` BLOCKS ON PURPOSE: a
-- subtransaction that aborts also reverts the set_config / set role made
-- inside it, and the next test would then run as the wrong person.
-- ============================================================================

do $smoke$
declare
  a uuid; b uuid; c uuid; x uuid; n uuid;
  d1 uuid; d1b uuid; g1 uuid; pc uuid; pv uuid;
  m1 uuid; gm1 uuid; gm2 uuid; r1 uuid; dm_att uuid;
  j jsonb;
  v_n integer;
  v_b boolean;
  v_path text;
  r text := '';
  nfail integer := 0;
  nskip integer := 0;
begin
  -- ---------- fixtures (as the owner) ----------
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
  select p.id into x from public.profiles p
   where coalesce(p.is_active, true) and p.id not in (a, b, c)
     and public.has_permission('communication', 'create', p.id)
   order by coalesce(p.is_super_admin, false), p.created_at limit 1;
  select p.id into n from public.profiles p
   where coalesce(p.is_active, true) and not public.has_permission('communication', 'view', p.id)
   order by p.created_at limit 1;

  if a is null or b is null or c is null then
    raise exception 'SMOKE SKIPPED — need three active non-super-admin logins with communication:view: a=% b=% c=%', a, b, c;
  end if;

  -- ======================= DIRECT MESSAGES =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T1 one DM per pair, whichever side opens it
  d1  := public.comm_open_direct(b);
  d1b := public.comm_open_direct(b);
  if d1 = d1b then r := r || 'ok T1 '; else r := r || 'FAIL T1 (second open made a new DM) '; nfail := nfail + 1; end if;

  -- T2 no DM with yourself
  begin
    perform public.comm_open_direct(a);
    r := r || 'FAIL T2 (self DM accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T2 '; end;

  -- T4 send, then replay the same client key
  j  := public.comm_send_message(d1, '11111111-1111-4111-8111-111111111111', 'hello B');
  m1 := (j ->> 'id')::uuid;
  if (j ->> 'created')::boolean then r := r || 'ok T4 '; else r := r || 'FAIL T4 '; nfail := nfail + 1; end if;
  j := public.comm_send_message(d1, '11111111-1111-4111-8111-111111111111', 'hello B');
  if (j ->> 'id')::uuid = m1 and not (j ->> 'created')::boolean then r := r || 'ok T4b ';
  else r := r || 'FAIL T4b (retry posted twice) '; nfail := nfail + 1; end if;

  -- T6 a direct INSERT bypassing the RPC is refused by RLS
  begin
    insert into public.comm_messages (conversation_id, author_id, body) values (d1, b, 'forged as B');
    r := r || 'FAIL T6 (direct insert accepted) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok T6 ';
            when others then r := r || 'FAIL T6 (' || sqlerrm || ') '; nfail := nfail + 1; end;

  -- T18 attachments: wrong folder and wrong type refused, a valid one recorded
  begin
    perform public.comm_send_message(d1, gen_random_uuid(), 'f',
      null, jsonb_build_array(jsonb_build_object('storage_path', gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.pdf',
        'file_name', 'x.pdf', 'mime_type', 'application/pdf', 'size_bytes', 100)));
    r := r || 'FAIL T18a (foreign folder accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T18a '; end;
  begin
    perform public.comm_send_message(d1, gen_random_uuid(), 'f',
      null, jsonb_build_array(jsonb_build_object('storage_path', d1::text || '/' || gen_random_uuid()::text || '.exe',
        'file_name', 'x.exe', 'mime_type', 'application/x-msdownload', 'size_bytes', 100)));
    r := r || 'FAIL T18b (.exe accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T18b '; end;
  v_path := d1::text || '/' || gen_random_uuid()::text || '.pdf';
  j := public.comm_send_message(d1, gen_random_uuid(), null,
    null, jsonb_build_array(jsonb_build_object('storage_path', v_path,
      'file_name', 'spec.pdf', 'mime_type', 'application/pdf', 'size_bytes', 2048)));
  dm_att := (j ->> 'id')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T1b the other side lands in the same DM
  if public.comm_open_direct(a) = d1 then r := r || 'ok T1b '; else r := r || 'FAIL T1b '; nfail := nfail + 1; end if;

  -- T7 unread, then read
  select unread_count into v_n from public.comm_my_conversations('direct') where id = d1;
  if v_n = 2 then r := r || 'ok T7 '; else r := r || format('FAIL T7 (unread=%s, want 2) ', v_n); nfail := nfail + 1; end if;
  perform public.comm_mark_read(d1);
  select unread_count into v_n from public.comm_my_conversations('direct') where id = d1;
  if v_n = 0 then r := r || 'ok T7b '; else r := r || format('FAIL T7b (unread=%s after read) ', v_n); nfail := nfail + 1; end if;

  -- T8 only the author edits
  begin
    perform public.comm_edit_message(m1, 'rewritten by B');
    r := r || 'FAIL T8 (non-author edit accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T8 '; end;

  -- T19 only the author (or a manager — none in a DM) deletes
  begin
    perform public.comm_delete_message(m1);
    r := r || 'FAIL T19 (non-author delete accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T19 '; end;

  -- T18c a member can read the attached file
  if public.comm_can_read_file(v_path) then r := r || 'ok T18c '; else r := r || 'FAIL T18c '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T3 an outsider sees nothing of the DM
  select count(*) into v_n from public.comm_conversations where id = d1;
  select v_n + count(*) into v_n from public.comm_messages where conversation_id = d1;
  select v_n + count(*) into v_n from public.comm_members where conversation_id = d1;
  if v_n = 0 then r := r || 'ok T3 '; else r := r || format('FAIL T3 (outsider saw %s rows) ', v_n); nfail := nfail + 1; end if;

  -- T5 an outsider cannot post into it
  begin
    perform public.comm_send_message(d1, gen_random_uuid(), 'intrude');
    r := r || 'FAIL T5 (outsider post accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T5 '; end;

  -- T18d an outsider cannot read the file
  if not public.comm_can_read_file(v_path) then r := r || 'ok T18d '; else r := r || 'FAIL T18d '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T8b the author edits; T18e deleting returns the file key and closes the file
  perform public.comm_edit_message(m1, 'hello B (edited)');
  if exists (select 1 from public.comm_messages where id = m1 and edited_at is not null)
  then r := r || 'ok T8b '; else r := r || 'FAIL T8b '; nfail := nfail + 1; end if;
  j := public.comm_delete_message(dm_att);
  if j -> 'paths' ? v_path then r := r || 'ok T18e '; else r := r || 'FAIL T18e (paths=' || (j -> 'paths')::text || ') '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.comm_can_read_file(v_path) then r := r || 'ok T18f '; else r := r || 'FAIL T18f (file readable after delete) '; nfail := nfail + 1; end if;

  -- ======================= GROUPS =======================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  g1  := public.comm_create_group('smoke group', array[b, c]);
  gm1 := (public.comm_send_message(g1, gen_random_uuid(), 'before C leaves') ->> 'id')::uuid;
  perform public.comm_remove_member(g1, c);
  gm2 := (public.comm_send_message(g1, gen_random_uuid(), 'after C leaves') ->> 'id')::uuid;

  -- T13 a mention of a removed member mentions nobody
  j := public.comm_send_message(g1, gen_random_uuid(), '<@' || b::text || '> and <@' || c::text || '>');
  if (j -> 'mentioned') = to_jsonb(array[b]) then r := r || 'ok T13 ';
  else r := r || 'FAIL T13 (mentioned=' || (j -> 'mentioned')::text || ') '; nfail := nfail + 1; end if;

  -- T11 the last owner cannot walk out on members
  begin
    perform public.comm_remove_member(g1, a);
    r := r || 'FAIL T11 (last owner left) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T11 '; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T10 a plain member cannot remove the owner or add people
  begin
    perform public.comm_remove_member(g1, a);
    r := r || 'FAIL T10 (member removed owner) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T10 '; end;
  begin
    perform public.comm_add_members(g1, array[c]);
    r := r || 'FAIL T10b (member added people) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T10b '; end;

  -- T12 one level of threads, and the count follows
  r1 := (public.comm_send_message(g1, gen_random_uuid(), 'a reply', gm1) ->> 'id')::uuid;
  begin
    perform public.comm_send_message(g1, gen_random_uuid(), 'reply to a reply', r1);
    r := r || 'FAIL T12 (nested reply accepted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T12 '; end;
  if (select reply_count from public.comm_messages where id = gm1) = 1 then r := r || 'ok T12b ';
  else r := r || 'FAIL T12b '; nfail := nfail + 1; end if;

  -- T14 reactions toggle
  v_b := public.comm_toggle_reaction(gm1, '👍');
  if v_b and not public.comm_toggle_reaction(gm1, '👍') then r := r || 'ok T14 ';
  else r := r || 'FAIL T14 '; nfail := nfail + 1; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- T9 the removed member keeps the past and loses the future
  select count(*) into v_n from public.comm_messages where id = gm1;
  if v_n = 1 then r := r || 'ok T9 '; else r := r || 'FAIL T9 (lost history) '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.comm_messages where id = gm2;
  if v_n = 0 then r := r || 'ok T9b '; else r := r || 'FAIL T9b (saw a message after removal) '; nfail := nfail + 1; end if;
  begin
    perform public.comm_send_message(g1, gen_random_uuid(), 'still here?');
    r := r || 'FAIL T9c (removed member posted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T9c '; end;

  -- T14b reacting needs ACTIVE membership
  begin
    perform public.comm_toggle_reaction(gm1, '👍');
    r := r || 'FAIL T14b (removed member reacted) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T14b '; end;

  -- T15 saving follows visibility
  insert into public.comm_saved (user_id, message_id) values (c, gm1);
  r := r || 'ok T15 ';
  begin
    insert into public.comm_saved (user_id, message_id) values (c, gm2);
    r := r || 'FAIL T15b (saved an invisible message) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok T15b ';
            when others then r := r || 'FAIL T15b (' || sqlerrm || ') '; nfail := nfail + 1; end;

  -- T16 a removed member cannot un-remove themselves (no UPDATE policy)
  update public.comm_members set removed_at = null where conversation_id = g1 and user_id = c;
  get diagnostics v_n = row_count;
  if v_n = 0 then r := r || 'ok T16 '; else r := r || 'FAIL T16 (self un-remove) '; nfail := nfail + 1; end if;

  -- T20 an archived group refuses new messages
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.comm_update_conversation(g1, 'smoke group', null, true);
  begin
    perform public.comm_send_message(g1, gen_random_uuid(), 'into the archive');
    r := r || 'FAIL T20 (archived accepted a post) '; nfail := nfail + 1;
  exception when others then r := r || 'ok T20 '; end;

  -- ======================= CHANNELS =======================
  -- T17 a login without communication:create cannot make a channel
  if public.has_permission('communication', 'create') then
    r := r || 'SKIP T17 (A holds communication:create) '; nskip := nskip + 1;
  else
    begin
      perform public.comm_create_channel('smoke-denied', 'public');
      r := r || 'FAIL T17 (channel without permission) '; nfail := nfail + 1;
    exception when others then r := r || 'ok T17 '; end;
  end if;

  if x is null then
    r := r || 'SKIP T17b-f (nobody holds communication:create) '; nskip := nskip + 1;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    set local role authenticated;
    pc := public.comm_create_channel('smoke-public-0737', 'public', 'probe');
    pv := public.comm_create_channel('smoke-private-0737', 'private', 'probe');
    perform public.comm_send_message(pc, gen_random_uuid(), 'public hello');
    perform public.comm_send_message(pv, gen_random_uuid(), 'private hello');

    -- T17g duplicate channel name refused
    begin
      perform public.comm_create_channel('SMOKE-PUBLIC-0737', 'public');
      r := r || 'FAIL T17g (duplicate channel name) '; nfail := nfail + 1;
    exception when others then r := r || 'ok T17g '; end;

    perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- T17b a public channel is readable before joining
    select count(*) into v_n from public.comm_messages where conversation_id = pc;
    if v_n = 1 then r := r || 'ok T17b '; else r := r || format('FAIL T17b (saw %s) ', v_n); nfail := nfail + 1; end if;
    -- T17c … but not writable
    begin
      perform public.comm_send_message(pc, gen_random_uuid(), 'drive-by');
      r := r || 'FAIL T17c (non-member posted) '; nfail := nfail + 1;
    exception when others then r := r || 'ok T17c '; end;
    -- T17d join, then post
    perform public.comm_join_channel(pc);
    j := public.comm_send_message(pc, gen_random_uuid(), 'joined');
    if (j ->> 'created')::boolean then r := r || 'ok T17d '; else r := r || 'FAIL T17d '; nfail := nfail + 1; end if;
    -- T17e a private channel is invisible, and cannot be joined
    select count(*) into v_n from public.comm_conversations where id = pv;
    select v_n + count(*) into v_n from public.comm_messages where conversation_id = pv;
    if v_n = 0 then r := r || 'ok T17e '; else r := r || format('FAIL T17e (saw %s) ', v_n); nfail := nfail + 1; end if;
    begin
      perform public.comm_join_channel(pv);
      r := r || 'FAIL T17f (joined a private channel) '; nfail := nfail + 1;
    exception when others then r := r || 'ok T17f '; end;
  end if;

  -- ======================= ACCESS SWITCH =======================
  -- T21 a login without communication:view cannot write, even to someone
  if n is null then
    r := r || 'SKIP T21 (every active login holds communication:view) '; nskip := nskip + 1;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', n, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.comm_open_direct(a);
      r := r || 'FAIL T21 (no view, still opened a DM) '; nfail := nfail + 1;
    exception when insufficient_privilege then r := r || 'ok T21 ';
              when others then r := r || 'FAIL T21 (' || sqlerrm || ') '; nfail := nfail + 1; end;
  end if;

  raise exception 'DRY RUN (rolled back) — % FAIL, % SKIP: %', nfail, nskip, r;
end $smoke$;
