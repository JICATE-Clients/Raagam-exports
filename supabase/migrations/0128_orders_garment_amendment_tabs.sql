-- ============================================================================
-- Raagam ERP — 0128 Orders ▸ Garment Order Amendment — the data tabs (Phase 2)
-- Additive follow-up to 0126 (which built the header + Logistic + Reason). Now
-- that the remaining tab screenshots are in, this migration:
--   1. reworks the Reason tab: the legacy screen is an "Amendment In" panel with
--      3 checkboxes (Material BOM / Fabric BOM / Garment Process BOM) + free text,
--      NOT the type dropdown 0126 guessed. Drop reason_type; add 3 booleans.
--   2. adds one child table per data tab: Style(s), Color/Print (dyeings + prints
--      + structures), Combos, Prices, Approval Qty, Country/Sizewise.
--   3. widens config_lookups.kind to add 'roll_form_print' (no print master
--      exists; the Color/Print tab's roll-form prints are a config list).
--
-- Still deferred (kept as UI placeholders, no tables yet — no screenshot):
--   Pack type(s), full Quantities columns, and the nested Process / Assort /
--   Countrywise-detail sub-screens.
--
-- Reuses the EXISTING 'orders' permission — no new module.
-- ============================================================================

-- ---------- 1. Reason rework on the header ----------
alter table public.garment_order_amendments
  drop column if exists reason_type,
  add column if not exists amend_in_material_bom       boolean not null default false,
  add column if not exists amend_in_fabric_bom          boolean not null default false,
  add column if not exists amend_in_garment_process_bom boolean not null default false;

-- ---------- 2. config_lookups: add the roll_form_print kind ----------
-- Re-widen the CHECK: re-add ALL current kinds (from the live constraint) + the new one.
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check check (
  kind = any (array[
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state','department',
    'designation','internal_department','ship_type','payment_term','employee_category',
    'team','account_schedule','vendor_group','agent_type','agent','packing_list_format',
    'commercial_invoice_format','shift_category','doc_track','doc_menu','doc_value_type',
    'doc_value_from','style_category','coordinate','style_component','structure',
    'trims_category','size',
    'roll_form_print'
  ]::text[])
);

-- ---------- 3a. Style(s) tab ----------
create table if not exists public.garment_order_amendment_styles (
  id                uuid primary key default gen_random_uuid(),
  amendment_id      uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno               int not null default 0,
  style_ref_no      text,
  style_id          uuid references public.garment_styles(id),   -- ⓘ Style picker
  article_no        text,                                        -- auto-filled from style
  style_category    text,                                        -- auto-filled from style
  style_description text,                                        -- auto-filled from style
  order_unit_id     uuid references public.uoms(id),             -- ⓘ Order Unit
  plan_unit_id      uuid references public.uoms(id),             -- ⓘ Plan Unit
  po_qty            numeric(16,3) not null default 0,
  description       text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_goa_styles_amend on public.garment_order_amendment_styles(amendment_id);

-- ---------- 3b. Color/Print tab — dyeings (Yarn + Fabric) ----------
create table if not exists public.garment_order_amendment_dyeings (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  section      text not null default 'yarn' check (section in ('yarn','fabric')),
  dye_type     text,                                             -- "Type" (option list unknown)
  color_id     uuid references public.color_card_colors(id),     -- ⊕ colour (scoped by buyer)
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_dyeings_amend on public.garment_order_amendment_dyeings(amendment_id);

-- ---------- 3c. Color/Print tab — roll-form prints ----------
create table if not exists public.garment_order_amendment_prints (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  print_id     uuid references public.config_lookups(id),        -- ⊕ kind roll_form_print
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_prints_amend on public.garment_order_amendment_prints(amendment_id);

-- ---------- 3d. Color/Print tab — structures ----------
create table if not exists public.garment_order_amendment_structures (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  structure_id uuid references public.config_lookups(id),        -- ⓘ kind structure (existing)
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_structures_amend on public.garment_order_amendment_structures(amendment_id);

-- ---------- 3e. Combos tab ----------
create table if not exists public.garment_order_amendment_combos (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  style_ref_no text,
  style        text,
  article_no   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_combos_amend on public.garment_order_amendment_combos(amendment_id);

-- ---------- 3f. Prices tab (distinct from Logistic's style_prices) ----------
create table if not exists public.garment_order_amendment_price_details (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  style_ref_no text,
  style        text,
  article_no   text,
  price_type   text,
  unit         text,
  price        numeric(14,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_price_details_amend on public.garment_order_amendment_price_details(amendment_id);

-- ---------- 3g. Approval Qty tab ----------
create table if not exists public.garment_order_amendment_approval_qtys (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  style_ref_no text,
  style        text,
  article_no   text,
  approval_qty numeric(16,3) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_approval_qtys_amend on public.garment_order_amendment_approval_qtys(amendment_id);

-- ---------- 3h. Country/Sizewise tab ----------
create table if not exists public.garment_order_amendment_country_sizes (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno          int not null default 0,
  style_ref_no text,
  style        text,
  article_no   text,
  countrywise  boolean not null default false,                   -- detail button deferred
  created_at   timestamptz not null default now()
);
create index if not exists idx_goa_country_sizes_amend on public.garment_order_amendment_country_sizes(amendment_id);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'garment_order_amendment_styles',
    'garment_order_amendment_dyeings',
    'garment_order_amendment_prints',
    'garment_order_amendment_structures',
    'garment_order_amendment_combos',
    'garment_order_amendment_price_details',
    'garment_order_amendment_approval_qtys',
    'garment_order_amendment_country_sizes'
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
