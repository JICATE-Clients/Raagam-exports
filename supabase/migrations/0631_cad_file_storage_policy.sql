-- ============================================================================
-- Raagam ERP — 0631 CAD files: who may upload and remove them.
--
-- 0628's CAD dispatch stores .DXF/.PDS/.PLT in the private `garment-order-docs`
-- bucket (0416) under cad/{order}/{style}/v{n}/. That bucket's policies were
-- written for ORDER attachments: INSERT needs orders:CREATE and DELETE needs
-- orders:DELETE. The people who send CADs — the CAD Technician role (0458) —
-- hold orders:view + orders:edit and nothing else, so:
--
--   - they could not attach the file a dispatch cannot be recorded without;
--   - "Undo dispatch" and a cancelled dispatch sheet could not remove the
--     objects they had just uploaded (best-effort, so silently orphaned).
--
-- TWO NARROW POLICIES, cad/ ONLY. Storage policies are OR-ed, so the existing
-- four are unchanged for every other file in the bucket.
--
--   INSERT  orders:edit, path under cad/.
--   DELETE  orders:edit, path under cad/, and ONLY an object no recorded
--           dispatch points at. A sent CAD is what the buyer saw; its file is
--           history. `cad_undo_dispatch` deletes the rows first, so undo's
--           cleanup passes this test and nothing else does.
-- ============================================================================

drop policy if exists garment_order_docs_cad_insert on storage.objects;
create policy garment_order_docs_cad_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'garment-order-docs'
    and name like 'cad/%'
    and public.has_permission('orders', 'edit')
  );

drop policy if exists garment_order_docs_cad_delete on storage.objects;
create policy garment_order_docs_cad_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'garment-order-docs'
    and name like 'cad/%'
    and public.has_permission('orders', 'edit')
    and not exists (
      select 1 from public.order_cad_dispatch_files f where f.storage_path = storage.objects.name
    )
  );
