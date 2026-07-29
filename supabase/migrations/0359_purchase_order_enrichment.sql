-- ============================================================================
-- Raagam ERP -- 0348 Purchase Order Enrichment
-- Adds full 5-band hierarchy (ItemGroups -> Items -> SizeDeliveries ->
-- DeliverySizes -> ItemSizeDeliveries), dual currency (INR + FGN),
-- commercial fields, general/logistics fields, additional charges,
-- and agent commission -- all from VB.NET FrmPurchaseOrder.vb source.
-- ============================================================================

-- ---------- 1. Enrich purchase_orders header ----------
alter table public.purchase_orders
  add column if not exists po_type            text default 'local' check (po_type in ('local','import')),
  add column if not exists exchange_rate       numeric(12,6),
  add column if not exists foreign_currency_code text references public.currencies(code),
  add column if not exists foreign_total_amount numeric(16,2) default 0,
  -- commercial / payment
  add column if not exists payment_terms       text,
  add column if not exists ship_mode           text,
  add column if not exists ship_type           text,
  add column if not exists pay_mode            text,
  add column if not exists place_of_delivery   text,
  add column if not exists invoice_send_to     text,
  add column if not exists vat_against         text,
  add column if not exists duty_against        text,
  -- freight
  add column if not exists freight_type        text check (freight_type in ('itemwise','consolidated')),
  add column if not exists freight_inr         numeric(16,2) default 0,
  add column if not exists freight_fgn         numeric(16,2) default 0,
  -- insurance
  add column if not exists insurance_inr       numeric(16,2) default 0,
  add column if not exists insurance_fgn       numeric(16,2) default 0,
  -- value summary (INR)
  add column if not exists basic_inr           numeric(16,2) default 0,
  add column if not exists discount_inr        numeric(16,2) default 0,
  add column if not exists duty_inr            numeric(16,2) default 0,
  add column if not exists vat_inr             numeric(16,2) default 0,
  add column if not exists cess_inr            numeric(16,2) default 0,
  add column if not exists gross_inr           numeric(16,2) default 0,
  add column if not exists net_inr             numeric(16,2) default 0,
  add column if not exists round_off_inr       numeric(16,2) default 0,
  -- value summary (Foreign)
  add column if not exists basic_fgn           numeric(16,2) default 0,
  add column if not exists discount_fgn        numeric(16,2) default 0,
  add column if not exists duty_fgn            numeric(16,2) default 0,
  add column if not exists vat_fgn             numeric(16,2) default 0,
  add column if not exists cess_fgn            numeric(16,2) default 0,
  add column if not exists gross_fgn           numeric(16,2) default 0,
  add column if not exists net_fgn             numeric(16,2) default 0,
  add column if not exists round_off_fgn       numeric(16,2) default 0,
  -- agent commission
  add column if not exists agent_id            uuid references public.vendors(id),
  add column if not exists agent_commission_rate numeric(5,2) default 0,
  add column if not exists agent_commission_amount numeric(16,2) default 0,
  -- general / logistics
  add column if not exists quality_requirements text,
  add column if not exists bank_guarantee      text,
  add column if not exists warranty_terms      text,
  add column if not exists delivery_instructions text,
  add column if not exists insurance_details   text,
  add column if not exists port_of_shipment    text,
  add column if not exists transport_name      text,
  add column if not exists transport_details   text,
  add column if not exists reference           text;


