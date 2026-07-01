-- ============================================================================
-- Raagam ERP — 0014 Logistics & Export Documentation
-- One shipment record is the single source of truth; all export documents
-- (commercial invoice, packing list, bill of lading, GST invoice, DGFT) are
-- generated / re-generated FROM it. Shipment completion → Finance receivable
-- is stubbed until the Finance module exists.
-- ============================================================================

create sequence if not exists public.seq_shipment;
create table if not exists public.shipments (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,
  buyer_id           uuid references public.buyers(id),
  consignee_name     text,
  consignee_address  text,
  port_of_loading    text default 'Tuticorin',
  destination_port   text,
  destination_country text,
  vessel             text,
  voyage_no          text,
  incoterm           text default 'FOB',
  currency_code      text references public.currencies(code),
  etd                date,
  eta                date,
  invoice_no         text,
  invoice_date       date,
  total_value        numeric(16,2) not null default 0,
  status             text not null default 'planning'
                       check (status in ('planning','docs_ready','shipped','delivered','closed')),
  notes              text,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_shipment_code before insert on public.shipments
  for each row execute function public.assign_code('SHP','public.seq_shipment');
create trigger trg_shipment_updated before update on public.shipments
  for each row execute function public.set_updated_at();
create index if not exists idx_shipments_buyer on public.shipments(buyer_id);
create index if not exists idx_shipments_status on public.shipments(status);

-- orders consolidated into a shipment
create table if not exists public.shipment_orders (
  shipment_id    uuid not null references public.shipments(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  primary key (shipment_id, sales_order_id)
);

-- invoice / packing-list line items
create table if not exists public.shipment_lines (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references public.shipments(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id),
  description    text not null,
  hsn_code       text,
  quantity       numeric(14,3) not null default 0,
  unit_price     numeric(14,4) not null default 0,
  amount         numeric(16,2) not null default 0,
  cartons        numeric(10,0),
  net_weight     numeric(12,3),
  gross_weight   numeric(12,3),
  sort_order     int not null default 0
);
create index if not exists idx_shiplines_shipment on public.shipment_lines(shipment_id);

-- generated documents (one current row per type per shipment; regenerate upserts)
create table if not exists public.shipment_documents (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments(id) on delete cascade,
  doc_type     text not null check (doc_type in
                 ('commercial_invoice','packing_list','bill_of_lading','gst_invoice','dgft')),
  doc_no       text,
  status       text not null default 'generated' check (status in ('pending','generated')),
  data         jsonb not null default '{}'::jsonb,   -- snapshot at generation time
  generated_at timestamptz,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shipment_id, doc_type)
);
create trigger trg_shipdoc_updated before update on public.shipment_documents
  for each row execute function public.set_updated_at();
create index if not exists idx_shipdocs_shipment on public.shipment_documents(shipment_id);

-- ---------- RLS (gated by 'logistics') ----------
do $$
declare t text;
begin
  foreach t in array array[
    'shipments','shipment_orders','shipment_lines','shipment_documents'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('logistics','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('logistics','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('logistics','edit'))
        with check (public.has_permission('logistics','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('logistics','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- roles + grants ----------
insert into public.roles (name, description, is_system)
values ('Logistics Executive', 'Manages shipments and export documents', false)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'logistics' and p.action in ('view','create','edit','approve','export')
where r.name in ('Logistics Executive','Manager') on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'logistics' and p.action = 'view'
where r.name = 'Merchandiser' on conflict do nothing;
