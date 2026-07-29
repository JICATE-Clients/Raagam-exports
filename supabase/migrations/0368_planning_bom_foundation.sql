-- ============================================================================
-- Raagam ERP — 0368 Planning ▸ BOM Foundation
-- Rebuilt from VB.NET Planning_UI deep-dive (ver_30A, company 38).
-- Creates all BOM tables: Fabric BOM, Garment BOM, Material/Production BOM,
-- Accessories BOM, BOM Shortage, BOM Transfer.
-- Permission gated by 'planning' module.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Register 'planning' module permission
-- ---------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name)
select 'module', 'planning', 'Planning'
where not exists (
  select 1 from public.config_lookups
  where kind = 'module' and code = 'planning'
);

-- ============================================================================
-- 1. FABRIC BOM  (FrmStyle_Fab_BOM)
--    Style-level fabric definition: fabrics, cloths, components, combos,
--    dye/print color specs. One per style per amendment.
-- ============================================================================
create sequence if not exists public.seq_fabric_bom;

create table if not exists public.fabric_boms (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  style_id        uuid references public.styles(id),
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  amendment_no    int not null default 0,
  revision_no     int not null default 0,
  catalogue_no    text,
  description     text,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  location_id     uuid references public.locations(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_fabbom_code before insert on public.fabric_boms
  for each row execute function public.assign_code('FABBOM','public.seq_fabric_bom');
create trigger trg_fabbom_updated before update on public.fabric_boms
  for each row execute function public.set_updated_at();
create index if not exists idx_fabbom_style on public.fabric_boms(style_id);
create index if not exists idx_fabbom_order on public.fabric_boms(sales_order_id);

-- Dye/print color specs (tabs 1-4 in VB.NET: yarn dyeing, roll form prints,
-- fabric dyeing colors). One table with color_type discriminator.
create table if not exists public.fabric_bom_dye_colors (
  id              uuid primary key default gen_random_uuid(),
  fabric_bom_id   uuid not null references public.fabric_boms(id) on delete cascade,
  color_type      text not null check (color_type in ('yarn_dye','fabric_dye','print')),
  description     text not null,
  process_loss_pct numeric(6,2) default 0,
  sub_type        text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fabbom_dye_parent on public.fabric_bom_dye_colors(fabric_bom_id);

-- Fabric items (tab 5: main fabric grid)
create table if not exists public.fabric_bom_fabrics (
  id              uuid primary key default gen_random_uuid(),
  fabric_bom_id   uuid not null references public.fabric_boms(id) on delete cascade,
  sno             int not null default 0,
  category_id     uuid references public.categories(id),
  item_id         uuid references public.items(id),
  item_sub_type   text check (item_sub_type in ('solid','yarn_dyed','melange')),
  gsm_range       text,
  no_of_colors    int default 1,
  mixing_uom_id   uuid references public.uoms(id),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fabbom_fab_parent on public.fabric_bom_fabrics(fabric_bom_id);

-- Cloth variants per fabric
create table if not exists public.fabric_bom_cloths (
  id              uuid primary key default gen_random_uuid(),
  fabric_id       uuid not null references public.fabric_bom_fabrics(id) on delete cascade,
  sno             int not null default 0,
  cloth_name      text,
  fabric_short_name text,
  uom_id          uuid references public.uoms(id),
  yarn_short_name text,
  shade_id        text,
  warp_weft       text check (warp_weft in ('warp','weft')),
  yarn_reqd_form  text check (yarn_reqd_form in ('hank','cheese','both')),
  is_doubling_yarn boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fabbom_cloth_parent on public.fabric_bom_cloths(fabric_id);

-- Style components assembly (tab 6)
create table if not exists public.fabric_bom_components (
  id              uuid primary key default gen_random_uuid(),
  fabric_bom_id   uuid not null references public.fabric_boms(id) on delete cascade,
  sno             int not null default 0,
  component_id    uuid references public.components(id),
  coordinate      text,
  category_id     uuid references public.categories(id),
  item_type       text,
  item_sub_type   text,
  item_id         uuid references public.items(id),
  gsm             numeric(10,2),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fabbom_comp_parent on public.fabric_bom_components(fabric_bom_id);

-- Color combos per component
create table if not exists public.fabric_bom_combos (
  id              uuid primary key default gen_random_uuid(),
  component_id    uuid not null references public.fabric_bom_components(id) on delete cascade,
  sno             int not null default 0,
  assort_color    text,
  item_sub_type   text,
  item_id         uuid references public.items(id),
  gsm             numeric(10,2),
  item_process_type text,
  item_color      text,
  print_name      text,
  specifications  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_fabbom_combo_parent on public.fabric_bom_combos(component_id);

-- ============================================================================
-- 2. GARMENT BOM  (FrmStyl_Gar_BOM)
--    Style garment components & processes. 3-level hierarchy:
--    Process → Component → Placement.
-- ============================================================================
create sequence if not exists public.seq_garment_bom;

create table if not exists public.garment_boms (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  style_id        uuid references public.styles(id),
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  order_no        text,
  oc_no           text,
  amendment_no    int not null default 0,
  reason          text,
  task_owner_id   uuid references public.profiles(id),
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  location_id     uuid references public.locations(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_garbom_code before insert on public.garment_boms
  for each row execute function public.assign_code('GARBOM','public.seq_garment_bom');
create trigger trg_garbom_updated before update on public.garment_boms
  for each row execute function public.set_updated_at();
create index if not exists idx_garbom_style on public.garment_boms(style_id);
create index if not exists idx_garbom_order on public.garment_boms(sales_order_id);

-- Process steps (component processes + garment processes — discriminated)
create table if not exists public.garment_bom_processes (
  id              uuid primary key default gen_random_uuid(),
  garment_bom_id  uuid not null references public.garment_boms(id) on delete cascade,
  process_type    text not null check (process_type in ('component','garment')),
  sno             int not null default 0,
  style_ref_no    text,
  style_no        text,
  article_no      text,
  process_id      uuid references public.processes(id),
  against_pack_ref boolean not null default false,
  loss_pct        numeric(6,2) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_garbom_proc_parent on public.garment_bom_processes(garment_bom_id);

-- Components per process
create table if not exists public.garment_bom_components (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.garment_bom_processes(id) on delete cascade,
  sno             int not null default 0,
  component_id    uuid references public.components(id),
  coordinate      text,
  design          text,
  vendor_specification text,
  attachment_ref  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_garbom_comp_parent on public.garment_bom_components(process_id);

-- Placement details per component
create table if not exists public.garment_bom_placements (
  id              uuid primary key default gen_random_uuid(),
  component_id    uuid not null references public.garment_bom_components(id) on delete cascade,
  sno             int not null default 0,
  position        text,
  design_detail   text,
  combo_detail    text,
  pack_ref_detail text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_garbom_place_parent on public.garment_bom_placements(component_id);

-- ============================================================================
-- 3. MATERIAL / PRODUCTION BOM  (FrmProd_BOM)
--    Production-level BOM with 5 tabs: Fabrics, Programs, Products,
--    Yarn Process Sequences, Fabric Process Sequences.
-- ============================================================================
create sequence if not exists public.seq_material_bom;

create table if not exists public.material_boms (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  order_no        text,
  oc_no           text,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  location_id     uuid references public.locations(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_matbom_code before insert on public.material_boms
  for each row execute function public.assign_code('MATBOM','public.seq_material_bom');
create trigger trg_matbom_updated before update on public.material_boms
  for each row execute function public.set_updated_at();
create index if not exists idx_matbom_order on public.material_boms(sales_order_id);

-- Tab 1: Fabrics
create table if not exists public.material_bom_fabrics (
  id              uuid primary key default gen_random_uuid(),
  material_bom_id uuid not null references public.material_boms(id) on delete cascade,
  sno             int not null default 0,
  category_id     uuid references public.categories(id),
  item_id         uuid references public.items(id),
  item_sub_type   text check (item_sub_type in ('solid','yarn_dyed','melange')),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_fab_parent on public.material_bom_fabrics(material_bom_id);

-- Cloth variants per material_bom fabric
create table if not exists public.material_bom_cloths (
  id              uuid primary key default gen_random_uuid(),
  fabric_id       uuid not null references public.material_bom_fabrics(id) on delete cascade,
  sno             int not null default 0,
  cloth_name      text,
  fabric_short_name text,
  uom_id          uuid references public.uoms(id),
  yarn_short_name text,
  shade_id        text,
  warp_weft       text check (warp_weft in ('warp','weft')),
  yarn_reqd_form  text check (yarn_reqd_form in ('hank','cheese','both')),
  is_doubling_yarn boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_cloth_parent on public.material_bom_cloths(fabric_id);

-- Tab 2: Programs (production programs / SKUs)
create table if not exists public.material_bom_programs (
  id              uuid primary key default gen_random_uuid(),
  material_bom_id uuid not null references public.material_boms(id) on delete cascade,
  sno             int not null default 0,
  program_no      text,
  item_name       text,
  item_sub_type   text,
  cloth_width     numeric(10,2),
  plan_mtr        numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_prog_parent on public.material_bom_programs(material_bom_id);

-- Cutting plans per program
create table if not exists public.material_bom_plans (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.material_bom_programs(id) on delete cascade,
  sno             int not null default 0,
  plan_no         text,
  cut_size_length numeric(10,3),
  cut_size_width  numeric(10,3),
  cons_mtr        numeric(14,3) default 0,
  repeats         int default 1,
  plan_mtr        numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_plan_parent on public.material_bom_plans(program_id);

-- Tab 3: Products (raw materials, accessories, trims)
create table if not exists public.material_bom_products (
  id              uuid primary key default gen_random_uuid(),
  material_bom_id uuid not null references public.material_boms(id) on delete cascade,
  sno             int not null default 0,
  item_id         uuid references public.items(id),
  uom_id          uuid references public.uoms(id),
  order_qty       numeric(14,3) default 0,
  excess_pct      numeric(6,2) default 0,
  extra_qty       numeric(14,3) default 0,
  additional_qty  numeric(14,3) default 0,
  total_qty       numeric(14,3) default 0,
  rate            numeric(14,4) default 0,
  inr_rate        numeric(14,4) default 0,
  total_value     numeric(16,2) default 0,
  description     text,
  yarn_reqd_form  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_prod_parent on public.material_bom_products(material_bom_id);

-- Tabs 4 & 5: Process sequences (yarn + fabric — discriminated by process_type)
create table if not exists public.material_bom_process_sequences (
  id              uuid primary key default gen_random_uuid(),
  material_bom_id uuid not null references public.material_boms(id) on delete cascade,
  process_type    text not null check (process_type in ('yarn','fabric')),
  sno             int not null default 0,
  item_id         uuid references public.items(id),
  item_process_type text,
  process_seq_name text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_pseq_parent on public.material_bom_process_sequences(material_bom_id);

-- Stage details per process sequence
create table if not exists public.material_bom_process_stages (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.material_bom_process_sequences(id) on delete cascade,
  sno             int not null default 0,
  stage           text,
  process_name    text,
  loss_for        text,
  loss_pct        numeric(6,2) default 0,
  description     text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_matbom_stage_parent on public.material_bom_process_stages(sequence_id);

-- ============================================================================
-- 4. ACCESSORIES BOM  (FrmSC_Acc_BOM + FrmIWO_Acc_BOM)
--    Purchased & in-factory accessories. 4-level hierarchy:
--    Item → Combination → Detail → Size.
-- ============================================================================
create sequence if not exists public.seq_accessory_bom;

create table if not exists public.accessory_boms (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  bom_type        text not null default 'purchased'
                    check (bom_type in ('purchased','in_factory')),
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  style_id        uuid references public.styles(id),
  order_no        text,
  group_no        text,
  amendment_no    int not null default 0,
  reason          text,
  task_owner_id   uuid references public.profiles(id),
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  location_id     uuid references public.locations(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_accbom_code before insert on public.accessory_boms
  for each row execute function public.assign_code('ACCBOM','public.seq_accessory_bom');
create trigger trg_accbom_updated before update on public.accessory_boms
  for each row execute function public.set_updated_at();
create index if not exists idx_accbom_order on public.accessory_boms(sales_order_id);
create index if not exists idx_accbom_style on public.accessory_boms(style_id);

-- Items (accessories master list)
create table if not exists public.accessory_bom_items (
  id              uuid primary key default gen_random_uuid(),
  accessory_bom_id uuid not null references public.accessory_boms(id) on delete cascade,
  sno             int not null default 0,
  category_id     uuid references public.categories(id),
  item_id         uuid references public.items(id),
  availability_type text check (availability_type in ('stock','made_to_order','special')),
  bom_for         text check (bom_for in ('itemwise','colorwise','sizewise','colorwise_sizewise')),
  supply_type     text check (supply_type in ('customer','nominated','recommended','others')),
  vendor_id       uuid references public.vendors(id),
  uom_id          uuid references public.uoms(id),
  consumption_uom_id uuid references public.uoms(id),
  moq             numeric(14,3),
  is_approval_required boolean not null default false,
  advised_item_name text,
  specifications  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_item_parent on public.accessory_bom_items(accessory_bom_id);

-- Color/size combinations per item
create table if not exists public.accessory_bom_combinations (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.accessory_bom_items(id) on delete cascade,
  sno             int not null default 0,
  item_color      text,
  specifications  text,
  item_size       text,
  bom_for         text,
  design          text,
  style_no        text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_combo_parent on public.accessory_bom_combinations(item_id);

-- Consumption calculations per item
create table if not exists public.accessory_bom_consumptions (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.accessory_bom_items(id) on delete cascade,
  sno             int not null default 0,
  uom_id          uuid references public.uoms(id),
  nos_per_pcs     numeric(14,4) default 1,
  pcs_per_nos     numeric(14,4) default 1,
  waste_pct       numeric(6,2) default 0,
  allowance_qty   numeric(14,3) default 0,
  style_ref_no    text,
  style_no        text,
  article_no      text,
  is_sizewise     boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_cons_parent on public.accessory_bom_consumptions(item_id);

-- Consumption size breakdowns
create table if not exists public.accessory_bom_consumption_sizes (
  id              uuid primary key default gen_random_uuid(),
  consumption_id  uuid not null references public.accessory_bom_consumptions(id) on delete cascade,
  sno             int not null default 0,
  garment_size    text,
  nos_per_pcs     numeric(14,4) default 1,
  pcs_per_nos     numeric(14,4) default 1,
  allowance_pct   numeric(6,2) default 0,
  allowance_qty   numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_consz_parent on public.accessory_bom_consumption_sizes(consumption_id);

-- Process definitions (shared by purchased & in-factory)
create table if not exists public.accessory_bom_processes (
  id              uuid primary key default gen_random_uuid(),
  accessory_bom_id uuid not null references public.accessory_boms(id) on delete cascade,
  sno             int not null default 0,
  item_id         uuid references public.items(id),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_proc_parent on public.accessory_bom_processes(accessory_bom_id);

-- Process stage details
create table if not exists public.accessory_bom_process_stages (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.accessory_bom_processes(id) on delete cascade,
  sno             int not null default 0,
  stage           text check (stage in ('grey','dyed','print','wash')),
  process_name    text,
  loss_for        text,
  loss_pct        numeric(6,2) default 0,
  description     text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_accbom_pstage_parent on public.accessory_bom_process_stages(process_id);

-- ============================================================================
-- 5. BOM SHORTAGE  (FrmBOM_Shortage)
--    Shortage requisition when BOM execution reveals material shortfalls.
-- ============================================================================
create sequence if not exists public.seq_bom_shortage;

create table if not exists public.bom_shortages (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  style_id        uuid references public.styles(id),
  group_no        text,
  order_no        text,
  req_no          text,
  req_date        date not null default current_date,
  required_date   date,
  department_id   uuid references public.departments(id),
  employee_id     uuid references public.employees(id),
  ppm_ref         text,
  against_ppm     boolean not null default false,
  division_id     uuid references public.divisions(id),
  location_id     uuid references public.locations(id),
  update_previous_boms boolean not null default false,
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_bomshort_code before insert on public.bom_shortages
  for each row execute function public.assign_code('BOMSHRT','public.seq_bom_shortage');
create trigger trg_bomshort_updated before update on public.bom_shortages
  for each row execute function public.set_updated_at();
create index if not exists idx_bomshort_order on public.bom_shortages(sales_order_id);

-- Shortage line items
create table if not exists public.bom_shortage_items (
  id              uuid primary key default gen_random_uuid(),
  shortage_id     uuid not null references public.bom_shortages(id) on delete cascade,
  sno             int not null default 0,
  item_class      text,
  description     text,
  uom_id          uuid references public.uoms(id),
  qty             numeric(14,3) default 0,
  mtr             numeric(14,3) default 0,
  wt              numeric(14,3) default 0,
  rate            numeric(14,4) default 0,
  reason          text,
  due_to          text check (due_to in ('by_us','by_party')),
  due_to_vendor_id uuid references public.vendors(id),
  due_to_employee_id uuid references public.employees(id),
  debit_required  boolean not null default false,
  remarks         text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bomshort_item_parent on public.bom_shortage_items(shortage_id);

-- Size-wise shortage breakdown
create table if not exists public.bom_shortage_sizes (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.bom_shortage_items(id) on delete cascade,
  sno             int not null default 0,
  item_size       text,
  qty             numeric(14,3) default 0,
  wt              numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bomshort_size_parent on public.bom_shortage_sizes(item_id);

-- ============================================================================
-- 6. BOM TRANSFER  (FrmBOMXfrs)
--    Allocate/transfer BOM materials between locations/departments.
-- ============================================================================
create sequence if not exists public.seq_bom_transfer;

create table if not exists public.bom_transfers (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  sales_order_id  uuid references public.sales_orders(id),
  customer_id     uuid references public.customers(id),
  group_no        text,
  transfer_from   text,
  transfer_to     text,
  location_id     uuid references public.locations(id),
  status          text not null default 'draft'
                    check (status in ('draft','submitted','approved')),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_bomxfr_code before insert on public.bom_transfers
  for each row execute function public.assign_code('BOMXFR','public.seq_bom_transfer');
create trigger trg_bomxfr_updated before update on public.bom_transfers
  for each row execute function public.set_updated_at();
create index if not exists idx_bomxfr_order on public.bom_transfers(sales_order_id);

-- Transfer line items
create table if not exists public.bom_transfer_items (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.bom_transfers(id) on delete cascade,
  sno             int not null default 0,
  item_class      text,
  stage           text check (stage in ('grey','dyed','print','wash','finished')),
  description     text,
  process_name    text,
  uom_id          uuid references public.uoms(id),
  reqd_qty        numeric(14,3) default 0,
  reqd_wt         numeric(14,3) default 0,
  xfr_qty         numeric(14,3) default 0,
  xfr_wt          numeric(14,3) default 0,
  xfr_qty_with_loss numeric(14,3) default 0,
  xfr_wt_with_loss  numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bomxfr_item_parent on public.bom_transfer_items(transfer_id);

-- Size-wise transfer breakdown
create table if not exists public.bom_transfer_sizes (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.bom_transfer_items(id) on delete cascade,
  sno             int not null default 0,
  item_size       text,
  reqd_qty        numeric(14,3) default 0,
  reqd_wt         numeric(14,3) default 0,
  xfr_qty         numeric(14,3) default 0,
  xfr_wt          numeric(14,3) default 0,
  xfr_qty_with_loss numeric(14,3) default 0,
  xfr_wt_with_loss  numeric(14,3) default 0,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_bomxfr_size_parent on public.bom_transfer_sizes(item_id);

-- ============================================================================
-- 7. RLS POLICIES — all planning tables gated by 'planning' permission
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fabric_boms','fabric_bom_dye_colors','fabric_bom_fabrics','fabric_bom_cloths',
    'fabric_bom_components','fabric_bom_combos',
    'garment_boms','garment_bom_processes','garment_bom_components','garment_bom_placements',
    'material_boms','material_bom_fabrics','material_bom_cloths',
    'material_bom_programs','material_bom_plans','material_bom_products',
    'material_bom_process_sequences','material_bom_process_stages',
    'accessory_boms','accessory_bom_items','accessory_bom_combinations',
    'accessory_bom_consumptions','accessory_bom_consumption_sizes',
    'accessory_bom_processes','accessory_bom_process_stages',
    'bom_shortages','bom_shortage_items','bom_shortage_sizes',
    'bom_transfers','bom_transfer_items','bom_transfer_sizes'
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
