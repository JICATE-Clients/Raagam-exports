-- 0811 · Pulse: Threads in the chat list (user 2026-11-05, the "Threads in the
-- chat list" artifact: "apply").
--
-- The list gains a Threads section — threads the caller started or replied in,
-- newest reply first — and a thread with replies the caller has not opened is
-- bold with a dot. "Not opened" needs to know WHEN each person last opened each
-- thread, which nothing stores: a conversation's last_read_at says nothing about
-- the replies under one message. So this is a per-person row, like comm_hidden.
--
-- Written through an RPC, not a direct-write policy: 0737's assertion (d) holds
-- that comm_saved is the only comm table with a write policy, and this keeps it
-- true. The list itself needs no function — it reads comm_messages through the
-- existing RLS (lib/comms/service.ts listMyThreads).

create table if not exists public.comm_thread_seen (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid not null references public.comm_messages(id) on delete cascade,
  seen_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, parent_id)
);
comment on table public.comm_thread_seen is
  'location-scope: exempt -- when a person last opened each Pulse thread (0811).';

alter table public.comm_thread_seen enable row level security;

drop policy if exists comm_thread_seen_read on public.comm_thread_seen;
create policy comm_thread_seen_read on public.comm_thread_seen
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.comm_mark_thread_seen(p_parent uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if not public.comm_message_visible(p_parent) then
    raise exception 'That thread is not in a chat you can read.' using errcode = '42501';
  end if;
  insert into public.comm_thread_seen (user_id, parent_id, seen_at)
  values (v_me, p_parent, clock_timestamp())
  on conflict (user_id, parent_id) do update set seen_at = excluded.seen_at;
end;
$$;
revoke all on function public.comm_mark_thread_seen(uuid) from public, anon;
grant execute on function public.comm_mark_thread_seen(uuid) to authenticated;

-- Verify from the catalog (AGENTS.md "Function grants").
do $$
begin
  if has_function_privilege('anon', 'public.comm_mark_thread_seen(uuid)', 'EXECUTE') then
    raise exception '0811: comm_mark_thread_seen is executable by anon';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.comm_thread_seen'::regclass) then
    raise exception '0811: row level security is not enabled on comm_thread_seen';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_thread_seen' and cmd <> 'SELECT') then
    raise exception '0811: comm_thread_seen has a write policy; writes go through comm_mark_thread_seen';
  end if;
end $$;
