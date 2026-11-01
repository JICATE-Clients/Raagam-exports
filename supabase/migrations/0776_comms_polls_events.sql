-- ============================================================================
-- Raagam ERP — 0776 Communication Hub: polls and events (the 📎 menu)
--
-- User 2026-10-31: "apply this" — the Pulse Attach Menu mockup, WhatsApp's
-- attach menu (Document · Photos & videos · Camera · Audio · Contact · Poll ·
-- Event · New sticker). Documents, photos, camera, audio, contacts and
-- stickers need nothing new: they are files and tokens on an ordinary message
-- (lib/comms/cards.ts). A POLL and an EVENT carry state everyone changes —
-- votes, answers — so they get tables.
--
-- ## A POLL / EVENT IS A MESSAGE FIRST
--
-- `comm_send_poll` / `comm_send_event` write an ordinary comm_messages row
-- (body '<poll>Question' / '<event>Name') and the poll / event beside it, in
-- one transaction. So the message is read, paged, searched, pinned, saved,
-- deleted, reacted to and streamed by Realtime exactly as any other, and the
-- Announcements rule (0775, comm_announcement_guard) applies unchanged: only
-- a community admin can post a poll there.
--
-- ## WHO SEES AND WHO VOTES
--
-- Read: the four tables use `comm_message_visible(message_id)` — whoever may
-- read the message may read its poll, its votes and its answers, including
-- the cut-off for someone who left (0737). Vote / answer: ACTIVE members only
-- (comm_is_member), through the RPC; nobody votes on a deleted message or in
-- an archived conversation.
--
-- ## LIVE COUNTS WITHOUT A NEW SUBSCRIPTION
--
-- A vote or an answer bumps the message's `updated_at`, which reaches every
-- open chat as an RLS-filtered UPDATE on comm_messages — the same path a
-- reaction already takes (0737: "Also bumped by a reaction or pin change").
-- The chat re-reads that message and the counts move.
-- ============================================================================


-- ---------- 1. tables ------------------------------------------------------------

create table if not exists public.comm_polls (
  message_id      uuid primary key references public.comm_messages(id) on delete cascade,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  question        text not null check (char_length(btrim(question)) between 1 and 200),
  options         text[] not null check (array_length(options, 1) between 2 and 12),
  multi           boolean not null default false,
  created_at      timestamptz not null default clock_timestamp()
);
comment on table public.comm_polls is
  'location-scope: exempt -- a poll on a Communication Hub message (0776); readable per comm_message_visible().';

create table if not exists public.comm_poll_votes (
  message_id uuid not null references public.comm_polls(message_id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  option_idx integer not null check (option_idx between 0 and 11),
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id, option_idx)
);
comment on table public.comm_poll_votes is
  'location-scope: exempt -- votes on a Communication Hub poll (0776); see comm_polls.';

create table if not exists public.comm_events (
  message_id      uuid primary key references public.comm_messages(id) on delete cascade,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  description     text check (description is null or char_length(description) <= 500),
  event_date      date not null,
  event_time      time,
  location        text check (location is null or char_length(location) <= 120),
  created_at      timestamptz not null default clock_timestamp()
);
comment on table public.comm_events is
  'location-scope: exempt -- an event on a Communication Hub message (0776); readable per comm_message_visible().';

