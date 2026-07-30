-- ============================================================================
-- Raagam ERP — 0373 Planning ↔ Purchase Flow Wiring
--
-- Establishes the missing links in the flow:
--   Planning PPM (approved) → Indent → PO
--
-- Three FK links added:
--   1. purchase_indents.garment_ppm_id    → garment_ppms(id)
--   2. purchase_orders.purchase_indent_id → purchase_indents(id)
--   3. po_item_groups.garment_ppm_id      → garment_ppms(id)
--      (replaces the free-text ppm_no column with a proper FK)
-- ============================================================================

-- 1. PPM → Indent: allow indents to reference their source PPM
alter table public.purchase_indents
  add column if not exists garment_ppm_id uuid references public.garment_ppms(id);

create index if not exists idx_pindent_ppm on public.purchase_indents(garment_ppm_id);

-- 2. Indent → PO: allow POs to reference their source indent
alter table public.purchase_orders
  add column if not exists purchase_indent_id uuid references public.purchase_indents(id);

create index if not exists idx_po_indent on public.purchase_orders(purchase_indent_id);

-- 3. PO Item Group → PPM: proper FK (alongside existing ppm_no text field for backward compat)
alter table public.po_item_groups
  add column if not exists garment_ppm_id uuid references public.garment_ppms(id);

create index if not exists idx_pogrp_ppm on public.po_item_groups(garment_ppm_id);
