-- ============================================================================
-- Raagam ERP — 0737 Communication Hub, phase 1: the messaging core
--
-- doc/slack.md/slack §5 (core messaging) and §9–§10 (schema, security).
-- Direct messages, groups and channels between ERP LOGINS, with threads,
-- mentions, reactions, pins, saved messages and attachments.
--
-- THE PATTERN IS 0458's, WIDENED. The order "RE-Community" channel already
-- proved the shape — membership as rows, a SECURITY DEFINER gate every policy
-- calls, a private bucket keyed on the first path folder, bot-vs-human as a
-- column. 0458 is NOT modified: it is per-order and unit-scoped through its
-- order, and folding it in here would change who can read it.
--
--
-- ## IDENTITY IS profiles.id, NEVER staff
--
-- A login is `profiles.id` = `auth.uid()`. `staff` (HR's people table) has no
-- FK to it — the link is the soft match `employee_login_ids()` uses (0674):
-- employee_code first, then e-mail. So every person column here points at
-- `profiles`, and staff is read ONLY to print a designation / department beside
-- a name (`comm_directory`). A staff row with no login cannot chat, and that is
-- correct: there is nobody to sign in as them.
--
--
-- ## CROSS-UNIT, ON PURPOSE (decision default, 2026-10-23 — see the plan)
--
-- People in Head Office, Unit 1 and Unit 2 must be able to message each other,
-- so nothing here is narrowed to `current_location()`. None of these tables is
-- in the location FK tree (they reference profiles / departments, neither of
-- which carries `location_id`), but each is still marked
-- `location-scope: exempt -- …` so the decision is written where
-- scripts/check-location-scope.sql reads it, rather than being an accident of
-- which FKs happen to exist today.
--
--
-- ## WHO READS WHAT
--
--   * An ACTIVE member reads the whole conversation.
--   * A REMOVED member keeps the history up to `removed_at` and nothing after
--     it (spec §5: "without exposing future messages"). Taking away what they
--     already read would destroy their record of work they took part in — the
--     same reasoning 0458's header gives for never auto-removing.
--   * A PUBLIC channel is readable by every signed-in user (browse before
--     joining). Posting, reacting and pinning still need membership.
--   * A SUPER ADMIN HAS NO READ BYPASS HERE. 0458 gives one because an order
--     channel is a business record; a direct message is private correspondence.
--     A super admin still passes `has_permission`, so can create / manage
--     channels — just not read DMs they are not in.
--
--
-- ## EVERY WRITE IS AN RPC
--
-- There is no INSERT / UPDATE / DELETE policy on conversations, members,
-- messages, mentions, reactions, pins or attachments. Each write goes through a
-- SECURITY DEFINER function that takes the actor from `auth.uid()` — never from
-- an argument — and checks membership itself. That is what makes "never trust a
-- browser-provided sender ID" (spec §10) structural: no argument names a sender.
--
-- It also closes a hole 0458 left open: `order_channel_members_update` lets a
-- user update their OWN row unconditionally, so a removed member can clear
-- their own `removed_at`. Here members cannot update rows at all; reading
-- position, mute and leaving are RPCs that touch exactly one column each.
--
-- The one table with direct-write policies is `comm_saved` — a private bookmark
-- list where the only rule is "your own rows, on a message you can read".
--
--
-- ## A RETRIED SEND CANNOT POST TWICE
--
-- The browser mints `client_id` once per typed message; `uq_comm_msg_client`
-- is (author_id, client_id). A retry after a dropped connection replays the
-- same pair and `comm_send_message` returns the row that already exists with
-- `created = false`, so the optimistic bubble reconciles instead of doubling.
--
--
-- ## MENTIONS ARE PARSED HERE, NOT TRUSTED FROM THE CLIENT
--
-- The supported format is `<@profile-uuid>` inside the body (the UI renders it
-- as @Name, so a rename never rewrites old messages). The send RPC extracts the
-- tokens and keeps only ACTIVE MEMBERS of the conversation other than the
-- author — so a mention can never reveal a private conversation to an outsider
-- or notify one. The ids it kept are returned for the TypeScript caller to hand
-- to `notify()` (phase 4); notifications are not written from SQL, for the
-- reason 0458's header gives: SQL rows would arrive with no web push.
--
--
-- ## REALTIME LEAKS DELETES, SO NOTHING HERE IS HARD-DELETED BY A USER
--
-- Supabase Realtime applies the SELECT policy to INSERT and UPDATE events but
-- NOT to DELETE events. So only `comm_messages` is published, and it is never
-- hard-deleted by a user action: a deleted message is a soft delete
-- (`deleted_at`, body cleared). Reactions and pins are NOT published; changing
-- one touches the message's `updated_at`, which arrives as an RLS-filtered
-- UPDATE instead.
--
-- `comm_members` is deliberately NOT published either: every mark-read moves
-- `last_read_at`, and broadcasting that row to the other members would hand
-- them a read receipt nobody opted into. A new DM or group reaches its members
-- through the first message's INSERT, which they can already see.
--
--
-- ## NOT IN THIS MIGRATION (later phases, see the plan)
--
--   * notifications dedupe key + comms event keys      → phase 4
--   * ERP record links                                 → phase 6
--   * full-text search index                           → with the Search view
--   * audit: membership / channel admin acts are logged with writeAudit() from
--     the server actions (phase 2). No record_audit trigger: last_read_at and
--     last_message_at move on every message, and a trigger would copy private
--     message text into an admin-readable table.
--
-- ADD-ONLY. Touches no existing table, function or policy.
-- ============================================================================


-- ---------- 0. permission vocabulary -----------------------------------------
--
-- `communication:view` = MAY USE THE HUB at all: it is what puts the row in the
-- sidebar (the nav filters every module by its View) and what `comm_actor()`
-- asks before any write, so the switch on Users & Access is a real switch and
-- not a hidden menu row over a door that still opens. It is granted below to
-- EVERY ROLE THAT EXISTS TODAY, so the hub reaches everyone on day one; a role
-- created later starts without it, like any other module, and is ticked on
-- the permission screen.
--
-- `communication:create / edit / delete` = CHANNEL administration: creating,
-- managing and moderating channels. Administrator only, to start.
--
-- Reads are NOT gated on view: a person whose access is switched off keeps
-- read access to conversations they were in, through membership — switching a
-- module off is not a reason to erase someone's correspondence.

insert into public.permissions (module, action, description)
select 'communication', a, initcap(a) || ' communication hub'
from unnest(array['view', 'create', 'edit', 'delete']) a
on conflict (module, action) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'communication' and p.action = 'view'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'communication'
where r.name = 'Administrator'
on conflict do nothing;


-- ---------- 1. conversations --------------------------------------------------

create table if not exists public.comm_conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('direct', 'group', 'channel')),
  name            text,
  topic           text,
  visibility      text not null default 'private' check (visibility in ('public', 'private')),
  -- A department channel. Nullable: most channels are not one. Membership is
  -- NOT derived from it at read time — `comm_sync_department_members()` adds
  -- the department's logins as rows, so leaving the department does not
  -- silently revoke history (0458's rule).
  department_id   uuid references public.departments(id) on delete set null,
  -- "least:greatest" of the two profile ids. The uniqueness of a DM pair is
  -- this index, not a check-then-insert in a service (which races).
  direct_key      text,
  is_archived     boolean not null default false,
  last_message_at timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default clock_timestamp(),

  constraint chk_comm_conv_direct check (
    (kind = 'direct' and direct_key is not null and name is null
       and visibility = 'private' and department_id is null)
    or (kind <> 'direct' and direct_key is null)
  ),
  constraint chk_comm_conv_group check (
    kind <> 'group' or (visibility = 'private' and department_id is null)
  ),
  constraint chk_comm_conv_channel_name check (
    kind <> 'channel' or nullif(btrim(name), '') is not null
  ),
  constraint chk_comm_conv_name_len  check (name  is null or char_length(name)  <= 80),
  constraint chk_comm_conv_topic_len check (topic is null or char_length(topic) <= 250)
);

