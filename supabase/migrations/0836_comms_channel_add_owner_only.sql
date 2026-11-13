-- ============================================================================
-- Raagam ERP — 0836 Channels: only the OWNER adds people
--
-- User 2026-11-12: "channel la member adding option only owner mattum than add
-- panna mudiyanum" (artifact "Channel Add — Owner Only", option B).
--
-- Before: a channel owner OR a moderator (role 'admin') could add people and
-- pull in a department's members. Now only the owner can. "Owner" keeps 0751's
-- meaning — the channel's owner, or a workspace governor on a PUBLIC channel —
-- so a workspace admin managing a public channel is unchanged.
--
-- Three places, all of them, so the button and the database agree:
--   * comm_channel_can('add_members')   — what the screen asks (abilities);
--   * comm_add_members                  — the RPC the Add people sheet calls;
--   * comm_sync_department_members      — "Add <department> members".
--
-- comm_can_manage is NOT narrowed: it also decides remove / rename / archive,
-- and GROUPS keep "owners or admins add people". Only the channel branch of
-- the two add RPCs reads the new rule. Communities (0775) add to groups, never
-- to channels, so they are out of scope.
-- ============================================================================

-- 1. The ability. Body is 0751's, with add_members narrowed to the owner.
create or replace function public.comm_channel_can(p_conv uuid, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me     uuid := auth.uid();
  c        public.comm_conversations%rowtype;
  v_role   text;
  v_owner  boolean;
begin
  if v_me is null then return false; end if;
  select * into c from public.comm_conversations where id = p_conv and kind = 'channel';
  if c.id is null then return false; end if;
  if public.comm_workspace_blocked(v_me) then return false; end if;

  select m.role into v_role from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = v_me and m.removed_at is null;
  -- '' = not a member. Never NULL: a NULL role would turn every OR below into
  -- NULL, which a caller reading "not true" might still treat as "not false".
  v_role := coalesce(v_role, '');

  v_owner := v_role = 'owner'
          or (c.visibility = 'public' and coalesce(public.comm_workspace_governs(v_me), false));

  return case p_action
    when 'edit_info'          then v_owner or v_role = 'admin'
    when 'rename'             then v_owner
    -- 0836: owner only (was owner or moderator).
    when 'add_members'        then v_owner and not c.is_archived
    when 'remove_members'     then v_owner or v_role = 'admin'
    when 'remove_privileged'  then v_owner
    when 'set_roles'          then v_owner
    when 'transfer'           then v_owner
    when 'archive'            then v_owner
    when 'join'               then v_role = '' and c.visibility = 'public' and not c.is_archived
    when 'leave'              then v_role <> ''
    when 'preferences'        then v_role <> ''
    else false
  end;
end $$;
revoke all on function public.comm_channel_can(uuid, text) from public, anon, authenticated;


-- 2. Add people. Body is 0737's; the manage check now splits by kind.
create or replace function public.comm_add_members(p_conv uuid, p_user_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.comm_actor();
  v_conv  public.comm_conversations%rowtype;
  v_users uuid[];
  n       integer;
begin
  select * into v_conv from public.comm_conversations where id = p_conv;
  if not found or v_conv.kind = 'direct' then
    raise exception 'People cannot be added to this conversation.' using errcode = '22023';
  end if;
  if v_conv.is_archived then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;
  if v_conv.kind = 'channel' then
    if not public.comm_channel_can(p_conv, 'add_members') then
      raise exception 'Only the channel owner can add people.' using errcode = '42501';
    end if;
  elsif not public.comm_can_manage(p_conv) then
    raise exception 'Only the owners or admins can add people.' using errcode = '42501';
  end if;

  v_users := public.comm_active_profiles(p_user_ids, null);
  if v_conv.kind = 'group' and (
       select count(*) from (
         select m.user_id from public.comm_members m
          where m.conversation_id = p_conv and m.removed_at is null
         union
         select u from unnest(v_users) u
       ) x) > 100 then
    raise exception 'A group can have at most 100 people. Use a channel instead.' using errcode = '22023';
  end if;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  select p_conv, u, 'member', v_me from unnest(v_users) u
  on conflict (conversation_id, user_id) do update
     set removed_at = null, removed_by = null, joined_at = clock_timestamp(),
         role = 'member', added_by = excluded.added_by
   where public.comm_members.removed_at is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.comm_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.comm_add_members(uuid, uuid[]) to authenticated;


-- 3. Add a department's members (channels only). Body is 0737's.
create or replace function public.comm_sync_department_members(p_conv uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_dept uuid;
  n      integer;
begin
  if not public.comm_channel_can(p_conv, 'add_members') then
    raise exception 'Only the channel owner can add people.' using errcode = '42501';
  end if;
  select c.department_id into v_dept
    from public.comm_conversations c where c.id = p_conv and c.kind = 'channel';
  if v_dept is null then
    raise exception 'This channel is not linked to a department.' using errcode = '22023';
  end if;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  select p_conv, l.profile_id, 'member', v_me
    from public.employee_login_ids(array(
           select s.id from public.staff s
            where s.department_id = v_dept
              and coalesce(s.is_active, true)
              and not coalesce(s.blocked, false))) l
  on conflict (conversation_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.comm_sync_department_members(uuid) from public, anon;
grant execute on function public.comm_sync_department_members(uuid) to authenticated;
