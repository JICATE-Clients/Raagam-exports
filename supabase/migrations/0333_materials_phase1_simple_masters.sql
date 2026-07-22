-- ============================================================================
-- Raagam ERP — 0333 Materials Phase 1: Simple Masters
--
-- Adds missing simple master tables from VB.NET source of truth.
-- All validations and business logic replicated from Masters_DAL BL files.
-- ============================================================================

-- ==========================================================================
-- 1. Yarn Compositions (Pri_YarnComposition)
--    Simple code+name lookup. Used by fabric BOM and blending.
-- ==========================================================================
create table if not exists public.yarn_compositions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint yarn_compositions_code_unique unique (code)
);
create trigger trg_yarn_composition_updated before update on public.yarn_compositions
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 2. Defect Groups (DefectGroup)
--    QC defect category groups (fabric defects, stitching defects, etc.)
-- ==========================================================================
create table if not exists public.defect_groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint defect_groups_code_unique unique (code)
);
create trigger trg_defect_group_updated before update on public.defect_groups
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 3. Defect Details (DefectDetail)
--    Individual defect codes. Code = CatgID.DefectID.DetID (auto-generated).
-- ==========================================================================
create table if not exists public.defect_details (
  id              uuid primary key default gen_random_uuid(),
  defect_catg_id  text not null,
  defect_id       text not null,
  defect_det_id   text not null,
  code            text not null generated always as (defect_catg_id || '.' || defect_id || '.' || defect_det_id) stored,
  name            text not null,
  defect_group_id uuid references public.defect_groups(id) on delete set null,
  defect_type     text,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint defect_details_composite_unique unique (defect_catg_id, defect_id, defect_det_id)
);
create trigger trg_defect_detail_updated before update on public.defect_details
  for each row execute function public.set_updated_at();
create index if not exists idx_defect_details_group on public.defect_details(defect_group_id);

-- ==========================================================================
-- 4. Product Sizes (ProductSize)
--    Width × Length × Height with auto-generated size description.
-- ==========================================================================
create table if not exists public.product_sizes (
  id            uuid primary key default gen_random_uuid(),
  prod_size_id  text not null,
  width         numeric(10,2) not null default 0,
  length        numeric(10,2) not null default 0,
  height        numeric(10,2) not null default 0,
  prod_cut_size text,
  prod_size     text not null,
  desc1         text,
  desc2         text,
  desc3         text,
  size_for      text not null default 'P' check (size_for in ('P','F')),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint product_sizes_id_unique unique (prod_size_id),
  constraint product_sizes_size_unique unique (prod_size)
);
create trigger trg_product_size_updated before update on public.product_sizes
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 5. Style Stock Categories (StyleStockCategory)
--    Simple code-only lookup.
-- ==========================================================================
create table if not exists public.style_stock_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint style_stock_categories_code_unique unique (code)
);
create trigger trg_style_stock_cat_updated before update on public.style_stock_categories
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 6. Special Instructions (SpecialInstruction)
--    Reusable instruction templates for orders/shipments.
-- ==========================================================================
create table if not exists public.special_instructions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  description text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint special_instructions_code_unique unique (code)
);
create trigger trg_special_inst_updated before update on public.special_instructions
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 7. Production Sections (ProductionSection)
--    Production line/section master. SectionFor: C=Cut, S=Stitch, etc.
-- ==========================================================================
create table if not exists public.production_sections (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  section_for text not null default 'C' check (section_for in ('C','S','I','E','W','F','P')),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint production_sections_code_unique unique (code)
);
create trigger trg_prod_section_updated before update on public.production_sections
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 8. Beams (Beam)
--    Weaving beam master with tare weight, loom type, location.
-- ==========================================================================
create table if not exists public.beams (
  id              uuid primary key default gen_random_uuid(),
  beam_no         text not null,
  tare_wt         numeric(10,3) not null default 0,
  loom_type       text not null default 'N',
  location_type   text not null default 'O' check (location_type in ('O','P')),
  vendor_id       uuid references public.vendors(id) on delete set null,
  flange_width    numeric(10,2) not null default 0,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint beams_beam_no_unique unique (beam_no)
);
create trigger trg_beam_updated before update on public.beams
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 9. Beam Types (BeamType)
--    Beam type classification lookup.
-- ==========================================================================
create table if not exists public.beam_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint beam_types_code_unique unique (code)
);
create trigger trg_beam_type_updated before update on public.beam_types
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 10. Tyres (Tyre)
--     Textile machinery tyre master with retread tracking.
-- ==========================================================================
create table if not exists public.tyres (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  name              text not null,
  brand             text,
  tyre_type         text,
  size              text,
  allowed_retreads  integer not null default 0,
  retreads_done     integer not null default 0,
  km_per_retread    integer not null default 0,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tyres_code_unique unique (code),
  constraint tyres_name_unique unique (name),
  constraint tyres_retreads_check check (
    (allowed_retreads = 0 and km_per_retread >= 0) or
    (allowed_retreads > 0 and km_per_retread > 0)
  )
);
create trigger trg_tyre_updated before update on public.tyres
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 11. Designs (Design)
--     Fabric design master — simple name lookup.
-- ==========================================================================
create table if not exists public.designs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint designs_name_unique unique (name)
);
create trigger trg_design_updated before update on public.designs
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 12. Domestic Product Designs (DomesticProductDesign)
--     Design groupings for domestic market products.
-- ==========================================================================
create table if not exists public.domestic_product_designs (
  id          uuid primary key default gen_random_uuid(),
  design_no   text not null,
  description text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint domestic_product_designs_no_unique unique (design_no)
);
create trigger trg_dom_prod_design_updated before update on public.domestic_product_designs
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 13. Lab Test Standards (LabTestStandard)
--     Lab test standard benchmarks (acceptable ranges per test).
-- ==========================================================================
create table if not exists public.lab_test_standards (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  category    text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint lab_test_standards_code_unique unique (code)
);
create trigger trg_lab_test_std_updated before update on public.lab_test_standards
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 14. Print Types (Pri_PrintType) — Printing module
-- ==========================================================================
create table if not exists public.print_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint print_types_code_unique unique (code)
);
create trigger trg_print_type_updated before update on public.print_types
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 15. Product Types (Pri_ProductType) — Printing module
-- ==========================================================================
create table if not exists public.product_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_types_code_unique unique (code)
);
create trigger trg_product_type_updated before update on public.product_types
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 16. Print Items (Pri_Item) — Printing module items
--     ItemType: A=All, Y=Yarn, F=Fabric, etc.
-- ==========================================================================
create table if not exists public.print_items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  item_type   text not null default 'A',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint print_items_code_unique unique (code),
  constraint print_items_name_unique unique (name)
);
create trigger trg_print_item_updated before update on public.print_items
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 17. Print Processes (Pri_Process) — Printing module processes
--     Flags: is_yarn_process, is_fabric_process, is_cmt_process, etc.
-- ==========================================================================
create table if not exists public.print_processes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null,
  name              text not null,
  is_yarn_process   boolean not null default false,
  is_fabric_process boolean not null default false,
  is_cmt_process    boolean not null default false,
  is_trims_process  boolean not null default false,
  is_pieces_process boolean not null default false,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint print_processes_code_unique unique (code),
  constraint print_processes_name_unique unique (name),
  constraint print_processes_at_least_one check (
    is_yarn_process or is_fabric_process or is_cmt_process or is_trims_process or is_pieces_process
  )
);
create trigger trg_print_process_updated before update on public.print_processes
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 18. Garment Accepted Qty Levels (header + detail)
--     Range-based acceptance rules with dated entries.
-- ==========================================================================
create sequence if not exists public.seq_garment_accepted_qty;

