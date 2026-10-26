-- ============================================================================
-- Raagam ERP — 0749 Communication Hub: channel creation reads departments.inactive
--
-- FOUND BY THE LIVE END-TO-END RUN (2026-10-26), not by the scratch tests.
-- 0737's `comm_create_channel` checked `departments.blocked`, the name 0259
-- created — but 0299_masters_blocked_to_inactive.sql renamed that column to
-- `inactive`. PL/pgSQL resolves columns when the statement first runs, not
-- when the function is created, so 0737 applied cleanly and every channel
-- create then failed with `column d.blocked does not exist` — even with no
-- department chosen, because the whole IF expression is planned at once.
--
-- The scratch database the smoke test runs on was stubbed from 0259's shape,
-- which is why it passed there. The live database is the one that counts.
--
-- Replaces exactly one function, same signature, same grants; nothing else in
-- 0737 reads a departments flag (comm_sync_department_members reads
-- staff.blocked, which does exist — 0534).
-- ============================================================================

create or replace function public.comm_create_channel(
  p_name text, p_visibility text, p_topic text default null,
  p_department_id uuid default null, p_member_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_topic  text := nullif(btrim(coalesce(p_topic, '')), '');
  v_others uuid[];
  v_id     uuid;
begin
  if not public.has_permission('communication', 'create') then
    raise exception 'You do not have permission to create channels.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'A channel needs a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the channel name to 80 characters.' using errcode = '22023';
  end if;
  if coalesce(p_visibility, '') not in ('public', 'private') then
    raise exception 'Choose whether the channel is public or private.' using errcode = '22023';
  end if;
  -- A switched-off department is not offered (AGENTS.md "Disabled rows").
  if p_department_id is not null and not exists (
       select 1 from public.departments d where d.id = p_department_id and not coalesce(d.inactive, false)) then
    raise exception 'That department is not available.' using errcode = '22023';
  end if;

  begin
    insert into public.comm_conversations (kind, name, topic, visibility, department_id, created_by)
    values ('channel', v_name, v_topic, p_visibility, p_department_id, v_me)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A channel named "%" already exists.', v_name using errcode = '23505';
  end;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'owner', v_me);

  v_others := public.comm_active_profiles(p_member_ids, v_me);
  insert into public.comm_members (conversation_id, user_id, role, added_by)
  select v_id, u, 'member', v_me from unnest(v_others) u
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end $$;
revoke all on function public.comm_create_channel(text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.comm_create_channel(text, text, text, uuid, uuid[]) to authenticated;


do $assert$
begin
  -- The column this fix exists for is really there…
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'departments' and column_name = 'inactive') then
    raise exception '0749: public.departments.inactive does not exist — check 0299 before applying';
  end if;
  -- …and the function no longer names the one that is not.
  if pg_get_functiondef('public.comm_create_channel(text,text,text,uuid,uuid[])'::regprocedure) like '%d.blocked%' then
    raise exception '0749: comm_create_channel still reads departments.blocked';
  end if;
  if has_function_privilege('anon', 'public.comm_create_channel(text,text,text,uuid,uuid[])'::regprocedure, 'EXECUTE') then
    raise exception '0749: comm_create_channel is executable by anon';
  end if;
end $assert$;
