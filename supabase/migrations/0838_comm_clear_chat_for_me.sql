-- 0838 · Pulse: "Clear chat" (user 2026-11-12, artifact "Pulse Clear Chat", option A).
--
-- A new item in the chat ⋮ menu of a person chat, group or channel that empties
-- the caller's view of the chat and keeps the chat itself where it is.
--
-- It is 0810's comm_delete_chat_for_me WITHOUT the "delete conversation" half:
--   * every message now in the chat goes into 0807's comm_hidden for the caller
--     (the "Delete for me" list the chat view already filters by), so nothing is
--     deleted from the database and every other member keeps every message;
--   * the read marker moves to now, so the unread count goes to 0;
--   * pin, favourite, archive, mute and membership are NOT touched, and
--     cleared_at is NOT stamped — that stamp is what makes 0810 drop a direct
--     chat from the list, and a cleared chat stays in the list.
-- New messages arrive as usual. Not undoable from the screen.
--
-- ROLLBACK:
--   drop function public.comm_clear_chat_for_me(uuid);

create or replace function public.comm_clear_chat_for_me(p_conv uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_now timestamptz := clock_timestamp();
  n     integer;
begin
  if not public.comm_is_member(p_conv) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  insert into public.comm_hidden (user_id, message_id)
  select v_me, m.id from public.comm_messages m
   where m.conversation_id = p_conv and m.created_at <= v_now
  on conflict (user_id, message_id) do nothing;
  get diagnostics n = row_count;
  update public.comm_members
     set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_now)
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
  return n;
end $$;
revoke all on function public.comm_clear_chat_for_me(uuid) from public, anon;
grant execute on function public.comm_clear_chat_for_me(uuid) to authenticated;

-- Verify from the catalog (AGENTS.md "Function grants").
do $$
begin
  if has_function_privilege('anon', 'public.comm_clear_chat_for_me(uuid)', 'EXECUTE') then
    raise exception '0838: comm_clear_chat_for_me is executable by anon';
  end if;
end $$;
