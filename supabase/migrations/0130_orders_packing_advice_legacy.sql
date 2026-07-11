-- ============================================================================
-- Raagam ERP — 0130 Orders ▸ Packing List Advice — rebuild to legacy screen
-- The 0033 tables were a lean model (one order per advice + a simple carton grid).
-- The legacy RP-Software "Packing List Advice" screen is richer: a header with
-- Customer / Consignee / Warehouse + a wide per-line grid where the order (SC No)
-- is chosen PER LINE, not per header. This migration extends both tables
-- additively (no data loss) so the same feature now matches the legacy form.
--   • header: relax sales_order_id (order is now per-line); add reference,
--     carton_slno_by, customer/consignee, ctns/qty totals, warehouse + address.
--   • lines: relax description; add carton range, SC No, PO No, country, ref no,
--     assort type, customer order no, multiple-pack flag, qty/ctn, total qty,
--     unit, measurement.
--   • config_lookups: new kind 'warehouse' (the ⊕ Warehouse Name list).
-- Reuses the EXISTING 'orders' permission — no new module.
-- ============================================================================

-- ---------- 1. config_lookups: add the warehouse kind ----------
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
    'trims_category','size','roll_form_print',
    'warehouse'
  ]::text[])
);

-- ---------- 2. header: packing_advices ----------
alter table public.packing_advices
  alter column sales_order_id drop not null,
  add column if not exists reference         text,
  add column if not exists advice_date       date not null default current_date,
  add column if not exists carton_slno_by     text,                                  -- "Carton SlNo.By" ▼
  add column if not exists customer_id        uuid references public.buyers(id),      -- Customer ⓘ
  add column if not exists consignee_id       uuid references public.consignees(id),  -- Consignee ⓘ
  add column if not exists ctns_total         numeric(14,0) not null default 0,       -- header Ctns total
  add column if not exists qty_total          numeric(16,3) not null default 0,       -- header Qty total
  add column if not exists warehouse_id       uuid references public.config_lookups(id), -- Warehouse Name ⊕
  add column if not exists warehouse_address  text;
create index if not exists idx_pla_customer  on public.packing_advices(customer_id);
create index if not exists idx_pla_consignee on public.packing_advices(consignee_id);

-- ---------- 3. lines: packing_advice_lines ----------
alter table public.packing_advice_lines
  alter column description drop not null,
  add column if not exists ctn_from          text,
  add column if not exists ctn_to            text,
  add column if not exists ctns              numeric(14,0) not null default 0,
  add column if not exists sc_no_id          uuid references public.sales_orders(id), -- SC No ⓘ
  add column if not exists po_no             text,
  add column if not exists country_id        uuid references public.countries(id),   -- Country ⓘ
  add column if not exists ref_no            text,
  add column if not exists assort_type       text,                                   -- "Assort Type" ▼
  add column if not exists customer_order_no text,
  add column if not exists multiple_pack     boolean not null default false,
  add column if not exists qty_per_ctn       numeric(16,3) not null default 0,
  add column if not exists total_qty         numeric(16,3) not null default 0,
  add column if not exists unit_id           uuid references public.uoms(id),        -- Unit ⓘ
  add column if not exists measurement       text;
create index if not exists idx_pla_lines_scno on public.packing_advice_lines(sc_no_id);
