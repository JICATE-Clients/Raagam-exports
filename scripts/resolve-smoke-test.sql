-- ============================================================================
-- Resolve Hub — smoke test (0739 · 0740 · 0741)
-- ============================================================================
--
-- ONE DO BLOCK THAT ALWAYS ENDS IN `raise exception`, so every fixture, role
-- grant, settings change and ticket it makes is rolled back and the live DB
-- is untouched. Read the result from the error message:
--
--     DRY RUN (rolled back) — 0 FAIL: ok R1 … ok OB3 …
--
-- Any "FAIL" in that list is a real failure. Run it with the Supabase MCP
-- `execute_sql`, or `psql -f`. It impersonates real, NON-super-admin logins
-- through `request.jwt.claims` (auth.uid()) AND `set local role
-- authenticated`, so grants and RLS are exercised, not only function bodies.
-- Setup steps run as the migration owner (`reset role`).
--
-- Fixture logins are picked by e-mail below; inside the block each is given
-- unit access (user_access, all units) and the role it needs:
--   rep, rep2, caretaker  + MERCHANDISING    (view only — every role has resolve:view,
--                                              but a login with NO role has nothing)
--   worker, lead          + Supervisor       (resolve:edit)
--   triage                + Factory Manager  (edit, approve, export)
-- ============================================================================

do $smoke$
declare
  u_rep    uuid := (select id from public.profiles where lower(email) = 'sripriyas@jkkn.ac.in');
  u_rep2   uuid := (select id from public.profiles where lower(email) = 'rojasundharam2000@gmail.com');
  u_worker uuid := (select id from public.profiles where lower(email) = 'dhanushyogesh36@gmail.com');
  u_lead   uuid := (select id from public.profiles where lower(email) = 'vikas78arun@gmail.com');
  u_triage uuid := (select id from public.profiles where lower(email) = 'ramkumarramya1974@gmail.com');
  u_estate uuid := (select id from public.profiles where lower(email) = 'chandrasekar1212@gmail.com');
  u_head   uuid := (select id from public.profiles where lower(email) = 'santhakumarhebin@gmail.com');
  u_care   uuid := (select id from public.profiles where lower(email) = 'mohanraj7863@gmail.com');
  u_ovr    uuid := (select id from public.profiles where lower(email) = 'pragadeesh3011@gmail.com');
  v_ho     uuid := (select id from public.locations where code = 'HO');
  r        text := '';
  nfail    int  := 0;
  v_trade  uuid;
  v_place  uuid;
  v_place2 uuid;
  v_team   uuid;
  v_ovr    uuid;
  v_staff  uuid;
  v_leave  uuid;
  v_out    jsonb;
  v_out2   jsonb;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t7 uuid;
  v_n      int;
  v_txt    text;
  v_due0   timestamptz;
  v_due1   timestamptz;
  v_arr    text[];
  rt       record;
  -- complaints (0745/0746)
  u_sa     uuid := (select id from public.profiles where lower(email) = 'sudhan@raagamexports.com');
  c_har    uuid;
  c_gen    uuid;
  c_saf    uuid;
  k_anon   uuid;
  k_gen    uuid;
  k_gen2   uuid;
  k_saf    uuid;
  k_sup    uuid;
  v_token  text;
  v_hash   text;
  s_a      uuid;
  s_b      uuid;
  s_c      uuid;
