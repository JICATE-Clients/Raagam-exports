-- ============================================================================
-- Raagam Assist — smoke test (0751: catalog, tap-first wrappers, requirements)
-- ============================================================================
-- ONE DO block that ALWAYS ends in `raise exception`, so everything is rolled
-- back. Read: "ASSIST DRY RUN (rolled back) — 0 FAIL: ok A1 … ok A15".
-- Impersonates real non-super-admin logins (request.jwt.claims + set local
-- role authenticated); setup and read-backs that must see past RLS run as the
-- owner (`reset role`) — an anonymous complaint is INVISIBLE to its own
-- author, which is the point (A5 checked that by mistake on 2026-10-26).
-- ============================================================================

do $smoke$
declare
  u_rep    uuid := (select id from public.profiles where lower(email) = 'sripriyas@jkkn.ac.in');
  u_worker uuid := (select id from public.profiles where lower(email) = 'dhanushyogesh36@gmail.com');
  u_lead   uuid := (select id from public.profiles where lower(email) = 'vikas78arun@gmail.com');
  u_triage uuid := (select id from public.profiles where lower(email) = 'ramkumarramya1974@gmail.com');
  u_store  uuid := (select id from public.profiles where lower(email) = 'chandrasekar1212@gmail.com');
  v_ho     uuid := (select id from public.locations where code = 'HO');
  r text := ''; nfail int := 0;
  v_out jsonb; v_arr text[]; v_n int; v_seen int; v_txt text; v_ok boolean;
  t1 uuid; t3 uuid; t4 uuid; v_ref text;
  i_needle uuid := (select id from public.rh_catalog_items where code = 'F-SEW-NEEDLE');
  i_spark  uuid := (select id from public.rh_catalog_items where code = 'F-ELE-SPARK');
  i_print  uuid := (select id from public.rh_catalog_items where code = 'I-PRN-NOPRT');
  i_shout  uuid := (select id from public.rh_catalog_items where code = 'C-BEH-SHOUT');
  i_oil    uuid := (select id from public.rh_catalog_items where code = 'B-PRD-OIL');
  v_used0 int;
