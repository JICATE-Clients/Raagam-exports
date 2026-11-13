-- ============================================================================
-- Raagam ERP — 0775 Communication Hub: communities (WhatsApp-style)
--
-- User 2026-10-31: "community feature similar to WhatsApp … in the dropdown
-- menu button", then "apply this artifact" (the Pulse Communities mockup).
--
-- A COMMUNITY GROUPS RELATED GROUP CHATS UNDER ONE ANNOUNCEMENTS CHAT.
--
--   * comm_communities          name, description, its Announcements chat
--   * comm_community_members    who is in it, owner | admin | member
--   * comm_conversations        + community_id (a group belongs to ONE
--                                 community at most), is_announcement,
--                                 join_policy ('open' | 'request')
--   * comm_community_requests   "Ask to join" for a group whose policy is
--                                 'request'
--
-- ## THE ANNOUNCEMENTS CHAT IS AN ORDINARY GROUP CONVERSATION
--
-- kind 'group', is_announcement = true, its members = the community's members.
-- So reading it, unread counts, push alerts, reactions and search all come
-- from 0737 unchanged. What is different is enforced HERE, in triggers, so no
-- caller can go round it:
--
--   * only a community owner / admin may post in it (or reply in a thread) —
--     `comm_announcement_guard`, BEFORE INSERT on comm_messages. It reads the
--     author, not the screen, so a crafted send is refused the same way;
--   * it is never itself a group of a community.
--
-- ## MEMBERSHIP FOLLOWS THE GROUPS
--
-- Anyone who becomes an active member of a group that belongs to a community
-- becomes a member of the community and of its Announcements chat
-- (`comm_community_member_sync`, AFTER INSERT/UPDATE on comm_members). That
-- covers every existing way into a group — comm_add_members, comm_join_channel
-- style re-joins, an approved request — without touching those functions.
-- Leaving the COMMUNITY (comm_community_leave) leaves its Announcements and
-- every one of its groups, as in WhatsApp. Leaving one group does not leave
-- the community.
--
-- ## WHO SEES WHAT
--
-- A community member sees the community, its member list, and the NAME and
-- size of every group in it (comm_community_groups, SECURITY DEFINER) — never
-- a group's messages until they join it. comm_can_read_at is untouched.
--
-- Nothing here is location-scoped: like every comm_* table (0737), access is
-- membership, not unit.
-- ============================================================================


-- ---------- 1. tables ---------------------------------------------------------

