-- ============================================================================
-- Raagam ERP — 0824 Communication Hub: edit and cancel an event (📎 Event)
--
-- User 2026-11-10: "add edit event option in event" — an "Edit event" strip
-- under every event card (design: artifact "Chat Event and Poll Cards",
-- board 2, which the user chose: Edit event for EVERYONE, no Going / Not going).
--
-- ## ANY MEMBER EDITS, AND THE CARD CHANGES IN PLACE
--
-- Not only the sender: the user put Edit event on a RECEIVED card, so every
-- active member of the chat may correct or cancel it. Because of that the gray
-- note names WHO changed it ("Roja moved test to …"), so a change is never
-- anonymous.
--
-- `comm_edit_event` rewrites the comm_events row and the message body
-- ('<event>Name', lib/comms/cards.ts) and stamps edited_at. Answers are
-- KEPT — the people who said Going are still going unless they say otherwise.
-- The UPDATE on comm_messages reaches every open chat through Realtime, the
-- same path a vote takes (0776, "LIVE COUNTS"), so nobody needs a reload.
--
-- ## A MOVED DATE OR TIME IS SAID OUT LOUD
--
-- A card that silently changes from 10:00 to 15:00 is how somebody turns up at
-- the wrong time. When the date or time changes a gray system line goes into
-- the chat ("Sample review moved to 11/11/2026 · 15:00"), which also lifts the
-- conversation in everyone's list. A name / place / description fix is quiet.
--
-- ## CANCEL IS NOT DELETE
--
-- `comm_cancel_event` stamps cancelled_at: the card stays, struck through,
-- with its answers frozen, and a system line says so. Deleting the message is
-- still possible through the ordinary message menu.
--
-- Same checks as every comms write: the actor is auth.uid() (comm_actor), must
-- still be a member, the message must not be deleted and the conversation not
-- archived. NEEDS 0776 APPLIED FIRST.
-- ============================================================================

alter table public.comm_events
  add column if not exists cancelled_at timestamptz;


-- ---------- 1. edit ------------------------------------------------------------------

create or replace function public.comm_edit_event(
  p_message uuid, p_name text, p_description text,
  p_date date, p_time time default null, p_location text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  v_ev   public.comm_events%rowtype;
  v_msg  public.comm_messages%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_loc  text := nullif(btrim(coalesce(p_location, '')), '');
  v_at   timestamptz;
begin
  select * into v_ev from public.comm_events e where e.message_id = p_message;
  select * into v_msg from public.comm_messages g where g.id = p_message;
  if v_ev.message_id is null or v_msg.id is null or not public.comm_is_member(v_ev.conversation_id) then
    raise exception 'You cannot edit that event.' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'That event was deleted.' using errcode = '55000';
  end if;
  if v_ev.cancelled_at is not null then
    raise exception 'That event was cancelled.' using errcode = '55000';
  end if;
  if exists (select 1 from public.comm_conversations c where c.id = v_ev.conversation_id and c.is_archived) then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;
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

  update public.comm_events
     set name = v_name, description = v_desc, event_date = p_date, event_time = p_time, location = v_loc
   where message_id = p_message;
  update public.comm_messages
     set body = '<event>' || v_name, edited_at = clock_timestamp()
   where id = p_message;

  -- "A MOVED DATE OR TIME IS SAID OUT LOUD" (header). DD/MM/YYYY, as every date in the app.
  if v_ev.event_date is distinct from p_date or v_ev.event_time is distinct from p_time then
    insert into public.comm_messages (conversation_id, author_id, kind, body)
    values (
      v_ev.conversation_id, null, 'system',
      coalesce((select p.full_name from public.profiles p where p.id = v_me), 'Someone')
        || ' moved ' || v_name || ' to ' || to_char(p_date, 'DD/MM/YYYY')
        || coalesce(' · ' || to_char(p_time, 'HH24:MI'), ' (all day)')
    )
    returning created_at into v_at;
    update public.comm_conversations set last_message_at = v_at where id = v_ev.conversation_id;
  end if;
end $$;
revoke all on function public.comm_edit_event(uuid, text, text, date, time, text) from public, anon;
grant execute on function public.comm_edit_event(uuid, text, text, date, time, text) to authenticated;


-- ---------- 2. cancel ----------------------------------------------------------------

create or replace function public.comm_cancel_event(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.comm_actor();
  v_ev  public.comm_events%rowtype;
  v_msg public.comm_messages%rowtype;
  v_at  timestamptz;
begin
  select * into v_ev from public.comm_events e where e.message_id = p_message;
  select * into v_msg from public.comm_messages g where g.id = p_message;
  if v_ev.message_id is null or v_msg.id is null or not public.comm_is_member(v_ev.conversation_id) then
    raise exception 'You cannot cancel that event.' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'That event was deleted.' using errcode = '55000';
  end if;
  if v_ev.cancelled_at is not null then
    return; -- already cancelled: a second click changes nothing
  end if;
  if exists (select 1 from public.comm_conversations c where c.id = v_ev.conversation_id and c.is_archived) then
    raise exception 'This conversation is archived.' using errcode = '55000';
  end if;

  update public.comm_events set cancelled_at = clock_timestamp() where message_id = p_message;
  update public.comm_messages set updated_at = clock_timestamp() where id = p_message;
  insert into public.comm_messages (conversation_id, author_id, kind, body)
  values (
    v_ev.conversation_id, null, 'system',
    coalesce((select p.full_name from public.profiles p where p.id = v_me), 'Someone') || ' cancelled ' || v_ev.name
  )
  returning created_at into v_at;
  update public.comm_conversations set last_message_at = v_at where id = v_ev.conversation_id;
end $$;
revoke all on function public.comm_cancel_event(uuid) from public, anon;
grant execute on function public.comm_cancel_event(uuid) to authenticated;


-- ---------- 3. no answers on a cancelled event ---------------------------------------
-- 0776's comm_rsvp_event, with one more refusal.

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
  if v_ev.cancelled_at is not null then
    raise exception 'That event was cancelled.' using errcode = '55000';
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

notify pgrst, 'reload schema';
