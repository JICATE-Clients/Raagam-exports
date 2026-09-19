-- ============================================================================
-- 0589 — A PLACE TO UPLOAD THE COMPANY LOGO
--
-- Client 2026-09-19: the document letterheads carry the company logo
-- (`lib/orders/fabric-bom/letterhead.ts`). `company_profile.logo` has existed
-- since the profile was built, but no screen could fill it — the Company Profile
-- had a "Show logo on documents" tick box and no upload — so every document
-- printed the Raagam wordmark placeholder.
--
-- A PUBLIC bucket, like `employee-photos` (0336): the logo is printed on every
-- PDF a supplier or buyer receives, so it is not a secret, and a public URL is
-- what `<img>` and the PDF exporter can both load without a signed-URL round
-- trip.
--
-- WRITES ARE SYSTEM ADMIN ONLY — the same permission the Company Profile's own
-- save checks (`can("system_admin", "edit")`, lib/admin/company-actions.ts).
-- `employee-photos` lets any authenticated user write; the letterhead of every
-- document is not something any operator should be able to replace.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  2097152, -- 2 MB, the same ceiling PhotoUpload enforces client-side
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "company_assets_read"
  on storage.objects for select
  to public
  using (bucket_id = 'company-assets');

create policy "company_assets_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'company-assets' and public.has_permission('system_admin', 'edit'));

create policy "company_assets_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'company-assets' and public.has_permission('system_admin', 'edit'));

create policy "company_assets_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'company-assets' and public.has_permission('system_admin', 'edit'));
