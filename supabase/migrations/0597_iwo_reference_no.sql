-- ============================================================================
-- Raagam ERP — 0597 Internal Work Order: the Reference is TYPED.
--
-- User 2026-09-20: "In internal work order, reference field is manual entry".
-- The IWO header's Reference (RE No) was a picker over `sales_orders`
-- (`sales_order_id`, 0578). A work order usually PRECEDES any buyer order, so
-- the reference it carries is whatever the merchandiser writes — a trial, a
-- buyer's enquiry, an RE No that may not exist yet — not a row that must
-- already be in the order book.
--
-- `reference_no` holds it as text, capitalised by the schema like every typed
-- value. Each existing work order's linked RE No is copied in, so nothing that
-- was shown disappears. `sales_order_id` is KEPT, untouched and no longer
-- written: dropping it would lose the link on any row that has one, and
-- nothing reads it once the screens read `reference_no`.
--
-- (Same day, same user: "style remove the field" — the Style field comes off
-- the work order and its BOM / budget screens. `style_ref_no` is kept as it is
-- for the same reason: the stored values stay, nothing asks for them.)
-- ============================================================================

alter table public.internal_work_orders
  add column if not exists reference_no text
  check (reference_no is null or char_length(btrim(reference_no)) between 1 and 60);

comment on column public.internal_work_orders.reference_no is
  'Reference (RE No), TYPED by the merchandiser (0597, user 2026-09-20) — an IWO usually precedes '
  'any buyer order. Backfilled from the old sales_order_id link; that column is kept and no longer written.';

update public.internal_work_orders w
   set reference_no = so.order_number
  from public.sales_orders so
 where so.id = w.sales_order_id
   and w.reference_no is null
   and so.order_number is not null;
