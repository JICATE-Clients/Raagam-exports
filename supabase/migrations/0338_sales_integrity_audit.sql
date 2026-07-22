-- ============================================================================
-- Raagam ERP — 0338 Sales Integrity Audit Fixes
--
-- Addresses gaps found during VB.NET source-of-truth audit:
--   1. CRITICAL: samples.vendor_id missing FK constraint
--   2. HIGH: Missing article_no on styles
--   3. HIGH: Missing customer_order_no on quotes
--   4. MEDIUM: Missing country_id on opportunities
-- ============================================================================

-- ==========================================================================
-- 1. CRITICAL: samples.vendor_id — add FK constraint + index
--    Column was added in 0322 as bare UUID without FK reference.
--    seasonal_orders.vendor_id was fixed in 0325, but samples was missed.
-- ==========================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_samples_vendor'
      and table_name = 'samples'
  ) then
    alter table public.samples
      add constraint fk_samples_vendor
      foreign key (vendor_id) references public.vendors(id) on delete set null;
  end if;
end $$;

create index if not exists idx_samples_vendor on public.samples(vendor_id);

-- ==========================================================================
-- 2. HIGH: styles.article_no — textile industry standard identifier
--    VB.NET "ArticleNo" field on style grid, used for buyer PO matching.
-- ==========================================================================
alter table public.styles
  add column if not exists article_no text;

-- ==========================================================================
-- 3. HIGH: quotes.customer_order_no — customer PO reference
--    VB.NET "CustomerOrderNo" on quote form, needed for order confirmation.
-- ==========================================================================
alter table public.quotes
  add column if not exists customer_order_no text;

-- ==========================================================================
-- 4. MEDIUM: opportunities.country_id — shipment country at enquiry level
--    VB.NET "CountryID" on market enquiry header.
-- ==========================================================================
alter table public.opportunities
  add column if not exists country_id uuid references public.countries(id) on delete set null;

create index if not exists idx_opp_country on public.opportunities(country_id);