create unique index if not exists uq_comm_conv_direct
  on public.comm_conversations (direct_key) where direct_key is not null;
-- Two live channels may not share a name (case-folded). An archived one frees
-- its name; un-archiving into a collision is refused by this same index.
create unique index if not exists uq_comm_conv_channel_name
  on public.comm_conversations (lower(btrim(name)))
  where kind = 'channel' and not is_archived;
create index if not exists idx_comm_conv_public_channels
  on public.comm_conversations (lower(name))
  where kind = 'channel' and visibility = 'public';

drop trigger if exists trg_comm_conversations_updated on public.comm_conversations;
create trigger trg_comm_conversations_updated before update on public.comm_conversations
  for each row execute function public.set_updated_at();

comment on table public.comm_conversations is
  'location-scope: exempt -- Communication Hub (0737): people in every unit message each other; access is membership, not unit.';


-- ---------- 2. members --------------------------------------------------------

create table if not exists public.comm_members (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at       timestamptz not null default clock_timestamp(),
  -- The read marker. Unread = top-level messages newer than this (or than
  -- joined_at, before the first read). Moved only by comm_mark_read / a send.
  last_read_at    timestamptz,
  muted           boolean not null default false,
  -- Set by a person (themselves leaving, or a manager). Never cleared by a
  -- sync; cleared only by an explicit re-add or re-join.
  removed_at      timestamptz,
  removed_by      uuid references public.profiles(id) on delete set null,
  added_by        uuid references public.profiles(id) on delete set null,
  constraint uq_comm_members unique (conversation_id, user_id)
);

create index if not exists idx_comm_members_user_active
  on public.comm_members (user_id) where removed_at is null;

comment on table public.comm_members is
  'location-scope: exempt -- membership of a Communication Hub conversation (0737); see comm_conversations.';
comment on column public.comm_members.removed_at is
  'Removed or left. The person keeps read access to messages created up to this instant and nothing after (0737 header).';


-- ---------- 3. messages -------------------------------------------------------

create table if not exists public.comm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  -- NULL for a system line, and for a human line whose login was deleted.
  author_id       uuid references public.profiles(id) on delete set null,
  kind            text not null default 'message' check (kind in ('message', 'system')),
  body            text,
  -- One level of threading: a reply's parent is always a top-level message in
  -- the same conversation (enforced in comm_send_message).
  parent_id       uuid references public.comm_messages(id) on delete cascade,
  -- Minted by the browser per typed message; the retry-safety key.
  client_id       uuid,
  reply_count     integer not null default 0,
  last_reply_at   timestamptz,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp(),
  -- Also bumped by a reaction or pin change, so those reach subscribers as an
  -- RLS-filtered UPDATE (see header: Realtime does not filter DELETEs).
  updated_at      timestamptz not null default clock_timestamp(),

  constraint chk_comm_msg_system check (kind <> 'system' or author_id is null),
  constraint chk_comm_msg_body_len check (body is null or char_length(body) <= 8000),
  constraint chk_comm_msg_deleted_empty check (deleted_at is null or body is null),
  constraint chk_comm_msg_reply_count check (reply_count >= 0)
);

create unique index if not exists uq_comm_msg_client
  on public.comm_messages (author_id, client_id) where client_id is not null;
-- The history page: newest first, keyset on (created_at, id). Top level only —
-- replies are read per thread through the next index.
create index if not exists idx_comm_msg_timeline
  on public.comm_messages (conversation_id, created_at desc, id desc) where parent_id is null;
create index if not exists idx_comm_msg_thread
  on public.comm_messages (parent_id, created_at, id) where parent_id is not null;

drop trigger if exists trg_comm_messages_updated on public.comm_messages;
create trigger trg_comm_messages_updated before update on public.comm_messages
  for each row execute function public.set_updated_at();

comment on table public.comm_messages is
  'location-scope: exempt -- Communication Hub messages (0737); readable per comm_can_read_at().';


-- ---------- 4. mentions, reactions, pins, saved, attachments -----------------

create table if not exists public.comm_mentions (
  message_id uuid not null references public.comm_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id)
);
create index if not exists idx_comm_mentions_user on public.comm_mentions (user_id, created_at desc);
comment on table public.comm_mentions is
  'location-scope: exempt -- parsed <@uuid> mentions of a Communication Hub message (0737).';

create table if not exists public.comm_reactions (
  message_id uuid not null references public.comm_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 32 and emoji !~ '\s'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id, emoji)
);
comment on table public.comm_reactions is
  'location-scope: exempt -- reactions on a Communication Hub message (0737).';

