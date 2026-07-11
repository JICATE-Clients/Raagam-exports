-- ============================================================================
-- Raagam ERP — 0265 Orders ▸ Garment Orders ▸ Material BOM Amendment
-- Additive sub-module (legacy EDP2: "Material BOM Amendment" — step 9).
-- A master-detail amendment DOCUMENT: header + Items grid + Processes grid.
-- (The "Calculated Quantities" tab is a read-only projection computed from the
--  Items grid × the order qty — no table.) Gated by the EXISTING 'orders'
-- permission (no new module). Distinct from the Planning free-text approval log
-- `bom_amendments` (0023), which is left untouched.
-- Icon fields reference existing masters (customers, sales_orders, items, vendors,
-- uoms) or config_lookups kinds (material_category, material_attribute — both
-- already allowed by the kind CHECK, so no CHECK change here).
-- ============================================================================

-- ---------- amendment header ----------
create sequence if not exists public.seq_material_bom_amendment;
create table if not exists public.material_bom_amendments (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                   -- MBA-0001 (assign_code) = legacy "Entry No"
  sales_order_id uuid references public.sales_orders(id),       -- "SC No" / "Order No"
  customer_id    uuid references public.customers(id),          -- "Customer"
  amendment_no   int not null default 1,                        -- "A. No" (per-order sequence)
  amend_date     date not null default current_date,            -- "Date"
  is_draft       boolean not null default true,                 -- Draft vs Recorded
  remarks        text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_mba_code before insert on public.material_bom_amendments
  for each row execute function public.assign_code('MBA','public.seq_material_bom_amendment');
create trigger trg_mba_updated before update on public.material_bom_amendments
  for each row execute function public.set_updated_at();
create index if not exists idx_mba_order on public.material_bom_amendments(sales_order_id);
create index if not exists idx_mba_customer on public.material_bom_amendments(customer_id);

-- ---------- child: Items ("Item Details" grid) ----------
create table if not exists public.material_bom_amendment_items (
  id                 uuid primary key default gen_random_uuid(),
  amendment_id       uuid not null references public.material_bom_amendments(id) on delete cascade,
  sno                int not null default 0,
  category_id        uuid references public.config_lookups(id),  -- "Category" (material_category)
  type               text,                                       -- "Type" (provisional — fixed list)
  item_id            uuid references public.items(id),           -- "Item"
  attribute_id       uuid references public.config_lookups(id),  -- "Attribute" (material_attribute)
  supply_type        text,                                       -- "Supply Type" (provisional — fixed list)
  vendor_id          uuid references public.vendors(id),         -- "Vendor"
  purchase_uom_id    uuid references public.uoms(id),            -- "Purchase Uom"
  consumption_uom_id uuid references public.uoms(id),            -- "Consumption Uom"
  alternate_uom_id   uuid references public.uoms(id),            -- "Alternate Uom"
  combination        text,                                       -- "Combination" (provisional — free text)
  moq                numeric(14,3),                              -- "MOQ"
  quantity_nos       numeric(14,3),                              -- per-piece qty (basis for Calc Qty)
  created_at         timestamptz not null default now()
);
create index if not exists idx_mba_items_amd on public.material_bom_amendment_items(amendment_id);

-- ---------- child: Processes ("Detail" grid — S No + Item) ----------
create table if not exists public.material_bom_amendment_processes (
  id           uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.material_bom_amendments(id) on delete cascade,
  sno          int not null default 0,
  item_id      uuid references public.items(id),                -- "Item"
  created_at   timestamptz not null default now()
);
create index if not exists idx_mba_proc_amd on public.material_bom_amendment_processes(amendment_id);

-- ---------- seed the two legacy material categories (idempotent) ----------
insert into public.config_lookups (kind, code, name)
select 'material_category', v.code, v.name
from (values ('SEW','Sewing Accessory'), ('PACK','Packing Accessory')) as v(code, name)
where not exists (
  select 1 from public.config_lookups c
  where c.kind = 'material_category' and lower(c.name) = lower(v.name)
);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'material_bom_amendments','material_bom_amendment_items','material_bom_amendment_processes'
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
