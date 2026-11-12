-- 0839 · A channel's profile photo (user 2026-11-12, artifact "Channel Photo
-- Upload": "profile pic uplode pandra mari option channel la venum").
--
-- WHAT IT ADDS
--   1. comm_conversations.photo_path — the storage KEY of the channel's photo,
--      never a URL (0416 / 0458 / 0737 rule). Channels only, and the key must
--      sit under the channel's own folder: "<conversation id>/<uuid>.<ext>".
--      A CHECK, not only the RPC, so no write path can point one channel at
--      another channel's picture.
--   2. Bucket `comm-channel-photos` — PUBLIC (like `employee-photos`, 0336), so
--      the chat list, header and details can show it with a plain <img> and no
--      signed URL per row. The key carries a random uuid, so a URL cannot be
--      guessed. 2 MB, JPG / PNG / WebP, enforced BY STORAGE.
--   3. Upload policy: the caller may put a file under a channel's folder only
--      when they may edit that channel's info (owner / moderator, or a
--      workspace admin on a public channel) — `comm_channel_can(.., 'edit_info')`,
--      the same rule as the description. No UPDATE / DELETE policy: the
--      replaced photo's bytes are removed by the server action with the
--      service role after the RPC confirms (0737's rule for comm-files).
--   4. comm_set_channel_photo(conv, path) — sets or clears it, returns the
--      PREVIOUS key so the action can delete its bytes.
--
-- comm_my_conversations is NOT touched: photos are read beside it
-- (lib/comms/photos.ts getChannelPhotos), so this migration cannot drop
-- anything from that function's latest body.

-- ---------- 1. the column ---------------------------------------------------------
alter table public.comm_conversations
  add column if not exists photo_path text;

alter table public.comm_conversations
  drop constraint if exists chk_comm_conv_photo_path;
alter table public.comm_conversations
  add constraint chk_comm_conv_photo_path check (
    photo_path is null
    or (kind = 'channel'
        and photo_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$'))
  );

-- ---------- 2. the bucket ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comm-channel-photos', 'comm-channel-photos', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- 3. who may upload -----------------------------------------------------
-- comm_channel_can is revoked from `authenticated` (0751 / 0836) and a storage
-- policy runs as the caller, so the policy asks through this definer wrapper.
-- It answers one boolean about the caller and nothing else.
create or replace function public.comm_can_set_channel_photo(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.comm_channel_can(public.comm_conversation_of_path(p_name), 'edit_info'),
    false
  );
$$;
revoke all on function public.comm_can_set_channel_photo(text) from public, anon;
grant execute on function public.comm_can_set_channel_photo(text) to authenticated;

drop policy if exists comm_channel_photos_insert on storage.objects;
create policy comm_channel_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comm-channel-photos'
              and public.comm_can_set_channel_photo(name));

-- ---------- 4. set / clear --------------------------------------------------------
create or replace function public.comm_set_channel_photo(p_conv uuid, p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.comm_actor();
  c      public.comm_conversations%rowtype;
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  select * into c from public.comm_conversations where id = p_conv and kind = 'channel' for update;
  if c.id is null or not public.comm_can_read_at(p_conv, null) then
    raise exception 'That channel was not found.' using errcode = '22023';
  end if;
  if not public.comm_channel_can(p_conv, 'edit_info') then
    raise exception 'Only the channel''s owners and moderators can change its photo.' using errcode = '42501';
  end if;
  if v_path is not null then
    if v_path !~ ('^' || p_conv::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'That photo could not be used.' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'comm-channel-photos' and o.name = v_path) then
      raise exception 'The photo did not finish uploading. Try again.' using errcode = '22023';
    end if;
  end if;

  update public.comm_conversations set photo_path = v_path where id = p_conv;
  return case when c.photo_path is distinct from v_path then c.photo_path end;
end $$;
revoke all on function public.comm_set_channel_photo(uuid, text) from public, anon;
grant execute on function public.comm_set_channel_photo(uuid, text) to authenticated;

-- ---------- 5. verify -------------------------------------------------------------
do $v$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comm_conversations'
                    and column_name = 'photo_path') then
    raise exception '0839: comm_conversations.photo_path missing';
  end if;
  if not exists (select 1 from storage.buckets
                  where id = 'comm-channel-photos' and public and file_size_limit = 2097152) then
    raise exception '0839: bucket comm-channel-photos not as expected';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'comm_channel_photos_insert') <> 1 then
    raise exception '0839: upload policy missing';
  end if;
  if has_function_privilege('anon', 'public.comm_set_channel_photo(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.comm_can_set_channel_photo(text)', 'execute') then
    raise exception '0839: a new function is executable by anon';
  end if;
end $v$;
