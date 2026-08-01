-- =============================================================================
-- 0380 — Order Trims gets a real vendor, and a buyer can name its customer
-- -----------------------------------------------------------------------------
-- Last of the nominated-vendor set (0376 · 0377 · 0379). Orders ▸ order detail ▸
-- Trims carries `supply_type` — nominated / recommended / foc_csp / foc_ssp /
-- purchase / csp_purchase / none — beside a Vendor that was a bare `text`
-- column. An operator typed anything at all, including for a line marked
-- "nominated", and the value joined to nothing: not to `master_vendors`, not to
-- `public.vendors`, not to the customer's nomination list. That is the "wrong
-- data in the nominated vendor field" the client reported.
--
-- ## Part 1 — order_trims.vendor_id
--
-- FREE: `public.order_trims` is EMPTY (0 rows, verified before writing this), so
-- there is no text to reconcile. `vendor_name` is KEPT rather than dropped:
-- `lib/data-io` imports and any legacy spreadsheet still carry a typed name, and
-- the screen shows it when `vendor_id` is null instead of rendering the line as
-- vendorless. New rows written through the UI set `vendor_id`.
--
-- ## Part 2 — buyers.customer_id, and why it is needed
--
-- The Trims tab could not apply a nomination even if it wanted to.
-- `sales_orders.buyer_id` references `public.buyers`; nominations hang off
-- `public.customers` (`customer_nominated_vendors.customer_id`). Two tables, no
-- link, and on the live database the six buyers (ABASIC · NEXT · Aurelia Retail ·
-- Cotton & Co UK · H&B Sourcing · Nordheim Apparel) share NO name with the four
-- customers — so not even a name match could bridge them. This is the same class
-- of split as `vendors` / `master_vendors` (0376) and the `state` shim (0355).
--
-- The link is a nullable column, deliberately: merging `buyers` into `customers`
-- would touch Finance (receivables, notes, party openings, domestic and
-- provisional invoices, P&L), Logistics (shipments, LCs) and Sales, and is a far
-- larger decision than this fix. Nullable means nothing breaks today — an order
-- whose buyer is unlinked keeps offering every vendor, with a line on the field
-- saying why — and the narrowing switches on per buyer as the operator links
-- them on the Buyer record. No data moves.
--
-- No backfill is attempted. Guessing that "NEXT" the buyer is "NEXT" the
-- customer is exactly the same-name-means-same-entity assumption 0376 had to
-- make and 0379 stopped making; here nothing even matches, so a backfill would
-- be pure invention. Linking is an operator decision.
-- =============================================================================

-- --- Part 1: a real vendor on a trim line ------------------------------------

alter table public.order_trims
  add column if not exists vendor_id uuid
    references public.master_vendors(id) on delete set null;

create index if not exists idx_order_trims_vendor on public.order_trims(vendor_id);

comment on column public.order_trims.vendor_id is
  'FK to public.master_vendors (the Vendor master), NOT public.vendors — see 0380. '
  'When supply_type is ''nominated'' or ''recommended'' the UI narrows this to the '
  'nominations of the customer linked to the order''s buyer (buyers.customer_id).';

comment on column public.order_trims.vendor_name is
  'Legacy / imported free text. Kept so a spreadsheet import still shows a name; '
  'the screen displays it only when vendor_id is null. New rows set vendor_id.';

-- --- Part 2: a buyer may name the customer whose nominations apply -----------

alter table public.buyers
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null;

create index if not exists idx_buyers_customer on public.buyers(customer_id);

comment on column public.buyers.customer_id is
  'Optional link to the Masters ▸ Associates ▸ Customer record for the same party. '
  'Orders hang off buyers; nominated / recommended vendor lists hang off customers. '
  'Null means "not linked yet" — nomination-aware fields on that order stay '
  'unnarrowed and say so, rather than silently claiming the party nominated nobody. '
  'See 0380; not a backfill, an operator decision.';
