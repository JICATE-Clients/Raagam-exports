-- ============================================================================
-- Raagam ERP — 0124 Orders ▸ Garment Orders ▸ Style master
-- Additive sub-module (legacy EDP2: Sales ▸ Garment Orders ▸ step 2 "Style").
-- A full Style master: header + General panel + three child grids (Coordinates,
-- Components, Sizes). Gated by the EXISTING 'orders' permission (no new module).
-- Table is named `garment_styles` to avoid clashing with the thin Sales `styles`
-- opportunity-card table (0005). Icon fields reference existing masters
-- (customers, countries, uoms, samples, customer_contacts) or config_lookups.
-- ============================================================================

-- ---------- new config_lookups kinds for the Style pickers ----------
-- Re-create the kind CHECK preserving every currently-allowed kind + 6 new ones
-- (style_category, coordinate, style_component, structure, trims_category, size).
-- `style_component` is intentionally distinct from the Material `component` kind.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state',
    'department','designation','internal_department','ship_type','payment_term',
    'employee_category','team','account_schedule','vendor_group','agent_type',
    'agent','packing_list_format','commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from',
    -- new (Style master):
    'style_category','coordinate','style_component','structure','trims_category','size'
  ));

-- ---------- style header ----------
create sequence if not exists public.seq_garment_style;
create table if not exists public.garment_styles (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                              -- STL-0001 (assign_code)
  blocked             boolean not null default false,
  style_date          date not null default current_date,
  style_for           text,                                     -- "For" (Garments…)
  customer_id         uuid references public.customers(id),
  approved_sample_id  uuid references public.samples(id),
  style_name          text,                                     -- legacy "Style"
  season              text,
  style_year          int,
  article_no          text,
  style_category_id   uuid references public.config_lookups(id),
  style_description    text,
  tech_pack           text,
  unit_id             uuid references public.uoms(id),
  country_id          uuid references public.countries(id),
  department_id       uuid references public.config_lookups(id),
  contact_id          uuid references public.customer_contacts(id),
  customer_reference  text,
  received_date       date,
  receipt_mode        text,
  description         text,
  is_draft            boolean not null default false,
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_garment_style_code before insert on public.garment_styles
  for each row execute function public.assign_code('STL','public.seq_garment_style');
create trigger trg_garment_style_updated before update on public.garment_styles
  for each row execute function public.set_updated_at();
create index if not exists idx_garment_styles_customer on public.garment_styles(customer_id);
create index if not exists idx_garment_styles_status on public.garment_styles(is_draft);

-- ---------- child: coordinates ----------
create table if not exists public.garment_style_coordinates (
  id            uuid primary key default gen_random_uuid(),
  style_id      uuid not null references public.garment_styles(id) on delete cascade,
  sno           int not null default 0,
  coordinate_id uuid references public.config_lookups(id),
  mlist_no      text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_gsc_style on public.garment_style_coordinates(style_id);

-- ---------- child: components ----------
create table if not exists public.garment_style_components (
  id                uuid primary key default gen_random_uuid(),
  style_id          uuid not null references public.garment_styles(id) on delete cascade,
  sno               int not null default 0,
  coordinate_id     uuid references public.config_lookups(id),
  component_id      uuid references public.config_lookups(id),
  structure_id      uuid references public.config_lookups(id),
  comp_type         text,                                       -- "Type" (Circular…)
  trims             boolean not null default false,
  trims_category_id uuid references public.config_lookups(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_gscomp_style on public.garment_style_components(style_id);

-- ---------- child: sizes ----------
create table if not exists public.garment_style_sizes (
  id         uuid primary key default gen_random_uuid(),
  style_id   uuid not null references public.garment_styles(id) on delete cascade,
  sno        int not null default 0,
  size_id    uuid references public.config_lookups(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_gssize_style on public.garment_style_sizes(style_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'garment_styles','garment_style_coordinates',
    'garment_style_components','garment_style_sizes'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
