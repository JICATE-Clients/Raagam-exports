-- ============================================================================
-- 0669 — order_po_imports: a buyer PO read by the machine (doc/order/digitalisation-plan.md §2)
--
-- The merchandiser uploads the buyer's PO (PDF / Excel / image) to the
-- garment-order-docs bucket under `po-imports/<id>/…`; the file is read by an AI
-- model into a DRAFT; the draft is reviewed and edited on /orders/po-import and
-- then pre-fills a NEW order on Order Entry. Nothing here creates an order —
-- the order only exists once the merchandiser presses Save on Order Entry.
--
-- This table is the audit trail of what the machine read: the file, the raw
-- extraction as the model returned it (`extracted`, overwritten by the edited
-- draft when the reviewer saves), who uploaded it, and which order it became.
-- ============================================================================

create table if not exists public.order_po_imports (
  id                 uuid primary key default gen_random_uuid(),
  storage_path       text not null,
  file_name          text not null,
  mime_type          text,
  status             text not null default 'uploaded'
                     check (status in ('uploaded', 'extracted', 'failed', 'used')),
  extracted          jsonb,
  error              text,
  used_amendment_id  uuid references public.garment_order_amendments(id) on delete set null,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists order_po_imports_created_at_idx on public.order_po_imports (created_at);

drop trigger if exists trg_order_po_imports_updated_at on public.order_po_imports;
create trigger trg_order_po_imports_updated_at
  before update on public.order_po_imports
  for each row execute function public.set_updated_at();

alter table public.order_po_imports enable row level security;

drop policy if exists order_po_imports_read   on public.order_po_imports;
drop policy if exists order_po_imports_insert on public.order_po_imports;
drop policy if exists order_po_imports_update on public.order_po_imports;

-- Reading an import is reading an order document's source.
create policy order_po_imports_read on public.order_po_imports
  for select to authenticated using (public.has_permission('orders', 'view'));
-- Uploading one is the first step of RAISING an order.
create policy order_po_imports_insert on public.order_po_imports
  for insert to authenticated with check (public.has_permission('orders', 'create'));
-- Editing the draft / stamping the order it became: create or edit.
create policy order_po_imports_update on public.order_po_imports
  for update to authenticated
  using (public.has_permission('orders', 'create') or public.has_permission('orders', 'edit'))
  with check (public.has_permission('orders', 'create') or public.has_permission('orders', 'edit'));
-- No delete policy: an import is evidence of what was read, kept like an audit row.

comment on table public.order_po_imports is
  'A buyer PO read by AI into a draft order (0669). The file lives in garment-order-docs under po-imports/<id>/; extracted holds the draft JSON; used_amendment_id the order it became. Creates no order by itself.';

-- ---------------------------------------------------------------------------
-- Verify from the catalog, not from "it ran".
-- ---------------------------------------------------------------------------
do $verify$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'order_po_imports' and c.relrowsecurity) then
    raise exception '0669: order_po_imports missing or RLS not enabled';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_po_imports') <> 3 then
    raise exception '0669: expected exactly 3 policies on order_po_imports';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_po_imports'
              and 'anon' = any(roles)) then
    raise exception '0669: a policy on order_po_imports reaches anon';
  end if;
end $verify$;