create table if not exists public.comm_pins (
  message_id      uuid primary key references public.comm_messages(id) on delete cascade,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  pinned_by       uuid references public.profiles(id) on delete set null,
  pinned_at       timestamptz not null default clock_timestamp()
);
create index if not exists idx_comm_pins_conv on public.comm_pins (conversation_id, pinned_at desc);
comment on table public.comm_pins is
  'location-scope: exempt -- pinned Communication Hub messages (0737).';

create table if not exists public.comm_saved (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.comm_messages(id) on delete cascade,
  saved_at   timestamptz not null default clock_timestamp(),
  primary key (user_id, message_id)
);
create index if not exists idx_comm_saved_user on public.comm_saved (user_id, saved_at desc);
comment on table public.comm_saved is
  'location-scope: exempt -- a person''s own saved-message bookmarks (0737).';

create table if not exists public.comm_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.comm_messages(id) on delete cascade,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  file_name       text not null check (char_length(file_name) between 1 and 255),
  -- Key WITHIN the private comm-files bucket, never a URL (0416 / 0458 rule).
  -- THE FIRST FOLDER IS THE CONVERSATION ID — the storage insert policy reads it.
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes between 1 and 20971520),
  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default clock_timestamp()
);
create unique index if not exists uq_comm_attachments_path on public.comm_attachments (storage_path);
create index if not exists idx_comm_attachments_message on public.comm_attachments (message_id);
comment on table public.comm_attachments is
  'location-scope: exempt -- files on a Communication Hub message (0737); bytes in the private comm-files bucket.';


-- ---------- 5. gates -----------------------------------------------------------
--
-- SECURITY DEFINER for 0458's two reasons: a policy on comm_members that reads
-- comm_members recurses, and storage.objects policies run as the caller.

-- The actor, or a refusal. Every write RPC starts here: a signed-in, active
-- login holding communication:view (section 0).
create or replace function public.comm_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v and coalesce(p.is_active, true)) then
    raise exception 'This login is not active.' using errcode = '42501';
  end if;
  if not public.has_permission('communication', 'view') then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public.comm_actor() from public, anon;
grant execute on function public.comm_actor() to authenticated;

-- ACTIVE membership: may post, react, pin, read everything.
create or replace function public.comm_is_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conv is not null and exists (
    select 1 from public.comm_members m
     where m.conversation_id = p_conv
       and m.user_id = (select auth.uid())
       and m.removed_at is null
  );
$$;
revoke all on function public.comm_is_member(uuid) from public, anon;
grant execute on function public.comm_is_member(uuid) to authenticated;

-- May the caller read something in this conversation created at p_at?
-- p_at NULL asks about the conversation itself (its row, its member list):
-- a former member may still see those. FALSE for a null conversation, so a
-- malformed storage path can never pass.
--
-- STRICTLY BEFORE the removal: a message stamped at the removal instant is on
-- the far side of it. Every comm timestamp is clock_timestamp(), not now() —
-- now() is frozen for a whole transaction, so a removal and the next message
-- written in the same transaction would tie and the cut-off would leak.
create or replace function public.comm_can_read_at(p_conv uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_conv is not null and (
    exists (
      select 1 from public.comm_members m
       where m.conversation_id = p_conv
         and m.user_id = (select auth.uid())
         and (m.removed_at is null or p_at is null or p_at < m.removed_at)
    )
    or (
      (select auth.uid()) is not null
      and exists (
        select 1 from public.comm_conversations c
         where c.id = p_conv and c.kind = 'channel' and c.visibility = 'public'
      )
    )
  );
$$;
revoke all on function public.comm_can_read_at(uuid, timestamptz) from public, anon;
grant execute on function public.comm_can_read_at(uuid, timestamptz) to authenticated;

create or replace function public.comm_message_visible(p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comm_messages g
     where g.id = p_message
       and public.comm_can_read_at(g.conversation_id, g.created_at)
  );
$$;
revoke all on function public.comm_message_visible(uuid) from public, anon;
grant execute on function public.comm_message_visible(uuid) to authenticated;

-- May the caller manage this conversation (add / remove others, rename,
-- archive)? Direct: never. Group: its owner or admin. Channel: its owner or
-- admin, or anyone holding communication:edit.
create or replace function public.comm_can_manage(p_conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comm_conversations c
     where c.id = p_conv
       and c.kind <> 'direct'
       and (
         exists (
           select 1 from public.comm_members m
            where m.conversation_id = c.id
              and m.user_id = (select auth.uid())
              and m.removed_at is null
              and m.role in ('owner', 'admin')
         )
         or (c.kind = 'channel' and public.has_permission('communication', 'edit'))
       )
  );
$$;
revoke all on function public.comm_can_manage(uuid) from public, anon;
grant execute on function public.comm_can_manage(uuid) to authenticated;

-- The conversation a storage key belongs to, or NULL when the key is not
-- shaped like one of ours. Tested before cast: an exception inside a storage
-- policy is a 500, not a refusal (0458's order_channel_of_path).
create or replace function public.comm_conversation_of_path(p_name text)
returns uuid language sql stable set search_path = '' as $$
  select case
    when coalesce((storage.foldername(p_name))[1], '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;
revoke all on function public.comm_conversation_of_path(text) from public, anon;
grant execute on function public.comm_conversation_of_path(text) to authenticated;

-- Reading a FILE is reading the message it is attached to. Not "a member of the
-- folder's conversation": that would hand a removed member every file posted
-- after they left, to anyone who learned the key.
create or replace function public.comm_can_read_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comm_attachments a
      join public.comm_messages g on g.id = a.message_id
     where a.storage_path = p_name
       and g.deleted_at is null
       and public.comm_can_read_at(g.conversation_id, g.created_at)
  );
$$;
revoke all on function public.comm_can_read_file(text) from public, anon;
grant execute on function public.comm_can_read_file(text) to authenticated;

-- The bucket's MIME allowlist, stated once so the bucket row below and the send
-- RPC cannot disagree.
create or replace function public.comm_allowed_mime(p_mime text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(lower(p_mime), '') = any (array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]);
$$;
revoke all on function public.comm_allowed_mime(text) from public, anon;
grant execute on function public.comm_allowed_mime(text) to authenticated;

-- Active logins among p_ids (distinct, nulls and p_except dropped).
create or replace function public.comm_active_profiles(p_ids uuid[], p_except uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct p.id), '{}')
    from public.profiles p
   where p.id = any (coalesce(p_ids, '{}'))
     and p.id is distinct from p_except
     and coalesce(p.is_active, true);
$$;
revoke all on function public.comm_active_profiles(uuid[], uuid) from public, anon;
grant execute on function public.comm_active_profiles(uuid[], uuid) to authenticated;


-- ---------- 6. RLS — reads only -----------------------------------------------

alter table public.comm_conversations enable row level security;
alter table public.comm_members       enable row level security;
alter table public.comm_messages      enable row level security;
alter table public.comm_mentions      enable row level security;
alter table public.comm_reactions     enable row level security;
alter table public.comm_pins          enable row level security;
alter table public.comm_saved         enable row level security;
alter table public.comm_attachments   enable row level security;

drop policy if exists comm_conversations_read on public.comm_conversations;
create policy comm_conversations_read on public.comm_conversations
  for select to authenticated using (public.comm_can_read_at(id, null));

drop policy if exists comm_members_read on public.comm_members;
create policy comm_members_read on public.comm_members
  for select to authenticated using (public.comm_can_read_at(conversation_id, null));

drop policy if exists comm_messages_read on public.comm_messages;
create policy comm_messages_read on public.comm_messages
  for select to authenticated using (public.comm_can_read_at(conversation_id, created_at));

drop policy if exists comm_mentions_read on public.comm_mentions;
create policy comm_mentions_read on public.comm_mentions
  for select to authenticated using (public.comm_message_visible(message_id));

drop policy if exists comm_reactions_read on public.comm_reactions;
create policy comm_reactions_read on public.comm_reactions
  for select to authenticated using (public.comm_message_visible(message_id));

drop policy if exists comm_pins_read on public.comm_pins;
create policy comm_pins_read on public.comm_pins
  for select to authenticated using (public.comm_message_visible(message_id));

drop policy if exists comm_attachments_read on public.comm_attachments;
create policy comm_attachments_read on public.comm_attachments
  for select to authenticated using (public.comm_message_visible(message_id));

-- Saved: your own rows, on a message you can read. The only direct-write table.
drop policy if exists comm_saved_read   on public.comm_saved;
drop policy if exists comm_saved_insert on public.comm_saved;
drop policy if exists comm_saved_delete on public.comm_saved;
create policy comm_saved_read on public.comm_saved
  for select to authenticated using (user_id = (select auth.uid()));
create policy comm_saved_insert on public.comm_saved
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.comm_message_visible(message_id));
create policy comm_saved_delete on public.comm_saved
  for delete to authenticated using (user_id = (select auth.uid()));


