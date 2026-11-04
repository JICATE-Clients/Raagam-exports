-- 0807 · Pulse: "Delete for me" (user 2026-11-04, the Pulse delete mockup).
--
-- The delete dialog now offers Delete for everyone · Delete for me · Cancel.
-- Delete for everyone is the existing soft delete (comm_delete_message: the
-- row is cleared and reads "This message was deleted" for every member).
-- Delete for me removes a message from the CALLER's view only and touches
-- nothing anyone else sees, so it is a per-person row, like comm_saved.
--
-- Written through an RPC, not a direct-write policy: 0737's assertion (d) holds
-- that comm_saved is the only comm table with a write policy, and this keeps it
-- true. Any member who can read a message may hide it from themselves — their
-- own or someone else's.

create table if not exists public.comm_hidden (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.comm_messages(id) on delete cascade,
  hidden_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, message_id)
);
comment on table public.comm_hidden is
  'location-scope: exempt -- a person''s own "Delete for me" list of comm messages (0807).';

alter table public.comm_hidden enable row level security;

drop policy if exists comm_hidden_read on public.comm_hidden;
create policy comm_hidden_read on public.comm_hidden
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.comm_hide_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if not public.comm_message_visible(p_message) then
    raise exception 'That message is not in a chat you can read.' using errcode = '42501';
  end if;
  insert into public.comm_hidden (user_id, message_id)
  values (v_me, p_message)
  on conflict (user_id, message_id) do nothing;
end;
$$;
revoke all on function public.comm_hide_message(uuid) from public, anon;
grant execute on function public.comm_hide_message(uuid) to authenticated;

-- Verify from the catalog (AGENTS.md "Function grants").
do $$
begin
  if has_function_privilege('anon', 'public.comm_hide_message(uuid)', 'EXECUTE') then
    raise exception '0807: comm_hide_message is executable by anon';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.comm_hidden'::regclass) then
    raise exception '0807: row level security is not enabled on comm_hidden';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_hidden' and cmd <> 'SELECT') then
    raise exception '0807: comm_hidden has a write policy; writes go through comm_hide_message';
  end if;
end $$;
