-- ════════════════════════════════════════════════════════════════════════════
-- Raagam ERP — 0843 Time Off: a file attached to a request
--
-- User 2026-11-14: "in od req give a option to attach a file" — the letter,
-- invitation or travel order behind an On Duty request. One file per request,
-- PDF / JPEG / PNG up to 5 MB, in a PRIVATE bucket (same shape as 0773's
-- training certificates).
--
--   * timeoff_requests gains attachment_path / attachment_name.
--   * bucket hr-timeoff-files, key <auth.uid()>/<uuid>.<ext> — the uploader's
--     own folder, so the file can go up before the request exists.
--   * timeoff_attach_file(id, path, name) links it: only the person who
--     applied, only while the request is pending, only a file they uploaded.
--   * whoever can read the request (HR, the HOD, the person) can read its file
--     — the read policy asks timeoff_requests under the caller's own RLS.
--
-- Additive only: no existing row, function or policy is changed.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.timeoff_requests
  add column if not exists attachment_path text unique,
  add column if not exists attachment_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-timeoff-files', 'hr-timeoff-files', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Upload: only into your own folder.
drop policy if exists hr_timeoff_files_insert on storage.objects;
create policy hr_timeoff_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-timeoff-files'
              and (storage.foldername(name))[1] = auth.uid()::text);

-- Read: your own upload, or the file of a request you can see.
drop policy if exists hr_timeoff_files_read on storage.objects;
create policy hr_timeoff_files_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-timeoff-files'
         and (owner = auth.uid()
              or exists (select 1 from public.timeoff_requests r
                          where r.attachment_path = storage.objects.name)));

-- Delete: only your own file that no request points at (abandoned / replaced).
drop policy if exists hr_timeoff_files_delete on storage.objects;
create policy hr_timeoff_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-timeoff-files' and owner = auth.uid()
         and not exists (select 1 from public.timeoff_requests r
                          where r.attachment_path = storage.objects.name));

create or replace function public.timeoff_attach_file(p_id uuid, p_path text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.timeoff_requests;
begin
  select * into r from public.timeoff_requests where id = p_id for update;
  if r.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or auth.uid() is distinct from coalesce(r.applied_by, r.created_by) then
    raise exception 'Only the person who applied can attach a file' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'A file can be attached only while the request is pending' using errcode = '22023';
  end if;
  if p_path is not null then
    if left(p_path, length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then
      raise exception 'The file is not stored where your uploads go' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects so
                    where so.bucket_id = 'hr-timeoff-files' and so.name = p_path and so.owner = auth.uid()) then
      raise exception 'The file was not uploaded' using errcode = '22023';
    end if;
    if btrim(coalesce(p_name, '')) = '' or length(p_name) > 255 then
      raise exception 'The file needs a name under 255 characters' using errcode = '22023';
    end if;
  end if;
  update public.timeoff_requests
     set attachment_path = p_path,
         attachment_name = case when p_path is null then null else p_name end
   where id = p_id;
end $$;

revoke all on function public.timeoff_attach_file(uuid, text, text) from public, anon;
grant execute on function public.timeoff_attach_file(uuid, text, text) to authenticated;
