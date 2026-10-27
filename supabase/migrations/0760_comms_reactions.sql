-- ============================================================================
-- Raagam ERP — 0760 Communication Hub: emoji reactions, finished
--
-- Development Task 04. 0737 already built reactions — `comm_reactions`
-- (message, user, emoji) with that triple as its PRIMARY KEY, so one person
-- cannot hold the same emoji twice on one message; the read policy through
-- comm_message_visible(); history loading the reactions embedded with each
-- page (one query, no per-message lookup); and comm_toggle_reaction(), which
-- bumps the message's updated_at so the change reaches every viewer as an
-- RLS-filtered Realtime UPDATE. No new table. Counts are never stored: they
-- are counted from the rows, so there is nothing to drift.
--
-- What this adds:
--
--   * AN ALLOWLIST. 0737 accepted any 1–32 non-space characters, so "lol" or
--     "<b>" was a reaction (harmless as React text, but not an emoji, and the
--     spec asks for supported values only). comm_allowed_emoji() holds the
--     picker's catalog — lib/comms/emoji.ts, ALLOWED_EMOJI — and
--     scripts/check-comms-reactions.mts fails the build if the two disagree.
--     Only ADDING is checked: a reaction stored before this migration can
--     still be removed by its owner. (None exist on the live database today.)
--
--   * SET, NOT ONLY TOGGLE. comm_set_reaction(message, emoji, on) says which
--     state the person WANTS. A double-click or a retried request then lands
--     on that state instead of flipping it twice, which is what lets the
--     screen update optimistically and reconcile safely. It returns whether
--     anything changed, and bumps updated_at ONLY then, so a no-op sends no
--     Realtime event. comm_toggle_reaction keeps its signature and delegates.
--
--   * NO REACTING IN AN ARCHIVED CONVERSATION — archiving stops new activity
--     (0751), and 0737's toggle had missed this one door.
--
--   * comm_message_reactions(message): one message's reactions, for the screen
--     to reconcile after a change. Same visibility as reading the message.
--
-- WHO MAY: an ACTIVE MEMBER of the conversation (comm_is_member), on a message
-- that is not deleted, through comm_actor() — so a deactivated person (0750),
-- a paused workspace (0750, non-admins), a former member and a public-channel
-- previewer who has not joined are all refused. Removing only ever touches
-- the caller's OWN row: no argument names a user.
--
-- DELETED MESSAGES: comm_delete_message (0737) already removes the message's
-- reactions with it; reacting to a deleted message is refused here.
--
-- ROLLBACK: drop function public.comm_set_reaction(uuid, text, boolean);
-- drop function public.comm_message_reactions(uuid); drop function
-- public.comm_allowed_emoji(text); and re-run 0737's comm_toggle_reaction
-- body. No table or row is changed by this migration.
-- ============================================================================

create or replace function public.comm_allowed_emoji(p_emoji text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_emoji, '') = any (array[
    '👍', '❤️', '😂', '🎉', '👀', '🙏', '🚀', '✅', '😮', '👎', '😀', '😃',
    '😄', '😁', '😆', '😅', '🤣', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩',
    '😘', '😋', '😎', '🤓', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😬',
    '😌', '😔', '😴', '😷', '🤒', '🤯', '🥳', '😲', '😳', '🥺', '😢', '😭',
    '😱', '😤', '😡', '🤐', '🫡', '🤗', '🤭', '👌', '✌️', '🤞', '🤝', '👏',
    '🙌', '👋', '💪', '✍️', '👉', '👈', '👆', '👇', '☝️', '✋', '🤙', '🫶',
    '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '✨', '⭐', '🌟',
    '🔥', '🎊', '🎈', '🎁', '🎂', '🏆', '🥇', '🏅', '🍾', '☕', '🍵', '🍕',
    '🍰', '📌', '📎', '📝', '📋', '📊', '📈', '📉', '📅', '⏰', '⏳', '📦',
    '🚚', '🚢', '🧵', '🧶', '👕', '✂️', '🧾', '💰', '💡', '🔍', '🔧', '⚙️',
    '🔒', '📞', '📧', '🗓️', '☑️', '✔️', '❌', '❎', '⚠️', '❗', '❓', '‼️',
    '🆗', '🆕', '🔴', '🟠', '🟡', '🟢', '🔵', '➕', '➖', '🔁', '🔄', '⬆️',
    '⬇️', '➡️', '🛑', '🚫'
  ]);