begin
  if u_rep is null or u_rep2 is null or u_worker is null or u_lead is null or u_triage is null
     or u_estate is null or u_head is null or u_care is null or u_ovr is null or v_ho is null then
    raise exception 'SMOKE SKIPPED — a fixture login or the HO unit is missing';
  end if;

  -- ── Setup (as owner) ──────────────────────────────────────────────────────
  update public.profiles set is_super_admin = false, is_active = true, current_location_id = v_ho
   where id in (u_rep, u_rep2, u_worker, u_lead, u_triage, u_estate, u_head, u_care, u_ovr);
  insert into public.user_access (user_email, is_active, all_locations)
  select lower(btrim(p.email)), true, true from public.profiles p
   where p.id in (u_rep, u_rep2, u_worker, u_lead, u_triage, u_estate, u_head, u_care, u_ovr)
  on conflict (user_email) do update set is_active = true, all_locations = true;
  insert into public.user_roles (user_id, role_id)
  select x.uid, ro.id from (values (u_worker, 'Supervisor'), (u_lead, 'Supervisor'), (u_triage, 'Factory Manager'),
                                   (u_rep, 'MERCHANDISING'), (u_rep2, 'MERCHANDISING'), (u_care, 'MERCHANDISING')) x(uid, rn)
    join public.roles ro on ro.name = x.rn
   where not exists (select 1 from public.user_roles ur where ur.user_id = x.uid and ur.role_id = ro.id);

  update public.rh_unit_settings
     set estate_owner_id = u_estate, unit_head_id = u_head, director_ids = array[u_head],
         spot_check_one_in = 0, report_limit_24h = 10, suppress_notifications = false,
         page_cap_per_day = 20, dispute_window_days = 7
   where location_id = v_ho;

  insert into public.rh_trades (code, name) values ('SMK', 'SMOKE TRADE') returning id into v_trade;
  insert into public.rh_places (location_id, code, name, kind, caretaker_id)
  values (v_ho, 'SMK-1', 'SMOKE ROOM', 'room', u_care) returning id into v_place;
  insert into public.rh_places (location_id, code, name, kind)
  values (v_ho, 'SMK-2', 'SMOKE YARD', 'area') returning id into v_place2;
  insert into public.rh_teams (location_id, trade_id, name, lead_id)
  values (v_ho, v_trade, 'SMOKE TEAM', u_lead) returning id into v_team;
  insert into public.rh_team_members (team_id, profile_id, created_at) values (v_team, u_worker, now() - interval '1 minute');
  insert into public.rh_team_members (team_id, profile_id) values (v_team, u_lead);
  insert into public.rh_routing_overrides (location_id, trade_id, place_id, owner_id)
  values (v_ho, v_trade, v_place, u_ovr) returning id into v_ovr;

  -- ── Routing fall-through (rh_route, as owner) ─────────────────────────────
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'qr');
  r := r || case when rt.owner_id = u_ovr then 'ok RT1-override ' else 'FAIL RT1(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_ovr then nfail := nfail + 1; end if;
  delete from public.rh_routing_overrides where id = v_ovr;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'qr');
  r := r || case when rt.owner_id = u_care then 'ok RT2-caretaker ' else 'FAIL RT2(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_care then nfail := nfail + 1; end if;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
  r := r || case when rt.owner_id = u_lead and rt.team_id = v_team then 'ok RT3-lead ' else 'FAIL RT3(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_lead then nfail := nfail + 1; end if;
  update public.rh_teams set lead_id = null where id = v_team;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
  r := r || case when rt.owner_id = u_worker and rt.reason = 'Team member' then 'ok RT4-member ' else 'FAIL RT4(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_worker then nfail := nfail + 1; end if;
  update public.rh_teams set inactive = true where id = v_team;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
  r := r || case when rt.owner_id = u_estate then 'ok RT5-estate ' else 'FAIL RT5(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_estate then nfail := nfail + 1; end if;
  update public.rh_unit_settings set estate_owner_id = null where location_id = v_ho;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
  r := r || case when rt.owner_id = u_head then 'ok RT6-head ' else 'FAIL RT6(' || coalesce(rt.reason, '-') || ') ' end;
  if rt.owner_id is distinct from u_head then nfail := nfail + 1; end if;
  update public.rh_unit_settings set unit_head_id = null where location_id = v_ho;
  select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
  r := r || case when rt.owner_id is null then 'ok RT7-nobody ' else 'FAIL RT7 ' end;
  if rt.owner_id is not null then nfail := nfail + 1; end if;
  -- restore
  update public.rh_unit_settings set estate_owner_id = u_estate, unit_head_id = u_head where location_id = v_ho;
  update public.rh_teams set inactive = false, lead_id = u_lead where id = v_team;
  -- leave: only when the lead's login links to a staff record
  v_staff := public.rh_staff_of(u_lead);
  if v_staff is not null then
    insert into public.hr_leaves (employee_type, employee_id, leave_type, from_date, to_date, days, is_encashment, status)
    values ('staff', v_staff, 'casual', (now() at time zone 'Asia/Kolkata')::date,
            (now() at time zone 'Asia/Kolkata')::date, 1, false, 'approved')
    returning id into v_leave;
    select * into rt from public.rh_route(v_ho, v_place, v_trade, 'form');
    r := r || case when rt.owner_id is distinct from u_lead then 'ok RT8-leave(' || rt.reason || ') ' else 'FAIL RT8 ' end;
    if rt.owner_id = u_lead then nfail := nfail + 1; end if;
    delete from public.hr_leaves where id = v_leave;
  else
    r := r || 'skip RT8-leave(no staff link) ';
  end if;

  -- ── Submit (as reporter) ──────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out  := public.rh_submit_broken(p_place_id => v_place, p_trade_id => v_trade, p_title => 'Smoke: tap leaking',
                                    p_photo_path => 'tickets/smoke/a.jpg', p_source => 'form');
  v_out2 := public.rh_submit_broken(p_place_id => v_place, p_trade_id => v_trade, p_title => 'Smoke: door hinge');
  t1 := (v_out ->> 'ticket_id')::uuid;
  t2 := (v_out2 ->> 'ticket_id')::uuid;
  if v_out ->> 'ref_no' ~ ('^BRK-' || extract(year from now() at time zone 'Asia/Kolkata')::int || '-\d{6}$')
     and (v_out ->> 'owner_id')::uuid = u_lead and not (v_out ->> 'needs_sorting')::boolean then
    r := r || 'ok S1(' || (v_out ->> 'ref_no') || ') ';
  else r := r || 'FAIL S1(' || v_out::text || ') '; nfail := nfail + 1; end if;
  if right(v_out2 ->> 'ref_no', 6)::int = right(v_out ->> 'ref_no', 6)::int + 1 then r := r || 'ok S2-sequential ';
  else r := r || 'FAIL S2 '; nfail := nfail + 1; end if;
  t3 := (public.rh_submit_broken(p_place_id => v_place2, p_trade_id => v_trade, p_title => 'Smoke: t3') ->> 'ticket_id')::uuid;
  t4 := (public.rh_submit_broken(p_place_id => v_place2, p_trade_id => v_trade, p_title => 'Smoke: t4') ->> 'ticket_id')::uuid;
  t5 := (public.rh_submit_broken(p_place_id => v_place2, p_trade_id => v_trade, p_title => 'Smoke: t5') ->> 'ticket_id')::uuid;
  t7 := (public.rh_submit_broken(p_place_id => v_place2, p_trade_id => v_trade, p_title => 'Smoke: sparking socket',
                                 p_is_dangerous => true) ->> 'ticket_id')::uuid;
  begin
    perform public.rh_submit_broken(p_title => 'Smoke: bad path', p_photo_path => '../etc/passwd');
    r := r || 'FAIL S3 (bad photo path accepted) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok S3-photo-path ';
  end;
  select count(*) into v_n from public.rh_tickets where id = t1;   -- reporter sees own ticket
  r := r || case when v_n = 1 then 'ok V1-reporter-sees ' else 'FAIL V1 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  begin
    update public.rh_tickets set title = 'hacked' where id = t1;
    get diagnostics v_n = row_count;
    r := r || case when v_n = 0 then 'ok V2-no-update(0 rows) ' else 'FAIL V2 (reporter updated) ' end;
    if v_n <> 0 then nfail := nfail + 1; end if;
  exception when insufficient_privilege then r := r || 'ok V2-no-update(denied) ';
  end;
  -- reporter cannot act as worker on own ticket
  begin
    perform public.rh_start(t1);
    r := r || 'FAIL X1 (reporter started) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X1-reporter-start ';
  end;
  -- withdraw while open works (t2)
  v_out := public.rh_withdraw(t2);
  r := r || case when v_out ->> 'status' = 'withdrawn' then 'ok W1-withdraw ' else 'FAIL W1 ' end;
  if v_out ->> 'status' <> 'withdrawn' then nfail := nfail + 1; end if;
  reset role;

  -- ── Outbox from submit: owner told, actor never ───────────────────────────
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t1 and a.action = 'created' and o.recipient_id = u_lead
     and o.event_key = 'resolve.ticket_routed' and o.channel = 'in_app';
  r := r || case when v_n = 1 then 'ok OB1-routed ' else 'FAIL OB1(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) filter (where o.channel = 'sms') into v_n from public.rh_outbox o where o.ticket_id = t7 and o.event_key = 'resolve.dangerous';
  r := r || case when v_n = 1 then 'ok OB2-dangerous-sms ' else 'FAIL OB2(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  -- ── Worker: claim, start, block/unblock, fix ──────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_arr := public.rh_ticket_actions(t1);
  r := r || case when 'claim' = any (v_arr) then 'ok A1-actions-claim ' else 'FAIL A1(' || array_to_string(v_arr, ',') || ') ' end;
  if not ('claim' = any (v_arr)) then nfail := nfail + 1; end if;
  perform public.rh_claim(t1);
  perform public.rh_start(t1);
  begin
    perform public.rh_fix(t1, null);
    r := r || 'FAIL X2 (fix without photo) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X2-fix-needs-photo ';
  end;
  begin
    perform public.rh_cancel(t4, 'smoke');
    r := r || 'FAIL X3 (worker cancelled) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X3-cancel-not-triage ';
  end;
  begin
    perform public.rh_assign(t4, u_worker);
    r := r || 'FAIL X4 (worker assigned) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X4-assign-not-triage ';
  end;
  perform public.rh_block(t1, 'Waiting for a washer');
  reset role;
  update public.rh_tickets set paused_at = now() - interval '2 hours' where id = t1;
  select due_at into v_due0 from public.rh_tickets where id = t1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_unblock(t1);
  select due_at into v_due1 from public.rh_tickets where id = t1;
  select paused_seconds into v_n from public.rh_tickets where id = t1;
  if v_due1 - v_due0 = interval '2 hours' and v_n = 7200 then r := r || 'ok B1-due-shift ';
  else r := r || 'FAIL B1(' || (v_due1 - v_due0)::text || ',' || v_n || ') '; nfail := nfail + 1; end if;
  v_out := public.rh_fix(t1, 'tickets/smoke/fix1.jpg', 'washer replaced');
  r := r || case when v_out ->> 'status' = 'closed' and not (v_out ->> 'spot_check')::boolean
                 then 'ok F1-auto-close ' else 'FAIL F1(' || v_out::text || ') ' end;
  if v_out ->> 'status' <> 'closed' then nfail := nfail + 1; end if;
  -- internal note by worker
  perform public.rh_add_note(t1, 'Smoke internal note', 'internal');
  perform public.rh_add_note(t1, 'Smoke note for reporter', 'reporter');
  reset role;

  -- ── Reporter: rate, rate twice, dispute ───────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_rate(t1, 5, 'thanks');
  begin
    perform public.rh_rate(t1, 4);
    r := r || 'FAIL X5 (rated twice) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X5-rate-once ';
  end;
  select count(*) into v_n from public.rh_ticket_notes where ticket_id = t1 and visibility = 'internal';
  r := r || case when v_n = 0 then 'ok V3-no-internal-for-reporter ' else 'FAIL V3 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_ticket_notes where ticket_id = t1 and visibility = 'reporter';
  r := r || case when v_n = 1 then 'ok V4-reporter-note ' else 'FAIL V4 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  begin
    perform public.rh_add_note(t1, 'sneaky', 'internal');
    r := r || 'FAIL X6 (reporter wrote internal) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X6-reporter-no-internal ';
  end;
  v_out := public.rh_dispute(t1, 'Still dripping');
  select count(*) into v_n from public.rh_tickets
   where id = t1 and status = 'in_progress' and fix_round = 2 and dispute_count = 1 and reopen_count = 1;
  r := r || case when v_n = 1 then 'ok D1-dispute-round ' else 'FAIL D1 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t1 and a.action = 'disputed';
  -- disputed → owner (lead) + assignee (worker), never the reporter
  if v_n = 2 and not exists (select 1 from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
                               where a.ticket_id = t1 and a.action = 'disputed' and o.recipient_id = u_rep)
  then r := r || 'ok OB3-disputed ';
  else r := r || 'FAIL OB3(' || v_n || ') '; nfail := nfail + 1; end if;

  -- second fix, then dispute after the window is refused
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_fix(t1, 'tickets/smoke/fix2.jpg');
  reset role;
  update public.rh_tickets set closed_at = now() - interval '8 days' where id = t1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_dispute(t1, 'late complaint');
    r := r || 'FAIL X7 (dispute after window) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X7-dispute-window ';
  end;
  reset role;

  -- ── A stranger cannot see the ticket or its notes ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id in (t1, t3, t7);
  r := r || case when v_n = 0 then 'ok V5-stranger-no-ticket ' else 'FAIL V5(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_ticket_notes where ticket_id = t1;
  r := r || case when v_n = 0 then 'ok V6-stranger-no-notes ' else 'FAIL V6 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_ticket_activity where ticket_id = t1;
  r := r || case when v_n = 0 then 'ok V7-stranger-no-activity ' else 'FAIL V7 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  -- …but can find and join an open one at the same place
  select count(*) into v_n from public.rh_similar_open(v_place2) s where s.id = t7;
  r := r || case when v_n = 1 then 'ok J0-similar ' else 'FAIL J0 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform public.rh_join(t7);
  select count(*) into v_n from public.rh_tickets where id = t7;
  r := r || case when v_n = 1 then 'ok J1-joiner-sees ' else 'FAIL J1 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  begin
    perform public.rh_join(t7);
    r := r || 'FAIL X8 (joined twice) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X8-join-once ';
  end;
  reset role;

  -- ── Owner (lead): start t3; reporter can no longer withdraw it ────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_lead, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_start(t3);
  perform public.rh_start(t5);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_withdraw(t3);
    r := r || 'FAIL X9 (withdraw after start) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X9-withdraw-after-start ';
  end;
  begin
    perform public.rh_edit_report(t3, 'new title');
    r := r || 'FAIL X10 (edit after start) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X10-edit-after-start ';
  end;
  reset role;

  -- ── Spot check path on t5 (always spot-check) ─────────────────────────────
  update public.rh_unit_settings set spot_check_one_in = 1 where location_id = v_ho;
  perform set_config('request.jwt.claims', json_build_object('sub', u_lead, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.rh_fix(t5, 'tickets/smoke/t5a.jpg');
  r := r || case when v_out ->> 'status' = 'fixed' and (v_out ->> 'spot_check')::boolean then 'ok SC1-pending ' else 'FAIL SC1 ' end;
  if v_out ->> 'status' <> 'fixed' then nfail := nfail + 1; end if;
  begin
    perform public.rh_start(t5);   -- fixed → in_progress is not a worker's move
    r := r || 'FAIL X11 (fixed→in_progress by worker) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X11-fixed-not-restartable ';
  end;
  begin
    perform public.rh_spot_check(t5, true);
    r := r || 'FAIL X12 (worker spot-checked) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X12-spot-not-worker ';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_spot_check(t5, false, 'still loose');
  select count(*) into v_n from public.rh_tickets where id = t5 and status = 'in_progress' and fix_round = 2;
  r := r || case when v_n = 1 then 'ok SC2-fail-new-round ' else 'FAIL SC2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_lead, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_fix(t5, 'tickets/smoke/t5b.jpg');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_spot_check(t5, true, 'good');
  select count(*) into v_n from public.rh_tickets where id = t5 and status = 'closed' and closure_kind = 'spot_checked';
  r := r || case when v_n = 1 then 'ok SC3-pass ' else 'FAIL SC3 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  -- triage: cancel t4, assign t7, queue, workload, analytics
  perform public.rh_cancel(t4, 'Duplicate of another report');
  perform public.rh_assign(t7, u_worker);
  select count(*) into v_n from public.rh_triage_queue('open') q where q.id in (t3, t7) and q.score > 0
     and jsonb_array_length(q.score_parts) > 0;
  r := r || case when v_n = 2 then 'ok TQ1-queue ' else 'FAIL TQ1(' || v_n || ') ' end;
  if v_n <> 2 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_triage_queue('all') q where q.id = t4 and q.score = 0;
  r := r || case when v_n = 1 then 'ok TQ2-cancelled-zero ' else 'FAIL TQ2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_workload() w where w.team_id = v_team;
  r := r || case when v_n >= 2 then 'ok WL1 ' else 'FAIL WL1(' || v_n || ') ' end;
  if v_n < 2 then nfail := nfail + 1; end if;
  v_out := public.rh_analytics(12);
  r := r || case when (v_out -> 'totals' ->> 'total')::int >= 6 and jsonb_array_length(v_out -> 'weekly') = 12
                 then 'ok AN1(total=' || (v_out -> 'totals' ->> 'total') || ',vfr=' || coalesce(v_out ->> 'verified_fix_rate', 'null') || ') '
                 else 'FAIL AN1(' || left(v_out::text, 120) || ') ' end;
  if (v_out -> 'totals' ->> 'total')::int < 6 then nfail := nfail + 1; end if;
  reset role;

  -- a view-only user cannot reach triage or analytics
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.rh_triage_queue('open');
    r := r || 'FAIL X13 (reporter read triage) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok X13-triage-gated ';
  end;
  reset role;

  -- ── Activity is append-only ───────────────────────────────────────────────
  begin
    update public.rh_ticket_activity set note = 'rewritten' where ticket_id = t1;
    r := r || 'FAIL AC1 (activity updated) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok AC1-activity-immutable ';
  end;
  begin
    delete from public.rh_ticket_activity where ticket_id = t1;
    r := r || 'FAIL AC2 (activity deleted) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok AC2-activity-undeletable ';
  end;

  -- ── Outbox invariants ─────────────────────────────────────────────────────
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where o.recipient_id = a.actor_id;
  r := r || case when v_n = 0 then 'ok OB4-no-actor ' else 'FAIL OB4(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  select count(*) into v_n from (select o.activity_id, o.recipient_id, o.channel from public.rh_outbox o
                                  group by 1, 2, 3 having count(*) > 1) d;
  r := r || case when v_n = 0 then 'ok OB5-deduped ' else 'FAIL OB5 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  -- fixed/closed → reporter AND joiners
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t5 and a.action = 'spot_check_passed' and o.recipient_id = u_rep and o.event_key = 'resolve.closed';
  r := r || case when v_n = 1 then 'ok OB6-closed-to-reporter ' else 'FAIL OB6(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  -- drain: claim, fail with backoff
  select count(*) into v_n from public.rh_outbox_claim(500);
  select o.id::text into v_txt from public.rh_outbox o where o.ticket_id = t1 order by o.created_at limit 1;
  v_out := public.rh_outbox_mark(v_txt::uuid, 'failed', 'smoke');
  select count(*) into v_n from public.rh_outbox o
   where o.id = v_txt::uuid and o.status = 'pending' and o.attempts = 1
     and o.next_attempt_at between now() + interval '119 seconds' and now() + interval '121 seconds';
  r := r || case when v_n = 1 then 'ok OB7-backoff ' else 'FAIL OB7 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  -- suppression
  update public.rh_unit_settings set suppress_notifications = true where location_id = v_ho;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_start(t7);
  perform public.rh_fix(t7, 'tickets/smoke/t7.jpg');   -- spot_check_one_in = 1 → fixed
  reset role;
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t7 and a.action = 'fixed' and o.status = 'suppressed';
  r := r || case when v_n >= 2 then 'ok OB8-suppressed(' || v_n || ') ' else 'FAIL OB8(' || v_n || ') ' end;
  if v_n < 2 then nfail := nfail + 1; end if;
  update public.rh_unit_settings set suppress_notifications = false where location_id = v_ho;
  -- service-only RPCs are not callable by a login
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_escalation_sweep();
    r := r || 'FAIL G1 (login ran the sweep) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok G1-sweep-service-only ';
  end;
  reset role;

  -- ── Escalation sweep: idempotent ──────────────────────────────────────────
  update public.rh_tickets set due_at = now() - interval '8 days' where id = t3;
  v_out  := public.rh_escalation_sweep();
  v_out2 := public.rh_escalation_sweep();
  if (v_out ->> 'level1')::int >= 1 and (v_out ->> 'level3')::int >= 1 and (v_out ->> 'level7')::int >= 1
     and (v_out ->> 'digests')::int >= 1
     and (v_out2 ->> 'level1')::int = 0 and (v_out2 ->> 'level3')::int = 0
     and (v_out2 ->> 'level7')::int = 0 and (v_out2 ->> 'digests')::int = 0 then
    r := r || 'ok E1-sweep(' || v_out::text || ') ';
  else r := r || 'FAIL E1(' || v_out::text || ' then ' || v_out2::text || ') '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox o where o.event_key = 'resolve.overdue' and o.ticket_id = t3
     and exists (select 1 from public.rh_outbox h where h.event_key = 'resolve.overdue' and h.ticket_id = t3
                  and h.recipient_id = u_head);
  r := r || case when v_n >= 2 then 'ok E2-overdue-recipients ' else 'FAIL E2(' || v_n || ') ' end;
  if v_n < 2 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox o where o.event_key = 'resolve.digest' and o.recipient_id = u_head;
  r := r || case when v_n = 1 then 'ok E3-digest ' else 'FAIL E3(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  -- ══ COMPLAINTS (0745/0746) ═════════════════════════════════════════════════
  -- Complainant A = rep2. Staff chain A → B (estate) → C (head) → A (a cycle,
  -- to prove the walk terminates). Committee of HARASSMENT = caretaker,
  -- oversight = override owner. GENERAL handler = lead.
  c_har := (select id from public.rh_complaint_categories where location_id = v_ho and code = 'HAR');
  c_gen := (select id from public.rh_complaint_categories where location_id = v_ho and code = 'GEN');
  c_saf := (select id from public.rh_complaint_categories where location_id = v_ho and code = 'SAF');
  s_a := public.rh_staff_of(u_rep2);
  s_b := public.rh_staff_of(u_estate);
  s_c := public.rh_staff_of(u_head);
  if c_har is null or c_gen is null or c_saf is null or s_a is null or s_b is null or s_c is null or u_sa is null then
    raise exception 'SMOKE SKIPPED — complaint fixture missing: har=% gen=% saf=% a=% b=% c=% sa=%',
      c_har, c_gen, c_saf, s_a, s_b, s_c, u_sa;
  end if;
  update public.staff set manager_id = s_b where id = s_a;
  update public.staff set manager_id = s_c where id = s_b;
  update public.staff set manager_id = s_a where id = s_c;
  insert into public.rh_category_members (category_id, profile_id, role) values
    (c_har, u_care, 'committee'), (c_har, u_ovr, 'oversight'), (c_saf, u_lead, 'committee');
  update public.rh_complaint_categories set handler_id = u_lead where id = c_gen;
  update public.rh_complaint_categories set handler_id = u_estate where id = c_saf;
  update public.rh_unit_settings set superior_handler_id = u_estate, director_ids = array[u_head]
   where location_id = v_ho;
  update public.profiles set current_location_id = v_ho where id = u_sa;

  v_arr := public.rh__chain_of(u_rep2)::text[];
  r := r || case when u_estate::text = any (v_arr) and u_head::text = any (v_arr) and not (u_rep2::text = any (v_arr))
                 then 'ok CH1-chain(cycle-safe) ' else 'FAIL CH1(' || array_to_string(v_arr, ',') || ') ' end;
  if not (u_estate::text = any (v_arr) and u_head::text = any (v_arr)) then nfail := nfail + 1; end if;

  -- ── Anonymous, sensitive ──────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.rh_submit_complaint(p_category_id => c_har, p_subject => 'Smoke: harassment',
                                      p_description => 'details', p_is_anonymous => true);
  v_token := v_out ->> 'tracking_token';
  v_hash  := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');  -- what the server sends (0747)
  r := r || case when v_out -> 'ticket_id' = 'null'::jsonb and length(v_token) = 43 and v_token ~ '^[A-Za-z0-9_-]{43}$'
                      and v_out ->> 'ref_no' like 'CMP-%'
                 then 'ok CA1-anon-receipt(' || (v_out ->> 'ref_no') || ') ' else 'FAIL CA1(' || v_out::text || ') ' end;
  if not (length(v_token) = 43 and v_out -> 'ticket_id' = 'null'::jsonb) then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_tickets where kind = 'complaint';
  r := r || case when v_n = 0 then 'ok CA2-complainant-cannot-select ' else 'FAIL CA2(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  begin
    perform public.rh_track_complaint(v_hash);
    r := r || 'FAIL CA3 (login ran track) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok CA3-track-service-only ';
  end;
  reset role;
  k_anon := (select id from public.rh_tickets where ref_no = v_out ->> 'ref_no');
  select count(*) into v_n from public.rh_tickets
   where id = k_anon and reporter_id is null and created_by is null and is_anonymous
     and tracking_token_hash = v_hash and owner_id = u_care;
  r := r || case when v_n = 1 then 'ok CA4-unlinked-hash-only ' else 'FAIL CA4 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_ticket_activity where ticket_id = k_anon and actor_id is not null;
  r := r || case when v_n = 0 then 'ok CA5-activity-actor-null ' else 'FAIL CA5(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_report_ledger
   where profile_id = u_rep2 and kind = 'complaint' and ticket_id is null
     and created_at = date_trunc('hour', created_at);
  r := r || case when v_n = 1 then 'ok CA6-ledger-unlinked-hour ' else 'FAIL CA6(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from (
      select row_to_json(x)::text as j from public.rh_tickets x where x.id = k_anon
      union all select row_to_json(a)::text from public.rh_ticket_activity a where a.ticket_id = k_anon
      union all select row_to_json(o)::text from public.rh_outbox o where o.ticket_id = k_anon
      union all select row_to_json(l)::text from public.rh_report_ledger l where l.profile_id = u_rep2) z
   where z.j like '%' || v_token || '%';
  r := r || case when v_n = 0 then 'ok CA7-token-never-stored ' else 'FAIL CA7(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  v_out := public.rh_track_complaint(v_hash);
  select array_agg(k order by k) into v_arr from jsonb_object_keys(v_out) k;
  r := r || case when v_arr = array['created_at', 'first_response_at', 'ref_no', 'resolution_message',
                                    'resolved_at', 'status', 'subject', 'withdrawn_at']
                 then 'ok CA8-track-keys ' else 'FAIL CA8(' || array_to_string(v_arr, ',') || ') ' end;
  if v_arr <> array['created_at', 'first_response_at', 'ref_no', 'resolution_message',
                    'resolved_at', 'status', 'subject', 'withdrawn_at'] then nfail := nfail + 1; end if;
  -- the RAW token is refused outright: only its hash is accepted (0747)
  r := r || case when public.rh_track_complaint('x') is null
                      and public.rh_track_complaint(repeat('a', 64)) is null
                      and public.rh_track_complaint(v_token) is null
                 then 'ok CA9-bad-or-raw-token-null ' else 'FAIL CA9 ' end;
  if public.rh_track_complaint(repeat('a', 64)) is not null
     or public.rh_track_complaint(v_token) is not null then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox_claim(500) q where q.ticket_id = k_anon and q.is_sensitive;
  r := r || case when v_n >= 1 then 'ok CN0-claim-marks-sensitive ' else 'FAIL CN0(' || v_n || ') ' end;
  if v_n < 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox where ticket_id = k_anon and event_key = 'resolve.complaint_new' and recipient_id = u_care;
  r := r || case when v_n = 1 then 'ok CN1-handler-notified ' else 'FAIL CN1(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  -- sensitive visibility: committee + oversight yes; triage and a non-member super admin no
  perform set_config('request.jwt.claims', json_build_object('sub', u_care, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id = k_anon;
  reset role;
  r := r || case when v_n = 1 then 'ok CV1-committee-sees ' else 'FAIL CV1 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_ovr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id = k_anon;
  reset role;
  r := r || case when v_n = 1 then 'ok CV2-oversight-sees ' else 'FAIL CV2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id = k_anon;
  reset role;
  r := r || case when v_n = 0 then 'ok CV3-triage-blind-sensitive ' else 'FAIL CV3 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_sa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id = k_anon;
  v_txt := public.has_permission('resolve', 'approve')::text;
  reset role;
  r := r || case when v_n = 0 and v_txt = 'true' then 'ok CV4-superadmin-blind-sensitive ' else 'FAIL CV4(' || v_n || ',' || v_txt || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;

  -- ── Named, non-sensitive (GENERAL) ────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  k_gen  := (public.rh_submit_complaint(p_category_id => c_gen, p_subject => 'Smoke: canteen') ->> 'ticket_id')::uuid;
  k_gen2 := (public.rh_submit_complaint(p_category_id => c_gen, p_subject => 'Smoke: second') ->> 'ticket_id')::uuid;
  select count(*) into v_n from public.rh_tickets where id in (k_gen, k_gen2);
  r := r || case when v_n = 2 then 'ok CG1-named-reporter-sees ' else 'FAIL CG1 ' end;
  if v_n <> 2 then nfail := nfail + 1; end if;
  begin
    perform public.rh_submit_complaint(p_category_id => c_gen, p_subject => 'x', p_is_anonymous => true);
    r := r || 'FAIL CG2 (anonymous accepted where not allowed) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CG2-anon-not-allowed ';
  end;
  perform public.rh_c_withdraw(k_gen2);
  reset role;
  select count(*) into v_n from public.rh_tickets where id = k_gen and owner_id = u_lead and reporter_id = u_rep2;
  r := r || case when v_n = 1 then 'ok CG3-category-handler ' else 'FAIL CG3 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where id = k_gen;
  reset role;
  r := r || case when v_n = 1 then 'ok CV5-triage-sees-nonsensitive ' else 'FAIL CV5 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_c_start(k_gen);
    r := r || 'FAIL CX1 (outsider started a complaint) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CX1-outsider-cannot-act ';
  end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_lead, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_arr := public.rh_ticket_actions(k_gen);
  r := r || case when v_arr @> array['c_start', 'c_resolve', 'c_assign', 'note_internal'] and not (v_arr && array['start', 'fix'])
                 then 'ok CX2-actions ' else 'FAIL CX2(' || array_to_string(v_arr, ',') || ') ' end;
  if not (v_arr @> array['c_start', 'c_resolve']) then nfail := nfail + 1; end if;
  begin
    perform public.rh_start(k_gen);
    r := r || 'FAIL CX3 (broken verb on a complaint) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CX3-broken-verb-refused ';
  end;
  begin
    perform public.rh_c_resolve(k_gen, '  ');
    r := r || 'FAIL CX4 (resolved without message) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CX4-resolve-needs-message ';
  end;
  perform public.rh_c_start(k_gen);
  perform public.rh_c_resolve(k_gen, 'Canteen menu changed from Monday.');
  select count(*) into v_n from public.rh_tickets
   where id = k_gen and status = 'resolved' and first_response_at is not null and resolved_at is not null;
  r := r || case when v_n = 1 then 'ok CL1-start-resolve ' else 'FAIL CL1 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  select count(*) into v_n from public.rh_outbox where ticket_id = k_gen and event_key = 'resolve.complaint_resolved' and recipient_id = u_rep2;
  r := r || case when v_n = 1 then 'ok CN2-resolved-to-reporter ' else 'FAIL CN2(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_c_withdraw(k_gen);
    r := r || 'FAIL CX5 (withdrawn after resolved) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CX5-no-withdraw-after-resolve ';
  end;
  reset role;
  select count(*) into v_n from public.rh_tickets where id = k_gen2 and status = 'withdrawn' and withdrawn_at is not null;
  r := r || case when v_n = 1 then 'ok CL2-reporter-withdraw ' else 'FAIL CL2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  -- ── Management chain: never routed to B, even as category handler ────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  k_saf := (public.rh_submit_complaint(p_category_id => c_saf, p_subject => 'Smoke: unsafe stacking') ->> 'ticket_id')::uuid;
  begin
    perform public.rh_submit_complaint(p_category_id => c_gen, p_subject => 'Smoke: about my boss', p_about_superior => true);
    r := r || 'FAIL CS1 (routed inside the chain) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then
    r := r || case when sqlerrm like 'No independent handler%' then 'ok CS1-no-independent-refused '
                   else 'FAIL CS1(' || sqlerrm || ') ' end;
    if sqlerrm not like 'No independent handler%' then nfail := nfail + 1; end if;
  end;
  reset role;
  select count(*) into v_n from public.rh_tickets where id = k_saf and owner_id = u_lead;
  r := r || case when v_n = 1 then 'ok CS2-handler-in-chain-skipped ' else 'FAIL CS2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  update public.rh_unit_settings set director_ids = array[u_head, u_ovr] where location_id = v_ho;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  k_sup := (public.rh_submit_complaint(p_category_id => c_gen, p_subject => 'Smoke: about my boss',
                                       p_about_superior => true) ->> 'ticket_id')::uuid;
  reset role;
  select count(*) into v_n from public.rh_tickets where id = k_sup and owner_id = u_ovr and about_superior;
  r := r || case when v_n = 1 then 'ok CS3-independent-director ' else 'FAIL CS3 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from (values (u_estate), (u_head), (u_triage), (u_lead)) x(uid)
   where public.rh__can_see(k_sup, x.uid);
  r := r || case when v_n = 0 then 'ok CS4-chain-and-triage-blind ' else 'FAIL CS4(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_ovr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_arr := public.rh_ticket_actions(k_sup);
  reset role;
  r := r || case when not ('c_assign' = any (v_arr)) and 'c_resolve' = any (v_arr)
                 then 'ok CS5-no-reassign ' else 'FAIL CS5(' || array_to_string(v_arr, ',') || ') ' end;
  if 'c_assign' = any (v_arr) then nfail := nfail + 1; end if;

  -- ── 72h breach: escalated once, oversight told, never triage ─────────────
  update public.rh_tickets set response_due_at = now() - interval '1 hour', due_at = now() - interval '1 hour'
   where id = k_anon;
  v_out  := public.rh_escalation_sweep();
  v_out2 := public.rh_escalation_sweep();
  select count(*) into v_n from public.rh_tickets where id = k_anon and status = 'escalated';
  if (v_out ->> 'complaints')::int = 1 and (v_out2 ->> 'complaints')::int = 0 and v_n = 1 then
    r := r || 'ok CE1-escalated-once ';
  else r := r || 'FAIL CE1(' || v_out::text || ' then ' || v_out2::text || ') '; nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox
   where ticket_id = k_anon and event_key = 'resolve.complaint_escalated' and recipient_id = u_ovr;
  r := r || case when v_n = 1 then 'ok CE2-oversight-told ' else 'FAIL CE2(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox
   where ticket_id = k_anon and recipient_id in (u_triage, u_rep2, u_sa);
  r := r || case when v_n = 0 then 'ok CE3-no-triage-no-complainant ' else 'FAIL CE3(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;

  -- ── Anonymous withdraw by token ───────────────────────────────────────────
  v_out := public.rh_track_withdraw(v_hash);
  v_out2 := public.rh_track_complaint(v_hash);
  select count(*) into v_n from public.rh_ticket_activity
   where ticket_id = k_anon and action = 'withdrawn' and actor_id is null;
  if v_out2 ->> 'status' = 'withdrawn' and v_out2 ->> 'withdrawn_at' is not null and v_n = 1 then
    r := r || 'ok CT1-token-withdraw ';
  else r := r || 'FAIL CT1(' || coalesce(v_out2::text, 'null') || ') '; nfail := nfail + 1; end if;
  begin
    perform public.rh_track_withdraw(v_hash);
    r := r || 'FAIL CT2 (withdrawn twice) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok CT2-withdraw-once ';
  end;
  select count(*) into v_n from public.rh_outbox where ticket_id = k_anon and recipient_id = u_rep2;
  r := r || case when v_n = 0 then 'ok CA10-complainant-never-targeted ' else 'FAIL CA10 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;

  -- ── Rate limit: the 11th report in 24h is refused ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_tickets where reporter_id = u_rep and created_at > now() - interval '24 hours';
  for i in (v_n + 1) .. 10 loop
    perform public.rh_submit_broken(p_place_id => v_place2, p_title => 'Smoke filler ' || i);
  end loop;
  begin
    perform public.rh_submit_broken(p_place_id => v_place2, p_title => 'Smoke: the eleventh');
    r := r || 'FAIL RL1 (11th accepted) '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then
    r := r || case when sqlerrm like '%limit%' then 'ok RL1-limit ' else 'FAIL RL1(' || sqlerrm || ') ' end;
    if sqlerrm not like '%limit%' then nfail := nfail + 1; end if;
  end;
  reset role;

  -- ── No identity oracle (0744): helpers answer only for the caller ─────────
  -- the uid-taking bodies are not executable by a login…
  select count(*) into v_n from (values
      ('public.rh__can_see(uuid,uuid)'), ('public.rh__is_staff_on(uuid,uuid)'),
      ('public.rh__is_joiner(uuid,uuid)'), ('public.rh__is_team_member(uuid,uuid)'),
      ('public.rh__staff_row(uuid,uuid,uuid,uuid,uuid)')) s(sig)
   where has_function_privilege('authenticated', s.sig, 'execute')
      or has_function_privilege('anon', s.sig, 'execute');
  r := r || case when v_n = 0 then 'ok O1-internal-not-callable ' else 'FAIL O1(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  -- …the old public uid-taking signatures no longer exist…
  select count(*) into v_n from (values
      ('public.rh_can_see(uuid,uuid)'), ('public.rh_is_staff_on(uuid,uuid)'),
      ('public.rh_is_joiner(uuid,uuid)'), ('public.rh_is_team_member(uuid,uuid)'),
      ('public.rh_staff_row(uuid,uuid,uuid,uuid,uuid)')) s(sig)
   where to_regprocedure(s.sig) is not null;
  r := r || case when v_n = 0 then 'ok O2-uid-signatures-gone ' else 'FAIL O2(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  -- …and every public rh_*/lv_rh_* function a login can call takes no uid.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'rh\_%' or p.proname like 'lv\_rh\_%')
     and has_function_privilege('authenticated', p.oid, 'execute')
     -- `_` is a word character, so '\muid' would never match `p_uid`
     and pg_get_function_identity_arguments(p.oid) ~ '(^|[ ,])(p_)?uid uuid';
  r := r || case when v_n = 0 then 'ok O3-no-uid-arg-granted ' else 'FAIL O3(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  -- behaviour: a stranger asking about t1 learns only about themself
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh__can_see(t1, u_rep);
    r := r || 'FAIL O4 (stranger asked about the reporter) '; nfail := nfail + 1;
  exception when insufficient_privilege then r := r || 'ok O4-cannot-probe-other-uid ';
  end;
  r := r || case when not public.rh_can_see(t1) and not public.rh_is_joiner(t1)
                 then 'ok O5-self-only ' else 'FAIL O5 ' end;
  if public.rh_can_see(t1) or public.rh_is_joiner(t1) then nfail := nfail + 1; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || case when public.rh_can_see(t1) then 'ok O6-reporter-self ' else 'FAIL O6 ' end;
  if not public.rh_can_see(t1) then nfail := nfail + 1; end if;
  reset role;

  raise exception 'DRY RUN (rolled back) — % FAIL: %', nfail, r;
end
$smoke$;
