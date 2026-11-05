-- 0810 · Pulse: the person-chat ⌄ menu (user 2026-11-05, artifact "Pulse Chat Menu").
--
-- The row menu on a direct chat now reads, as in Gmail chat:
--   Mark as unread · Pin · Mute · Notifications · Move conversation
--   ── Block · Hide conversation · Delete conversation
-- Pin, Mute, Notifications (0751 notify_level), Hide (0764 archive) and Move
-- (the person's own sections, kept in the browser) already had their writes.
-- Three did not, and this file adds them. Every one is the CALLER's own and
-- moves nothing anyone else sees, except Block, which is the point of it.
--
-- 1. MARK AS UNREAD — comm_mark_unread(conv). Moves the caller's read marker
--    back to just before the newest top-level message someone ELSE sent, so the
--    chat shows 1 unread again. comm_mark_read takes greatest(), so the marker
--    moves forward again the moment the chat is opened.
--
-- 2. BLOCK — comm_blocks(blocker_id, blocked_id) + comm_set_blocked(user, on).
--    Enforced by a BEFORE INSERT trigger on comm_messages rather than inside
--    comm_send_message, so no existing function body is re-created (and none
--    can lose a guard by being copied from a stale version). A human message in
--    a DIRECT conversation is refused when either person has blocked the other.
--    Groups and channels are untouched: a block is between two people.
--
-- 3. DELETE CONVERSATION (for me) — comm_delete_chat_for_me(conv). Every
--    message now in the chat goes into 0807's comm_hidden for the caller (the
--    same "Delete for me" list the chat view already filters by), the read
--    marker moves to now, pin / favourite / archive are cleared, and
--    comm_members.cleared_at is stamped. The list hides a direct chat whose
--    newest message is not newer than cleared_at, so it comes back by itself
--    when the other person writes again. The other person keeps every message.
--
-- ROLLBACK:
--   drop trigger if exists trg_comm_block_direct on public.comm_messages;
--   drop function public.comm_refuse_blocked_direct();
--   drop function public.comm_mark_unread(uuid);
--   drop function public.comm_set_blocked(uuid, boolean);
--   drop function public.comm_delete_chat_for_me(uuid);
--   drop table public.comm_blocks;
--   alter table public.comm_members drop column cleared_at;

-- 1 ── Mark as unread ─────────────────────────────────────────────────────────
create or replace function public.comm_mark_unread(p_conv uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_last timestamptz;
  v_at   timestamptz;
begin
  if not public.comm_is_member(p_conv) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  select max(m.created_at) into v_last
    from public.comm_messages m
   where m.conversation_id = p_conv
     and m.parent_id is null
     and m.kind = 'message'
     and m.deleted_at is null
     and m.author_id is distinct from v_me;
  if v_last is null then
    raise exception 'There is no message from anyone else to mark unread.' using errcode = 'P0001';
  end if;
  update public.comm_members
     set last_read_at = v_last - interval '1 microsecond'
   where conversation_id = p_conv and user_id = v_me and removed_at is null
  returning last_read_at into v_at;
  return v_at;
end $$;
revoke all on function public.comm_mark_unread(uuid) from public, anon;
grant execute on function public.comm_mark_unread(uuid) to authenticated;

-- 2 ── Block ──────────────────────────────────────────────────────────────────
create table if not exists public.comm_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  blocked_at timestamptz not null default clock_timestamp(),
  primary key (blocker_id, blocked_id),
  constraint chk_comm_block_self check (blocker_id <> blocked_id)
);
comment on table public.comm_blocks is
  'location-scope: exempt -- a person''s own Pulse block list (0810), not a unit document.';
create index if not exists idx_comm_blocks_blocked on public.comm_blocks (blocked_id);

alter table public.comm_blocks enable row level security;
-- A person sees only who THEY blocked, never who blocked them.
drop policy if exists comm_blocks_read on public.comm_blocks;
create policy comm_blocks_read on public.comm_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

create or replace function public.comm_set_blocked(p_user uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if p_user is null or p_user = v_me then
    raise exception 'Pick someone else to block.' using errcode = 'P0001';
  end if;
  if coalesce(p_blocked, false) then
    insert into public.comm_blocks (blocker_id, blocked_id) values (v_me, p_user)
    on conflict (blocker_id, blocked_id) do nothing;
  else
    delete from public.comm_blocks where blocker_id = v_me and blocked_id = p_user;
  end if;
end $$;
revoke all on function public.comm_set_blocked(uuid, boolean) from public, anon;
grant execute on function public.comm_set_blocked(uuid, boolean) to authenticated;

create or replace function public.comm_refuse_blocked_direct()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_other uuid;
begin
  if new.kind <> 'message' or new.author_id is null then
    return new;
  end if;
  if not exists (select 1 from public.comm_conversations c where c.id = new.conversation_id and c.kind = 'direct') then
    return new;
  end if;
  select m.user_id into v_other
    from public.comm_members m
   where m.conversation_id = new.conversation_id and m.user_id <> new.author_id
   limit 1;
  if v_other is null then
    return new;
  end if;
  if exists (select 1 from public.comm_blocks b where b.blocker_id = new.author_id and b.blocked_id = v_other) then
    raise exception 'You blocked this person. Unblock them to send a message.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_blocks b where b.blocker_id = v_other and b.blocked_id = new.author_id) then
    raise exception 'You can''t send messages to this person.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.comm_refuse_blocked_direct() from public, anon;

drop trigger if exists trg_comm_block_direct on public.comm_messages;
create trigger trg_comm_block_direct
  before insert on public.comm_messages
  for each row execute function public.comm_refuse_blocked_direct();

-- 3 ── Delete conversation (for me) ───────────────────────────────────────────
alter table public.comm_members add column if not exists cleared_at timestamptz;

create or replace function public.comm_delete_chat_for_me(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_now timestamptz := clock_timestamp();
begin
  if not public.comm_is_member(p_conv) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  insert into public.comm_hidden (user_id, message_id)
  select v_me, m.id from public.comm_messages m
   where m.conversation_id = p_conv and m.created_at <= v_now
  on conflict (user_id, message_id) do nothing;
  update public.comm_members
     set cleared_at   = v_now,
         last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_now),
         pinned_at    = null,
         favorite_at  = null,
         archived_at  = null
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
end $$;
revoke all on function public.comm_delete_chat_for_me(uuid) from public, anon;
grant execute on function public.comm_delete_chat_for_me(uuid) to authenticated;

-- Verify from the catalog (AGENTS.md "Function grants").
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.comm_mark_unread(uuid)',
    'public.comm_set_blocked(uuid, boolean)',
    'public.comm_delete_chat_for_me(uuid)',
    'public.comm_refuse_blocked_direct()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0810: % is executable by anon', f;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.comm_blocks'::regclass) then
    raise exception '0810: row level security is not enabled on comm_blocks';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_blocks' and cmd <> 'SELECT') then
    raise exception '0810: comm_blocks has a write policy; writes go through comm_set_blocked';
  end if;
end $$;
