-- ============================================================================
-- Raagam ERP — 0751 Communication Hub: channel management
--
-- Development Task 02 (doc/slack.md/slack §5 "Channels"). EXTENDS what 0737
-- built — a channel is a `comm_conversations` row of kind 'channel' and its
-- people are `comm_members` rows — rather than adding a parallel
-- chat_channels / chat_channel_members pair beside them. What this adds:
--
--   * description, archived_at / archived_by, a retry key, and the workspace
--     (0750) every conversation belongs to;
--   * a NAMING RULE for channels, enforced by a constraint;
--   * per-person preferences on the membership row: pinned, notify level;
--   * explicit channel permissions (owner / moderator / member) and a stated
--     precedence for workspace administrators;
--   * discovery, the sidebar list, ownership transfer, archive / restore.
--
--
-- ## ROLES: 'admin' IS THE MODERATOR
--
-- comm_members.role is owner | admin | member, shared with groups. On a
-- CHANNEL the screen calls 'admin' "Moderator" — renaming the stored value
-- would rewrite every group's rows and every function reading it for no gain.
--
--   action                         owner  moderator  governor*  member
--   description / topic              ✓        ✓          ✓
--   rename                           ✓                   ✓
--   add people                       ✓        ✓          ✓
--   remove a MEMBER                  ✓        ✓          ✓
--   remove an owner / moderator      ✓                   ✓
--   change roles                     ✓                   ✓
--   transfer ownership               ✓                   ✓
--   archive / restore                ✓                   ✓
--   pin, notification level, leave   ✓        ✓          (if a member) ✓
--
-- * GOVERNOR = a workspace owner / admin (0750) or a holder of
--   communication:edit — and ONLY ON A PUBLIC CHANNEL. A private channel is
--   governed by its own owners and moderators and nobody else: a workspace
--   admin has no read access (comm_can_read_at never had a bypass) and, from
--   this migration, no management access either. 0737 let communication:edit
--   manage EVERY channel, which included adding yourself to a private one and
--   so reading it; that path is closed here (spec: "Workspace administrators
--   must not automatically gain access to private channel content").
--   Consequence, stated rather than hidden: if every owner of a PRIVATE
--   channel is deactivated, nobody in the app can re-own it. The last owner
--   can never LEAVE (0737), so this happens only through deactivation;
--   recovering it is a database administrator's job, deliberately — the
--   alternative is a standing key to every private channel.
--
-- One rule, two readers: `comm_channel_can(conv, action)` is what every RPC
-- below enforces, and `comm_channel_abilities(conv)` hands the SAME answers to
-- the screen, so a button and its refusal cannot disagree.
--
--
-- ## NAMES
--
-- Lowercase letters, digits, '-' and '_'; starts with a letter or digit; 1–80
-- characters. The server NORMALISES before it validates — trims, lowercases,
-- turns runs of spaces into one '-' — so "Cutting Room" becomes cutting-room
-- rather than an error. Anything else (a '#', a '.', Tamil script) is refused
-- with the rule in the sentence. Unique among LIVE channels, case-folded
-- (0737's index): archiving frees a name, and restoring into a collision is
-- refused with a sentence saying so.
--
-- A RETRIED CREATE CANNOT MAKE TWO CHANNELS: the sheet mints `p_create_key`
-- once per open, `uq_comm_conv_create_key` is (created_by, create_key), and a
-- replay returns the channel the first call made.
--
--
-- ## ARCHIVE
--
-- Archiving keeps EVERYTHING — messages, members, roles, pins, preferences —
-- and only stops new activity: no posting, joining or adding people (0737's
-- send / join / add already refuse an archived conversation). It drops out of
-- discovery and the sidebar; its members and, for a public one, anyone in the
-- workspace can still open its history from Channels ▸ Archived. Restoring
-- puts it back exactly as it was.
--
--
-- ## PREFERENCES LIVE ON THE MEMBERSHIP ROW
--
-- A preference is the member's own; there is nothing to pin in a channel you
-- are not in. `notify_level` 'all' | 'mentions' | 'none'. 0737's `muted` stays
-- as the column lib/comms/notify.ts reads, kept equal to (notify_level <>
-- 'all') by both writers below, so the existing alert path needs one change:
-- 'none' also silences @mentions.
--
-- REPLACES (same signatures, same grants): comm_can_manage,
-- comm_update_conversation, comm_remove_member, comm_set_member_role,
-- comm_set_muted. REPLACES WITH A WIDER SIGNATURE: comm_create_channel — the
-- old five arguments are the first five of the new seven and the two new ones
-- default, so a caller passing the old five still resolves (no overload is
-- left behind for PostgREST to find ambiguous).
-- ============================================================================


-- ---------- 1. columns ---------------------------------------------------------

-- The workspace every conversation belongs to. One today (0750), but stated
-- on the row so a second can never be implicit.
create or replace function public.comm_workspace_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select w.id from public.comm_workspace w limit 1;
$$;
revoke all on function public.comm_workspace_id() from public, anon, authenticated;

alter table public.comm_conversations
  add column if not exists workspace_id uuid references public.comm_workspace(id) on delete restrict,
  add column if not exists description  text,
  add column if not exists archived_at  timestamptz,
  add column if not exists archived_by  uuid references public.profiles(id) on delete set null,
  add column if not exists create_key   uuid;

update public.comm_conversations set workspace_id = public.comm_workspace_id() where workspace_id is null;
-- Archived before this migration: the moment is unknown, so it is left NULL
-- rather than invented.
alter table public.comm_conversations alter column workspace_id set default public.comm_workspace_id();
alter table public.comm_conversations alter column workspace_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_comm_conv_desc_len') then
    alter table public.comm_conversations
      add constraint chk_comm_conv_desc_len check (description is null or char_length(description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_comm_conv_channel_name_format') then
    alter table public.comm_conversations
      add constraint chk_comm_conv_channel_name_format
      check (kind <> 'channel' or name ~ '^[a-z0-9][a-z0-9_-]{0,79}$') not valid;
    -- Validated separately so a non-conforming legacy name names itself in
    -- the error instead of failing the whole ALTER silently.
    alter table public.comm_conversations validate constraint chk_comm_conv_channel_name_format;
  end if;
end $$;

create unique index if not exists uq_comm_conv_create_key
  on public.comm_conversations (created_by, create_key) where create_key is not null;
create index if not exists idx_comm_conv_channels_live
  on public.comm_conversations (workspace_id, lower(name)) where kind = 'channel' and not is_archived;

comment on column public.comm_conversations.create_key is
  '0751: minted once per create sheet; (created_by, create_key) unique, so a retried create returns the first channel.';

alter table public.comm_members
  add column if not exists pinned_at    timestamptz,
  add column if not exists notify_level text not null default 'all';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_comm_members_notify_level') then
    alter table public.comm_members
      add constraint chk_comm_members_notify_level check (notify_level in ('all', 'mentions', 'none'));
  end if;
end $$;
-- A muted conversation was "no message alerts, mentions still alert" (notify.ts).
update public.comm_members set notify_level = 'mentions' where muted and notify_level = 'all';

create index if not exists idx_comm_members_user_pinned
  on public.comm_members (user_id, pinned_at) where removed_at is null and pinned_at is not null;


-- ---------- 2. the rule --------------------------------------------------------
--
-- INTERNAL (granted to nobody): they answer for auth.uid(), and only the
-- SECURITY DEFINER functions below should ask.

-- A channel name as the operator meant it: trimmed, lowercased, spaces → '-'.
-- Validation is separate (comm_channel_name_problem) so the two can be shown
-- apart: "this is what it will be called" vs "this cannot be a name".
create or replace function public.comm_channel_slug(p_name text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', '-', 'g'), '');
$$;
revoke all on function public.comm_channel_slug(text) from public, anon, authenticated;

create or replace function public.comm_channel_name_problem(p_slug text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_slug is null then 'A channel needs a name.'
    when char_length(p_slug) > 80 then 'Keep the channel name to 80 characters.'
    when p_slug !~ '^[a-z0-9][a-z0-9_-]*$' then
      'Use lowercase letters, numbers, - and _ in a channel name, starting with a letter or number.'
  end;
$$;
revoke all on function public.comm_channel_name_problem(text) from public, anon, authenticated;

-- Workspace owner / admin, or communication:edit. Governs PUBLIC channels only.
create or replace function public.comm_workspace_governs(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null
     and public.comm_workspace_status(p_user) = 'active'
     and (public.comm_workspace_role(p_user) in ('owner', 'admin')
          or public.has_permission('communication', 'edit', p_user));
$$;
revoke all on function public.comm_workspace_governs(uuid) from public, anon, authenticated;

-- May the caller do p_action on channel p_conv? See the table in the header.
-- FALSE for anything that is not a channel, and for an unknown action.
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
    when 'add_members'        then (v_owner or v_role = 'admin') and not c.is_archived
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


-- 0737's comm_can_manage, with the channel branch narrowed to the rule above:
-- an owner / moderator, or a governor on a PUBLIC channel. Groups unchanged.
-- getConversation and comm_add_members / comm_sync_department_members read it.
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
         or (c.kind = 'channel' and c.visibility = 'public'
             and public.comm_workspace_governs((select auth.uid())))
       )
  );
$$;
revoke all on function public.comm_can_manage(uuid) from public, anon;
grant execute on function public.comm_can_manage(uuid) to authenticated;


-- What the caller may do here, for the screen. Same function the RPCs ask.
-- A channel the caller cannot see is "not found" (22023) — never "forbidden",
-- which would confirm a private channel exists.
create or replace function public.comm_channel_abilities(p_conv uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_role text;
begin
  if v_me is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.comm_conversations c where c.id = p_conv and c.kind = 'channel')
     or not public.comm_can_read_at(p_conv, null) then
    raise exception 'That channel was not found.' using errcode = '22023';
  end if;
  select m.role into v_role from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = v_me and m.removed_at is null;
  return jsonb_build_object(
    'role', v_role,
    'governs', exists (select 1 from public.comm_conversations c
                        where c.id = p_conv and c.visibility = 'public')
               and coalesce(public.comm_workspace_governs(v_me), false),
    'edit_info', public.comm_channel_can(p_conv, 'edit_info'),
    'rename', public.comm_channel_can(p_conv, 'rename'),
    'add_members', public.comm_channel_can(p_conv, 'add_members'),
    'remove_members', public.comm_channel_can(p_conv, 'remove_members'),
    'remove_privileged', public.comm_channel_can(p_conv, 'remove_privileged'),
    'set_roles', public.comm_channel_can(p_conv, 'set_roles'),
    'transfer', public.comm_channel_can(p_conv, 'transfer'),
    'archive', public.comm_channel_can(p_conv, 'archive'),
    'join', public.comm_channel_can(p_conv, 'join'),
    'leave', public.comm_channel_can(p_conv, 'leave'),
    'preferences', public.comm_channel_can(p_conv, 'preferences')
  );
end $$;
revoke all on function public.comm_channel_abilities(uuid) from public, anon;
grant execute on function public.comm_channel_abilities(uuid) to authenticated;


-- ---------- 3. create (retry-safe, named by the rule) ---------------------------

drop function if exists public.comm_create_channel(text, text, text, uuid, uuid[]);

create or replace function public.comm_create_channel(
  p_name text, p_visibility text, p_topic text default null,
  p_department_id uuid default null, p_member_ids uuid[] default '{}',
  p_description text default null, p_create_key uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_name   text := public.comm_channel_slug(p_name);
  v_topic  text := nullif(btrim(coalesce(p_topic, '')), '');
  v_desc   text := nullif(btrim(coalesce(p_description, '')), '');
  v_why    text;
  v_others uuid[];
  v_id     uuid;
  v_con    text;
begin
  if not public.has_permission('communication', 'create')
     and public.comm_workspace_role(v_me) not in ('owner', 'admin') then
    raise exception 'You do not have permission to create channels.' using errcode = '42501';
  end if;

  -- A replay of a create that already landed returns that channel, unchanged.
  if p_create_key is not null then
    select c.id into v_id from public.comm_conversations c
     where c.created_by = v_me and c.create_key = p_create_key;
    if v_id is not null then return v_id; end if;
  end if;

  v_why := public.comm_channel_name_problem(v_name);
  if v_why is not null then
    raise exception '%', v_why using errcode = '22023';
  end if;
  if coalesce(p_visibility, '') not in ('public', 'private') then
    raise exception 'Choose whether the channel is public or private.' using errcode = '22023';
  end if;
  if v_topic is not null and char_length(v_topic) > 250 then
    raise exception 'Keep the topic to 250 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Keep the description to 500 characters.' using errcode = '22023';
  end if;
  -- A switched-off department is not offered (AGENTS.md "Disabled rows", 0749).
  if p_department_id is not null and not exists (
       select 1 from public.departments d where d.id = p_department_id and not coalesce(d.inactive, false)) then
    raise exception 'That department is not available.' using errcode = '22023';
  end if;

  begin
    insert into public.comm_conversations
      (kind, name, topic, description, visibility, department_id, created_by, create_key, workspace_id)
    values
      ('channel', v_name, v_topic, v_desc, p_visibility, p_department_id, v_me, p_create_key, public.comm_workspace_id())
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'uq_comm_conv_create_key' then
      -- Two copies of one create raced; the other one won. Same answer.
      select c.id into v_id from public.comm_conversations c
       where c.created_by = v_me and c.create_key = p_create_key;
      return v_id;
    end if;
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
revoke all on function public.comm_create_channel(text, text, text, uuid, uuid[], text, uuid) from public, anon;
grant execute on function public.comm_create_channel(text, text, text, uuid, uuid[], text, uuid) to authenticated;


-- ---------- 4. details, archive, restore -----------------------------------------

-- Name / description / topic. Each field is checked against its OWN action
-- only when it changes, so a moderator saving a new topic is not refused for
-- the name they did not touch. NULL p_name = keep the name.
create or replace function public.comm_update_channel(
  p_conv uuid, p_name text, p_description text, p_topic text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  c      public.comm_conversations%rowtype;
  v_name text := public.comm_channel_slug(p_name);
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_top  text := nullif(btrim(coalesce(p_topic, '')), '');
  v_why  text;
begin
  select * into c from public.comm_conversations where id = p_conv and kind = 'channel' for update;
  if c.id is null or not public.comm_can_read_at(p_conv, null) then
    raise exception 'That channel was not found.' using errcode = '22023';
  end if;
  v_name := coalesce(v_name, c.name);
  if v_name is distinct from c.name then
    if not public.comm_channel_can(p_conv, 'rename') then
      raise exception 'Only the channel''s owners can rename it.' using errcode = '42501';
    end if;
    v_why := public.comm_channel_name_problem(v_name);
    if v_why is not null then
      raise exception '%', v_why using errcode = '22023';
    end if;
  end if;
  if (v_desc is distinct from c.description or v_top is distinct from c.topic)
     and not public.comm_channel_can(p_conv, 'edit_info') then
    raise exception 'Only the channel''s owners and moderators can change this.' using errcode = '42501';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Keep the description to 500 characters.' using errcode = '22023';
  end if;
  if v_top is not null and char_length(v_top) > 250 then
    raise exception 'Keep the topic to 250 characters.' using errcode = '22023';
  end if;

  begin
    update public.comm_conversations
       set name = v_name, description = v_desc, topic = v_top
     where id = p_conv;
  exception when unique_violation then
    raise exception 'A channel named "%" already exists.', v_name using errcode = '23505';
  end;
end $$;
revoke all on function public.comm_update_channel(uuid, text, text, text) from public, anon;
grant execute on function public.comm_update_channel(uuid, text, text, text) to authenticated;


-- Archive (true) / restore (false). Idempotent: FALSE when already so.
create or replace function public.comm_set_channel_archived(p_conv uuid, p_archived boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
  c    public.comm_conversations%rowtype;
begin
  if p_archived is null then
    raise exception 'Choose archive or restore.' using errcode = '22023';
  end if;
  select * into c from public.comm_conversations where id = p_conv and kind = 'channel' for update;
  if c.id is null or not public.comm_can_read_at(p_conv, null) then
    raise exception 'That channel was not found.' using errcode = '22023';
  end if;
  if not public.comm_channel_can(p_conv, 'archive') then
    raise exception 'Only the channel''s owners can archive or restore it.' using errcode = '42501';
  end if;
  if c.is_archived = p_archived then
    return false;
  end if;
  begin
    update public.comm_conversations
       set is_archived = p_archived,
           archived_at = case when p_archived then clock_timestamp() end,
           archived_by = case when p_archived then v_me end
     where id = p_conv;
  exception when unique_violation then
    raise exception 'Another channel is now called "%". Rename one of them before restoring this one.', c.name
      using errcode = '23505';
  end;
  return true;
end $$;
revoke all on function public.comm_set_channel_archived(uuid, boolean) from public, anon;
grant execute on function public.comm_set_channel_archived(uuid, boolean) to authenticated;


-- 0737's generic update, kept for GROUPS (the details sheet still uses it for
-- them). On a channel it now applies the channel rule field by field, and
-- archiving stamps archived_at / _by like comm_set_channel_archived.
create or replace function public.comm_update_conversation(
  p_conv uuid, p_name text, p_topic text, p_archived boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  c      public.comm_conversations%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select * into c from public.comm_conversations where id = p_conv;
  if c.id is null or c.kind = 'direct' then
    raise exception 'A direct message cannot be renamed or archived.' using errcode = '22023';
  end if;

  if c.kind = 'channel' then
    perform public.comm_update_channel(p_conv, coalesce(p_name, c.name), c.description, p_topic);
    if p_archived is not null and p_archived <> c.is_archived then
      perform public.comm_set_channel_archived(p_conv, p_archived);
    end if;
    return;
  end if;

  if not public.comm_can_manage(p_conv) then
    raise exception 'Only the owners or admins can change this.' using errcode = '42501';
  end if;
  if char_length(coalesce(v_name, '')) > 80 or char_length(coalesce(p_topic, '')) > 250 then
    raise exception 'The name or topic is too long.' using errcode = '22023';
  end if;
  update public.comm_conversations
     set name = v_name,
         topic = nullif(btrim(coalesce(p_topic, '')), ''),
         is_archived = coalesce(p_archived, is_archived),
         archived_at = case when coalesce(p_archived, is_archived) then coalesce(archived_at, clock_timestamp()) end,
         archived_by = case when coalesce(p_archived, is_archived) then coalesce(archived_by, v_me) end
   where id = p_conv;
end $$;
revoke all on function public.comm_update_conversation(uuid, text, text, boolean) from public, anon;
grant execute on function public.comm_update_conversation(uuid, text, text, boolean) to authenticated;


-- ---------- 5. membership and roles ----------------------------------------------

-- 0737's comm_remove_member. Groups: unchanged. Channels: a moderator removes
-- members only; removing an owner or moderator needs owner powers (an owner,
-- or a governor on a public channel). The last-owner rule is kept for both.
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

  -- The last owner may not leave a conversation others are still in.
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


-- 0737's comm_set_member_role. Groups: owners only, unchanged. Channels: owner
-- powers (see header). Nobody gains a role through this but by someone who
-- already holds owner powers, so a moderator cannot promote themselves.
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
  if v_kind = 'channel' then
    if not public.comm_channel_can(p_conv, 'set_roles') then
      raise exception 'Only the channel''s owners can change roles.' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.comm_members m
                     where m.conversation_id = p_conv and m.user_id = v_me
                       and m.removed_at is null and m.role = 'owner') then
    raise exception 'Only an owner can change roles.' using errcode = '42501';
  end if;

  select m.role into v_old from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = p_user and m.removed_at is null
   for update;
  if v_old is null then
    raise exception 'That person is not in this conversation.' using errcode = '22023';
  end if;
  if p_role = 'owner' and public.comm_workspace_blocked(p_user) then
    raise exception 'A deactivated person cannot be made an owner.' using errcode = '22023';
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


-- Hand the channel to p_to. ONE statement block, so the new owner exists
-- before the old one steps down — the channel is never ownerless, not even
-- between two calls. The caller, if an owner, becomes p_step_down_to
-- ('admin' = moderator, or 'member'); a governor who is not a member just adds
-- the owner.
create or replace function public.comm_transfer_channel_ownership(
  p_conv uuid, p_to uuid, p_step_down_to text default 'admin'
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.comm_actor();
  v_target text;
  v_mine   text;
begin
  if coalesce(p_step_down_to, '') not in ('admin', 'member') then
    raise exception 'Choose moderator or member for yourself.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.comm_conversations c where c.id = p_conv and c.kind = 'channel')
     or not public.comm_can_read_at(p_conv, null) then
    raise exception 'That channel was not found.' using errcode = '22023';
  end if;
  if not public.comm_channel_can(p_conv, 'transfer') then
    raise exception 'Only the channel''s owners can hand it over.' using errcode = '42501';
  end if;
  if p_to is null or p_to = v_me then
    raise exception 'Pick someone else to own the channel.' using errcode = '22023';
  end if;

  select m.role into v_target from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = p_to and m.removed_at is null
   for update;
  if v_target is null then
    raise exception 'The new owner must already be in the channel.' using errcode = '22023';
  end if;
  if v_target = 'owner' then
    raise exception 'That person already owns the channel.' using errcode = '22023';
  end if;
  if public.comm_workspace_blocked(p_to)
     or not exists (select 1 from public.profiles p where p.id = p_to and coalesce(p.is_active, true)) then
    raise exception 'A deactivated person cannot own a channel.' using errcode = '22023';
  end if;

  update public.comm_members set role = 'owner'
   where conversation_id = p_conv and user_id = p_to and removed_at is null;

  select m.role into v_mine from public.comm_members m
   where m.conversation_id = p_conv and m.user_id = v_me and m.removed_at is null
   for update;
  if v_mine = 'owner' then
    update public.comm_members set role = p_step_down_to
     where conversation_id = p_conv and user_id = v_me and removed_at is null;
  end if;
end $$;
revoke all on function public.comm_transfer_channel_ownership(uuid, uuid, text) from public, anon;
grant execute on function public.comm_transfer_channel_ownership(uuid, uuid, text) to authenticated;


-- ---------- 6. preferences ---------------------------------------------------------

-- Pin / notify level for the caller's OWN membership. NULL = leave unchanged.
-- Any conversation the caller is in (a pinned DM is as personal as a pinned
-- channel); the sidebar lists channels.
create or replace function public.comm_set_conversation_prefs(
  p_conv uuid, p_pinned boolean default null, p_notify_level text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  if p_notify_level is not null and p_notify_level not in ('all', 'mentions', 'none') then
    raise exception 'Choose all messages, mentions only, or nothing.' using errcode = '22023';
  end if;
  update public.comm_members
     set pinned_at = case when p_pinned is null then pinned_at
                          when p_pinned then coalesce(pinned_at, clock_timestamp())
                          else null end,
         notify_level = coalesce(p_notify_level, notify_level),
         muted = coalesce(p_notify_level, notify_level) <> 'all'
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
  if not found then
    raise exception 'Join the conversation first.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.comm_set_conversation_prefs(uuid, boolean, text) from public, anon;
grant execute on function public.comm_set_conversation_prefs(uuid, boolean, text) to authenticated;

-- 0737's comm_set_muted, kept in step with notify_level: mute = mentions only.
create or replace function public.comm_set_muted(p_conv uuid, p_muted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
begin
  update public.comm_members
     set muted = coalesce(p_muted, false),
         notify_level = case when coalesce(p_muted, false)
                             then case when notify_level = 'all' then 'mentions' else notify_level end
                             else 'all' end
   where conversation_id = p_conv and user_id = v_me and removed_at is null;
  if not found then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.comm_set_muted(uuid, boolean) from public, anon;
grant execute on function public.comm_set_muted(uuid, boolean) to authenticated;


-- ---------- 7. reads ------------------------------------------------------------------

-- Discovery. Every public channel in the workspace, plus private channels the
-- caller is IN — a private channel the caller is not in is not counted, not
-- named and not matched, so a search cannot enumerate one. p_scope 'active'
-- (the normal view) or 'archived'. Paginated; total_count is the full match.
create or replace function public.comm_discover_channels(
  p_q text default null, p_scope text default 'active',
  p_limit integer default 30, p_offset integer default 0
)
returns table (
  id uuid, name text, description text, topic text, visibility text,
  department_name text, is_archived boolean, archived_at timestamptz,
  member_count integer, is_member boolean, my_role text, total_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  if public.comm_workspace_status(v) is distinct from 'active' then
    raise exception 'You do not have access to messages.' using errcode = '42501';
  end if;
  if coalesce(p_scope, '') not in ('active', 'archived') then
    raise exception 'Unknown channel filter.' using errcode = '22023';
  end if;

  return query
  with pat as (
    select case when nullif(btrim(coalesce(p_q, '')), '') is null then null
           else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as like_pat
  ), visible as (
    select c.*, m.role as my_role
      from public.comm_conversations c
      left join public.comm_members m
        on m.conversation_id = c.id and m.user_id = v and m.removed_at is null
      cross join pat
     where c.kind = 'channel'
       and c.workspace_id = public.comm_workspace_id()
       and (c.visibility = 'public' or m.user_id is not null)
       and c.is_archived = (p_scope = 'archived')
       and (pat.like_pat is null
            or c.name ilike pat.like_pat
            or c.description ilike pat.like_pat
            or c.topic ilike pat.like_pat)
  )
  select x.id, x.name, x.description, x.topic, x.visibility,
         dep.name,
         x.is_archived, x.archived_at,
         (select count(*)::int from public.comm_members o
           where o.conversation_id = x.id and o.removed_at is null),
         x.my_role is not null,
         x.my_role,
         (count(*) over ())::int
    from visible x
    left join public.departments dep on dep.id = x.department_id
   order by x.name, x.id
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.comm_discover_channels(text, text, integer, integer) from public, anon;
grant execute on function public.comm_discover_channels(text, text, integer, integer) to authenticated;


-- The sidebar: the caller's live channels, PINNED FIRST (in the order pinned),
-- then by name. Unread and mention counts are 0737's persisted read state —
-- the same arithmetic as comm_my_conversations, not a second system.
create or replace function public.comm_sidebar_channels()
returns table (
  id uuid, name text, visibility text, my_role text, pinned_at timestamptz,
  notify_level text, unread_count integer, mention_count integer
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.visibility, m.role, m.pinned_at, m.notify_level,
         (select count(*)::int from public.comm_messages g
           where g.conversation_id = c.id and g.parent_id is null and g.deleted_at is null
             and g.author_id is distinct from m.user_id
             and g.created_at > coalesce(m.last_read_at, m.joined_at)),
         (select count(*)::int from public.comm_mentions x
            join public.comm_messages g on g.id = x.message_id
           where x.user_id = m.user_id and g.conversation_id = c.id and g.deleted_at is null
             and g.created_at > coalesce(m.last_read_at, m.joined_at))
    from public.comm_members m
    join public.comm_conversations c on c.id = m.conversation_id
   where m.user_id = (select auth.uid())
     and m.removed_at is null
     and c.kind = 'channel'
     and not c.is_archived
     and not public.comm_workspace_blocked((select auth.uid()))
   order by (m.pinned_at is null), m.pinned_at, c.name;
$$;
revoke all on function public.comm_sidebar_channels() from public, anon;
grant execute on function public.comm_sidebar_channels() to authenticated;


-- ============================================================================
-- 8. ASSERTIONS
-- ============================================================================

do $assert$
declare
  n integer;
begin
  -- (a) no comm_ function executable by anon / PUBLIC.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where p.proname like 'comm\_%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or p.proacl is null or p.proacl::text ~ '(\{|,)=X');
  if n > 0 then
    raise exception '0751: % comm function(s) are executable by anon/public', n;
  end if;

  -- (b) the internal rule is callable by nobody but the owner.
  if has_function_privilege('authenticated', 'public.comm_channel_can(uuid,text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.comm_workspace_governs(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '0751: an internal channel rule is callable by authenticated';
  end if;

  -- (c) exactly ONE comm_create_channel — an old overload left beside the new
  --     one would make PostgREST's resolution ambiguous (PGRST203).
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'comm_create_channel') <> 1 then
    raise exception '0751: comm_create_channel is overloaded';
  end if;

  -- (d) every conversation has its workspace.
  if exists (select 1 from public.comm_conversations where workspace_id is null) then
    raise exception '0751: a conversation has no workspace';
  end if;

  -- (e) the name rule, by attempting a violation.
  begin
    insert into public.comm_conversations (kind, name, visibility) values ('channel', 'Has Spaces', 'public');
    raise exception '0751: a channel name breaking the rule was accepted';
  exception when check_violation then null;
  end;

  -- (f) the normaliser and the validator agree on vectors.
  if public.comm_channel_slug('  Cutting   Room ') <> 'cutting-room'
     or public.comm_channel_name_problem('cutting-room') is not null
     or public.comm_channel_name_problem('#general') is null
     or public.comm_channel_name_problem('-lead') is null
     or public.comm_channel_name_problem(repeat('a', 81)) is null
     or public.comm_channel_name_problem(null) is null then
    raise exception '0751: comm_channel_slug / comm_channel_name_problem disagree with the rule';
  end if;

  -- (g) the redefinitions carry the narrowed rule.
  if pg_get_functiondef('public.comm_can_manage(uuid)'::regprocedure) not like '%visibility = ''public''%'
     or pg_get_functiondef('public.comm_remove_member(uuid,uuid)'::regprocedure) not like '%comm_channel_can%'
     or pg_get_functiondef('public.comm_set_member_role(uuid,uuid,text)'::regprocedure) not like '%comm_channel_can%' then
    raise exception '0751: a channel gate still grants communication:edit on private channels';
  end if;
end $assert$;