create table if not exists public.comm_communities (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.comm_workspace(id) on delete restrict,
  name            text not null,
  description     text,
  announcement_id uuid unique references public.comm_conversations(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default clock_timestamp(),
  constraint chk_comm_community_name check (char_length(btrim(name)) between 1 and 60),
  constraint chk_comm_community_desc check (description is null or char_length(description) <= 500)
);

create unique index if not exists uq_comm_community_name
  on public.comm_communities (workspace_id, lower(btrim(name)));

drop trigger if exists trg_comm_communities_updated on public.comm_communities;
create trigger trg_comm_communities_updated before update on public.comm_communities
  for each row execute function public.set_updated_at();

comment on table public.comm_communities is
  'location-scope: exempt -- Communication Hub communities (0775): access is membership, not unit (0737).';

create table if not exists public.comm_community_members (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.comm_communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default clock_timestamp(),
  removed_at   timestamptz,
  removed_by   uuid references public.profiles(id) on delete set null,
  added_by     uuid references public.profiles(id) on delete set null,
  constraint uq_comm_community_members unique (community_id, user_id)
);
create index if not exists idx_comm_community_members_user
  on public.comm_community_members (user_id) where removed_at is null;

comment on table public.comm_community_members is
  'location-scope: exempt -- membership of a Communication Hub community (0775); see comm_communities.';

alter table public.comm_conversations
  add column if not exists community_id    uuid references public.comm_communities(id) on delete set null,
  add column if not exists is_announcement boolean not null default false,
  add column if not exists join_policy     text not null default 'open';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_comm_conv_join_policy') then
    alter table public.comm_conversations
      add constraint chk_comm_conv_join_policy check (join_policy in ('open', 'request'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_comm_conv_announcement') then
    alter table public.comm_conversations
      add constraint chk_comm_conv_announcement check (not is_announcement or kind = 'group');
  end if;
end $$;
create index if not exists idx_comm_conv_community
  on public.comm_conversations (community_id) where community_id is not null;

create table if not exists public.comm_community_requests (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.comm_communities(id) on delete cascade,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at      timestamptz not null default clock_timestamp(),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id) on delete set null
);
create unique index if not exists uq_comm_community_request_pending
  on public.comm_community_requests (conversation_id, user_id) where status = 'pending';

comment on table public.comm_community_requests is
  'location-scope: exempt -- requests to join a group of a community (0775); see comm_communities.';


-- ---------- 2. helpers ----------------------------------------------------------

-- The caller's ACTIVE role in a community, or NULL.
create or replace function public.comm_community_role(p_community uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.role from public.comm_community_members m
   where m.community_id = p_community
     and m.user_id = (select auth.uid())
     and m.removed_at is null;
$$;
revoke all on function public.comm_community_role(uuid) from public, anon;
grant execute on function public.comm_community_role(uuid) to authenticated;

create or replace function public.comm_is_community_admin(p_community uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.comm_community_role(p_community) in ('owner', 'admin'), false);
$$;
revoke all on function public.comm_is_community_admin(uuid) from public, anon;
grant execute on function public.comm_is_community_admin(uuid) to authenticated;

-- Put a person into a community AND its Announcements chat (re-activating a
-- removed row). Internal: not callable by a client.
create or replace function public.comm_community_enrol(p_community uuid, p_user uuid, p_role text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ann uuid;
begin
  insert into public.comm_community_members (community_id, user_id, role, added_by)
  values (p_community, p_user, p_role, p_by)
  on conflict (community_id, user_id) do update
     set removed_at = null, removed_by = null, joined_at = clock_timestamp(),
         role = case when public.comm_community_members.role = 'owner' then 'owner' else excluded.role end
   where public.comm_community_members.removed_at is not null;

  select c.announcement_id into v_ann from public.comm_communities c where c.id = p_community;
  if v_ann is not null then
    insert into public.comm_members (conversation_id, user_id, role, added_by)
    values (v_ann, p_user, case when p_role = 'member' then 'member' else p_role end, p_by)
    on conflict (conversation_id, user_id) do update
       set removed_at = null, removed_by = null, joined_at = clock_timestamp()
     where public.comm_members.removed_at is not null;
  end if;
end $$;
revoke all on function public.comm_community_enrol(uuid, uuid, text, uuid) from public, anon, authenticated;

-- A line in a conversation from nobody, the way 0737 writes system lines.
create or replace function public.comm_community_system_line(p_conv uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz;
begin
  insert into public.comm_messages (conversation_id, author_id, kind, body)
  values (p_conv, null, 'system', p_body)
  returning created_at into v_at;
  update public.comm_conversations set last_message_at = v_at where id = p_conv;
end $$;
revoke all on function public.comm_community_system_line(uuid, text) from public, anon, authenticated;


-- ---------- 3. triggers ----------------------------------------------------------

-- Joining a community's group joins the community (header, "MEMBERSHIP FOLLOWS THE GROUPS").
create or replace function public.comm_community_member_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_comm uuid;
begin
  if new.removed_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.removed_at is null then
    return null; -- was already active; nothing changed about membership
  end if;
  select c.community_id into v_comm from public.comm_conversations c
   where c.id = new.conversation_id and c.community_id is not null and not c.is_announcement;
  if v_comm is not null then
    perform public.comm_community_enrol(v_comm, new.user_id, 'member', new.added_by);
  end if;
  return null;
end $$;
revoke all on function public.comm_community_member_sync() from public, anon, authenticated;

drop trigger if exists trg_comm_community_member_sync on public.comm_members;
create trigger trg_comm_community_member_sync
  after insert or update of removed_at on public.comm_members
  for each row execute function public.comm_community_member_sync();

-- Only community admins speak in Announcements (header).
create or replace function public.comm_announcement_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_comm uuid;
begin
  if new.kind <> 'message' then
    return new;
  end if;
  select c.community_id into v_comm from public.comm_conversations c
   where c.id = new.conversation_id and c.is_announcement;
  if not found then
    return new;
  end if;
  if not exists (
    select 1 from public.comm_community_members m
     where m.community_id = v_comm and m.user_id = new.author_id
       and m.removed_at is null and m.role in ('owner', 'admin')
  ) then
    raise exception 'Only community admins can send messages in Announcements.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.comm_announcement_guard() from public, anon, authenticated;

drop trigger if exists trg_comm_announcement_guard on public.comm_messages;
create trigger trg_comm_announcement_guard
  before insert on public.comm_messages
  for each row execute function public.comm_announcement_guard();


-- ---------- 4. row-level security (reads only; every write is an RPC) -----------

alter table public.comm_communities        enable row level security;
alter table public.comm_community_members  enable row level security;
alter table public.comm_community_requests enable row level security;

drop policy if exists comm_communities_read on public.comm_communities;
create policy comm_communities_read on public.comm_communities
  for select to authenticated using (public.comm_community_role(id) is not null);

drop policy if exists comm_community_members_read on public.comm_community_members;
create policy comm_community_members_read on public.comm_community_members
  for select to authenticated using (public.comm_community_role(community_id) is not null);

drop policy if exists comm_community_requests_read on public.comm_community_requests;
create policy comm_community_requests_read on public.comm_community_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.comm_is_community_admin(community_id));


-- ---------- 5. linking groups -----------------------------------------------------

-- Link groups to a community. The actor must own or admin EACH group; a group
-- already in another community, a channel, a DM or an Announcements chat is
-- refused by name. Every active member of a linked group joins the community.
create or replace function public.comm_community_link(p_community uuid, p_groups uuid[], p_actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_conv  public.comm_conversations%rowtype;
  v_cname text;
  v_n     integer := 0;
  v_m     record;
begin
  select c.name into v_cname from public.comm_communities c where c.id = p_community;
  for v_conv in
    select * from public.comm_conversations c where c.id = any(coalesce(p_groups, '{}')) for update
  loop
    if v_conv.kind <> 'group' or v_conv.is_announcement then
      raise exception 'Only group chats can be added to a community.' using errcode = '22023';
    end if;
    if v_conv.is_archived then
      raise exception '% is archived and cannot be added.', coalesce(v_conv.name, 'That group') using errcode = '22023';
    end if;
    if v_conv.community_id is not null and v_conv.community_id <> p_community then
      raise exception '% is already in another community.', coalesce(v_conv.name, 'That group') using errcode = '23505';
    end if;
    if not exists (select 1 from public.comm_members m
                    where m.conversation_id = v_conv.id and m.user_id = p_actor
                      and m.removed_at is null and m.role in ('owner', 'admin')) then
      raise exception 'You can add only groups you own or admin (%).', coalesce(v_conv.name, 'unnamed group') using errcode = '42501';
    end if;
    if v_conv.community_id = p_community then
      continue;
    end if;
    update public.comm_conversations set community_id = p_community where id = v_conv.id;
    for v_m in select m.user_id from public.comm_members m
                where m.conversation_id = v_conv.id and m.removed_at is null loop
      perform public.comm_community_enrol(p_community, v_m.user_id,
        case when v_m.user_id = p_actor then coalesce(
          (select cm.role from public.comm_community_members cm
            where cm.community_id = p_community and cm.user_id = p_actor and cm.removed_at is null), 'member')
        else 'member' end, p_actor);
    end loop;
    perform public.comm_community_system_line(v_conv.id, 'This group was added to the community ' || v_cname || '.');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.comm_community_link(uuid, uuid[], uuid) from public, anon, authenticated;


-- ---------- 6. RPCs ------------------------------------------------------------------

create or replace function public.comm_create_community(p_name text, p_description text, p_group_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_ws   uuid := public.comm_workspace_id();
  v_id   uuid;
  v_ann  uuid;
begin
  -- The same gate as starting a group (0750).
  if exists (select 1 from public.comm_workspace w where not w.members_can_create_groups)
     and public.comm_workspace_role(v_me) not in ('owner', 'admin')
     and not public.has_permission('communication', 'create') then
    raise exception 'Only workspace admins can start communities here.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Give the community a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Keep the community name to 60 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Keep the description to 500 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.comm_communities c
              where c.workspace_id = v_ws and lower(btrim(c.name)) = lower(v_name)) then
    raise exception '% already exists. Use a different name.', v_name using errcode = '23505';
  end if;

  insert into public.comm_communities (workspace_id, name, description, created_by)
  values (v_ws, v_name, v_desc, v_me)
  returning id into v_id;

  insert into public.comm_conversations (kind, name, visibility, created_by, community_id, is_announcement)
  values ('group', v_name, 'private', v_me, v_id, true)
  returning id into v_ann;
  update public.comm_communities set announcement_id = v_ann where id = v_id;

  perform public.comm_community_enrol(v_id, v_me, 'owner', v_me);
  perform public.comm_community_link(v_id, p_group_ids, v_me);
  perform public.comm_community_system_line(v_ann,
    'Welcome to ' || v_name || '. Only community admins can send messages here.');
  return v_id;
end $$;
revoke all on function public.comm_create_community(text, text, uuid[]) from public, anon;
grant execute on function public.comm_create_community(text, text, uuid[]) to authenticated;

create or replace function public.comm_community_add_groups(p_community uuid, p_group_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if not public.comm_is_community_admin(p_community) then
    raise exception 'Only community admins can add groups.' using errcode = '42501';
  end if;
  return public.comm_community_link(p_community, p_group_ids, v_me);
end $$;
revoke all on function public.comm_community_add_groups(uuid, uuid[]) from public, anon;
grant execute on function public.comm_community_add_groups(uuid, uuid[]) to authenticated;

-- Take a group out of the community. Its people stay in the community.
create or replace function public.comm_community_remove_group(p_community uuid, p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
  v_cname text;
begin
  if not public.comm_is_community_admin(p_community) then
    raise exception 'Only community admins can remove groups.' using errcode = '42501';
  end if;
  update public.comm_conversations set community_id = null
   where id = p_conv and community_id = p_community and not is_announcement;
  if not found then
    raise exception 'That group is not in this community.' using errcode = '22023';
  end if;
  update public.comm_community_requests set status = 'declined', decided_at = clock_timestamp(), decided_by = v_me
   where conversation_id = p_conv and status = 'pending';
  select c.name into v_cname from public.comm_communities c where c.id = p_community;
  perform public.comm_community_system_line(p_conv, 'This group was removed from the community ' || v_cname || '.');
end $$;
revoke all on function public.comm_community_remove_group(uuid, uuid) from public, anon;
grant execute on function public.comm_community_remove_group(uuid, uuid) to authenticated;

create or replace function public.comm_my_communities()
returns table (
  id uuid, name text, description text, announcement_id uuid, my_role text,
  member_count integer, group_count integer, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.description, c.announcement_id, m.role,
         (select count(*)::int from public.comm_community_members x
           where x.community_id = c.id and x.removed_at is null),
         (select count(*)::int from public.comm_conversations g
           where g.community_id = c.id and not g.is_announcement and not g.is_archived),
         c.created_at
    from public.comm_community_members m
    join public.comm_communities c on c.id = m.community_id
   where m.user_id = (select auth.uid())
     and m.removed_at is null
     and not public.comm_workspace_blocked((select auth.uid()))
   order by c.name;
$$;
revoke all on function public.comm_my_communities() from public, anon;
grant execute on function public.comm_my_communities() to authenticated;

-- Every group of a community, as a member of the community may see it: name
-- and size, never its messages.
create or replace function public.comm_community_groups(p_community uuid)
returns table (
  id uuid, name text, member_count integer, join_policy text,
  is_member boolean, requested boolean, can_manage boolean, last_message_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name,
         (select count(*)::int from public.comm_members o where o.conversation_id = g.id and o.removed_at is null),
         g.join_policy,
         exists (select 1 from public.comm_members o
                  where o.conversation_id = g.id and o.user_id = (select auth.uid()) and o.removed_at is null),
         exists (select 1 from public.comm_community_requests r
                  where r.conversation_id = g.id and r.user_id = (select auth.uid()) and r.status = 'pending'),
         exists (select 1 from public.comm_members o
                  where o.conversation_id = g.id and o.user_id = (select auth.uid())
                    and o.removed_at is null and o.role in ('owner', 'admin')),
         g.last_message_at
    from public.comm_conversations g
   where g.community_id = p_community
     and not g.is_announcement
     and not g.is_archived
     and public.comm_community_role(p_community) is not null
   order by coalesce(g.last_message_at, g.created_at) desc;
$$;
revoke all on function public.comm_community_groups(uuid) from public, anon;
grant execute on function public.comm_community_groups(uuid) to authenticated;

-- Join a group of a community: straight in when its policy is 'open' (or the
-- caller is a community admin), otherwise a request for its admins.
create or replace function public.comm_community_join(p_conv uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_conv public.comm_conversations%rowtype;
begin
  select * into v_conv from public.comm_conversations c where c.id = p_conv;
  if not found or v_conv.community_id is null or v_conv.is_announcement or v_conv.is_archived
     or public.comm_community_role(v_conv.community_id) is null then
    raise exception 'That group cannot be joined.' using errcode = '42501';
  end if;
  if public.comm_is_member(p_conv) then
    return 'joined';
  end if;
  if v_conv.join_policy = 'open' or public.comm_is_community_admin(v_conv.community_id) then
    insert into public.comm_members (conversation_id, user_id, role, added_by)
    values (p_conv, v_me, 'member', v_me)
    on conflict (conversation_id, user_id) do update
       set removed_at = null, removed_by = null, joined_at = clock_timestamp(), role = 'member'
     where public.comm_members.removed_at is not null;
    update public.comm_community_requests set status = 'approved', decided_at = clock_timestamp(), decided_by = v_me
     where conversation_id = p_conv and user_id = v_me and status = 'pending';
    return 'joined';
  end if;
  insert into public.comm_community_requests (community_id, conversation_id, user_id)
  values (v_conv.community_id, p_conv, v_me)
  on conflict (conversation_id, user_id) where status = 'pending' do nothing;
  return 'requested';
end $$;
revoke all on function public.comm_community_join(uuid) from public, anon;
grant execute on function public.comm_community_join(uuid) to authenticated;

-- Pending requests the caller may decide: a community admin sees all of the
-- community's; a group's own owner / admin sees that group's.
create or replace function public.comm_community_pending(p_community uuid)
returns table (id uuid, conversation_id uuid, group_name text, user_id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.conversation_id, g.name, r.user_id, r.created_at
    from public.comm_community_requests r
    join public.comm_conversations g on g.id = r.conversation_id
   where r.community_id = p_community and r.status = 'pending'
     and (public.comm_is_community_admin(p_community) or public.comm_can_manage(r.conversation_id))
   order by r.created_at;
$$;
revoke all on function public.comm_community_pending(uuid) from public, anon;
grant execute on function public.comm_community_pending(uuid) to authenticated;

create or replace function public.comm_community_decide(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_req public.comm_community_requests%rowtype;
begin
  select * into v_req from public.comm_community_requests r where r.id = p_request for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'That request was already answered.' using errcode = '55000';
  end if;
  if not (public.comm_is_community_admin(v_req.community_id) or public.comm_can_manage(v_req.conversation_id)) then
    raise exception 'Only the community''s or the group''s admins can answer requests.' using errcode = '42501';
  end if;
  update public.comm_community_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = clock_timestamp(), decided_by = v_me
   where id = p_request;
  if p_approve then
    insert into public.comm_members (conversation_id, user_id, role, added_by)
    values (v_req.conversation_id, v_req.user_id, 'member', v_me)
    on conflict (conversation_id, user_id) do update
       set removed_at = null, removed_by = null, joined_at = clock_timestamp(), role = 'member'
     where public.comm_members.removed_at is not null;
  end if;
end $$;
revoke all on function public.comm_community_decide(uuid, boolean) from public, anon;
grant execute on function public.comm_community_decide(uuid, boolean) to authenticated;

create or replace function public.comm_community_update(p_community uuid, p_name text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_ws   uuid;
  v_ann  uuid;
begin
  if not public.comm_is_community_admin(p_community) then
    raise exception 'Only community admins can edit the community.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Give the community a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'Keep the community name to 60 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Keep the description to 500 characters.' using errcode = '22023';
  end if;
  select c.workspace_id, c.announcement_id into v_ws, v_ann from public.comm_communities c where c.id = p_community;
  if exists (select 1 from public.comm_communities c
              where c.workspace_id = v_ws and c.id <> p_community and lower(btrim(c.name)) = lower(v_name)) then
    raise exception '% already exists. Use a different name.', v_name using errcode = '23505';
  end if;
  update public.comm_communities set name = v_name, description = v_desc where id = p_community;
  if v_ann is not null then
    update public.comm_conversations set name = v_name where id = v_ann;
  end if;
end $$;
revoke all on function public.comm_community_update(uuid, text, text) from public, anon;
grant execute on function public.comm_community_update(uuid, text, text) to authenticated;

-- Invite people straight into the community (and its Announcements).
create or replace function public.comm_community_add_members(p_community uuid, p_user_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_ids uuid[];
  v_u   uuid;
begin
  if not public.comm_is_community_admin(p_community) then
    raise exception 'Only community admins can add people.' using errcode = '42501';
  end if;
  v_ids := public.comm_active_profiles(p_user_ids, v_me);
  foreach v_u in array coalesce(v_ids, '{}') loop
    perform public.comm_community_enrol(p_community, v_u, 'member', v_me);
  end loop;
  return coalesce(array_length(v_ids, 1), 0);
end $$;
revoke all on function public.comm_community_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.comm_community_add_members(uuid, uuid[]) to authenticated;

-- Make a member an admin, or an admin a member. The owner's role is fixed.
create or replace function public.comm_community_set_role(p_community uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_ann uuid;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'A role is admin or member.' using errcode = '22023';
  end if;
  if not public.comm_is_community_admin(p_community) then
    raise exception 'Only community admins can change roles.' using errcode = '42501';
  end if;
  update public.comm_community_members set role = p_role
   where community_id = p_community and user_id = p_user and removed_at is null and role <> 'owner';
  if not found then
    raise exception 'That person is not a member, or is the owner.' using errcode = '22023';
  end if;
  select c.announcement_id into v_ann from public.comm_communities c where c.id = p_community;
  update public.comm_members set role = p_role
   where conversation_id = v_ann and user_id = p_user and role <> 'owner';
end $$;
revoke all on function public.comm_community_set_role(uuid, uuid, text) from public, anon;
grant execute on function public.comm_community_set_role(uuid, uuid, text) to authenticated;

-- A group's own managers or a community admin set how the group is joined.
create or replace function public.comm_community_set_join_policy(p_conv uuid, p_policy text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_comm uuid;
begin
  if p_policy not in ('open', 'request') then
    raise exception 'Choose open or request.' using errcode = '22023';
  end if;
  select c.community_id into v_comm from public.comm_conversations c where c.id = p_conv and not c.is_announcement;
  if v_comm is null then
    raise exception 'That group is not in a community.' using errcode = '22023';
  end if;
  if not (public.comm_is_community_admin(v_comm) or public.comm_can_manage(p_conv)) then
    raise exception 'Only the community''s or the group''s admins can change this.' using errcode = '42501';
  end if;
  update public.comm_conversations set join_policy = p_policy where id = p_conv;
end $$;
revoke all on function public.comm_community_set_join_policy(uuid, text) from public, anon;
grant execute on function public.comm_community_set_join_policy(uuid, text) to authenticated;

-- Leave the community: its Announcements and every group in it too. The last
-- owner cannot leave (0737's rule for a group), so a community is never left
-- with nobody who can manage it.
create or replace function public.comm_community_leave(p_community uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_at  timestamptz := clock_timestamp();
begin
  if public.comm_community_role(p_community) is null then
    raise exception 'You are not in this community.' using errcode = '22023';
  end if;
  if public.comm_community_role(p_community) = 'owner'
     and not exists (select 1 from public.comm_community_members m
                      where m.community_id = p_community and m.user_id <> v_me
                        and m.removed_at is null and m.role in ('owner', 'admin')) then
    raise exception 'Make someone else an admin before you leave the community.' using errcode = '55000';
  end if;
  -- Hand ownership on so the community keeps an owner.
  if public.comm_community_role(p_community) = 'owner' then
    update public.comm_community_members set role = 'owner'
     where id = (select m.id from public.comm_community_members m
                  where m.community_id = p_community and m.user_id <> v_me
                    and m.removed_at is null and m.role = 'admin'
                  order by m.joined_at limit 1)
       and not exists (select 1 from public.comm_community_members o
                        where o.community_id = p_community and o.user_id <> v_me
                          and o.removed_at is null and o.role = 'owner');
  end if;
  update public.comm_community_members
     set removed_at = v_at, removed_by = v_me
   where community_id = p_community and user_id = v_me and removed_at is null;
  update public.comm_members m
     set removed_at = v_at, removed_by = v_me
    from public.comm_conversations c
   where c.id = m.conversation_id and c.community_id = p_community
     and m.user_id = v_me and m.removed_at is null
     and not (m.role = 'owner' and not exists (
       select 1 from public.comm_members o
        where o.conversation_id = m.conversation_id and o.user_id <> v_me
          and o.removed_at is null and o.role in ('owner', 'admin')));
  update public.comm_community_requests set status = 'declined', decided_at = v_at, decided_by = v_me
   where community_id = p_community and user_id = v_me and status = 'pending';
end $$;
revoke all on function public.comm_community_leave(uuid) from public, anon;
grant execute on function public.comm_community_leave(uuid) to authenticated;
