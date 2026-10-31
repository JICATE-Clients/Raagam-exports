-- 0777 · GRN Phase 1 (doc/purchase/grn-plan.md): receive a Raise-PO PO, and record the
-- vendor's invoice.
--
-- THE BLOCKER. Every PO is raised against a MASTER vendor (`purchase_orders.master_vendor_id`,
-- 0737) and its legacy `vendor_id` is NULL, while the GRN read and wrote only the legacy
-- `vendor_id` (→ public.vendors). So an approved PO showed on the GRN with no vendor and
-- could not be saved. The GRN now names the master vendor, as the PO does. The legacy
-- column stays (nullable) — there are no GRNs yet, so nothing needs carrying across.
--
-- The draft bill a posted GRN creates (`payables`) gets the same column, so a bill raised
-- from a requirement PO is not a bill with no vendor.
--
-- HEADER: the vendor's Invoice No + Invoice Date, and the DC No that came with the goods
-- (spec §2A). `challan_no` stays readable for any row written before this.
--
-- LINES: the item (copied from the PO line, so a report need not walk through the PO),
-- and the store + bin it was put into (spec §2A "select the target Bin"; used from Phase 2).

alter table public.grns
  add column if not exists master_vendor_id uuid references public.master_vendors(id),
  add column if not exists invoice_no text,
  add column if not exists invoice_date date,
  add column if not exists dc_no text;

create index if not exists idx_grns_master_vendor on public.grns(master_vendor_id);

alter table public.grn_line_items
  add column if not exists item_id uuid references public.items(id),
  add column if not exists store_id uuid references public.stores(id),
  add column if not exists bin_id uuid references public.bins(id);

create index if not exists idx_grn_line_items_item on public.grn_line_items(item_id);
create index if not exists idx_grn_line_items_bin on public.grn_line_items(bin_id);

alter table public.payables
  add column if not exists master_vendor_id uuid references public.master_vendors(id);

create index if not exists idx_payables_master_vendor on public.payables(master_vendor_id);
