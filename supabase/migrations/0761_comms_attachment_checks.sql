-- ============================================================================
-- Raagam ERP — 0761 Communication Hub: attachments the server has looked at
--
-- Development Task 05. 0737 already built attachments: the PRIVATE comm-files
-- bucket (20 MB, MIME allowlist enforced by storage itself), an insert policy
-- that lets only an active member upload into the conversation's folder, a
-- read policy that serves a file only to someone who may read its message,
-- `comm_attachments` with a unique storage_path (a file belongs to one
-- message and cannot be re-attached elsewhere), and comm_delete_message
-- returning the keys whose bytes the server action removes.
--
-- THE GAP THIS CLOSES: comm_send_message recorded the size and type the
-- BROWSER claimed, and nothing ever read the bytes. A file uploaded as
-- "application/pdf" was a PDF because the uploader said so — an .exe renamed
-- report.pdf went through, and a hand-made request could claim any size.
--
--   1. comm_upload_checks — one row per upload the SERVER has inspected. The
--      server action (lib/comms/attachment-actions.ts) confirms the caller
--      owns the stored object, reads its first bytes with the service role,
--      checks them against the type (lib/comms/file-sniff.ts) and only then
--      writes this row, from storage's own size and type. RLS is on and NO
--      policy exists, so no browser can write or read it.
--   2. comm_send_message now REQUIRES that row for every attachment, takes the
--      size and type FROM IT (never from the request), and consumes it. So
--      calling the RPC directly, past the action, cannot attach an unchecked
--      file: the check is in the database's path, not beside it.
--   3. comm_upload_facts(path) — what storage holds for one of the CALLER's
--      own uploads (size, type, conversation, already attached?). Nothing for
--      anyone else's.
--   4. comm_orphan_files(hours, limit) — uploads never attached (a removed
--      chip, a failed send, a closed tab) older than `hours`. Service role
--      only; the daily housekeeping job deletes them through the storage API
--      (deleting storage.objects rows in SQL would leave the bytes behind).
--
-- comm_send_message is 0737's body verbatim except the attachment loop.
-- ROLLBACK: re-run 0737's comm_send_message; drop the three functions and
-- comm_upload_checks. Nothing else is touched.
-- ============================================================================


-- ---------- 1. the checks ----------------------------------------------------

create table if not exists public.comm_upload_checks (
  storage_path    text primary key,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes between 1 and 20971520),
  checked_at      timestamptz not null default clock_timestamp()
);
alter table public.comm_upload_checks enable row level security;
-- (no policy: the service role writes it, SECURITY DEFINER functions read it)
comment on table public.comm_upload_checks is
  'location-scope: exempt -- 0761: uploads the server inspected before they may be attached; service role only.';


-- ---------- 2. facts about the caller's own upload ---------------------------

create or replace function public.comm_upload_facts(p_path text)
returns table (conversation_id uuid, size_bytes bigint, mime_type text, attached boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to use messages.' using errcode = '42501';
  end if;
  return query
  select public.comm_conversation_of_path(o.name),
         nullif(o.metadata ->> 'size', '')::bigint,
         lower(coalesce(o.metadata ->> 'mimetype', '')),
         exists (select 1 from public.comm_attachments a where a.storage_path = o.name)
    from storage.objects o
   where o.bucket_id = 'comm-files'
     and o.name = p_path
     and coalesce(o.owner_id, o.owner::text) = (select auth.uid())::text;
end $$;
revoke all on function public.comm_upload_facts(text) from public, anon;
grant execute on function public.comm_upload_facts(text) to authenticated;


-- ---------- 3. orphans (service role only) -----------------------------------

create or replace function public.comm_orphan_files(p_hours integer default 24, p_limit integer default 500)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'comm-files'
     and o.created_at < clock_timestamp() - make_interval(hours => greatest(coalesce(p_hours, 24), 1))
     and not exists (select 1 from public.comm_attachments a where a.storage_path = o.name)
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke all on function public.comm_orphan_files(integer, integer) from public, anon, authenticated;


-- ---------- 4. send, requiring the check --------------------------------------

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
  v_chk      public.comm_upload_checks%rowtype;
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
  -- already required active membership of the folder's conversation). 0761:
  -- each one must also have been INSPECTED by the server (comm_upload_checks,
  -- written only by the service role after reading the bytes), and its size
  -- and type are taken from that check — never from this request.
  for v_att in select * from jsonb_array_elements(v_atts) loop
    v_path  := v_att ->> 'storage_path';
    v_fname := nullif(btrim(coalesce(v_att ->> 'file_name', '')), '');
    select * into v_chk from public.comm_upload_checks k
     where k.storage_path = v_path and k.owner_id = v_me and k.conversation_id = p_conv;
    if not found then
      raise exception 'A file was not checked before sending. Attach it again.' using errcode = '22023';
    end if;
    v_mime := v_chk.mime_type;
    v_size := v_chk.size_bytes;
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
    -- Consumed: a check vouches for one attachment, once.
    delete from public.comm_upload_checks where storage_path = v_path;
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


-- ============================================================================
-- 5. ASSERTIONS
-- ============================================================================
do $assert$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.comm_upload_checks'::regclass) then
    raise exception '0761: RLS is off on comm_upload_checks';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_upload_checks') then
    raise exception '0761: comm_upload_checks has a policy — only the service role may touch it';
  end if;
  if has_function_privilege('authenticated', 'public.comm_orphan_files(integer,integer)'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.comm_upload_facts(text)'::regprocedure, 'EXECUTE') then
    raise exception '0761: an attachment function is callable by the wrong role';
  end if;
  if pg_get_functiondef('public.comm_send_message(uuid,uuid,text,uuid,jsonb)'::regprocedure) not like '%comm_upload_checks%' then
    raise exception '0761: comm_send_message does not require a checked upload';
  end if;
  -- The storage columns the facts and the sweep read exist on THIS project
  -- (0749's lesson: the live schema is the one that counts).
  if (select count(*) from information_schema.columns
       where table_schema = 'storage' and table_name = 'objects'
         and column_name in ('owner', 'owner_id', 'metadata', 'created_at', 'bucket_id', 'name')) <> 6 then
    raise exception '0761: storage.objects lacks a column 0761 reads';
  end if;
end $assert$;
