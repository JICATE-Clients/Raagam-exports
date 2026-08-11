-- ============================================================================
-- Raagam ERP — 0398 Garment Order Amendment ▸ Quantities tab
--
-- `Quantities` has been a placeholder since the amendment's tab strip was built
-- ("awaiting the legacy screenshot"). The screenshot arrived, so it can exist.
--
-- Legacy grid, left to right:
--   S No · Country ⓘ · Ref No · Consignee ⓘ · Assortment Type ⓘ · PO Qty ·
--   Delivery Dt · Earlier Shipment Dt · Assort [Click] · Style No · WareHouse ·
--   Discharge Port
--
-- `Assort` opens a size breakdown and is deliberately NOT built here (client
-- 2026-08-11) — the 11 visible columns first.
--
--
-- REF NO + STYLE NO ARE THE MODULE'S KEY, NOT FREE TEXT
--
-- `order-seed.ts` states it: "The key across the whole Orders module is
-- (sales_order_id, style_ref_no)". `order_prices`, `order_descriptions` and
-- `order_pack_ratios` all identify a style by `style_ref_no` + `style_no` TEXT,
-- and not one order child table carries a `garment_styles` FK. Legacy's `Ref No`
-- and `Style No` are exactly that pair, so this table matches its siblings'
-- denormalised shape rather than being the one row in the module that needs a
-- text↔uuid resolution on every read.
--
--
-- WAREHOUSE POINTS AT `stores`, NOT AT THE 'warehouse' LOOKUP KIND
--
-- That kind exists in the CHECK constraint and holds zero rows; `public.stores`
-- is the live master (Purchase / Processing / Material / Rejection / Surplus
-- Store) with its own screens. Pointing at the empty kind would have reproduced
-- exactly the defect 0396 just fixed on the Style screen — a field rendering a
-- dropdown over nothing while the real master sat beside it.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Assortment Type — a new config_lookups kind.
--
-- RE-LISTED FROM THE CONSTRAINT, NOT FROM THE DATA. `select distinct kind from
-- config_lookups` returns only the kinds that currently have ROWS; the check
-- admits more (`style_category`, `structure`, `trims_category`, the doc_* four,
-- `warehouse`…). Rebuilding this list from the data would silently REVOKE every
-- kind that happens to be empty today and break unrelated screens the next time
-- one of them gained a row. The list below is 0372's, verbatim, plus one.
--
-- Seeded EMPTY: the legacy screen shows "Solid Color - Solid…", but the real
-- vocabulary is the client's and a made-up list is how the near-miss feature had
-- to be rolled back once already. The picker's inline Add is how it gets filled.
-- ----------------------------------------------------------------------------

alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups
  add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state','department',
    'designation','internal_department','ship_type','payment_term','employee_category',
    'team','account_schedule','vendor_group','agent_type','agent','packing_list_format',
    'commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from',
    'style_category','coordinate','style_component','structure','trims_category','size',
    'roll_form_print','warehouse',
    'ta_activity_type',
    'fabric_structure','fabric_type','yarn_type',
    'duty_category',
    -- Associates ▸ Vendor ▸ Item Category grid (0369)
    'vendor_item_form','vendor_supply_type',
    -- Associates ▸ Vendor ▸ Service grid (0372)
    'vendor_service_type',
    -- Orders ▸ Amendment ▸ Quantities grid (0398)
    'assortment_type'
  ));


-- ----------------------------------------------------------------------------
-- 2. The rows.
--
-- Shape and RLS mirror `garment_order_amendment_approval_qtys` (0128) — same
-- parent, same cascade, same `sno`, same permission module — so the eight child
-- tables of an amendment stay one family rather than eight dialects.
-- ----------------------------------------------------------------------------

create table if not exists public.garment_order_amendment_quantities (
  id                    uuid primary key default gen_random_uuid(),
  amendment_id          uuid not null references public.garment_order_amendments(id) on delete cascade,
  sno                   int not null default 0,

  country_id            uuid references public.countries(id),
  -- The module key pair. Text, like every sibling — see the header.
  style_ref_no          text,
  style_no              text,
  consignee_id          uuid references public.consignees(id),
  assortment_type_id    uuid references public.config_lookups(id),

  po_qty                numeric(16,3) not null default 0,
  delivery_date         date,
  earlier_shipment_date date,

  warehouse_id          uuid references public.stores(id),
  discharge_port_id     uuid references public.ports(id),

  created_at            timestamptz not null default now()
);

create index if not exists idx_goa_quantities_amend
  on public.garment_order_amendment_quantities(amendment_id);

alter table public.garment_order_amendment_quantities enable row level security;

do $rls$
begin
  execute format($f$
    create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
    create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
    create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
    create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
  $f$, 'garment_order_amendment_quantities');
end $rls$;


-- ----------------------------------------------------------------------------
-- 3. Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both applied cleanly and both left a function anon-callable.
--
-- The kind check is asserted by SAMPLING kinds that existed before this
-- migration: the failure mode being guarded is a re-listed constraint that
-- quietly dropped one, and that cannot be caught by checking only the kind
-- being added.
-- ----------------------------------------------------------------------------

do $verify$
declare
  k text;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'garment_order_amendment_quantities'
  ) then
    raise exception '0398: garment_order_amendment_quantities was not created';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'garment_order_amendment_quantities') <> 4 then
    raise exception '0398: expected 4 policies on garment_order_amendment_quantities';
  end if;

  foreach k in array array[
    'assortment_type',            -- the new one
    'item_class','coordinate','style_component','structure','ship_type',
    'fabric_structure','vendor_service_type','doc_menu','warehouse'
  ] loop
    begin
      insert into public.config_lookups (kind, code, name) values (k, '__0398_probe', '__0398_probe');
      delete from public.config_lookups where kind = k and code = '__0398_probe';
    exception when check_violation then
      raise exception '0398: the kind CHECK no longer admits %, which the re-list dropped', k;
    end;
  end loop;
end $verify$;
