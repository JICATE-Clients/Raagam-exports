-- ============================================================================
-- Raagam ERP — 0008 Materials & Purchase
-- Vendors, RFQ, Purchase Orders (with approval), GRN (many-to-many vs PO,
-- partial + QC), Delivery Challans (out-and-back traceability).
-- GRN→Store and GRN→Finance(3-way match) are stubbed until those modules exist.
-- ============================================================================

-- ---------- vendors ----------
create sequence if not exists public.seq_vendor;
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  name           text not null,
  vendor_type    text check (vendor_type in
                   ('yarn','knitting','dyeing','trims','packing','processing','general')),
  contact_person text,
  email          text,
  phone          text,
  address        text,
  gst_number     text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_vendor_code before insert on public.vendors
  for each row execute function public.assign_code('VEN','public.seq_vendor');
create trigger trg_vendor_updated before update on public.vendors
  for each row execute function public.set_updated_at();

-- ---------- RFQ (lightweight request-for-quotation) ----------
create sequence if not exists public.seq_rfq;
create table if not exists public.rfqs (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  title       text not null,
  budget_id   uuid references public.budgets(id),
  status      text not null default 'open' check (status in ('open','closed','awarded')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_rfq_code before insert on public.rfqs
  for each row execute function public.assign_code('RFQ','public.seq_rfq');
create trigger trg_rfq_updated before update on public.rfqs
  for each row execute function public.set_updated_at();

create table if not exists public.rfq_lines (
  id          uuid primary key default gen_random_uuid(),
  rfq_id      uuid not null references public.rfqs(id) on delete cascade,
  item_id     uuid references public.items(id),
  description text not null,
  quantity    numeric(14,3) not null default 0,
  uom_id      uuid references public.uoms(id),
  sort_order  int not null default 0
);
create index if not exists idx_rfqlines_rfq on public.rfq_lines(rfq_id);

create table if not exists public.rfq_quotes (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.rfqs(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id),
  total_amount  numeric(16,2) not null default 0,
  currency_code text references public.currencies(code),
  lead_days     int,
  is_selected   boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rfqquotes_rfq on public.rfq_quotes(rfq_id);

-- ---------- purchase orders ----------
create sequence if not exists public.seq_po;
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  vendor_id     uuid not null references public.vendors(id),
  budget_id     uuid references public.budgets(id),
  rfq_id        uuid references public.rfqs(id),
  location_id   uuid references public.locations(id),
  currency_code text references public.currencies(code),
  status        text not null default 'draft' check (status in
                  ('draft','pending_approval','approved','partially_received','received','closed','cancelled')),
  order_date    date,
  expected_date date,
  total_amount  numeric(16,2) not null default 0,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_po_code before insert on public.purchase_orders
  for each row execute function public.assign_code('PO','public.seq_po');
create trigger trg_po_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_po_vendor on public.purchase_orders(vendor_id);
create index if not exists idx_po_status on public.purchase_orders(status);

create table if not exists public.po_line_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid references public.items(id),
  description       text not null,
  quantity          numeric(14,3) not null default 0,
  uom_id            uuid references public.uoms(id),
  unit_price        numeric(14,4) not null default 0,
  amount            numeric(16,2) not null default 0,
  received_qty      numeric(14,3) not null default 0,  -- cached accepted qty (open bal = quantity - received_qty)
  sort_order        int not null default 0
);
create index if not exists idx_poli_po on public.po_line_items(purchase_order_id);

-- ---------- GRN (goods receipt) — many-to-many vs PO at the LINE level ----------
-- A single GRN can receive lines from multiple POs; a single PO line can be
-- received across multiple GRNs (partial deliveries). Linkage is grn_line_items
-- → po_line_items.
create sequence if not exists public.seq_grn;
create table if not exists public.grns (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  vendor_id   uuid references public.vendors(id),
  location_id uuid references public.locations(id),
  grn_date    date,
  status      text not null default 'draft' check (status in ('draft','posted')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_grn_code before insert on public.grns
  for each row execute function public.assign_code('GRN','public.seq_grn');
create trigger trg_grn_updated before update on public.grns
  for each row execute function public.set_updated_at();

create table if not exists public.grn_line_items (
  id                uuid primary key default gen_random_uuid(),
  grn_id            uuid not null references public.grns(id) on delete cascade,
  po_line_item_id   uuid references public.po_line_items(id),
  purchase_order_id uuid references public.purchase_orders(id),  -- denormalised for querying
  description       text not null,
  received_qty      numeric(14,3) not null default 0,
  accepted_qty      numeric(14,3) not null default 0,
  rejected_qty      numeric(14,3) not null default 0,
  qc_status         text not null default 'pending'
                      check (qc_status in ('pending','passed','failed','partial')),
  rejection_reason  text,
  sort_order        int not null default 0
);
create index if not exists idx_grnli_grn on public.grn_line_items(grn_id);
create index if not exists idx_grnli_poli on public.grn_line_items(po_line_item_id);

-- ---------- Delivery Challans (DC out to processor + return tracking) ----------
create sequence if not exists public.seq_dc;
create table if not exists public.delivery_challans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  vendor_id   uuid references public.vendors(id),       -- processor
  location_id uuid references public.locations(id),
  dc_date     date,
  purpose     text,                                      -- e.g. Button Coloring, Knitting, Dyeing
  status      text not null default 'issued'
                check (status in ('issued','partially_returned','closed')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_dc_code before insert on public.delivery_challans
  for each row execute function public.assign_code('DC','public.seq_dc');
create trigger trg_dc_updated before update on public.delivery_challans
  for each row execute function public.set_updated_at();

create table if not exists public.dc_line_items (
  id                  uuid primary key default gen_random_uuid(),
  delivery_challan_id uuid not null references public.delivery_challans(id) on delete cascade,
  item_id             uuid references public.items(id),
  description         text not null,
  sent_qty            numeric(14,3) not null default 0,
  returned_qty        numeric(14,3) not null default 0,  -- balance = sent - returned
  uom_id              uuid references public.uoms(id),
  sort_order          int not null default 0
);
create index if not exists idx_dcli_dc on public.dc_line_items(delivery_challan_id);

-- ---------- RLS (all gated by 'materials_purchase') ----------
do $$
declare t text;
begin
  foreach t in array array[
    'vendors','rfqs','rfq_lines','rfq_quotes',
    'purchase_orders','po_line_items',
    'grns','grn_line_items',
    'delivery_challans','dc_line_items'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('materials_purchase','edit'))
        with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- grants ----------
-- Manager: full materials_purchase incl. PO approve/export
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'materials_purchase' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: view/create/edit (no approve)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'materials_purchase' and p.action in ('view','create','edit')
where r.name = 'Merchandiser'
on conflict do nothing;

-- ---------- seed vendors ----------
-- Omit code so the trigger assigns VEN-000N and advances seq_vendor. Guarded by
-- emptiness so re-running the migration does not duplicate.
insert into public.vendors (name, vendor_type)
select v.name, v.vtype
from (values
  ('Nivedha Knits','knitting'),
  ('SD Textile','yarn'),
  ('Shree Knit Impex','general')
) as v(name, vtype)
where not exists (select 1 from public.vendors);
