-- ============================================================================
-- Raagam ERP — 0545 The approval-proof storage bucket
--
-- Same shape as `garment-order-docs` (0416) — PRIVATE, gated on the Orders
-- permission rather than merely being signed in, read back only through a
-- short-lived `createSignedUrl`, never `getPublicUrl`. A separate bucket from
-- `garment-order-docs` because approval proofs (tech-pack pages, courier
-- receipts, lab certificates) are a different retention/access question than
-- the order's own sketches and PO documents, even though the policy SHAPE is
-- identical.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('order-approval-docs', 'order-approval-docs', false)
on conflict (id) do nothing;

drop policy if exists order_approval_docs_read   on storage.objects;
drop policy if exists order_approval_docs_insert on storage.objects;
drop policy if exists order_approval_docs_update on storage.objects;
drop policy if exists order_approval_docs_delete on storage.objects;

create policy order_approval_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'order-approval-docs' and public.has_permission('orders', 'view'));

create policy order_approval_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-approval-docs' and public.has_permission('orders', 'edit'));

create policy order_approval_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'order-approval-docs' and public.has_permission('orders', 'edit'))
  with check (bucket_id = 'order-approval-docs' and public.has_permission('orders', 'edit'));

create policy order_approval_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'order-approval-docs' and public.has_permission('orders', 'delete'));


-- ---------- assertions ------------------------------------------------------

do $assert$
begin
  if not exists (select 1 from storage.buckets where id = 'order-approval-docs') then
    raise exception '0545: the order-approval-docs bucket was not created';
  end if;

  if (select public from storage.buckets where id = 'order-approval-docs') then
    raise exception '0545: order-approval-docs is PUBLIC — a buyer approval document would be world-readable';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'order_approval_docs%') <> 4 then
    raise exception '0545: expected 4 storage.objects policies for order-approval-docs';
  end if;
end $assert$;
