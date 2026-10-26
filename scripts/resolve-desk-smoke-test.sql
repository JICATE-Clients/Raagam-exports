-- ============================================================================
-- Resolve Hub — Service Desk smoke test (0749 · 0750)
-- ============================================================================
--
-- Same shape as scripts/resolve-smoke-test.sql: ONE DO block that ALWAYS ends
-- in `raise exception`, so every fixture and ticket is rolled back. Read the
-- result from the message:
--
--     DESK DRY RUN (rolled back) — 0 FAIL: ok D1 … ok D40 …
--
-- Impersonates real NON-super-admin logins through `request.jwt.claims` AND
-- `set local role authenticated`, so grants and RLS are exercised. Setup and
-- the sweep run as the migration owner (`reset role`).
--   rep    + MERCHANDISING    (view only — the requester)
--   worker + Supervisor       (resolve:edit, member of IT SERVICE DESK)
--   lead   + Supervisor       (resolve:edit, team lead → routed owner)
--   triage + Factory Manager  (edit, approve, export — the desk manager)
-- ============================================================================

do $smoke$
declare
  u_rep    uuid := (select id from public.profiles where lower(email) = 'sripriyas@jkkn.ac.in');
  u_worker uuid := (select id from public.profiles where lower(email) = 'dhanushyogesh36@gmail.com');
  u_lead   uuid := (select id from public.profiles where lower(email) = 'vikas78arun@gmail.com');
  u_triage uuid := (select id from public.profiles where lower(email) = 'ramkumarramya1974@gmail.com');
  v_ho     uuid := (select id from public.locations where code = 'HO');
  r        text := '';
  nfail    int  := 0;
  v_team   uuid;
  c_hw     uuid;
  c_acc    uuid;
  c_net    uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid;
  v_out    jsonb;
  v_arr    text[];
  v_n      int;
  v_txt    text;
  v_ts     timestamptz;
  v_ts2    timestamptz;
  v_kb     uuid;
  v_ok     boolean;
  v_kind   text;
