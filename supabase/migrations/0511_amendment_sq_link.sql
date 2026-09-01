-- ============================================================================
-- Raagam ERP — 0511 The Confirmed Order records which Style Quotation it came
--                    from, so "Copy From SQ No" has something to copy FROM
--
-- Client 2026-09-01: "Copy From SQ No (HO/SQ/2627/0001) … this field allows the
-- merchandiser to pull pre-existing data from the Style Quotation. Copying from
-- the SQ No should instantly pull the structure, estimated compositions, and
-- initial parameters into the Confirmed Order (RE) layout to eliminate
-- repetitive manual data entry."
--
-- The legacy screen carries SQ No on the Fabric BOM header too (client
-- screenshot 2577, beside SC No and Order No), so the link is a property of the
-- ORDER rather than a transient choice made while copying.
--
--
-- THE CHAIN THIS OPENS, TRACED FROM THE CATALOG RATHER THAN ASSUMED
--
--   sq_details.opportunity_id  -> opportunities
--   cost_sheets.opportunity_id -> opportunities
--   ioc_fabric_rates.cost_sheet_id -> cost_sheets
--
-- and `ioc_fabric_rates` is where the estimation actually lives: it carries
-- `structure_name`, `composition_name`, `gsm`, `fabric_type`, `fabric_sub_type`
-- and `style_ref_no`. `sq_details` itself holds NOTHING about fabric — it is 29
-- commercial columns (quantities, dates, customer, excess, rejection), which is
-- why the copy has to go the long way round through the costing engine (0320).
--
-- So an SQ reaches its fabric estimation through its OPPORTUNITY, not directly.
-- That is worth writing down because the obvious query — join ioc_fabric_rates
-- to sq_details — has nothing to join ON and would silently return nothing.
--
--
-- NULLABLE, AND IT MUST STAY NULLABLE
--
-- Most orders are not raised from a quotation. An RE booked straight off a
-- customer PO has no SQ and never will, so this is provenance when it exists and
-- silence when it does not — never a required field, and never a default.
--
-- `on delete set null`: deleting a quotation must not delete the confirmed order
-- that once referenced it. The order is the commitment; the SQ was an estimate.
--
--
-- NO DATA EXISTS TO EXERCISE THIS YET, AND THAT IS STATED RATHER THAN DISCOVERED
--
-- Measured 2026-09-01, before writing: `sq_details` 0 rows, `ioc_fabric_rates`
-- 0 rows, `cost_sheets` 1 row, `opportunities` 2 rows. The column and the copy
-- built on it are therefore correct by construction and UNTESTED against real
-- rows — there is no SQ in the system to select. Treat the first real quotation
-- as the test, and check `sqFabricEstimation` abstains where it should before
-- trusting what it fills in.
-- ============================================================================

alter table public.garment_order_amendments
  add column if not exists sq_detail_id uuid
    references public.sq_details(id) on delete set null;

create index if not exists idx_goa_sq_detail
  on public.garment_order_amendments(sq_detail_id);

comment on column public.garment_order_amendments.sq_detail_id is
  'The Style Quotation this confirmed order was raised from (0511). Provenance, '
  'and the handle "Copy From SQ No" uses to reach the fabric estimation through '
  'sq_details -> opportunities -> cost_sheets -> ioc_fabric_rates. NULL for an '
  'order booked straight off a customer PO, which is the ordinary case.';
