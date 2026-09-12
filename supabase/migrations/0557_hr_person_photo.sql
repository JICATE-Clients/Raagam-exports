-- ===========================================================================
-- 0557 — a staff member's / worker's photo.
--
-- Asked for on the Detail tab (client 2026-09-12: "in detail field there should
-- be one more thing added which is their photo add the field for it").
--
-- ## A URL COLUMN, NOT A BLOB, AND NOT A NEW BUCKET
--
-- This app already photographs a person: `employees.photo_url` (0336) holds a
-- public URL into the `employee-photos` bucket, and `components/ui/photo-upload.tsx`
-- is the control that writes it. Same column name, same bucket, same component —
-- so the two people-shaped masters cannot drift into two ways of storing a face,
-- and the storage policies 0336 declared already cover these uploads.
--
-- 0534 deliberately left `photo` off this table. That call was made when the
-- Detail tab was being built from the legacy screenshot, which shows no photo
-- box; the client has now asked for one, so the omission is being reversed
-- rather than worked around.
-- ===========================================================================

alter table public.staff
  add column if not exists photo_url text;

alter table public.workers
  add column if not exists photo_url text;

comment on column public.staff.photo_url is
  'Public URL in the employee-photos bucket (0336). Written by PhotoUpload. 0557.';
comment on column public.workers.photo_url is
  'Public URL in the employee-photos bucket (0336). Written by PhotoUpload. 0557.';
