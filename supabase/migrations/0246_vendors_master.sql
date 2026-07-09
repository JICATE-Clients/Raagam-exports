-- ============================================================================
-- Raagam ERP — 0246 Master Data ▸ Associates ▸ Vendor
-- Legacy EDP2 "Vendor" form: a header (Short Name · Blocked · Type · Category
-- flags · Name · Country · Group Name · Status) + a registration footer (TIN ·
-- Reg.Caption · Reg.No/Dt · PAN · Web site) + two tabs (Address | Other Details).
--
-- Phase 1 models the header + registration footer + the Address tab (a multi-row
-- address grid). The "Other Details" tab is deferred until its legacy screenshot.
--
--   Type      → fixed list (With in State / Other State / Foreign Vendor)
--   Status    → fixed list (Approved / Under Evaluation / Terminated / Hold)
--   Category  → 4 boolean flags (IsBoughtItemsVendor / IsProcessor /
--               IsServiceProvider / IsSubContractor)
--   Country   → public.countries (default IND, resolved in UI)  — red ⓘ picker
--   Group Name→ config_lookups kind 'vendor_group'              — blue ⓘ picker
--   Address grid City/State → config_lookups; Country → countries
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK: add 'vendor_group'.
--    Re-add the FULL current kind set (mirrors lib/masters/extras-types.ts
--    LOOKUP_KINDS, which the parallel lane also extended with agent_type/agent/
--    packing_list_format/commercial_invoice_format) so this migration never
--    clobbers a kind another lane added, regardless of apply order.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state',
    'department','designation','internal_department','ship_type','payment_term',
    'employee_category','team','account_schedule','vendor_group',
    'agent_type','agent','packing_list_format','commercial_invoice_format'
  ));

-- 2) Vendors master (header). NOTE: a core `public.vendors` table already exists
--    (purchase/finance vendor, referenced by POs) — this Associates master is a
--    distinct, richer table `master_vendors`, mirroring the Customer precedent
--    (dedicated `customers`, core `buyers` left untouched).
create table if not exists public.master_vendors (
  id                       uuid primary key default gen_random_uuid(),
  code                     text,                                   -- "Short Name"
  name                     text not null,
  blocked                  boolean not null default false,
  vendor_type              text check (vendor_type is null or vendor_type in (
                             'With in State','Other State','Foreign Vendor')),
  country_id               uuid references public.countries(id) on delete set null,
  group_id                 uuid references public.config_lookups(id) on delete set null,
  status                   text not null default 'Approved'
                             check (status in ('Approved','Under Evaluation','Terminated','Hold')),
  -- Category flags
  is_bought_items_vendor   boolean not null default false,
  is_processor             boolean not null default false,
  is_service_provider      boolean not null default false,
  is_sub_contractor        boolean not null default false,
  -- Registration footer
  tin_no                   text,
  reg_caption              text,
  reg_no_dt                text,
  pan_no                   text,
  web_site                 text,
  is_draft                 boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_master_vendors_country on public.master_vendors(country_id);
create index if not exists idx_master_vendors_group on public.master_vendors(group_id);
create trigger trg_master_vendors_updated before update on public.master_vendors
  for each row execute function public.set_updated_at();

-- 3) Vendor addresses (child grid, cascade).
create table if not exists public.master_vendor_addresses (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.master_vendors(id) on delete cascade,
  sno           integer not null default 0,
  address_type  text,
  street        text,
  city_id       uuid references public.config_lookups(id) on delete set null,
  state_id      uuid references public.config_lookups(id) on delete set null,
  country_id    uuid references public.countries(id) on delete set null,
  pin           text,
  land_line     text,
  fax           text,
  email_id      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_master_vendor_addresses_vendor on public.master_vendor_addresses(vendor_id);
create trigger trg_master_vendor_addresses_updated before update on public.master_vendor_addresses
  for each row execute function public.set_updated_at();

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
do $$
declare t text;
begin
  foreach t in array array['master_vendors','master_vendor_addresses'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