-- ---------- 7. write RPCs -------------------------------------------------------

-- 7a. Open (or find) the one DM between the caller and p_other.
create or replace function public.comm_open_direct(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_key text;
  v_id  uuid;
begin
  if p_other is null or p_other = v_me then
    raise exception 'Pick someone else to message.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_other and coalesce(p.is_active, true)) then
    raise exception 'That person cannot receive messages.' using errcode = '22023';
  end if;

  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);

  insert into public.comm_conversations (kind, direct_key, visibility, created_by)
  values ('direct', v_key, 'private', v_me)
  on conflict (direct_key) where direct_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.comm_conversations c where c.direct_key = v_key;
  end if;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'member', v_me), (v_id, p_other, 'member', v_me)
  on conflict (conversation_id, user_id) do nothing;

  return v_id;
end $$;
revoke all on function public.comm_open_direct(uuid) from public, anon;
grant execute on function public.comm_open_direct(uuid) to authenticated;


-- 7b. A group conversation. Any active login may start one.
create or replace function public.comm_create_group(p_name text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_others uuid[];
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_id     uuid;
begin
  v_others := public.comm_active_profiles(p_member_ids, v_me);
  if coalesce(array_length(v_others, 1), 0) = 0 then
    raise exception 'Add at least one other person to the group.' using errcode = '22023';
  end if;
  if array_length(v_others, 1) > 99 then
    raise exception 'A group can have at most 100 people. Use a channel instead.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'Keep the group name to 80 characters.' using errcode = '22023';
  end if;

  insert into public.comm_conversations (kind, name, visibility, created_by)
  values ('group', v_name, 'private', v_me)
  returning id into v_id;

  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'owner', v_me);
  insert into public.comm_members (conversation_id, user_id, role, added_by)
  select v_id, u, 'member', v_me from unnest(v_others) u;

  return v_id;
end $$;
revoke all on function public.comm_create_group(text, uuid[]) from public, anon;
grant execute on function public.comm_create_group(text, uuid[]) to authenticated;


-- 7c. A channel. Needs communication:create.
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
  if p_department_id is not null and not exists (
       select 1 from public.departments d where d.id = p_department_id and not coalesce(d.blocked, false)) then
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


