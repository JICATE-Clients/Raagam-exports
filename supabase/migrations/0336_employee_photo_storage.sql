-- ============================================================================
-- Raagam ERP — 0336 Employee Photo Storage Bucket
--
-- Creates a Supabase Storage bucket for employee photos.
-- Public read access (photos displayed in UI), write restricted to authenticated.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload
create policy "employee_photos_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'employee-photos');

-- Allow authenticated users to update their uploads
create policy "employee_photos_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'employee-photos');

-- Public read access (photos are non-sensitive)
create policy "employee_photos_read"
  on storage.objects for select
  to public
  using (bucket_id = 'employee-photos');

-- Allow authenticated users to delete photos
create policy "employee_photos_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'employee-photos');
