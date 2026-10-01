# Order module digitalisation — build plan (features 1–4)

Client proposal: "Order Module Digitalisation Proposal" (Claude Docs, 2026-10-01).
Features 5 (Quotation → Order) and 6 (QR / carton barcodes) are ON HOLD (user, 2026-10-01).

Research was done against the live DB on 2026-10-01. **Every downstream table is empty**
(purchase_orders, po_line_items, grns, process_orders, production_entries, inspections,
shipments, shipment_lines, order_completions = 0 rows). Features 1 and 3 therefore show
"not started" / zero actuals until real documents exist. That is correct behaviour, not a
bug, and each screen says so in words rather than showing a blank.

Migration numbers are fixed up front so parallel work cannot collide (ledger top = 0665):

| # | Migration | Feature |
| --- | --- | --- |
| 0666 | `order_risk_alerts` | 1 |
| 0667 | `order_actual_costs` | 3 |
| 0668 | `ta_approval_links` + decision columns | 4 |
| 0669 | `order_po_imports` | 2 |

---

## 1. Order progress tracker + delivery risk

**Route:** `/orders/progress` (Order Management ▸ Order Progress). One row per live RE, a
risk pill, expand → the stage timeline. Dashboard alert "N orders at risk" links there.

**Order facts** come from the CURRENT document (`currentAmendmentsBySalesOrder`, drafts
dropped): order qty = Σ `garment_order_amendment_quantities.po_qty`, delivery = earliest
quantity-row `delivery_date`, else the header's. `sales_orders.order_qty` is always 0 and
`delivery_date` always NULL live — never read them.

**Stages, in order:**

| Group | Stage | Plan date | Done when |
| --- | --- | --- | --- |
| Office | the 8 Work Flow milestones (0607) | `target_date` | `status = done` (trigger-stamped) |
| Material | Materials in-house | ladder MATIH end | ladder `actual_date`, or every PO line for the RE received in full |
| Production | PP approval | ladder PPAPPR end | ladder `actual_date` |
| Production | Cutting / Sewing / Packing | ladder CUT / SEW / PACK end | cumulative good qty ≥ order qty (`production_entries`), or ladder `actual_date` |
| Production | Final inspection | ladder INSP end | a passed `inspections` row, or ladder `actual_date` |
| Shipment | Shipped | delivery date | shipped qty ≥ order qty (`shipment_lines` on shipped/delivered/closed shipments) |

Plan date of a ladder stage = `taSpanEnd(target_date, days_required)` — the day it must
FINISH. The Fabric / Trim T&A engines are NOT used for risk: they need a session (their
requirement report reads through RLS), and the nightly sweep has none. One rule that runs
in both places beats a richer rule that runs in one. The tracker links to those tabs for
item-level detail.

**Risk rule (one pure function, `orderRisk`):**

- `late` — today is past the delivery date and the order is not shipped.
- `at_risk` — some unfinished Material/Production stage is past its plan date. The ladder
  is scheduled BACKWARD from delivery with no slack, so `n` days late on any such stage
  projects delivery `n` days late. Projected = delivery + the largest lateness.
- `on_track` — otherwise. `no_plan` when the order has no T&A ladder (nothing to judge).
- Office milestones show their own overdue state but do not set risk: they are scheduled
  FORWARD from order receipt, so lateness there says nothing about delivery by itself
  (it surfaces through the material stages it delays).

**Alerts:** `/api/cron/order-risk` daily (09:00 IST). `order_risk_alerts` holds the last
level notified per RE; an alert is sent once when an order ENTERS at_risk or late (claim
then send, as the Work Flow sweep does), to the document's merchandiser
(`{ employeeIds }`) and the Managing Director role. Back on track clears the row so a later
slip alerts again.

## 2. Upload buyer PO → pre-filled draft

**Flow:** Order Entry list ▸ "Upload Buyer PO" → `/orders/po-import`. Upload PDF / Excel /
image to `garment-order-docs` (`po-imports/<id>/…`, client-side, as attachments already do
— server actions cap bodies at 1 MB) → POST `/api/orders/po-import` reads it with Claude
(structured output) → the review screen shows the file beside an editable draft →
"Create order" opens `/orders/garment-orders?draft=<id>`, which runs `openAdd()` and fills
header + styles + colours + size-wise quantities + prices through the existing `applyRows`
seed path. **Nothing is saved without the merchandiser pressing Save on Order Entry.**

- Excel is converted to text with `exceljs` server-side; PDFs and images go to the model
  as document / image blocks.
- Customers and sizes are matched to masters by normalised name; an unmatched value is
  shown for the operator to pick, never created. Colours are free text (no colour master
  since 0382).
- `ANTHROPIC_API_KEY` must be set; without it the screen says so and nothing breaks
  (same stance as `emailConfigured()`).
- `order_po_imports` keeps the file path, the extracted JSON, who/when, and the order it
  became — the audit trail of what the machine read.

## 3. Budget vs actual

**Route:** `/orders/profitability` (Order Management ▸ Profitability): every order with an
approved budget, budget profit vs actual profit, filter "closed only", grouped totals by
buyer and merchandiser. Row → per-order statement.

Buckets are the budget's own (`BUCKET_OF_SOURCE`, `breakdown.ts`): Fabric & yarn ·
Processing · Trims · CMT & overheads, plus Sales and Profit.

| Bucket | Budget | Actual |
| --- | --- | --- |
| Fabric & yarn, Trims | approved budget | PO lines with `sales_order_id`: received value = accepted GRN qty × net rate (INR); PO value shown beside |
| Processing | approved budget | `process_orders.sales_order_id`: received qty × line rate |
| CMT & overheads | approved budget | **entered by hand** (`order_actual_costs`) — no costed CMT exists per order |
| Sales | budget sales value | `shipment_lines.amount` × order ex-rate; shipped qty |

Lines over budget by more than 5 % are highlighted. Item class decides Fabric vs Trims
(yarn / fabric classes → Fabric). A bucket with no documents says "No documents yet",
never 0.

## 4. Buyer approval by link

- 0668 adds `ta_approval_links` (sha-256 of the token only — the token itself is never
  stored), and `decided_by_name / decision_comment / decided_at / decided_via` on
  `garment_order_amendment_ta_approvals`.
- TA Followup: a sent approval gets "Email buyer link" → recipient (prefilled from
  `customer_contacts.email_id`) → `sendApprovalLink` mints the token, stores the hash,
  emails it with Resend. Without email configured the link is returned to copy (WhatsApp).
- Public page `/p/approve/<token>` (outside `app/(app)`; `proxy.ts` stands down for
  `/p/`): RE No, customer, approval name, the proof file (signed URL, 10 min), Approve /
  Rework + name + comment. The decision goes through `ta_link_decide` — SECURITY DEFINER,
  granted to `service_role` only, called with the admin client — which locks the link,
  refuses an expired / used / superseded one, and for Rework writes the history snapshot
  and resets the row in ONE transaction.
- The merchandiser is notified (`{ employeeIds }`). Links expire after 14 days; one
  reminder after 3 days without an answer (`/api/cron/approval-links`, daily).
- A staff member can still mark the row by hand; the link then refuses ("already
  answered") because the row is no longer `sent` at the link's version.
