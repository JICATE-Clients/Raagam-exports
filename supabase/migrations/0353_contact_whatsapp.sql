-- ============================================================================
-- 0353 — Retire `fax`, adopt Mobile + WhatsApp across Master Data.
--
-- Fax survived only because these screens were reverse-engineered from legacy
-- RP-Software forms field-for-field. Nobody fills it. It has no view, RPC,
-- report (lib/reports/*) or data-io descriptor consumer, so the drop is safe.
--
-- CONVENTION: `whatsapp IS NULL` means "same as mobile". The number is never
-- stored twice, so the two cannot drift. Read it through effectiveWhatsApp()
-- in lib/validation/contact.ts — never read the column directly, or ~90% of
-- records will look like they have no WhatsApp number.
--
-- NOT touched: the 'fax' literal in the `receipt_mode` enums (0319, 0327).
-- That is a "how the enquiry reached us" value, not a column, and remains
-- legitimate history.
-- ============================================================================

-- Associates ▸ Bank — branch grid
alter table public.bank_branches
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Vendor — address grid
alter table public.master_vendor_addresses
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Customer
alter table public.customers
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Consignee
alter table public.consignees
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Applicant
alter table public.applicants
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Notify Party
alter table public.notifies
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Associates ▸ Courier Delivery Address
alter table public.courier_delivery_addresses
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Brands (`phone` stays and keeps its landline meaning)
alter table public.brands
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- Admin ▸ Company Profile (`phone` stays and keeps its landline meaning)
alter table public.company_profile
  drop column if exists fax,
  add column if not exists mobile   text,
  add column if not exists whatsapp text;

-- ---------------------------------------------------------------------------
-- Document the NULL convention at the column level, so anyone reading the
-- schema (or generating types) hits it before writing a direct SELECT.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'bank_branches',
    'master_vendor_addresses',
    'customers',
    'consignees',
    'applicants',
    'notifies',
    'courier_delivery_addresses',
    'brands',
    'company_profile'
  ]
  loop
    execute format(
      'comment on column public.%I.whatsapp is %L',
      t,
      'NULL = same as mobile. Resolve via effectiveWhatsApp() in lib/validation/contact.ts.'
    );
    execute format(
      'comment on column public.%I.mobile is %L',
      t,
      'Mobile / cell number. International-tolerant (PHONE_INTL_RE), not India-only.'
    );
  end loop;
end $$;