-- ---------- 2. Band 0: po_item_groups ----------
create sequence if not exists public.seq_po_item_group;
create table if not exists public.po_item_groups (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  sl_no             int not null default 0,
  ppm_no            text,
  group_no          text,
  group_description text,
  customer_name     text,
  style_no          text,
  style_description text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_poig_po on public.po_item_groups(purchase_order_id);
create trigger trg_po_item_groups_updated before update on public.po_item_groups
  for each row execute function public.set_updated_at();


-- ---------- 3. Enrich po_line_items (Band 1 -- now optionally child of po_item_groups) ----------
alter table public.po_line_items
  add column if not exists item_group_id            uuid references public.po_item_groups(id) on delete set null,
  add column if not exists item_class                text,
  add column if not exists category                  text,
  add column if not exists is_size_wise              boolean default false,
  add column if not exists is_colorwise              boolean default false,
  add column if not exists has_multiple_deliveries   boolean default false,
  add column if not exists quote_no                  text,
  add column if not exists quote_reference           text,
  add column if not exists billing_uom_id            uuid references public.uoms(id),
  add column if not exists weight_per_uom            numeric(14,4),
  add column if not exists rolls                     int default 0,
  add column if not exists meters                    numeric(14,3) default 0,
  add column if not exists weight                    numeric(14,3) default 0,
  add column if not exists net_rate                  numeric(14,4) default 0,
  add column if not exists is_foc                    boolean default false,
  add column if not exists delivery_date             date;

create index if not exists idx_poli_group on public.po_line_items(item_group_id);


-- ---------- 4. Band 2: po_size_deliveries ----------
create table if not exists public.po_size_deliveries (
  id                uuid primary key default gen_random_uuid(),
  po_line_item_id   uuid not null references public.po_line_items(id) on delete cascade,
  delivery_date     date,
  rolls             int default 0,
  quantity          numeric(14,3) not null default 0,
  meters            numeric(14,3) default 0,
  weight            numeric(14,3) default 0,
  rate              numeric(14,4) default 0,
  net_rate          numeric(14,4) default 0,
  po_value          numeric(16,2) default 0,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_posd_line on public.po_size_deliveries(po_line_item_id);
create trigger trg_po_size_deliveries_updated before update on public.po_size_deliveries
  for each row execute function public.set_updated_at();


-- ---------- 5. Band 3: po_delivery_sizes (child of po_size_deliveries) ----------
create table if not exists public.po_delivery_sizes (
  id                    uuid primary key default gen_random_uuid(),
  po_size_delivery_id   uuid not null references public.po_size_deliveries(id) on delete cascade,
  bom_size              text,
  item_size             text,
  rolls                 int default 0,
  quantity              numeric(14,3) not null default 0,
  weight                numeric(14,3) default 0,
  rate                  numeric(14,4) default 0,
  net_rate              numeric(14,4) default 0,
  po_value              numeric(16,2) default 0,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_pods_delivery on public.po_delivery_sizes(po_size_delivery_id);
create trigger trg_po_delivery_sizes_updated before update on public.po_delivery_sizes
  for each row execute function public.set_updated_at();


-- ---------- 6. Band 4: po_item_size_deliveries (alternate child of po_line_items) ----------
create table if not exists public.po_item_size_deliveries (
  id                uuid primary key default gen_random_uuid(),
  po_line_item_id   uuid not null references public.po_line_items(id) on delete cascade,
  bom_size          text,
  item_size         text,
  stitch_length     numeric(10,3),
  loop_length       numeric(10,3),
  rolls             int default 0,
  quantity          numeric(14,3) not null default 0,
  weight            numeric(14,3) default 0,
  rate              numeric(14,4) default 0,
  net_rate          numeric(14,4) default 0,
  po_value          numeric(16,2) default 0,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_poisd_line on public.po_item_size_deliveries(po_line_item_id);
create trigger trg_po_item_size_deliveries_updated before update on public.po_item_size_deliveries
  for each row execute function public.set_updated_at();


-- ---------- 7. Additional charges (4 add + 4 less from VB.NET) ----------
create table if not exists public.po_additional_charges (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  charge_type       text not null check (charge_type in ('add','less')),
  label             text not null,
  rate_type         text,
  rate              numeric(14,4) default 0,
  inr_amount        numeric(16,2) not null default 0,
  fgn_amount        numeric(16,2) not null default 0,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_poac_po on public.po_additional_charges(purchase_order_id);
create trigger trg_po_additional_charges_updated before update on public.po_additional_charges
  for each row execute function public.set_updated_at();


-- ---------- 8. RLS for all new tables ----------
do $$
declare t text;
begin
  foreach t in array array[
    'po_item_groups',
    'po_size_deliveries',
    'po_delivery_sizes',
    'po_item_size_deliveries',
    'po_additional_charges'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
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
  end loop;
end $$;
