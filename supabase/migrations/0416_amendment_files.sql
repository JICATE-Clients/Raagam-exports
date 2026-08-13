-- ============================================================================
-- Raagam ERP — 0416 Orders ▸ Garment Order Amendment ▸ Logistic ▸ Attachments
--
-- The client's last requirement for the Logistic tab (2026-08-12): before an
-- order is saved, attach a JPG of the style, a PDF of the buyer's ORIGINAL
-- order sheet, and any approvals or shade cards production needs to see.
--
-- Two halves — a child table for the metadata, and a PRIVATE storage bucket for
-- the bytes.
--
-- ## WHY THE BUCKET IS PRIVATE, AND WHY THAT IS NOT THE DEFAULT HERE
--
-- The only bucket this app has today is `employee-photos` (0336), created
-- `public = true` with blanket `to authenticated` write policies and read open
-- to `public`. For a staff photo that is a defensible trade. For a buyer's
-- order sheet it is not: that document carries the customer's name, their PO
-- and the agreed prices, and a public bucket hands all of it to anyone holding
-- the URL, forever, with no login and no audit.
--
-- So this bucket is `public = false` and its four policies are gated on
-- `has_permission('orders', ...)` — the same permission the amendment itself
-- is gated on — rather than on merely being signed in. A logged-in machinist
-- with no Orders permission can no more read the order sheet than they can read
-- the order.
--
-- The screen reads back through `createSignedUrl` (60s), never `getPublicUrl`.
--
-- ## SHAPE
--
-- Mirrors `garment_order_amendment_style_sizes` (0407) and `..._pack_types`
-- (0399) down to the cascade, the `sno` and the permission module, so the
-- amendment's child tables stay one family rather than a dozen dialects.
--
-- Every answer column is NULLABLE on purpose: a row the operator is midway
-- through is not an error, and `not null` turns "I have not answered yet" into
-- a 23502 on save. `doc_kind` is a CHECK rather than a lookup table for the
-- reason 0411 gives for `kind` — three fixed values the business does not add
-- to are a constraint, not a master.
--
-- No `created_by`: no amendment child table carries one, and attribution on
-- this screen is header-level through `withCreators()`.
-- ============================================================================

-- ---------- the metadata child ----------
create table if not exists public.garment_order_amendment_files (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,

  -- 'sketch'      the style picture / drawing
  -- 'order_sheet' the buyer's original order sheet or confirmation email
  -- 'approval'    shade cards and technical approvals for production reference
  doc_kind     text check (doc_kind is null or doc_kind in ('sketch','order_sheet','approval')),

  file_name    text,
  -- The path INSIDE the bucket, never a URL. A signed URL expires, so storing
  -- one would give a row that reads correctly today and 404s next week.
  storage_path text,
  mime_type    text,
  size_bytes   bigint,

  created_at   timestamptz not null default now()
);

create index if not exists idx_goa_files_amend
  on public.garment_order_amendment_files(amendment_id);

-- One object is attached once. `writeChildren` deletes and reinserts this table
-- wholesale on every save, so this cannot catch a double-save — what it catches
-- is the same file being added twice in one session, which is the operator
-- error that actually happens (a double-click on the picker).
create unique index if not exists uq_goa_files_path
  on public.garment_order_amendment_files(amendment_id, storage_path);

alter table public.garment_order_amendment_files enable row level security;

do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_files');
end $rls$;

comment on table public.garment_order_amendment_files is
  'Documents attached to a Garment Order Amendment (0416). Bytes live in the PRIVATE garment-order-docs bucket; storage_path is the key, never a URL.';

-- ---------- the bucket ----------
insert into storage.buckets (id, name, public)
values ('garment-order-docs', 'garment-order-docs', false)
on conflict (id) do nothing;

-- Gated on the Orders permission, NOT on `to authenticated` alone — see the
-- header. Dropped first so this migration is re-runnable.
drop policy if exists garment_order_docs_read   on storage.objects;
drop policy if exists garment_order_docs_insert on storage.objects;
drop policy if exists garment_order_docs_update on storage.objects;
drop policy if exists garment_order_docs_delete on storage.objects;

create policy garment_order_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'garment-order-docs' and public.has_permission('orders','view'));

create policy garment_order_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'garment-order-docs' and public.has_permission('orders','create'));

create policy garment_order_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'garment-order-docs' and public.has_permission('orders','edit'))
  with check (bucket_id = 'garment-order-docs' and public.has_permission('orders','edit'));

create policy garment_order_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'garment-order-docs' and public.has_permission('orders','delete'));

-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The unique index is asserted BY VIOLATING IT rather than by looking it up in
-- `pg_indexes`: a name being present proves a name is present, and the thing
-- worth knowing is that a second copy of one object is actually refused.
--
-- The bucket's privacy is asserted too, because it is the whole point of this
-- migration and it is one boolean away from being wrong.
-- ----------------------------------------------------------------------------

do $verify$
declare
  probe_amend uuid;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_files'
  ) then
    raise exception '0416: garment_order_amendment_files was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'garment_order_amendment_files') <> 4 then
    raise exception '0416: expected 4 policies on garment_order_amendment_files';
  end if;

  if not exists (select 1 from storage.buckets where id = 'garment-order-docs') then
    raise exception '0416: the garment-order-docs bucket was not created';
  end if;

  if (select public from storage.buckets where id = 'garment-order-docs') then
    raise exception '0416: garment-order-docs is PUBLIC — a buyer order sheet would be world-readable';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'garment_order_docs%') <> 4 then
    raise exception '0416: expected 4 storage.objects policies for garment-order-docs';
  end if;

  -- Any existing amendment will do; with none there is nothing to hang a probe
  -- row off, and the index assertion is SKIPPED rather than faked.
  select id into probe_amend from public.garment_order_amendments limit 1;

  if probe_amend is not null then
    begin
      insert into public.garment_order_amendment_files
        (amendment_id, sno, doc_kind, file_name, storage_path)
      values (probe_amend, 9001, 'sketch', '__0416_probe.jpg', '__0416_probe/a.jpg'),
             (probe_amend, 9002, 'sketch', '__0416_probe.jpg', '__0416_probe/a.jpg');
      raise exception '0416: (amendment_id, storage_path) admitted the same object twice';
    exception when unique_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_files where storage_path like '__0416_probe/%';

    -- And the CHECK actually refuses an unknown kind, rather than the column
    -- being plain text with a comment describing three values.
    begin
      insert into public.garment_order_amendment_files
        (amendment_id, sno, doc_kind, storage_path)
      values (probe_amend, 9003, 'invoice', '__0416_probe/b.jpg');
      raise exception '0416: doc_kind admitted a value outside its CHECK';
    exception when check_violation then
      null;  -- expected
    end;
    delete from public.garment_order_amendment_files where storage_path like '__0416_probe/%';
  end if;
end $verify$;