$$;
revoke all on function public.comm_allowed_emoji(text) from public, anon;
grant execute on function public.comm_allowed_emoji(text) to authenticated;


-- Put the caller's reaction into the state they asked for. Returns { on, changed }.
create or replace function public.comm_set_reaction(p_message uuid, p_emoji text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.comm_actor();
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_conv  uuid;
  v_n     integer;
begin
  if p_on is null then
    raise exception 'Choose to add or remove the reaction.' using errcode = '22023';
  end if;
  select g.conversation_id into v_conv from public.comm_messages g
   where g.id = p_message and g.deleted_at is null;
  -- One sentence for "no such message", "deleted" and "not yours to see", so
  -- a guessed id learns nothing.
  if v_conv is null or not public.comm_is_member(v_conv) then
    raise exception 'Join the conversation to react.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_conversations c where c.id = v_conv and c.is_archived) then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;

  if p_on then
    if not public.comm_allowed_emoji(v_emoji) then
      raise exception 'That reaction cannot be used.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.comm_reactions r
                    where r.message_id = p_message and r.emoji = v_emoji)
       and (select count(distinct r.emoji) from public.comm_reactions r where r.message_id = p_message) >= 20 then
      raise exception 'This message already has 20 different reactions.' using errcode = '22023';
    end if;
    -- The primary key is the guard: a concurrent duplicate lands on the
    -- conflict and changes nothing.
    insert into public.comm_reactions (message_id, user_id, emoji) values (p_message, v_me, v_emoji)
    on conflict (message_id, user_id, emoji) do nothing;
  else
    delete from public.comm_reactions
     where message_id = p_message and user_id = v_me and emoji = v_emoji;
  end if;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
  end if;
  return jsonb_build_object('on', p_on, 'changed', v_n > 0);
end $$;
revoke all on function public.comm_set_reaction(uuid, text, boolean) from public, anon;
grant execute on function public.comm_set_reaction(uuid, text, boolean) to authenticated;


-- 0737's toggle, same signature, now the set above.
create or replace function public.comm_toggle_reaction(p_message uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
  v_on boolean;
begin
  v_on := not exists (select 1 from public.comm_reactions r
                       where r.message_id = p_message and r.user_id = v_me
                         and r.emoji = btrim(coalesce(p_emoji, '')));
  perform public.comm_set_reaction(p_message, p_emoji, v_on);
  return v_on;
end $$;
revoke all on function public.comm_toggle_reaction(uuid, text) from public, anon;
grant execute on function public.comm_toggle_reaction(uuid, text) to authenticated;


-- One message's reactions: emoji, how many, whether the caller is one of
-- them, and who (ids — names come through creator_names(), and only for a
-- message the caller may read, where the member list is visible anyway).
-- Ordered by first use, so chips do not jump around as counts change.
create or replace function public.comm_message_reactions(p_message uuid)
returns table (emoji text, count integer, mine boolean, user_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.comm_message_visible(p_message) then
    raise exception 'That message could not be found.' using errcode = '22023';
  end if;
  return query
  select r.emoji,
         count(*)::int,
         bool_or(r.user_id = (select auth.uid())),
         array_agg(r.user_id order by r.created_at)
    from public.comm_reactions r
   where r.message_id = p_message
   group by r.emoji
   order by min(r.created_at), r.emoji;
end $$;
revoke all on function public.comm_message_reactions(uuid) from public, anon;
grant execute on function public.comm_message_reactions(uuid) to authenticated;


do $assert$
begin
  if not public.comm_allowed_emoji('👍') or not public.comm_allowed_emoji('❤️')
     or public.comm_allowed_emoji('lol') or public.comm_allowed_emoji('<b>') or public.comm_allowed_emoji('') then
    raise exception '0760: comm_allowed_emoji does not hold the catalog';
  end if;
  if has_function_privilege('anon', 'public.comm_set_reaction(uuid,text,boolean)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.comm_message_reactions(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '0760: a reaction function is executable by anon';
  end if;
  -- The duplicate guard is the primary key 0737 declared; prove it is there.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.comm_reactions'::regclass and c.contype = 'p'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           = array['emoji', 'message_id', 'user_id']) then
    raise exception '0760: comm_reactions is not keyed on (message, user, emoji)';
  end if;
end $assert$;
