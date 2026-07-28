-- ============================================================================
-- Raagam ERP -- 0358 Purchase & Stores Integrity Audit
-- Catch-up fixes from Step 7 audit of migrations 0350-0357.
-- ============================================================================

-- ---------- Fix 1: po_completion_items missing ON DELETE CASCADE ----------
-- Cannot ALTER FK constraint directly; recreate
alter table public.po_completion_items
  drop constraint if exists po_completion_items_purchase_order_id_fkey;
alter table public.po_completion_items
  add constraint po_completion_items_purchase_order_id_fkey
  foreign key (purchase_order_id) references public.purchase_orders(id) on delete cascade;

-- ---------- Fix 2: po_completion_items missing updated_at + trigger ----------
alter table public.po_completion_items
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_poci_updated before update on public.po_completion_items
  for each row execute function public.set_updated_at();

-- ---------- Fix 3: process_material_issue_lines missing timestamps + trigger ----------
alter table public.process_material_issue_lines
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_pmil_updated before update on public.process_material_issue_lines
  for each row execute function public.set_updated_at();

-- ---------- Fix 4: process_material_receipts missing ON DELETE CASCADE ----------
alter table public.process_material_receipts
  drop constraint if exists process_material_receipts_process_order_id_fkey;
alter table public.process_material_receipts
  add constraint process_material_receipts_process_order_id_fkey
  foreign key (process_order_id) references public.process_orders(id) on delete cascade;

-- ---------- Fix 5: process_material_receipt_lines missing timestamps + trigger ----------
alter table public.process_material_receipt_lines
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_pmrl_updated before update on public.process_material_receipt_lines
  for each row execute function public.set_updated_at();

-- ---------- Fix 6: interdept_deliveries missing FK indexes ----------
create index if not exists idx_idd_from_store on public.interdept_deliveries(from_store_id);
create index if not exists idx_idd_to_store on public.interdept_deliveries(to_store_id);

-- ---------- Fix 7: interdept_delivery_lines missing timestamps + trigger ----------
alter table public.interdept_delivery_lines
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
create trigger trg_iddl_updated before update on public.interdept_delivery_lines
  for each row execute function public.set_updated_at();

-- ---------- Fix 8: process_material_issues missing store_id index ----------
create index if not exists idx_pmi_store on public.process_material_issues(store_id);

-- ---------- Fix 9: process_material_receipts missing store_id index ----------
create index if not exists idx_pmr_store on public.process_material_receipts(store_id);

-- ---------- Fix 10: price_confirmations add location_id ----------
alter table public.price_confirmations
  add column if not exists location_id uuid references public.locations(id);
create index if not exists idx_pc_location on public.price_confirmations(location_id);