begin
  if u_rep is null or u_store is null or v_ho is null or i_needle is null then
    raise exception 'ASSIST SMOKE SKIPPED — a fixture login, the HO unit or the 0751 seed is missing';
  end if;

  -- ── Setup (as owner) ──────────────────────────────────────────────────────
  update public.profiles set is_super_admin = false, is_active = true, current_location_id = v_ho
   where id in (u_rep, u_worker, u_lead, u_triage, u_store);
  insert into public.user_access (user_email, is_active, all_locations)
  select lower(btrim(p.email)), true, true from public.profiles p
   where p.id in (u_rep, u_worker, u_lead, u_triage, u_store)
  on conflict (user_email) do update set is_active = true, all_locations = true;
  insert into public.user_roles (user_id, role_id)
  select x.uid, ro.id from (values (u_worker, 'Supervisor'), (u_lead, 'Supervisor'), (u_triage, 'Factory Manager'),
                                   (u_rep, 'MERCHANDISING'), (u_store, 'MERCHANDISING')) x(uid, rn)
    join public.roles ro on ro.name = x.rn
   where not exists (select 1 from public.user_roles ur where ur.user_id = x.uid and ur.role_id = ro.id);
  perform public.rh_settings(v_ho);
  update public.rh_unit_settings set requirement_owner_id = u_store, unit_head_id = u_triage,
         report_limit_24h = 20, suppress_notifications = false where location_id = v_ho;
  update public.rh_teams set lead_id = u_lead where location_id = v_ho and name = 'IT SERVICE DESK';
  update public.rh_complaint_categories set handler_id = u_triage where location_id = v_ho and code = 'HAR';
  delete from public.rh_report_ledger where profile_id = u_rep;
  select used_count into v_used0 from public.rh_catalog_items where id = i_needle;

  -- ── Reporter ──────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_out := public.rh_assist_catalog();
  v_ok := jsonb_array_length(v_out) = 24;
  r := r || case when v_ok then 'ok A1-catalog ' else 'FAIL A1(' || jsonb_array_length(v_out) || ') ' end;
  if not v_ok then nfail := nfail + 1; end if;

  v_out := public.rh_assist_broken(i_needle, null, null, 'LINE 3 MACHINE 12', false);
  t1 := (v_out ->> 'ticket_id')::uuid;
  select count(*) into v_n from public.rh_tickets t join public.rh_trades tr on tr.id = t.trade_id
   where t.id = t1 and tr.code = 'MECH' and t.title = 'NEEDLE BREAKING' and t.catalog_item_id = i_needle
     and not t.is_dangerous;
  r := r || case when v_n = 1 then 'ok A2-broken-routed-MECH ' else 'FAIL A2 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  v_out := public.rh_assist_broken(i_spark, null, null, 'NEAR CUTTING TABLE', false);
  select count(*) into v_n from public.rh_tickets where id = (v_out ->> 'ticket_id')::uuid and is_dangerous and priority = 'urgent';
  r := r || case when v_n = 1 then 'ok A3-item-dangerous-forces-urgent ' else 'FAIL A3 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  v_out := public.rh_assist_service(i_print, null, 'SHOWS OFFLINE', 'degraded');
  select count(*) into v_n from public.rh_tickets t join public.rh_sd_categories c on c.id = t.sd_category_id
   where t.id = (v_out ->> 'ticket_id')::uuid and c.code = 'PRN' and t.title = 'NOT PRINTING' and t.catalog_item_id = i_print;
  r := r || case when v_n = 1 then 'ok A4-it-routed-PRN ' else 'FAIL A4 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  v_out := public.rh_assist_complaint(i_shout, null, 'KEEPS HAPPENING', true, false);
  v_ref := v_out ->> 'ref_no';
  v_ok := v_out ->> 'ticket_id' is null and v_out ->> 'tracking_token' is not null;
  select count(*) into v_seen from public.rh_tickets where ref_no = v_ref;   -- the author, through RLS

  begin
    perform public.rh_assist_broken(i_print, null, null, null, false);
    r := r || 'FAIL A6-wrong-lane-accepted '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok A6-lane-checked ';
  end;

  v_out := public.rh_assist_requirement(i_oil, null, 'FOR LINE 3', 5, 'week', 'ran_out');
  t3 := (v_out ->> 'ticket_id')::uuid;
  select count(*) into v_n from public.rh_tickets where id = t3 and kind = 'requirement' and ref_no like 'REQ-____-______'
     and owner_id = u_store and rq_qty = 5 and title = 'MACHINE OIL' and catalog_item_id = i_oil;
  r := r || case when v_n = 1 then 'ok A7-requirement-to-stores ' else 'FAIL A7 ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  v_arr := public.rh_ticket_actions(t3);
  v_ok := v_ok and true;
  r := r || case when 'rq_withdraw' = any (v_arr) and not ('rq_approve' = any (v_arr)) then 'ok A8-reporter-actions '
                 else 'FAIL A8(' || array_to_string(v_arr, ',') || ') ' end;
  if not ('rq_withdraw' = any (v_arr) and not ('rq_approve' = any (v_arr))) then nfail := nfail + 1; end if;
  begin
    perform public.rh_rq_decide(t3, true, null);
    r := r || 'FAIL A9-reporter-approved '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok A9-approve-guarded ';
  end;
  v_out := public.rh_assist_requirement(i_oil, null, null, 1, 'today', 'other');
  t4 := (v_out ->> 'ticket_id')::uuid;

  reset role;
  select count(*) into v_n from public.rh_tickets where ref_no = v_ref and catalog_item_id = i_shout
     and reporter_id is null and created_by is null and is_anonymous;
  r := r || case when v_ok and v_n = 1 and v_seen = 0 then 'ok A5-anon-stamped-no-name-author-blind '
                 else 'FAIL A5(' || v_n || '/' || v_seen || ') ' end;
  if not (v_ok and v_n = 1 and v_seen = 0) then nfail := nfail + 1; end if;

  -- ── Stores ────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_store, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.rh_rq_decide(t4, false, '');
    r := r || 'FAIL A10-reject-without-reason '; nfail := nfail + 1;
  exception when sqlstate 'P0001' then r := r || 'ok A10-reject-needs-reason ';
  end;
  perform public.rh_rq_decide(t4, false, 'STOCK AVAILABLE IN STORES');
  perform public.rh_rq_decide(t3, true, null);
  perform public.rh_rq_fulfil(t3, 'ISSUED 5 BOTTLES');
  select status into v_txt from public.rh_tickets where id = t3;
  r := r || case when v_txt = 'fulfilled' then 'ok A11-approve-fulfil ' else 'FAIL A11(' || v_txt || ') ' end;
  if v_txt <> 'fulfilled' then nfail := nfail + 1; end if;

  reset role;
  select count(*) into v_n from public.rh_outbox where ticket_id in (t3, t4) and event_key = 'resolve.rq_update' and recipient_id = u_rep;
  r := r || case when v_n = 3 then 'ok A12-rq-alerts-to-requester ' else 'FAIL A12(' || v_n || ') ' end;
  if v_n <> 3 then nfail := nfail + 1; end if;
  select count(*) into v_n from public.rh_outbox where ticket_id = t3 and event_key = 'resolve.ticket_routed' and recipient_id = u_store;
  r := r || case when v_n = 1 then 'ok A13-new-req-to-stores ' else 'FAIL A13(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;
  select used_count - v_used0 into v_n from public.rh_catalog_items where id = i_needle;
  r := r || case when v_n = 1 then 'ok A14-used-count ' else 'FAIL A14(' || v_n || ') ' end;
  if v_n <> 1 then nfail := nfail + 1; end if;

  -- A login with no Resolve access is offered nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.rh_assist_catalog();
  r := r || case when jsonb_array_length(v_out) = 0 then 'ok A15-no-access-empty ' else 'FAIL A15 ' end;
  if jsonb_array_length(v_out) <> 0 then nfail := nfail + 1; end if;
  reset role;

  raise exception 'ASSIST DRY RUN (rolled back) — % FAIL: %', nfail, r;
end;
$smoke$;
