-- ============================================================================
-- Raagam ERP — 0249 Master Data ▸ Associates ▸ Vendor: "Other Details" tab
-- The Vendor "Other Details" tab (deferred from 0246). All header-level single
-- fields on master_vendors (no child grid):
--   Bank Name · Branch · A/c No · IFSC Code · A/c Type          — text
--   GST No  = a registration-status dropdown (Registered / Unregistered /
--             Composite) + a GST number text field
--   Debit Group  → public.account_groups (id)                   — red ⓘ picker
--   Credit Group → public.account_groups (id)                   — red ⓘ picker
-- ============================================================================

alter table public.master_vendors
  add column if not exists bank_name        text,
  add column if not exists branch           text,
  add column if not exists ac_no            text,
  add column if not exists ifsc_code        text,
  add column if not exists ac_type          text,
  add column if not exists gst_reg_status   text
    check (gst_reg_status is null or gst_reg_status in ('Registered','Unregistered','Composite')),
  add column if not exists gst_no           text,
  add column if not exists debit_group_id   uuid references public.account_groups(id) on delete set null,
  add column if not exists credit_group_id  uuid references public.account_groups(id) on delete set null;