begin
  if u_rep is null or u_worker is null or u_lead is null or u_triage is null or v_ho is null then
    raise exception 'DESK SMOKE SKIPPED — a fixture login or the HO unit is missing';
  end if;

  -- ── Setup (as owner) ──────────────────────────────────────────────────────
  update public.profiles set is_super_admin = false, is_active = true, current_location_id = v_ho
   where id in (u_rep, u_worker, u_lead, u_triage);
  insert into public.user_access (user_email, is_active, all_locations)
  select lower(btrim(p.email)), true, true from public.profiles p where p.id in (u_rep, u_worker, u_lead, u_triage)
  on conflict (user_email) do update set is_active = true, all_locations = true;
  insert into public.user_roles (user_id, role_id)
  select x.uid, ro.id from (values (u_worker, 'Supervisor'), (u_lead, 'Supervisor'),
                                   (u_triage, 'Factory Manager'), (u_rep, 'MERCHANDISING')) x(uid, rn)
    join public.roles ro on ro.name = x.rn
   where not exists (select 1 from public.user_roles ur where ur.user_id = x.uid and ur.role_id = ro.id);
  perform public.rh_settings(v_ho);
  update public.rh_unit_settings
     set desk_manager_id = u_triage, report_limit_24h = 10, suppress_notifications = false,
         sd_auto_close_days = 3, sd_stale_remind_days = 3, sd_stale_escalate_days = 4, sd_reopen_days = 7
   where location_id = v_ho;
  select id into v_team from public.rh_teams where location_id = v_ho and name = 'IT SERVICE DESK';
  update public.rh_teams set lead_id = u_lead, inactive = false where id = v_team;
  delete from public.rh_team_members where team_id = v_team;
  insert into public.rh_team_members (team_id, profile_id, created_at) values (v_team, u_worker, now() - interval '1 minute');
  insert into public.rh_team_members (team_id, profile_id) values (v_team, u_lead);
  select id into c_hw  from public.rh_sd_categories where location_id = v_ho and code = 'HW';
  select id into c_acc from public.rh_sd_categories where location_id = v_ho and code = 'ACC';
  select id into c_net from public.rh_sd_categories where location_id = v_ho and code = 'NET';
  update public.rh_sd_categories set team_id = v_team, inactive = false where id in (c_hw, c_acc, c_net);
  delete from public.rh_report_ledger where profile_id = u_rep;

  -- ── Requester ─────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.rh_sd_categories_open();
  r := r || case when v_n >= 10 then 'ok D1-categories ' else 'FAIL D1(' || v_n || ') ' end;
  if v_n < 10 then nfail := nfail + 1; end if;

  begin
    perform public.rh_sd_submit(c_hw, 'MONITOR DEAD', 'NO DISPLAY', 'very bad');
    r := r || 'FAIL D2-impact-accepted '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D2-impact-refused ';
  end;

  v_out := public.rh_sd_submit(c_hw, 'MONITOR DEAD', 'NO DISPLAY SINCE MORNING', 'degraded');
  t1 := (v_out ->> 'ticket_id')::uuid;
  v_ok := v_out ->> 'ref_no' like 'SD-____-______' and v_out ->> 'priority' = 'medium';
  r := r || case when v_ok then 'ok D3-submit ' else 'FAIL D3(' || v_out::text || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;

  -- request: category floor (HW medium) beats impact 'request' (low)
  v_out := public.rh_sd_submit(c_hw, 'KEYBOARD', 'A KEY STICKS', 'request');
  t4 := (v_out ->> 'ticket_id')::uuid;
  r := r || case when v_out ->> 'priority' = 'medium' then 'ok D4-floor ' else 'FAIL D4(' || (v_out ->> 'priority') || ') ' end;
  if v_out ->> 'priority' <> 'medium' then nfail := nfail + 1; end if;

  v_arr := public.rh_ticket_actions(t1);
  v_ok := 'sd_withdraw' = any (v_arr) and not ('sd_claim' = any (v_arr)) and not ('note_internal' = any (v_arr));
  r := r || case when v_ok then 'ok D5-reporter-actions ' else 'FAIL D5(' || array_to_string(v_arr, ',') || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;

  begin
    perform public.rh_sd_claim(t1);
    r := r || 'FAIL D6-reporter-claimed '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D6-reporter-cannot-claim ';
  end;
  begin
    perform * from public.rh_sd_queue('all');
    r := r || 'FAIL D7-reporter-read-queue '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D7-queue-guarded ';
  end;
  begin
    perform public.rh_sd_submit(c_hw, 'X', 'Y', 'request', null, 'phone', u_worker);
    r := r || 'FAIL D8-reporter-on-behalf '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D8-on-behalf-guarded ';
  end;
  begin
    perform public.rh_kb_save(null, 'T', 'P', array['S']);
    r := r || 'FAIL D9-reporter-wrote-kb '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D9-kb-write-guarded ';
  end;
  begin
    update public.rh_tickets set priority = 'urgent' where id = t1;
    get diagnostics v_n = row_count;
    r := r || case when v_n = 0 then 'ok D10-no-direct-write ' else 'FAIL D10 ' end;
    if v_n <> 0 then nfail := nfail + 1; end if;
  exception when insufficient_privilege then r := r || 'ok D10-no-direct-write ';
  end;

  -- ── Technician ────────────────────────────────────────────────────────────
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select owner_id, first_response_at into v_txt, v_ts from public.rh_tickets where id = t1;
  r := r || case when v_txt::uuid = u_lead and v_ts is null then 'ok D11-routed-lead ' else 'FAIL D11 ' end;
  if v_txt::uuid is distinct from u_lead then nfail := nfail + 1; end if;

  select count(*) into v_n from public.rh_sd_queue('unassigned') q where q.id = t1;
  r := r || case when v_n = 1 then 'ok D12-unassigned-tab ' else 'FAIL D12 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  perform public.rh_sd_claim(t1);
  select status, first_response_at into v_txt, v_ts from public.rh_tickets where id = t1;
  r := r || case when v_txt = 'assigned' and v_ts is not null then 'ok D13-claim-acks ' else 'FAIL D13(' || v_txt || ') ' end;
  if v_txt <> 'assigned' or v_ts is null then nfail := nfail + 1; end if;

  select count(*) into v_n from public.rh_sd_queue('mine') q where q.id = t1;
  r := r || case when v_n = 1 then 'ok D14-mine-tab ' else 'FAIL D14 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  v_out := public.rh_sd_shift_summary();
  r := r || case when v_out ? 'carried_over' and v_out ? 'since' then 'ok D15-shift ' else 'FAIL D15 ' end;
  if not (v_out ? 'carried_over' and v_out ? 'since') then nfail := nfail + 1; end if;

  perform public.rh_sd_start(t1);
  perform public.rh_sd_hold(t1, 'WAITING FOR A SPARE CABLE');
  select due_at into v_ts from public.rh_tickets where id = t1;
  reset role;
  update public.rh_tickets set paused_at = now() - interval '30 minutes' where id = t1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_sd_resume(t1);
  select due_at into v_ts2 from public.rh_tickets where id = t1;
  v_ok := v_ts2 - v_ts between interval '29 minutes' and interval '31 minutes';
  r := r || case when v_ok then 'ok D16-hold-shifts-due ' else 'FAIL D16(' || (v_ts2 - v_ts)::text || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;

  -- a requester-visible reply → 'replied' activity + outbox row for the requester
  perform public.rh_add_note(t1, 'CABLE ARRIVED, FITTING IT NOW', 'reporter');
  reset role;
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t1 and a.action = 'replied' and o.recipient_id = u_rep and o.event_key = 'resolve.sd_reply';
  r := r || case when v_n = 1 then 'ok D17-reply-notifies ' else 'FAIL D17(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.rh_sd_resolve(t1, 'SHORT', 'ALSO SHORT');
    r := r || 'FAIL D18-short-resolve '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D18-logging-mandatory ';
  end;
  v_out := public.rh_sd_resolve(t1, 'VGA CABLE WORN THROUGH AT THE PLUG', 'REPLACED THE VGA CABLE AND TESTED THE DISPLAY');
  r := r || case when v_out ->> 'status' = 'resolved' then 'ok D19-resolved ' else 'FAIL D19 ' end;

  -- ── Requester closes the loop ─────────────────────────────────────────────
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_arr := public.rh_ticket_actions(t1);
  v_ok := 'sd_confirm' = any (v_arr) and 'sd_reopen' = any (v_arr);
  r := r || case when v_ok then 'ok D20-confirm-or-reopen ' else 'FAIL D20(' || array_to_string(v_arr, ',') || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;
  perform public.rh_sd_reopen(t1, 'SCREEN FLICKERS AGAIN');
  select status, fix_round into v_txt, v_n from public.rh_tickets where id = t1;
  r := r || case when v_txt = 'in_progress' and v_n = 2 then 'ok D21-reopen ' else 'FAIL D21(' || v_txt || ') ' end;
  if v_txt <> 'in_progress' or v_n <> 2 then nfail := nfail + 1; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_sd_resolve(t1, 'LOOSE POWER CONNECTOR ON THE MONITOR', 'RESEATED AND TIED THE POWER CONNECTOR');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_sd_confirm(t1);
  perform public.rh_rate(t1, 5, 'QUICK');
  select status, closure_kind into v_txt, v_kind from public.rh_tickets where id = t1;
  r := r || case when v_txt = 'closed' and v_kind = 'requester_confirmed' then 'ok D22-confirmed+rated '
                 else 'FAIL D22(' || v_txt || ') ' end;
  if v_txt <> 'closed' then nfail := nfail + 1; end if;

  -- ── Override, preemption, FIFO ────────────────────────────────────────────
  v_out := public.rh_sd_submit(c_net, 'PAYROLL SERVER UNREACHABLE', 'SALARY RUN BLOCKED', 'cannot_work');
  t2 := (v_out ->> 'ticket_id')::uuid;
  v_out := public.rh_sd_submit(c_acc, 'NEW EMAIL FOR NEW JOINER', 'START MONDAY', 'request');
  t3 := (v_out ->> 'ticket_id')::uuid;
  begin
    perform public.rh_sd_override(t2, 'financial_risk', 'SALARY');
    r := r || 'FAIL D23-reporter-override '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D23-override-guarded ';
  end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_sd_assign(t3, u_worker);
  perform public.rh_sd_assign(t2, u_worker);
  begin
    perform public.rh_sd_reclassify(t2, null, null, 'urgent');
    r := r || 'FAIL D24-urgent-by-reclassify '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D24-urgent-only-by-override ';
  end;
  perform public.rh_sd_override(t2, 'financial_risk', 'SALARY RUN FOR 400 WORKERS IS BLOCKED');
  select q.id into v_txt from public.rh_sd_queue('all') q limit 1;
  r := r || case when v_txt::uuid = t2 then 'ok D25-override-jumps-queue ' else 'FAIL D25 ' end;
  if v_txt::uuid is distinct from t2 then nfail := nfail + 1; end if;
  select first_response_at into v_ts from public.rh_tickets where id = t2;
  r := r || case when v_ts is null then 'ok D26-assign-is-not-ack ' else 'FAIL D26 ' end;
  if v_ts is not null then nfail := nfail + 1; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_sd_start(t3);
  begin
    perform public.rh_sd_start(t2, t3, '');
    r := r || 'FAIL D27-pause-without-message '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok D27-pause-needs-message ';
  end;
  perform public.rh_sd_start(t2, t3, 'HELLO — I HAVE HAD TO PAUSE YOUR REQUEST BRIEFLY FOR AN URGENT ISSUE.');
  select status into v_txt from public.rh_tickets where id = t3;
  select count(*) into v_n from public.rh_tickets where id = t3 and preempted_by = t2 and paused_at is not null;
  r := r || case when v_txt = 'on_hold' and v_n = 1 then 'ok D28-preempted ' else 'FAIL D28(' || v_txt || ') ' end;
  if v_txt <> 'on_hold' or v_n <> 1 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_ticket_notes where ticket_id = t3 and visibility = 'reporter';
  r := r || case when v_n = 1 then 'ok D29-courtesy-note ' else 'FAIL D29(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  select count(*) into v_n from public.rh_ticket_activity where ticket_id = t3 and action = 'replied';
  r := r || case when v_n = 0 then 'ok D30-quiet-note ' else 'FAIL D30(' || v_n || ') ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.rh_sd_resolve(t2, 'STORAGE ON THE PAYROLL SERVER FULL', 'CLEARED OLD BACKUPS AND RESTARTED THE SERVICE');
  r := r || case when (v_out -> 'preempted' -> 0 ->> 'id')::uuid = t3 then 'ok D31-resume-hint ' else 'FAIL D31(' || v_out::text || ') ' end;
  if (v_out -> 'preempted' -> 0 ->> 'id')::uuid is distinct from t3 then nfail := nfail + 1; end if;
  perform public.rh_sd_resume(t3);

  -- ── Log a call on behalf (no rate-limit ledger) ───────────────────────────
  v_out := public.rh_sd_submit(c_acc, 'PASSWORD RESET', 'CALLED IN FROM STORES', 'cannot_work', null, 'phone', u_rep);
  t5 := (v_out ->> 'ticket_id')::uuid;
  select count(*) into v_n from public.rh_tickets where id = t5 and reporter_id = u_rep and created_by = u_worker and source = 'phone';
  r := r || case when v_n = 1 then 'ok D32-on-behalf ' else 'FAIL D32 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  select count(*) into v_n from public.rh_report_ledger where ticket_id = t5;
  r := r || case when v_n = 0 then 'ok D33-no-ledger-for-desk ' else 'FAIL D33 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;

  -- ── Knowledge base ────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_kb := public.rh_kb_save(null, 'MONITOR SHOWS NO DISPLAY', 'THE SCREEN STAYS BLACK BUT THE PC RUNS',
                            array['CHECK THE POWER CONNECTOR', '', 'RESEAT THE VGA CABLE'], array['monitor', 'display'],
                            'HW', t1);
  select count(*) into v_n from public.rh_kb_articles where id = v_kb and status = 'draft' and cardinality(steps) = 2;
  r := r || case when v_n = 1 then 'ok D34-kb-draft ' else 'FAIL D34 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_kb_search('monitor display') s where s.id = v_kb;
  r := r || case when v_n = 0 then 'ok D35-draft-hidden ' else 'FAIL D35 ' end;
  if v_n <> 0 then nfail := nfail + 1; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_worker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rh_kb_publish(v_kb);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.rh_kb_search('monitor display', 'HW') s where s.id = v_kb;
  r := r || case when v_n = 1 then 'ok D36-kb-found ' else 'FAIL D36 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  perform public.rh_kb_feedback(v_kb, true);
  perform public.rh_kb_feedback(v_kb, true);
  perform public.rh_kb_feedback(v_kb, false);
  select helpful_count || '/' || not_helpful_count into v_txt from public.rh_kb_articles where id = v_kb;
  r := r || case when v_txt = '0/1' then 'ok D37-one-vote ' else 'FAIL D37(' || v_txt || ') ' end;
  if v_txt <> '0/1' then nfail := nfail + 1; end if;

  -- ── Sweep (as owner) ──────────────────────────────────────────────────────
  reset role;
  update public.rh_tickets set response_due_at = now() - interval '1 minute', created_at = now() - interval '2 hours',
                               due_at = now() - interval '1 minute'
   where id = t4;
  v_out := public.rh_sd_sweep();
  v_ok := (v_out ->> 'response_breached')::int >= 1 and (v_out ->> 'resolution_breached')::int >= 1;
  r := r || case when v_ok then 'ok D38-breach ' else 'FAIL D38(' || v_out::text || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox o join public.rh_ticket_activity a on a.id = o.activity_id
   where a.ticket_id = t4 and o.event_key = 'resolve.sd_breach' and o.recipient_id = u_triage;
  r := r || case when v_n >= 1 then 'ok D39-breach-to-desk-manager ' else 'FAIL D39 ' end;
  if v_n < 1 then nfail := nfail + 1; end if;
  select last_activity_at into v_ts from public.rh_tickets where id = t4;
  update public.rh_tickets set last_activity_at = now() - interval '5 days' where id = t4;
  update public.rh_tickets set resolved_at = now() - interval '4 days' where id = t2;
  v_out := public.rh_sd_sweep();
  v_ok := (v_out ->> 'response_breached')::int = 0 and (v_out ->> 'stale_escalated')::int >= 1
          and (v_out ->> 'auto_closed')::int >= 1;
  r := r || case when v_ok then 'ok D40-idempotent+stale+autoclose ' else 'FAIL D40(' || v_out::text || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_tickets where id = t4 and last_activity_at < now() - interval '4 days';
  r := r || case when v_n = 1 then 'ok D41-system-rows-dont-reset-stale ' else 'FAIL D41 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select closure_kind into v_txt from public.rh_tickets where id = t2;
  r := r || case when v_txt = 'auto_timeout' then 'ok D42-auto-timeout ' else 'FAIL D42(' || coalesce(v_txt, '-') || ') ' end;
  if v_txt is distinct from 'auto_timeout' then nfail := nfail + 1; end if;

  -- ── Boards (as the desk manager) ──────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_triage, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.rh_sd_dashboard();
  v_ok := (v_out ->> 'open')::int >= 1 and jsonb_array_length(v_out -> 'trend' -> 'daily') = 14
          and jsonb_array_length(v_out -> 'escalation_list') >= 1;
  r := r || case when v_ok then 'ok D43-dashboard ' else 'FAIL D43 ' end;
  if not v_ok then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_sd_performance(current_date - 7, current_date + 1) p
   where p.name = 'DESK TOTAL' and p.resolved >= 2;
  r := r || case when v_n = 1 then 'ok D44-performance ' else 'FAIL D44 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  reset role;

  raise exception 'DESK DRY RUN (rolled back) — % FAIL: %', nfail, r;
end;
$smoke$;
