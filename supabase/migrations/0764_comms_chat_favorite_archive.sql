-- ============================================================================
-- Raagam ERP — 0764 Communication Hub: Pulse as WhatsApp's chat list
--
-- User 2026-10-29: "I want the interface to work just like WhatsApp" — a
-- search bar, All / Unread / Favourites / Groups, and an Archived section on
-- the main chat screen. Two things the database did not have:
--
-- 1. FAVOURITE and ARCHIVED, per PERSON. They live on comm_members — the
--    caller's own membership row, the same place 0751's pinned_at and
--    notify_level live — never on comm_conversations, whose is_archived is the
--    CHANNEL's archive (an admin closing it for everyone). Archiving a chat in
--    Pulse hides it from that one person's list and from nobody else's.
--    As in WhatsApp, an archived chat STAYS archived when a new message
--    arrives; it comes back only when the person unarchives it.
--
-- 2. THE LAST MESSAGE, so each row can show its preview and sender like
--    WhatsApp. Read through comm_can_read_at(), the same gate every message
--    read goes through, so a person removed from a group sees no message sent
--    after they left. A deleted message previews as deleted, never its text.
--
-- comm_my_conversations changes its return type, so it is DROPPED and
-- re-created — starting from 0750's body, whose workspace clause 0750's own
-- assertion (f) requires, and which this file re-asserts.
--
-- ROLLBACK: re-run 0750's comm_my_conversations after
--   drop function public.comm_my_conversations(text);
--   drop function public.comm_set_chat_flags(uuid, boolean, boolean);
--   alter table public.comm_members drop column favorite_at, drop column archived_at;
-- ============================================================================

alter table public.comm_members
  add column if not exists favorite_at timestamptz,
  add column if not exists archived_at timestamptz;

drop function if exists public.comm_my_conversations(text);
create function public.comm_my_conversations(p_kind text default null)
returns table (
  id uuid, kind text, name text, topic text, visibility text, department_id uuid,
  is_archived boolean, last_message_at timestamptz, created_at timestamptz,
  my_role text, muted boolean, last_read_at timestamptz,
  unread_count integer, mention_count integer,
  other_user_id uuid, member_count integer,
  favorite boolean, archived boolean,
  last_body text, last_author_id uuid, last_deleted boolean, last_has_file boolean
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.name, c.topic, c.visibility, c.department_id,
         c.is_archived, c.last_message_at, c.created_at,
         m.role, m.muted, m.last_read_at,
         (select count(*)::int from public.comm_messages g
           where g.conversation_id = c.id and g.parent_id is null and g.deleted_at is null
             and g.author_id is distinct from m.user_id
             and g.created_at > coalesce(m.last_read_at, m.joined_at)),
         (select count(*)::int from public.comm_mentions x
            join public.comm_messages g on g.id = x.message_id
           where x.user_id = m.user_id and g.conversation_id = c.id and g.deleted_at is null
             and g.created_at > coalesce(m.last_read_at, m.joined_at)),
         case when c.kind = 'direct' then
           (select o.user_id from public.comm_members o
             where o.conversation_id = c.id and o.user_id <> m.user_id limit 1)
         end,
         (select count(*)::int from public.comm_members o
           where o.conversation_id = c.id and o.removed_at is null),
         m.favorite_at is not null,
         m.archived_at is not null,
         case when lm.deleted_at is null then left(lm.body, 200) end,
         lm.author_id,
         coalesce(lm.deleted_at is not null, false),
         coalesce(lm.has_file, false)
    from public.comm_members m
    join public.comm_conversations c on c.id = m.conversation_id
    left join lateral (
      select g.body, g.author_id, g.deleted_at,
             exists (select 1 from public.comm_attachments a where a.message_id = g.id) as has_file
        from public.comm_messages g
       where g.conversation_id = c.id and g.parent_id is null
         and public.comm_can_read_at(c.id, g.created_at)
       order by g.created_at desc
       limit 1
    ) lm on true
   where m.user_id = (select auth.uid())
     and m.removed_at is null
     and not public.comm_workspace_blocked((select auth.uid()))
     and (p_kind is null or c.kind = p_kind)
   order by coalesce(c.last_message_at, c.created_at) desc;
$$;
revoke all on function public.comm_my_conversations(text) from public, anon;
grant execute on function public.comm_my_conversations(text) to authenticated;

-- The caller's own Favourite / Archived flags on one chat. NULL leaves a flag
-- as it is, so the star and the archive button each send only their own.
create or replace function public.comm_set_chat_flags(
  p_conv uuid, p_favorite boolean default null, p_archived boolean default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  update public.comm_members
     set favorite_at = case when p_favorite is null then favorite_at
                            when p_favorite then coalesce(favorite_at, clock_timestamp())
                            else null end,
         archived_at = case when p_archived is null then archived_at
                            when p_archived then coalesce(archived_at, clock_timestamp())
                            else null end
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
  if not found then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.comm_set_chat_flags(uuid, boolean, boolean) from public, anon;
grant execute on function public.comm_set_chat_flags(uuid, boolean, boolean) to authenticated;

do $assert$
begin
  if pg_get_functiondef('public.comm_my_conversations(text)'::regprocedure) not like '%comm_workspace_blocked%' then
    raise exception '0764: comm_my_conversations lost its workspace clause';
  end if;
  if has_function_privilege('anon', 'public.comm_my_conversations(text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.comm_set_chat_flags(uuid,boolean,boolean)'::regprocedure, 'EXECUTE') then
    raise exception '0764: a comm function is executable by anon';
  end if;
end $assert$;