-- 7d. Add the department's logins to a department channel. ADDS ONLY, and
-- steps over anyone a person removed (their removed_at survives) — 0458's sync
-- rule. Returns rows added by this call.
create or replace function public.comm_sync_department_members(p_conv uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_dept uuid;
  n      integer;
begin
  if not public.comm_can_manage(p_conv) then
    raise exception 'Only the channel''s owners or admins can do that.' using errcode = '42501';
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


-- 7e. Add people (or re-add someone removed). Managers only; never a DM.
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
  if not public.comm_can_manage(p_conv) then
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


-- 7f. Remove someone, or leave (p_user = yourself). Never from a DM.
create or replace function public.comm_remove_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_kind   text;
  v_target public.comm_members%rowtype;
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
    if not public.comm_can_manage(p_conv) then
      raise exception 'Only the owners or admins can remove people.' using errcode = '42501';
    end if;
    -- An admin cannot remove an owner or another admin; an owner (or a
    -- communication:edit holder on a channel) can.
    if v_target.role in ('owner', 'admin')
       and not exists (select 1 from public.comm_members m
                        where m.conversation_id = p_conv and m.user_id = v_me
                          and m.removed_at is null and m.role = 'owner')
       and not (v_kind = 'channel' and public.has_permission('communication', 'edit')) then
      raise exception 'Only an owner can remove an owner or admin.' using errcode = '42501';
    end if;
  end if;

  -- The last owner may not leave a conversation others are still in: nobody
  -- could then add or remove anyone.
  if v_target.role = 'owner'
     and not exists (select 1 from public.comm_members m
                      where m.conversation_id = p_conv and m.removed_at is null
                        and m.role = 'owner' and m.user_id <> p_user)
     and exists (select 1 from public.comm_members m
                  where m.conversation_id = p_conv and m.removed_at is null
                    and m.user_id <> p_user) then
    raise exception 'Make someone else an owner first.' using errcode = '55000';
  end if;

  update public.comm_members
     set removed_at = clock_timestamp(), removed_by = v_me
   where id = v_target.id;
end $$;
revoke all on function public.comm_remove_member(uuid, uuid) from public, anon;
grant execute on function public.comm_remove_member(uuid, uuid) to authenticated;


-- 7g. Change someone's role. Owners (or communication:edit on a channel).
create or replace function public.comm_set_member_role(p_conv uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_kind text;
  v_old  text;
begin
  if coalesce(p_role, '') not in ('owner', 'admin', 'member') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  select c.kind into v_kind from public.comm_conversations c where c.id = p_conv;
  if v_kind is null or v_kind = 'direct' then
    raise exception 'Roles do not apply to a direct message.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.comm_members m
                  where m.conversation_id = p_conv and m.user_id = v_me
                    and m.removed_at is null and m.role = 'owner')
     and not (v_kind = 'channel' and public.has_permission('communication', 'edit')) then
    raise exception 'Only an owner can change roles.' using errcode = '42501';
  end if;

  select m.role into v_old from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = p_user and m.removed_at is null
   for update;
  if v_old is null then
    raise exception 'That person is not in this conversation.' using errcode = '22023';
  end if;
  if v_old = 'owner' and p_role <> 'owner'
     and not exists (select 1 from public.comm_members m
                      where m.conversation_id = p_conv and m.removed_at is null
                        and m.role = 'owner' and m.user_id <> p_user) then
    raise exception 'Make someone else an owner first.' using errcode = '55000';
  end if;

  update public.comm_members set role = p_role
   where conversation_id = p_conv and user_id = p_user and removed_at is null;
end $$;
revoke all on function public.comm_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.comm_set_member_role(uuid, uuid, text) to authenticated;


-- 7h. Join a public channel yourself (or re-join after leaving).
create or replace function public.comm_join_channel(p_conv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if not exists (select 1 from public.comm_conversations c
                  where c.id = p_conv and c.kind = 'channel'
                    and c.visibility = 'public' and not c.is_archived) then
    raise exception 'That channel cannot be joined.' using errcode = '42501';
  end if;
  insert into public.comm_members (conversation_id, user_id, role, added_by)
  values (p_conv, v_me, 'member', v_me)
  on conflict (conversation_id, user_id) do update
     set removed_at = null, removed_by = null, joined_at = clock_timestamp(), role = 'member'
   where public.comm_members.removed_at is not null;
end $$;
revoke all on function public.comm_join_channel(uuid) from public, anon;
grant execute on function public.comm_join_channel(uuid) to authenticated;


-- 7i. Rename / re-topic / archive a group or channel. Managers only.
-- Visibility is deliberately NOT editable here: private → public would publish
-- a history its members wrote believing it private.
create or replace function public.comm_update_conversation(
  p_conv uuid, p_name text, p_topic text, p_archived boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_kind text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select c.kind into v_kind from public.comm_conversations c where c.id = p_conv;
  if v_kind is null or v_kind = 'direct' then
    raise exception 'A direct message cannot be renamed or archived.' using errcode = '22023';
  end if;
  if not public.comm_can_manage(p_conv) then
    raise exception 'Only the owners or admins can change this.' using errcode = '42501';
  end if;
  if v_kind = 'channel' and v_name is null then
    raise exception 'A channel needs a name.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_name, '')) > 80 or char_length(coalesce(p_topic, '')) > 250 then
    raise exception 'The name or topic is too long.' using errcode = '22023';
  end if;

  begin
    update public.comm_conversations
       set name = v_name,
           topic = nullif(btrim(coalesce(p_topic, '')), ''),
           is_archived = coalesce(p_archived, is_archived)
     where id = p_conv;
  exception when unique_violation then
    raise exception 'A channel named "%" already exists.', v_name using errcode = '23505';
  end;
end $$;
revoke all on function public.comm_update_conversation(uuid, text, text, boolean) from public, anon;
grant execute on function public.comm_update_conversation(uuid, text, text, boolean) to authenticated;


-- The <@uuid> tokens in a body that name ACTIVE members of p_conv other than
-- p_author. A token for anyone else is left as text and mentions nobody.
create or replace function public.comm_parse_mentions(p_conv uuid, p_body text, p_author uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
    from regexp_matches(coalesce(p_body, ''),
           '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>', 'g') r
    join public.comm_members m
      on m.conversation_id = p_conv
     and m.user_id = (r[1])::uuid
     and m.removed_at is null
     and m.user_id is distinct from p_author;
$$;
revoke all on function public.comm_parse_mentions(uuid, text, uuid) from public, anon;
grant execute on function public.comm_parse_mentions(uuid, text, uuid) to authenticated;


-- 7j. SEND. Idempotent on (author, client_id). Returns
--   { id, created, created_at, kind, mentioned: [profile ids] }
-- `created = false` means this exact send already landed (a retry); the
-- caller must not notify twice.
create or replace function public.comm_send_message(
  p_conv uuid, p_client_id uuid, p_body text,
  p_parent_id uuid default null, p_attachments jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.comm_actor();
  v_conv     public.comm_conversations%rowtype;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_atts     jsonb := case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end;
  v_att      jsonb;
  v_path     text;
  v_mime     text;
  v_size     bigint;
  v_fname    text;
  v_parent   public.comm_messages%rowtype;
  v_existing public.comm_messages%rowtype;
  v_id       uuid;
  v_at       timestamptz;
  v_mentions uuid[];
begin
  if p_client_id is null then
    raise exception 'Missing message key.' using errcode = '22023';
  end if;

  -- A replay of a send that already landed: hand back the original.
  select * into v_existing from public.comm_messages g
   where g.author_id = v_me and g.client_id = p_client_id;
  if found then
    if v_existing.conversation_id <> p_conv then
      raise exception 'Message key reused in another conversation.' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_existing.id, 'created', false,
                              'created_at', v_existing.created_at,
                              'mentioned', '[]'::jsonb);
  end if;

  select * into v_conv from public.comm_conversations c where c.id = p_conv;
  if not found or not public.comm_is_member(p_conv) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  if v_conv.is_archived then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;
  if v_body is null and jsonb_array_length(v_atts) = 0 then
    raise exception 'Type a message or attach a file.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_body, '')) > 8000 then
    raise exception 'A message can be at most 8,000 characters.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_atts) > 10 then
    raise exception 'Attach at most 10 files to one message.' using errcode = '22023';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.comm_messages g where g.id = p_parent_id for update;
    if not found or v_parent.conversation_id <> p_conv then
      raise exception 'That thread is not in this conversation.' using errcode = '22023';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'Reply to the thread''s first message.' using errcode = '22023';
    end if;
    if v_parent.deleted_at is not null then
      raise exception 'That message was deleted.' using errcode = '22023';
    end if;
  end if;

  insert into public.comm_messages (conversation_id, author_id, kind, body, parent_id, client_id)
  values (p_conv, v_me, 'message', v_body, p_parent_id, p_client_id)
  on conflict (author_id, client_id) where client_id is not null do nothing
  returning id, created_at into v_id, v_at;

  if v_id is null then
    -- Lost a race with an identical concurrent send.
    select * into v_existing from public.comm_messages g
     where g.author_id = v_me and g.client_id = p_client_id;
    return jsonb_build_object('id', v_existing.id, 'created', false,
                              'created_at', v_existing.created_at,
                              'mentioned', '[]'::jsonb);
  end if;

  -- Attachments: the bytes were uploaded first (the storage insert policy
  -- already required active membership of the folder's conversation); this
  -- validates the key shape, type and size SERVER-SIDE before recording them.
  for v_att in select * from jsonb_array_elements(v_atts) loop
    v_path  := v_att ->> 'storage_path';
    v_mime  := lower(coalesce(v_att ->> 'mime_type', ''));
    v_fname := nullif(btrim(coalesce(v_att ->> 'file_name', '')), '');
    begin
      v_size := (v_att ->> 'size_bytes')::bigint;
    exception when others then
      v_size := null;
    end;
    if v_path is null or v_path !~* ('^' || p_conv::text
         || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$') then
      raise exception 'An attachment is not stored where this conversation''s files go.' using errcode = '22023';
    end if;
    if not public.comm_allowed_mime(v_mime) then
      raise exception 'That file type cannot be shared here.' using errcode = '22023';
    end if;
    if v_size is null or v_size < 1 or v_size > 20971520 then
      raise exception 'Files must be under 20 MB.' using errcode = '22023';
    end if;
    if v_fname is null or char_length(v_fname) > 255 then
      raise exception 'An attachment needs a file name under 255 characters.' using errcode = '22023';
    end if;
    begin
      insert into public.comm_attachments
        (message_id, conversation_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
      values (v_id, p_conv, v_fname, v_path, v_mime, v_size, v_me);
    exception when unique_violation then
      raise exception 'That file is already attached to a message.' using errcode = '23505';
    end;
  end loop;

  v_mentions := public.comm_parse_mentions(p_conv, v_body, v_me);
  insert into public.comm_mentions (message_id, user_id)
  select v_id, u from unnest(v_mentions) u;

  if p_parent_id is null then
    update public.comm_conversations set last_message_at = v_at where id = p_conv;
    -- Your own message is read by you.
    update public.comm_members
       set last_read_at = greatest(coalesce(last_read_at, v_at), v_at)
     where conversation_id = p_conv and user_id = v_me and removed_at is null;
  else
    update public.comm_messages
       set reply_count = reply_count + 1, last_reply_at = v_at
     where id = p_parent_id;
  end if;

  return jsonb_build_object('id', v_id, 'created', true, 'created_at', v_at,
                            'kind', v_conv.kind, 'mentioned', to_jsonb(v_mentions));
end $$;
revoke all on function public.comm_send_message(uuid, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.comm_send_message(uuid, uuid, text, uuid, jsonb) to authenticated;


-- 7k. EDIT your own words. Returns { mentioned: [NEWLY mentioned ids] } so an
-- edit that adds a mention notifies only the person just added.
create or replace function public.comm_edit_message(p_message uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_msg  public.comm_messages%rowtype;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_old  uuid[];
  v_new  uuid[];
begin
  select * into v_msg from public.comm_messages g where g.id = p_message for update;
  if not found or v_msg.author_id is distinct from v_me or v_msg.kind <> 'message' then
    raise exception 'Only the person who wrote a message can edit it.' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'That message was deleted.' using errcode = '22023';
  end if;
  if not public.comm_is_member(v_msg.conversation_id) then
    raise exception 'You are no longer in this conversation.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_conversations c where c.id = v_msg.conversation_id and c.is_archived) then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;
  if v_body is null and not exists (select 1 from public.comm_attachments a where a.message_id = p_message) then
    raise exception 'A message cannot be emptied. Delete it instead.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_body, '')) > 8000 then
    raise exception 'A message can be at most 8,000 characters.' using errcode = '22023';
  end if;

  select coalesce(array_agg(x.user_id), '{}') into v_old
    from public.comm_mentions x where x.message_id = p_message;
  v_new := public.comm_parse_mentions(v_msg.conversation_id, v_body, v_me);

  delete from public.comm_mentions x
   where x.message_id = p_message and not (x.user_id = any (v_new));
  insert into public.comm_mentions (message_id, user_id)
  select p_message, u from unnest(v_new) u
  on conflict (message_id, user_id) do nothing;

  update public.comm_messages set body = v_body, edited_at = clock_timestamp() where id = p_message;

  return jsonb_build_object('mentioned', to_jsonb(coalesce(
    (select array_agg(u) from unnest(v_new) u where not (u = any (v_old))), '{}'::uuid[])));
end $$;
revoke all on function public.comm_edit_message(uuid, text) from public, anon;
grant execute on function public.comm_edit_message(uuid, text) to authenticated;


-- 7l. DELETE (soft). The author, a manager of the conversation, or a holder of
-- communication:delete on a channel. Idempotent. Returns { paths: [...] } —
-- the storage keys whose bytes the server action removes with the storage API
-- (bytes are not deleted from SQL; storage.objects rows are not the bytes).
create or replace function public.comm_delete_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.comm_actor();
  v_msg   public.comm_messages%rowtype;
  v_kind  text;
  v_paths text[];
begin
  select * into v_msg from public.comm_messages g where g.id = p_message for update;
  if not found or not public.comm_can_read_at(v_msg.conversation_id, v_msg.created_at) then
    raise exception 'That message could not be found.' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    return jsonb_build_object('paths', '[]'::jsonb);
  end if;

  select c.kind into v_kind from public.comm_conversations c where c.id = v_msg.conversation_id;
  if not (
       v_msg.author_id = v_me
       or public.comm_can_manage(v_msg.conversation_id)
       or (v_kind = 'channel' and public.has_permission('communication', 'delete'))
     ) then
    raise exception 'You can only delete your own messages.' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.comm_attachments a where a.message_id = p_message;

  delete from public.comm_attachments where message_id = p_message;
  delete from public.comm_mentions    where message_id = p_message;
  delete from public.comm_reactions   where message_id = p_message;
  delete from public.comm_pins        where message_id = p_message;

  update public.comm_messages
     set body = null, deleted_at = clock_timestamp(), deleted_by = v_me
   where id = p_message;

  if v_msg.parent_id is not null then
    update public.comm_messages
       set reply_count = greatest(reply_count - 1, 0)
     where id = v_msg.parent_id;
  end if;

  return jsonb_build_object('paths', to_jsonb(v_paths));
end $$;
revoke all on function public.comm_delete_message(uuid) from public, anon;
grant execute on function public.comm_delete_message(uuid) to authenticated;


-- 7m. Move your read marker forward (never back, never into the future).
create or replace function public.comm_mark_read(p_conv uuid, p_until timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
  v_at timestamptz;
begin
  update public.comm_members
     set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz),
                                 least(coalesce(p_until, clock_timestamp()), clock_timestamp()))
   where conversation_id = p_conv and user_id = v_me and removed_at is null
  returning last_read_at into v_at;
  if v_at is null then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  return v_at;
end $$;
revoke all on function public.comm_mark_read(uuid, timestamptz) from public, anon;
grant execute on function public.comm_mark_read(uuid, timestamptz) to authenticated;


create or replace function public.comm_set_muted(p_conv uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  update public.comm_members set muted = coalesce(p_muted, false)
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
  if not found then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.comm_set_muted(uuid, boolean) from public, anon;
grant execute on function public.comm_set_muted(uuid, boolean) to authenticated;


-- 7n. React / un-react. Returns TRUE when the reaction is now ON.
create or replace function public.comm_toggle_reaction(p_message uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.comm_actor();
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_conv  uuid;
  v_on    boolean;
begin
  select g.conversation_id into v_conv from public.comm_messages g
   where g.id = p_message and g.deleted_at is null;
  if v_conv is null or not public.comm_is_member(v_conv) then
    raise exception 'Join the conversation to react.' using errcode = '42501';
  end if;
  if char_length(v_emoji) not between 1 and 32 or v_emoji ~ '\s' then
    raise exception 'That reaction cannot be used.' using errcode = '22023';
  end if;

  delete from public.comm_reactions
   where message_id = p_message and user_id = v_me and emoji = v_emoji;
  if found then
    v_on := false;
  else
    if (select count(distinct r.emoji) from public.comm_reactions r where r.message_id = p_message) >= 20 then
      raise exception 'This message already has 20 different reactions.' using errcode = '22023';
    end if;
    insert into public.comm_reactions (message_id, user_id, emoji) values (p_message, v_me, v_emoji)
    on conflict do nothing;
    v_on := true;
  end if;

  update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
  return v_on;
end $$;
revoke all on function public.comm_toggle_reaction(uuid, text) from public, anon;
grant execute on function public.comm_toggle_reaction(uuid, text) to authenticated;


-- 7o. Pin / unpin. Any active member, as in most team chats.
create or replace function public.comm_set_pin(p_message uuid, p_pinned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_conv uuid;
begin
  select g.conversation_id into v_conv from public.comm_messages g
   where g.id = p_message and g.deleted_at is null;
  if v_conv is null or not public.comm_is_member(v_conv) then
    raise exception 'Join the conversation to pin messages.' using errcode = '42501';
  end if;

  if coalesce(p_pinned, false) then
    insert into public.comm_pins (message_id, conversation_id, pinned_by)
    values (p_message, v_conv, v_me)
    on conflict (message_id) do nothing;
  else
    delete from public.comm_pins where message_id = p_message;
  end if;

  update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
end $$;
revoke all on function public.comm_set_pin(uuid, boolean) from public, anon;
grant execute on function public.comm_set_pin(uuid, boolean) to authenticated;


-- ---------- 8. read RPCs --------------------------------------------------------

-- 8a. The caller's conversation list with unread counts, in ONE query — not one
-- count per row from the client (spec §12).
create or replace function public.comm_my_conversations(p_kind text default null)
returns table (
  id uuid, kind text, name text, topic text, visibility text, department_id uuid,
  is_archived boolean, last_message_at timestamptz, created_at timestamptz,
  my_role text, muted boolean, last_read_at timestamptz,
  unread_count integer, mention_count integer,
  other_user_id uuid, member_count integer
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
           where o.conversation_id = c.id and o.removed_at is null)
    from public.comm_members m
    join public.comm_conversations c on c.id = m.conversation_id
   where m.user_id = (select auth.uid())
     and m.removed_at is null
     and (p_kind is null or c.kind = p_kind)
   order by coalesce(c.last_message_at, c.created_at) desc;
$$;
revoke all on function public.comm_my_conversations(text) from public, anon;
grant execute on function public.comm_my_conversations(text) to authenticated;


-- 8b. The people picker. `profiles_read_own` hides every other login, and the
-- existing directory readers (notification_admin_people, override_grantee_
-- candidates) are admin-gated, so messaging needs its own NARROW one: id,
-- display name, employee code, and the designation / department of the staff
-- row the login soft-matches (0674's rule). No e-mail, phone, salary or unit.
create or replace function public.comm_directory(p_q text default null, p_limit integer default 20)
returns table (id uuid, full_name text, employee_code text, designation text, department text)
language sql stable security definer set search_path = '' as $$
  with q as (
    select nullif(btrim(coalesce(p_q, '')), '') as raw
  ), pat as (
    select '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pat
      from q
  )
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)) as full_name,
         p.employee_code,
         d.name,
         dep.name
    from public.profiles p
    left join lateral (
      select s.designation_id, s.department_id
        from public.staff s
       where coalesce(s.is_active, true) and not coalesce(s.blocked, false)
         and (
              (nullif(btrim(p.employee_code), '') is not null
               and lower(btrim(p.employee_code)) = lower(btrim(s.code)))
           or (nullif(btrim(p.email), '') is not null
               and lower(btrim(p.email)) = lower(btrim(s.email)))
         )
       order by (lower(btrim(coalesce(p.employee_code, ''))) = lower(btrim(coalesce(s.code, '')))) desc
       limit 1
    ) s on true
    left join public.designations d on d.id = s.designation_id
    left join public.departments dep on dep.id = s.department_id
    cross join pat
   where (select auth.uid()) is not null
     and coalesce(p.is_active, true)
     and (
          pat.like_pat is null
       or p.full_name     ilike pat.like_pat
       or p.employee_code ilike pat.like_pat
       or dep.name        ilike pat.like_pat
     )
   order by 2
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.comm_directory(text, integer) from public, anon;
grant execute on function public.comm_directory(text, integer) to authenticated;


-- ---------- 9. the bucket -------------------------------------------------------
--
-- Private, with the size and type limits enforced BY STORAGE as well as by the
-- send RPC — the only other bucket that does is company-assets (0589). Every
-- other bucket in this app validates in the browser only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comm-files', 'comm-files', false, 20971520,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

drop policy if exists comm_files_read   on storage.objects;
drop policy if exists comm_files_insert on storage.objects;

-- Read = can read the message the file is attached to (comm_can_read_file).
create policy comm_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'comm-files' and public.comm_can_read_file(name));

-- Upload = an ACTIVE member of the folder's conversation. No UPDATE policy
-- (uploads are never upserted) and no DELETE policy: bytes are removed by the
-- server action with the service role, after comm_delete_message confirms.
create policy comm_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comm-files'
              and public.comm_is_member(public.comm_conversation_of_path(name)));


-- ---------- 10. live updates ------------------------------------------------------
-- Messages only (see header: DELETE events are not RLS-filtered, and member
-- rows would broadcast read receipts).
do $rt$
begin
  begin
    execute 'alter publication supabase_realtime add table public.comm_messages';
  exception when duplicate_object then null;
  end;
end $rt$;


-- ============================================================================
-- 11. ASSERTIONS — from the catalog, never from reading this file (0458 §12).
-- Behavioural claims are asserted by attempting the violation. The full
-- impersonated access matrix is scripts/comms-smoke-test.sql.
-- ============================================================================

do $assert$
declare
  n   integer;
  u1  uuid;
  u2  uuid;
  c1  uuid;
begin
  -- (a) RLS is ON for every table. A policy on an RLS-off table is inert.
  if (select count(*) from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public'
         and c.relname in ('comm_conversations', 'comm_members', 'comm_messages', 'comm_mentions',
                           'comm_reactions', 'comm_pins', 'comm_saved', 'comm_attachments')
         and c.relrowsecurity) <> 8 then
    raise exception '0737: row level security is NOT enabled on all eight comm tables';
  end if;

  -- (b) no comm_ function is executable by anon or PUBLIC.
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where p.proname like 'comm\_%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or p.proacl is null
          or p.proacl::text ~ '(\{|,)=X');
  if n > 0 then
    raise exception '0737: % comm function(s) are executable by anon/public', n;
  end if;

  -- (c) THE ISOLATION CLAIM: every SELECT policy gates through a comm_ gate or
  --     the caller's own id — never a bare has_permission.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename like 'comm\_%' and cmd = 'SELECT'
       and coalesce(qual, '') !~ '(comm_can_read_at|comm_message_visible|auth\.uid)'
  ) then
    raise exception '0737: a comm SELECT policy does not gate on membership';
  end if;

  -- (d) NO DIRECT WRITES except comm_saved. A write policy on messages or
  --     members would let the browser name its own author or un-remove itself.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename like 'comm\_%' and tablename <> 'comm_saved'
       and cmd <> 'SELECT'
  ) then
    raise exception '0737: a comm table other than comm_saved has a write policy';
  end if;

  -- (e) the bucket is PRIVATE and limited, with exactly two policies.
  if not exists (select 1 from storage.buckets where id = 'comm-files' and not public
                   and file_size_limit = 20971520 and allowed_mime_types is not null) then
    raise exception '0737: comm-files is missing, public, or unlimited';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname like 'comm\_files\_%') <> 2 then
    raise exception '0737: expected 2 storage.objects policies for comm-files';
  end if;

  -- (f) a malformed storage key resolves to no conversation (and so to FALSE).
  if public.comm_conversation_of_path('not-a-uuid/x.png') is not null then
    raise exception '0737: comm_conversation_of_path accepted a malformed key';
  end if;

  -- (g) ONE DM PER PAIR, proved by attempting the second one.
  select p.id into u1 from public.profiles p order by p.created_at limit 1;
  select p.id into u2 from public.profiles p where p.id <> u1 order by p.created_at limit 1;
  if u2 is not null then
    insert into public.comm_conversations (kind, direct_key, created_by)
    values ('direct', '0737-probe:' || u1::text, u1) returning id into c1;
    begin
      insert into public.comm_conversations (kind, direct_key, created_by)
      values ('direct', '0737-probe:' || u1::text, u1);
      raise exception '0737: a SECOND direct conversation was accepted for one pair — uq_comm_conv_direct is not enforcing';
    exception when unique_violation then
      null;
    end;

    -- (h) a system line cannot carry an author.
    begin
      insert into public.comm_messages (conversation_id, author_id, kind, body)
      values (c1, u1, 'system', 'forged');
      raise exception '0737: a system message was accepted WITH an author';
    exception when check_violation then
      null;
    end;

    -- (i) a retried send with the same client key is refused by the index.
    insert into public.comm_messages (conversation_id, author_id, body, client_id)
    values (c1, u1, 'probe', '00000000-0000-4000-8000-000000000737');
    begin
      insert into public.comm_messages (conversation_id, author_id, body, client_id)
      values (c1, u1, 'probe again', '00000000-0000-4000-8000-000000000737');
      raise exception '0737: a duplicate (author, client_id) send was accepted';
    exception when unique_violation then
      null;
    end;

    delete from public.comm_conversations where id = c1;   -- cascades the probe rows
  end if;

  -- (j) a group cannot be public.
  begin
    insert into public.comm_conversations (kind, name, visibility) values ('group', 'probe', 'public');
    raise exception '0737: a PUBLIC group was accepted';
  exception when check_violation then
    null;
  end;

  -- (k) the permission vocabulary is seeded.
  if (select count(*) from public.permissions where module = 'communication') < 4 then
    raise exception '0737: communication permissions are not seeded';
  end if;
end $assert$;
