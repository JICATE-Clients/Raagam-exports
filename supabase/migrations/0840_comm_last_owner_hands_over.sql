-- Raagam ERP — 0840 Pulse: the last owner can leave; ownership passes on
--
-- User 2026-11-13 (screenshot 143620): leaving a channel or group as its only
-- owner raised "Make someone else an owner first." and nothing else — the
-- operator had no idea how, and the chat could not be left.
--
-- Now, WhatsApp's way: when the LAST owner LEAVES and other people are still
-- in the chat, ownership passes on automatically, in the same statement, so
-- the chat is never ownerless:
--   1. the longest-standing moderator / admin (role 'admin'), else
--   2. the longest-standing member,
-- skipping anyone the workspace has deactivated (they cannot be owners —
-- comm_set_member_role refuses the same).
--
-- Unchanged on purpose:
--   * Removing SOMEONE ELSE who is the last owner is still refused (only
--     another owner could try, and then they are not the last one anyway).
--   * Demoting yourself as the last owner (comm_set_member_role) is still
--     refused — that is a deliberate role change, not leaving.
--   * If nobody eligible remains (everyone else deactivated), the old
--     message stands rather than leaving the chat ownerless.
--
-- Body is 0751's comm_remove_member; only the "last owner" block changed.

create or replace function public.comm_remove_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_kind   text;
  v_target public.comm_members%rowtype;
  v_heir   uuid;
begin
  select c.kind into v_kind from public.comm_conversations c where c.id = p_conv;
  if v_kind is null or v_kind = 'direct' then
    raise exception 'Nobody can be removed from a direct message.' using errcode = '22023';
  end if;

  select * into v_target from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = p_user and m.removed_at is null
   for update;
  if not found then
    raise exception 'That person is not in this conversation.' using errcode = '22023';
  end if;

  if p_user <> v_me then
    if v_kind = 'channel' then
      if not public.comm_channel_can(p_conv, 'remove_members') then
        raise exception 'Only the channel''s owners and moderators can remove people.' using errcode = '42501';
      end if;
      if v_target.role in ('owner', 'admin') and not public.comm_channel_can(p_conv, 'remove_privileged') then
        raise exception 'Only an owner can remove an owner or moderator.' using errcode = '42501';
      end if;
    else
      if not public.comm_can_manage(p_conv) then
        raise exception 'Only the owners or admins can remove people.' using errcode = '42501';
      end if;
      if v_target.role in ('owner', 'admin')
         and not exists (select 1 from public.comm_members m
                          where m.conversation_id = p_conv and m.user_id = v_me
                            and m.removed_at is null and m.role = 'owner') then
        raise exception 'Only an owner can remove an owner or admin.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- The last owner, with others still in the chat.
  if v_target.role = 'owner'
     and not exists (select 1 from public.comm_members m
                      where m.conversation_id = p_conv and m.removed_at is null
                        and m.role = 'owner' and m.user_id <> p_user)
     and exists (select 1 from public.comm_members m
                  where m.conversation_id = p_conv and m.removed_at is null
                    and m.user_id <> p_user) then
    -- 0840: leaving yourself hands the chat on; removing someone else does not.
    if p_user = v_me then
      select m.user_id into v_heir
        from public.comm_members m
       where m.conversation_id = p_conv and m.removed_at is null
         and m.user_id <> p_user
         and not public.comm_workspace_blocked(m.user_id)
       order by (m.role = 'admin') desc, m.joined_at, m.id
       limit 1;
    end if;
    if v_heir is null then
      raise exception 'Make someone else an owner first.' using errcode = '55000';
    end if;
    update public.comm_members set role = 'owner'
     where conversation_id = p_conv and user_id = v_heir and removed_at is null;
  end if;

  update public.comm_members
     set removed_at = clock_timestamp(), removed_by = v_me
   where id = v_target.id;
end $$;
revoke all on function public.comm_remove_member(uuid, uuid) from public, anon;
grant execute on function public.comm_remove_member(uuid, uuid) to authenticated;
