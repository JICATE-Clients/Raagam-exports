-- ============================================================================
-- Raagam ERP — 0370 Planning ▸ PPM (Pre-Production Material)
-- Rebuilt from VB.NET deep-dive of 6 forms (ver_30A, company 38):
--   FrmGarment_PPM, FrmProcessingPPM, FrmPurchase_PPM,
--   FrmPPMCancel, FrmPPMCompletion, FrmGAR_PPMCancellation.
--
-- PPM lifecycle: BOM → Budget Approved → PPM → Completion / Cancellation
-- Three PPM types:
--   Garment PPM  (tblGAR_Orders)  — separate header table
--   Processing PPM (tblPPOs)      — shared PPO table with ppm_type discriminator
--   Purchase PPM   (tblPPOs)      — shared PPO table with ppm_type discriminator
-- ============================================================================

-- ============================================================================
-- 1. GARMENT PPM — Header (maps to tblGAR_Orders)
--    Most complex form: 5 tabs, 12 grid bands, 4-level quantity hierarchy
-- ============================================================================
create sequence if not exists public.seq_garment_ppm;

create table if not exists public.garment_ppms (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  -- record type
  record_type         text not null default 'garmenting'
                        check (record_type in (
                          'garmenting','cutting','shortage_garmenting',
                          'shortage_cutting','sample_work_order','rate_amendment'
                        )),
  -- header
  ppm_date            date not null default current_date,
  department_id       uuid references public.departments(id),
  requisitioner_id    uuid references public.employees(id),
  description         text,
  customer_id         uuid references public.customers(id),
  sales_order_id      uuid references public.sales_orders(id),
  group_no            text,
  group_description   text,
  style_id            uuid references public.styles(id),
  sc_no               text,
  delivery_date       date,
  is_full_order       boolean not null default true,
  order_for           text not null default 'B'
                        check (order_for in ('B','S')),  -- Bulk / Sample
  cons_multiplier     numeric(10,2) default 0,
  sourcing_type       text not null default 'I'
                        check (sourcing_type in ('I','O')),  -- In House / Outside
  -- To (In House)
  to_location_id      uuid references public.locations(id),
  to_department_id    uuid references public.departments(id),
  to_contact_id       uuid references public.employees(id),
  -- Supplier (Outside)
  vendor_id           uuid references public.vendors(id),
  -- Stages
  stage_from          text default 'FABRIC',
  stage_to            text default 'PACK',
  -- Values (calculated)
  cmt_value           numeric(16,2) default 0,
  fabric_issued_value numeric(16,2) default 0,
  garment_process_value numeric(16,2) default 0,
  accessories_value   numeric(16,2) default 0,
  gross_value         numeric(16,2) default 0,
  overhead_pct        numeric(8,2) default 0,
  overhead_value      numeric(16,2) default 0,
  net_value           numeric(16,2) default 0,
  -- Material stores
  sew_mat_store       text,
  pak_mat_store       text,
  -- Rate amendment fields
  reason              text,
  task_owner_id       uuid references public.profiles(id),
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_garment_ppm_code before insert on public.garment_ppms
  for each row execute function public.assign_code('GARPPM','public.seq_garment_ppm');
create trigger trg_garment_ppm_updated before update on public.garment_ppms
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_order on public.garment_ppms(sales_order_id);
create index if not exists idx_garppm_customer on public.garment_ppms(customer_id);
create index if not exists idx_garppm_status on public.garment_ppms(status);
create index if not exists idx_garppm_location on public.garment_ppms(location_id);

-- ============================================================================
-- 1a. GARMENT PPM — Packs
-- ============================================================================
create table if not exists public.garment_ppm_packs (
  id                  uuid primary key default gen_random_uuid(),
  garment_ppm_id      uuid not null references public.garment_ppms(id) on delete cascade,
  sno                 int not null default 0,
  sc_no               text,
  order_no            text,
  country_id          text,
  pack                text,
  consignee           text,
  assortment_type     text,   -- SC-SS, SC-AS, SS-AC, AC-AS
  no_of_cartons       int default 0,
  uom_id              uuid references public.uoms(id),
  ppm_qty             numeric(14,3) default 0,
  delivery_date       date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_pack_updated before update on public.garment_ppm_packs
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_pack_parent on public.garment_ppm_packs(garment_ppm_id);

-- ============================================================================
-- 1b. GARMENT PPM — Quantities (Band 0: styles/articles)
-- ============================================================================
create table if not exists public.garment_ppm_quantities (
  id                  uuid primary key default gen_random_uuid(),
  garment_ppm_id      uuid not null references public.garment_ppms(id) on delete cascade,
  sno                 int not null default 0,
  sc_no               text,
  order_no            text,
  style_ref_no        text,
  style_no            text,
  article_no          text,
  uom_id              uuid references public.uoms(id),
  order_qty           numeric(14,3) default 0,
  excess_qty          numeric(14,3) default 0,
  rejection_qty       numeric(14,3) default 0,
  approval_qty        numeric(14,3) default 0,
  ppm_qty             numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_qty_updated before update on public.garment_ppm_quantities
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_qty_parent on public.garment_ppm_quantities(garment_ppm_id);

-- ============================================================================
-- 1c. GARMENT PPM — Coordinates (child of Quantities)
-- ============================================================================
create table if not exists public.garment_ppm_coordinates (
  id                  uuid primary key default gen_random_uuid(),
  quantity_id         uuid not null references public.garment_ppm_quantities(id) on delete cascade,
  sno                 int not null default 0,
  coordinate          text,
  smvs                numeric(10,3) default 0,
  rate                numeric(14,4) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_coord_updated before update on public.garment_ppm_coordinates
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_coord_parent on public.garment_ppm_coordinates(quantity_id);

-- ============================================================================
-- 1d. GARMENT PPM — Combos (child of Quantities)
-- ============================================================================
create table if not exists public.garment_ppm_combos (
  id                  uuid primary key default gen_random_uuid(),
  quantity_id         uuid not null references public.garment_ppm_quantities(id) on delete cascade,
  sno                 int not null default 0,
  combo               text,
  order_qty           numeric(14,3) default 0,
  excess_qty          numeric(14,3) default 0,
  rejection_qty       numeric(14,3) default 0,
  approval_qty        numeric(14,3) default 0,
  ppm_qty             numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_combo_updated before update on public.garment_ppm_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_combo_parent on public.garment_ppm_combos(quantity_id);

-- ============================================================================
-- 1e. GARMENT PPM — Sizes (child of Combos, deepest level)
-- ============================================================================
create table if not exists public.garment_ppm_sizes (
  id                  uuid primary key default gen_random_uuid(),
  combo_id            uuid not null references public.garment_ppm_combos(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  order_qty           numeric(14,3) default 0,
  excess_qty          numeric(14,3) default 0,
  rejection_qty       numeric(14,3) default 0,
  approval_qty        numeric(14,3) default 0,
  ppm_qty             numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_size_updated before update on public.garment_ppm_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_size_parent on public.garment_ppm_sizes(combo_id);

-- ============================================================================
-- 1f. GARMENT PPM — Fabrics To Be Issued
-- ============================================================================
create table if not exists public.garment_ppm_fabrics (
  id                  uuid primary key default gen_random_uuid(),
  garment_ppm_id      uuid not null references public.garment_ppms(id) on delete cascade,
  sno                 int not null default 0,
  item_name           text,
  gsm                 numeric(10,2),
  vendor_name         text,
  stage               text,          -- GREY/DYED/PRINT/WASH
  item_type           text,          -- Circular/Woven/Flat
  item_color          text,
  print_name          text,
  specifications      text,
  uom_id              uuid references public.uoms(id),
  process_name        text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_fab_updated before update on public.garment_ppm_fabrics
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_fab_parent on public.garment_ppm_fabrics(garment_ppm_id);

-- ============================================================================
-- 1g. GARMENT PPM — Fabric Sizes (child of Fabrics)
-- ============================================================================
create table if not exists public.garment_ppm_fabric_sizes (
  id                  uuid primary key default gen_random_uuid(),
  fabric_id           uuid not null references public.garment_ppm_fabrics(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_fabsz_updated before update on public.garment_ppm_fabric_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_fabsz_parent on public.garment_ppm_fabric_sizes(fabric_id);

-- ============================================================================
-- 1h. GARMENT PPM — Garmenting Processes
-- ============================================================================
create table if not exists public.garment_ppm_processes (
  id                  uuid primary key default gen_random_uuid(),
  garment_ppm_id      uuid not null references public.garment_ppms(id) on delete cascade,
  sno                 int not null default 0,
  process_name        text,
  rate_for            text default 'PRO'
                        check (rate_for in ('PRO','DSN')),  -- Processwise / Designwise
  rate_for_type       text default '',       -- '' / ST / SC / SZ / SM
  uom_id              uuid references public.uoms(id),
  qty                 numeric(14,3) default 0,
  rate_type           text,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  is_by_us            boolean default false,
  is_by_vendor        boolean default false,
  is_inclusive_rate   boolean default false,
  is_exclusive_rate   boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_proc_updated before update on public.garment_ppm_processes
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_proc_parent on public.garment_ppm_processes(garment_ppm_id);

-- ============================================================================
-- 1i. GARMENT PPM — Process Items (child of Processes)
-- ============================================================================
create table if not exists public.garment_ppm_process_items (
  id                  uuid primary key default gen_random_uuid(),
  process_id          uuid not null references public.garment_ppm_processes(id) on delete cascade,
  sno                 int not null default 0,
  description         text,
  uom_id              uuid references public.uoms(id),
  qty                 numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  is_by_us            boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_procitm_updated before update on public.garment_ppm_process_items
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_procitm_parent on public.garment_ppm_process_items(process_id);

-- ============================================================================
-- 1j. GARMENT PPM — Accessories (Items To Be Issued)
-- ============================================================================
create table if not exists public.garment_ppm_accessories (
  id                  uuid primary key default gen_random_uuid(),
  garment_ppm_id      uuid not null references public.garment_ppms(id) on delete cascade,
  sno                 int not null default 0,
  item_name           text,
  vendor_name         text,
  item_color          text,
  specifications      text,
  uom_id              uuid references public.uoms(id),
  process_name        text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  is_by_vendor        boolean default false,
  is_inclusive_rate   boolean default false,
  is_exclusive_rate   boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_acc_updated before update on public.garment_ppm_accessories
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_acc_parent on public.garment_ppm_accessories(garment_ppm_id);

-- ============================================================================
-- 1k. GARMENT PPM — Accessory Sizes (child of Accessories)
-- ============================================================================
create table if not exists public.garment_ppm_accessory_sizes (
  id                  uuid primary key default gen_random_uuid(),
  accessory_id        uuid not null references public.garment_ppm_accessories(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garppm_accsz_updated before update on public.garment_ppm_accessory_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_garppm_accsz_parent on public.garment_ppm_accessory_sizes(accessory_id);

-- ============================================================================
-- 2. PROCESSING PPM — Header (maps to tblPPOs with ppm_type='processing')
-- ============================================================================
create sequence if not exists public.seq_processing_ppm;

create table if not exists public.processing_ppms (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  record_type         text not null default 'processing'
                        check (record_type in ('processing','processing_amendment','processing_for_purchase')),
  ppm_date            date not null default current_date,
  amendment_no        int not null default 0,
  department_id       uuid references public.departments(id),
  requisitioner_id    uuid references public.employees(id),
  customer_id         uuid references public.customers(id),
  sales_order_id      uuid references public.sales_orders(id),
  group_no            text,
  group_description   text,
  -- To
  to_location_id      uuid references public.locations(id),
  to_department_id    uuid references public.departments(id),
  to_contact_id       uuid references public.employees(id),
  -- Values
  gross_value         numeric(16,2) default 0,
  input_value         numeric(16,2) default 0,   -- sum of yarn to be issued
  overhead_pct        numeric(8,2) default 0,
  overhead_value      numeric(16,2) default 0,
  net_value           numeric(16,2) default 0,    -- process value
  remarks             text,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_processing_ppm_code before insert on public.processing_ppms
  for each row execute function public.assign_code('PROCPPM','public.seq_processing_ppm');
create trigger trg_processing_ppm_updated before update on public.processing_ppms
  for each row execute function public.set_updated_at();
create index if not exists idx_procppm_order on public.processing_ppms(sales_order_id);
create index if not exists idx_procppm_customer on public.processing_ppms(customer_id);
create index if not exists idx_procppm_status on public.processing_ppms(status);

-- ============================================================================
-- 2a. PROCESSING PPM — Items
-- ============================================================================
create table if not exists public.processing_ppm_items (
  id                  uuid primary key default gen_random_uuid(),
  processing_ppm_id   uuid not null references public.processing_ppms(id) on delete cascade,
  sno                 int not null default 0,
  item_class_name     text,
  category_name       text,
  description         text,
  uom_id              uuid references public.uoms(id),
  process_name        text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  is_size_wise        boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_procppm_item_updated before update on public.processing_ppm_items
  for each row execute function public.set_updated_at();
create index if not exists idx_procppm_item_parent on public.processing_ppm_items(processing_ppm_id);

-- ============================================================================
-- 2b. PROCESSING PPM — Item Sizes (child of Items)
-- ============================================================================
create table if not exists public.processing_ppm_sizes (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.processing_ppm_items(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_procppm_size_updated before update on public.processing_ppm_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_procppm_size_parent on public.processing_ppm_sizes(item_id);

-- ============================================================================
-- 2c. PROCESSING PPM — Yarn To Be Issued (auto-generated from BOM)
-- ============================================================================
create table if not exists public.processing_ppm_yarns (
  id                  uuid primary key default gen_random_uuid(),
  processing_ppm_id   uuid not null references public.processing_ppms(id) on delete cascade,
  sno                 int not null default 0,
  item_name           text,
  stage               text,
  item_color          text,
  vendor_name         text,
  specifications      text,
  uom_id              uuid references public.uoms(id),
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  amount              numeric(16,2) default 0,
  is_general_stock    boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_procppm_yarn_updated before update on public.processing_ppm_yarns
  for each row execute function public.set_updated_at();
create index if not exists idx_procppm_yarn_parent on public.processing_ppm_yarns(processing_ppm_id);

-- ============================================================================
-- 3. PURCHASE PPM — Header (maps to tblPPOs with ppm_type='purchase')
-- ============================================================================
create sequence if not exists public.seq_purchase_ppm;

create table if not exists public.purchase_ppms (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  record_type         text not null default 'purchase'
                        check (record_type in ('purchase','purchase_amendment')),
  ppm_date            date not null default current_date,
  amendment_no        int not null default 0,
  department_id       uuid references public.departments(id),
  requisitioner_id    uuid references public.employees(id),
  customer_id         uuid references public.customers(id),
  sales_order_id      uuid references public.sales_orders(id),
  group_no            text,
  group_description   text,
  -- To
  to_department_id    uuid references public.departments(id),
  to_contact_id       uuid references public.employees(id),
  -- Values
  gross_value         numeric(16,2) default 0,
  overhead_pct        numeric(8,2) default 0,
  overhead_value      numeric(16,2) default 0,
  net_value           numeric(16,2) default 0,
  remarks             text,
  -- Workflow
  ack_status          text not null default 'N'
                        check (ack_status in ('N','A','R','V')),  -- New/Ack/Return/RetAck
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_purchase_ppm_code before insert on public.purchase_ppms
  for each row execute function public.assign_code('PURPPM','public.seq_purchase_ppm');
create trigger trg_purchase_ppm_updated before update on public.purchase_ppms
  for each row execute function public.set_updated_at();
create index if not exists idx_purppm_order on public.purchase_ppms(sales_order_id);
create index if not exists idx_purppm_customer on public.purchase_ppms(customer_id);
create index if not exists idx_purppm_status on public.purchase_ppms(status);

-- ============================================================================
-- 3a. PURCHASE PPM — Items
-- ============================================================================
create table if not exists public.purchase_ppm_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_ppm_id     uuid not null references public.purchase_ppms(id) on delete cascade,
  sno                 int not null default 0,
  item_class_name     text,
  category_name       text,
  description         text,
  uom_id              uuid references public.uoms(id),
  is_approval_required boolean default false,
  is_size_wise        boolean default false,
  required_date       date,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_purppm_item_updated before update on public.purchase_ppm_items
  for each row execute function public.set_updated_at();
create index if not exists idx_purppm_item_parent on public.purchase_ppm_items(purchase_ppm_id);

-- ============================================================================
-- 3b. PURCHASE PPM — Item Sizes (child of Items)
-- ============================================================================
create table if not exists public.purchase_ppm_sizes (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.purchase_ppm_items(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  qty                 numeric(14,3) default 0,
  wt                  numeric(14,3) default 0,
  rate                numeric(14,4) default 0,
  po_value            numeric(16,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_purppm_size_updated before update on public.purchase_ppm_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_purppm_size_parent on public.purchase_ppm_sizes(item_id);

-- ============================================================================
-- 4. PPM CANCELLATION (Purchase/Processing PPMs)
-- ============================================================================
create sequence if not exists public.seq_ppm_cancel;

create table if not exists public.ppm_cancels (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  cancel_type         text not null default 'B'
                        check (cancel_type in ('B','P')),  -- Balance / Part
  cancel_date         date not null default current_date,
  customer_id         uuid references public.customers(id),
  ppm_id              text,        -- reference to the PPM being cancelled (code)
  ppm_date            date,
  group_no            text,
  group_description   text,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_ppm_cancel_code before insert on public.ppm_cancels
  for each row execute function public.assign_code('PPMCAN','public.seq_ppm_cancel');
create trigger trg_ppm_cancel_updated before update on public.ppm_cancels
  for each row execute function public.set_updated_at();
create index if not exists idx_ppmcan_customer on public.ppm_cancels(customer_id);

-- ============================================================================
-- 4a. PPM CANCEL — Items
-- ============================================================================
create table if not exists public.ppm_cancel_items (
  id                  uuid primary key default gen_random_uuid(),
  ppm_cancel_id       uuid not null references public.ppm_cancels(id) on delete cascade,
  sno                 int not null default 0,
  item_class_name     text,
  category_name       text,
  description         text,
  uom_id              uuid references public.uoms(id),
  -- PPM (ordered) quantities — read-only
  ppm_qty             numeric(14,3) default 0,
  ppm_wt              numeric(14,3) default 0,
  -- Cancel quantities
  cancel_qty          numeric(14,3) default 0,
  cancel_wt           numeric(14,3) default 0,
  is_size_wise        boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ppmcan_item_updated before update on public.ppm_cancel_items
  for each row execute function public.set_updated_at();
create index if not exists idx_ppmcan_item_parent on public.ppm_cancel_items(ppm_cancel_id);

-- ============================================================================
-- 4b. PPM CANCEL — Item Sizes (child of Items)
-- ============================================================================
create table if not exists public.ppm_cancel_sizes (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.ppm_cancel_items(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  ppm_qty             numeric(14,3) default 0,
  ppm_wt              numeric(14,3) default 0,
  cancel_qty          numeric(14,3) default 0,
  cancel_wt           numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_ppmcan_size_updated before update on public.ppm_cancel_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_ppmcan_size_parent on public.ppm_cancel_sizes(item_id);

-- ============================================================================
-- 5. PPM COMPLETION (simple header + notes)
-- ============================================================================
create sequence if not exists public.seq_ppm_completion;

create table if not exists public.ppm_completions (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  entry_date          date not null default current_date,
  customer_id         uuid references public.customers(id),
  ppm_id              text,        -- reference to the PPM being completed (code)
  group_no            text,
  group_description   text,
  notes               text,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_ppm_completion_code before insert on public.ppm_completions
  for each row execute function public.assign_code('PPMCMP','public.seq_ppm_completion');
create trigger trg_ppm_completion_updated before update on public.ppm_completions
  for each row execute function public.set_updated_at();
create index if not exists idx_ppmcmp_customer on public.ppm_completions(customer_id);

-- ============================================================================
-- 6. GARMENT PPM CANCELLATION — Separate form with 4-level hierarchy
-- ============================================================================
create sequence if not exists public.seq_garment_ppm_cancel;

create table if not exists public.garment_ppm_cancellations (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  cancel_date         date not null default current_date,
  garment_ppm_id      uuid references public.garment_ppms(id),
  ppm_code            text,        -- display reference
  customer_name       text,
  description         text,
  -- Workflow
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected')),
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  location_id         uuid references public.locations(id),
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_garppm_cancel_code before insert on public.garment_ppm_cancellations
  for each row execute function public.assign_code('GARCAN','public.seq_garment_ppm_cancel');
create trigger trg_garppm_cancel_updated before update on public.garment_ppm_cancellations
  for each row execute function public.set_updated_at();
create index if not exists idx_garcan_ppm on public.garment_ppm_cancellations(garment_ppm_id);

-- ============================================================================
-- 6a. GARMENT PPM CANCEL — Styles (Band 0)
-- ============================================================================
create table if not exists public.garment_ppm_cancel_styles (
  id                  uuid primary key default gen_random_uuid(),
  cancellation_id     uuid not null references public.garment_ppm_cancellations(id) on delete cascade,
  sno                 int not null default 0,
  style_ref_no        text,
  style_no            text,
  article_no          text,
  sc_no               text,
  order_no            text,
  uom_id              uuid references public.uoms(id),
  cancel_qty          numeric(14,3) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garcan_style_updated before update on public.garment_ppm_cancel_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_garcan_style_parent on public.garment_ppm_cancel_styles(cancellation_id);

-- ============================================================================
-- 6b. GARMENT PPM CANCEL — Coordinates (child of Styles)
-- ============================================================================
create table if not exists public.garment_ppm_cancel_coordinates (
  id                  uuid primary key default gen_random_uuid(),
  style_id            uuid not null references public.garment_ppm_cancel_styles(id) on delete cascade,
  sno                 int not null default 0,
  coordinate          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garcan_coord_updated before update on public.garment_ppm_cancel_coordinates
  for each row execute function public.set_updated_at();
create index if not exists idx_garcan_coord_parent on public.garment_ppm_cancel_coordinates(style_id);

-- ============================================================================
-- 6c. GARMENT PPM CANCEL — Combos (child of Styles)
-- ============================================================================
create table if not exists public.garment_ppm_cancel_combos (
  id                  uuid primary key default gen_random_uuid(),
  style_id            uuid not null references public.garment_ppm_cancel_styles(id) on delete cascade,
  sno                 int not null default 0,
  item_color          text,
  wo_qty              numeric(14,3) default 0,    -- work order qty (read-only)
  received_qty        numeric(14,3) default 0,    -- received qty (read-only)
  cancel_qty          numeric(14,3) default 0,    -- rollup from sizes
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garcan_combo_updated before update on public.garment_ppm_cancel_combos
  for each row execute function public.set_updated_at();
create index if not exists idx_garcan_combo_parent on public.garment_ppm_cancel_combos(style_id);

-- ============================================================================
-- 6d. GARMENT PPM CANCEL — Sizes (child of Combos, entry point for cancel qty)
-- ============================================================================
create table if not exists public.garment_ppm_cancel_sizes (
  id                  uuid primary key default gen_random_uuid(),
  combo_id            uuid not null references public.garment_ppm_cancel_combos(id) on delete cascade,
  sno                 int not null default 0,
  item_size           text,
  wo_qty              numeric(14,3) default 0,    -- read-only
  received_qty        numeric(14,3) default 0,    -- read-only
  cancel_qty          numeric(14,3) default 0,    -- editable — entry point
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garcan_size_updated before update on public.garment_ppm_cancel_sizes
  for each row execute function public.set_updated_at();
create index if not exists idx_garcan_size_parent on public.garment_ppm_cancel_sizes(combo_id);

-- ============================================================================
-- 7. RLS POLICIES — all PPM tables
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'garment_ppms','garment_ppm_packs','garment_ppm_quantities',
    'garment_ppm_coordinates','garment_ppm_combos','garment_ppm_sizes',
    'garment_ppm_fabrics','garment_ppm_fabric_sizes',
    'garment_ppm_processes','garment_ppm_process_items',
    'garment_ppm_accessories','garment_ppm_accessory_sizes',
    'processing_ppms','processing_ppm_items','processing_ppm_sizes','processing_ppm_yarns',
    'purchase_ppms','purchase_ppm_items','purchase_ppm_sizes',
    'ppm_cancels','ppm_cancel_items','ppm_cancel_sizes',
    'ppm_completions',
    'garment_ppm_cancellations','garment_ppm_cancel_styles',
    'garment_ppm_cancel_coordinates','garment_ppm_cancel_combos','garment_ppm_cancel_sizes'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
  end loop;
end $$;