create table if not exists public.garment_accepted_qty_levels (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  entry_date        date not null default current_date,
  effective_from    date not null default current_date,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint gaq_entry_date_check check (entry_date <= current_date)
);
create trigger trg_gaq_code before insert on public.garment_accepted_qty_levels
  for each row execute function public.assign_code('GAQ','public.seq_garment_accepted_qty');
create trigger trg_gaq_updated before update on public.garment_accepted_qty_levels
  for each row execute function public.set_updated_at();

create table if not exists public.garment_accepted_qty_level_details (
  id              uuid primary key default gen_random_uuid(),
  level_id        uuid not null references public.garment_accepted_qty_levels(id) on delete cascade,
  sno             integer not null,
  range_type      text not null check (range_type in ('U','B','A')),
  from_qty        numeric(12,2) not null default 0,
  to_qty          numeric(12,2) not null default 0,
  no_of_pieces    integer not null default 0,
  major_allowed   integer not null default 0,
  minor_allowed   integer not null default 0,
  critical_allowed integer not null default 0,
  allowed         numeric(6,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_gaq_detail_updated before update on public.garment_accepted_qty_level_details
  for each row execute function public.set_updated_at();
create index if not exists idx_gaq_details_level on public.garment_accepted_qty_level_details(level_id);

-- ==========================================================================
-- RLS policies for all new tables
-- ==========================================================================
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'yarn_compositions','defect_groups','defect_details','product_sizes',
      'style_stock_categories','special_instructions','production_sections',
      'beams','beam_types','tyres','designs','domestic_product_designs',
      'lab_test_standards','print_types','product_types','print_items',
      'print_processes','garment_accepted_qty_levels','garment_accepted_qty_level_details'
    ])
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (true)',
      tbl, tbl);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_permission(''masters'',''create''))',
      tbl, tbl);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_permission(''masters'',''edit'')) with check (public.has_permission(''masters'',''edit''))',
      tbl, tbl);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_permission(''masters'',''delete''))',
      tbl, tbl);
  end loop;
end $$;