create table if not exists public.comm_event_rsvps (
  message_id uuid not null references public.comm_events(message_id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  answer     text not null check (answer in ('going', 'maybe', 'no')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (message_id, user_id)
);
comment on table public.comm_event_rsvps is
  'location-scope: exempt -- answers to a Communication Hub event (0776); see comm_events.';


-- ---------- 2. reads (every write is an RPC) ---------------------------------------

alter table public.comm_polls       enable row level security;
alter table public.comm_poll_votes  enable row level security;
alter table public.comm_events      enable row level security;
alter table public.comm_event_rsvps enable row level security;

drop policy if exists comm_polls_read on public.comm_polls;
create policy comm_polls_read on public.comm_polls
  for select to authenticated using (public.comm_message_visible(message_id));
drop policy if exists comm_poll_votes_read on public.comm_poll_votes;
create policy comm_poll_votes_read on public.comm_poll_votes
  for select to authenticated using (public.comm_message_visible(message_id));
drop policy if exists comm_events_read on public.comm_events;
create policy comm_events_read on public.comm_events
  for select to authenticated using (public.comm_message_visible(message_id));
drop policy if exists comm_event_rsvps_read on public.comm_event_rsvps;
create policy comm_event_rsvps_read on public.comm_event_rsvps
  for select to authenticated using (public.comm_message_visible(message_id));


-- ---------- 3. posting ---------------------------------------------------------------

-- The message both cards sit on: membership, archive, the retry key, and the
-- conversation's timestamps — the top-level half of comm_send_message (0761).
-- Internal: the two RPCs below are the only callers.
create or replace function public.comm_card_message(p_conv uuid, p_client_id uuid, p_body text, p_me uuid)
returns table (id uuid, created boolean) language plpgsql security definer set search_path = '' as $$
declare
  v_conv public.comm_conversations%rowtype;
  v_id   uuid;
  v_at   timestamptz;
begin
  if p_client_id is null then
    raise exception 'Missing message key.' using errcode = '22023';
  end if;
  select g.id into v_id from public.comm_messages g where g.author_id = p_me and g.client_id = p_client_id;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;
  select * into v_conv from public.comm_conversations c where c.id = p_conv;
  if not found or not public.comm_is_member(p_conv) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  if v_conv.is_archived then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;
  insert into public.comm_messages (conversation_id, author_id, kind, body, client_id)
  values (p_conv, p_me, 'message', p_body, p_client_id)
  returning comm_messages.id, comm_messages.created_at into v_id, v_at;
  update public.comm_conversations set last_message_at = v_at where comm_conversations.id = p_conv;
  update public.comm_members
     set last_read_at = greatest(coalesce(last_read_at, v_at), v_at)
   where conversation_id = p_conv and user_id = p_me and removed_at is null;
  return query select v_id, true;
end $$;
revoke all on function public.comm_card_message(uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.comm_send_poll(
  p_conv uuid, p_client_id uuid, p_question text, p_options text[], p_multi boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_q   text := nullif(btrim(coalesce(p_question, '')), '');
  v_opt text[];
  v_id  uuid;
  v_new boolean;
begin
  select coalesce(array_agg(btrim(o) order by ord), '{}') into v_opt
    from unnest(coalesce(p_options, '{}')) with ordinality as t(o, ord)
   where nullif(btrim(o), '') is not null;
  if v_q is null then
    raise exception 'Type the question.' using errcode = '22023';
  end if;
  if char_length(v_q) > 200 then
    raise exception 'Keep the question to 200 characters.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_opt, 1), 0) < 2 then
    raise exception 'Give at least two options.' using errcode = '22023';
  end if;
  if array_length(v_opt, 1) > 12 then
    raise exception 'A poll can have at most 12 options.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_opt) o where char_length(o) > 100) then
    raise exception 'Keep each option to 100 characters.' using errcode = '22023';
  end if;
  if (select count(distinct lower(o)) from unnest(v_opt) o) <> array_length(v_opt, 1) then
    raise exception 'Two options say the same thing.' using errcode = '22023';
  end if;

  select m.id, m.created into v_id, v_new from public.comm_card_message(p_conv, p_client_id, '<poll>' || v_q, v_me) m;
  if v_new then
    insert into public.comm_polls (message_id, conversation_id, question, options, multi)
    values (v_id, p_conv, v_q, v_opt, coalesce(p_multi, false));
  end if;
  return v_id;
end $$;
revoke all on function public.comm_send_poll(uuid, uuid, text, text[], boolean) from public, anon;
grant execute on function public.comm_send_poll(uuid, uuid, text, text[], boolean) to authenticated;

create or replace function public.comm_send_event(
  p_conv uuid, p_client_id uuid, p_name text, p_description text,
  p_date date, p_time time default null, p_location text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_loc  text := nullif(btrim(coalesce(p_location, '')), '');
  v_id   uuid;
  v_new  boolean;
begin
  if v_name is null then
    raise exception 'Give the event a name.' using errcode = '22023';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'Keep the event name to 100 characters.' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Pick the date.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'Keep the description to 500 characters.' using errcode = '22023';
  end if;
  if v_loc is not null and char_length(v_loc) > 120 then
    raise exception 'Keep the location to 120 characters.' using errcode = '22023';
  end if;

  select m.id, m.created into v_id, v_new from public.comm_card_message(p_conv, p_client_id, '<event>' || v_name, v_me) m;
  if v_new then
    insert into public.comm_events (message_id, conversation_id, name, description, event_date, event_time, location)
    values (v_id, p_conv, v_name, v_desc, p_date, p_time, v_loc);
  end if;
  return v_id;
end $$;
revoke all on function public.comm_send_event(uuid, uuid, text, text, date, time, text) from public, anon;
grant execute on function public.comm_send_event(uuid, uuid, text, text, date, time, text) to authenticated;


-- ---------- 4. voting and answering ------------------------------------------------------

-- Replace the caller's vote with `p_options` (empty = take the vote back).
-- A single-answer poll takes at most one option.
create or replace function public.comm_vote_poll(p_message uuid, p_options integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_poll public.comm_polls%rowtype;
  v_opts integer[] := coalesce((select array_agg(distinct o) from unnest(p_options) o), '{}');
begin
  select * into v_poll from public.comm_polls p where p.message_id = p_message;
  if not found or not public.comm_is_member(v_poll.conversation_id) then
    raise exception 'You cannot vote on that poll.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_messages g where g.id = p_message and g.deleted_at is not null)
     or exists (select 1 from public.comm_conversations c where c.id = v_poll.conversation_id and c.is_archived) then
    raise exception 'That poll is closed.' using errcode = '55000';
  end if;
  if not v_poll.multi and coalesce(array_length(v_opts, 1), 0) > 1 then
    raise exception 'Pick one option.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_opts) o where o < 0 or o >= array_length(v_poll.options, 1)) then
    raise exception 'That option is not on the poll.' using errcode = '22023';
  end if;
  delete from public.comm_poll_votes where message_id = p_message and user_id = v_me;
  insert into public.comm_poll_votes (message_id, user_id, option_idx)
  select p_message, v_me, o from unnest(v_opts) o;
  -- Reaches every open chat as an UPDATE (header, "LIVE COUNTS").
  update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
end $$;
revoke all on function public.comm_vote_poll(uuid, integer[]) from public, anon;
grant execute on function public.comm_vote_poll(uuid, integer[]) to authenticated;

-- Going / maybe / can't go; NULL takes the answer back.
create or replace function public.comm_rsvp_event(p_message uuid, p_answer text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.comm_actor();
  v_ev public.comm_events%rowtype;
begin
  if p_answer is not null and p_answer not in ('going', 'maybe', 'no') then
    raise exception 'Answer going, maybe or no.' using errcode = '22023';
  end if;
  select * into v_ev from public.comm_events e where e.message_id = p_message;
  if not found or not public.comm_is_member(v_ev.conversation_id) then
    raise exception 'You cannot answer that event.' using errcode = '42501';
  end if;
  if exists (select 1 from public.comm_messages g where g.id = p_message and g.deleted_at is not null) then
    raise exception 'That event was deleted.' using errcode = '55000';
  end if;
  if p_answer is null then
    delete from public.comm_event_rsvps where message_id = p_message and user_id = v_me;
  else
    insert into public.comm_event_rsvps (message_id, user_id, answer)
    values (p_message, v_me, p_answer)
    on conflict (message_id, user_id) do update set answer = excluded.answer, updated_at = clock_timestamp();
  end if;
  update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
end $$;
revoke all on function public.comm_rsvp_event(uuid, text) from public, anon;
grant execute on function public.comm_rsvp_event(uuid, text) to authenticated;


-- ---------- 5. video and audio (📎 Photos & videos · Audio) ------------------------
--
-- The allowlist grows by the types lib/comms/types.ts ALLOWED_MIME now names;
-- scripts/check-comms.mts compares this, the LATEST statement of both halves,
-- with that list. Each type has its own signature in lib/comms/file-sniff.ts,
-- so a renamed program is still refused (0761). The 20 MB limit is unchanged.

create or replace function public.comm_allowed_mime(p_mime text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(lower(p_mime), '') = any (array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/webm'
  ]);
$$;
revoke all on function public.comm_allowed_mime(text) from public, anon;
grant execute on function public.comm_allowed_mime(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comm-files', 'comm-files', false, 20971520,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/webm'
  ]
)
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;
