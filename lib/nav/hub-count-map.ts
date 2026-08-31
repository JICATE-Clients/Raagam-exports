/**
 * Which table's rows each hub card counts.
 *
 * ## Why this is its own file, with NO imports
 *
 * Same constraint `lib/nav/module-groups.ts` lives under: `scripts/` runs under
 * `node --experimental-strip-types`, which erases types and resolves nothing —
 * no `@/` alias, no bundler. A check can therefore import this literal directly
 * (`../lib/nav/hub-count-map.ts`) and assert against it, which it could not do
 * if the map sat beside the `server-only` Supabase call in `hub-counts.ts`.
 *
 * The invariant worth checking is that the two files agree card-for-card: every
 * href in `MODULE_GROUPS` is declared here, and nothing here names an href the
 * registry does not have. A card silently missing from the map is
 * indistinguishable, on screen, from a card deliberately left uncounted.
 *
 * `lib/nav/hub-counts.ts` is the runtime half — read its header first; it is
 * where "ABSENT IS NOT ZERO" is written down, and that rule is what every `null`
 * below depends on.
 */

/**
 * Card href → the table whose rows that card counts.
 *
 * `null` means "deliberately not counted", and every one of them says why. An
 * href absent from the map is treated identically; `null` is for the cases
 * where someone will otherwise come back and "fix" the omission.
 *
 * The rule for choosing a table is: **the document the screen creates**, never
 * the document it selects from. `/orders/garment-processes` loads
 * `sales_orders` to pick an order — its count is `order_garment_processes`,
 * because "Garment Processes: 412" meaning "there are 412 orders" is worse
 * than no number at all.
 */
export const HUB_COUNT_TABLES: Record<string, string | null> = {
  // ---------------------------------------------------------------- orders
  "/orders/all": "sales_orders",
  "/orders/styles": "garment_styles",
  "/orders/order-booking": "order_bookings",
  "/orders/pack-ratios": "order_pack_ratios",
  "/orders/excess-orders": "excess_orders",
  // Both doors of one screen, so both count the same documents: the entry door
  // (/orders/garment-orders) raises them, the amend door (/orders/amendments)
  // changes them, and the register behind them is one table.
  "/orders/garment-orders": "garment_order_amendments",
  "/orders/amendments": "garment_order_amendments",
  // The route was renamed on 2026-08-19; the TABLE was not (see the redirect
  // page at the old path for why the two differ).
  "/orders/material-bom": "material_bom_amendments",
  // The DOCUMENT the screen creates, not the orders it selects from — the rule
  // above, and it matters here because the card's screen opens on a queue of
  // garment ORDERS. "Fabric BOM: 412" meaning "there are 412 orders" is worse
  // than no number at all.
  "/orders/fabric-bom": "order_fabric_boms",
  "/orders/fabric-plan": "order_fabric_plans",
  "/orders/budgets": "order_budgets",
  // A QUEUE OVER ANOTHER CARD'S TABLE, exactly like Approve Amendment above.
  // Counting `order_budgets` here would print the Budgeting card's number a
  // second time under a different label; the number worth showing is "how many
  // are awaiting you", which is a filtered count this batched RPC cannot express.
  "/orders/budget-approval": null,
  "/orders/process-amendments": "garment_process_amendment_docs",
  "/orders/due-date-confirmations": "due_date_confirmations",
  "/orders/contract-review": "contract_reviews",
  "/orders/price-confirmation": "price_confirmations",
  "/orders/garment-processes": "order_garment_processes",
  "/orders/internal-work-orders": "internal_work_orders",
  "/orders/advised-items": "order_advised_items",
  "/orders/packing-advice": "packing_advices",
  "/orders/cancellations": "order_cancellations",
  "/orders/completions": "order_completions",
  // Deliberately uncounted. The map counts a whole table, and the whole table
  // here is every T&A activity ever scheduled on every order — a number this
  // screen never shows and nobody is waiting on. What the card would want is
  // "how many are due today, for you", which is per-user, per-day and filtered,
  // so a table count would be a confident wrong number rather than a missing one.
  "/orders/ta-worklist": null,
  "/orders/ta-masters": "ta_activities",
  "/orders/ta-department-assign": "ta_department_assigns",
  // A MATRIX, NOT A LIST (W3's audit). `ta_user_rights` holds one row per user
  // PER ACTIVITY, and the screen's own `getTaUserRightsSummary` rolls those up
  // to one line per user. `count(*)` would print the number of ticked cells
  // under a card whose screen shows a handful of people.
  "/orders/ta-user-rights": null,
  "/orders/ta-style": "ta_styles",
  "/orders/ta-completion": "ta_completions",
  // Restored by 0401 (0332 had dropped it). Counts `ta_plan_docs`, the table
  // the service actually reads — NOT `ta_plans`, which is a different table
  // (0006, per-order plan + milestones) that this screen never touches.
  "/orders/ta-plan": "ta_plan_docs",
  // A WORK QUEUE OVER ANOTHER CARD'S TABLE. Approve Amendment reads
  // `garment_order_amendments`, the same table the Order Amendment card counts,
  // so a row count here would print that card's number a second time under a
  // different label. The number worth showing is "how many are awaiting you",
  // which is a filtered count this batched RPC deliberately cannot express.
  "/orders/approve-amendments": null,
  // A hub that opens another hub (Amendments). It has no records of its own.
  "/orders/changes": null,

  // -------------------------------------------------------------- planning
  // NONE of these tables exist. Migration 0332 dropped the planning schema
  // while the screens stayed in the tree (see the standing note in
  // AGENTS.md-adjacent memory: "the planning module is dropped — the code is
  // there, the tables are not"). Declared with their intended names anyway,
  // because 0391 skips a table it cannot resolve: every one of these cards
  // shows no count today and starts showing one the day the table is created,
  // with no edit here.
  "/planning/fabric-bom": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/garment-bom": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/material-bom": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/accessory-bom": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/bom-shortage": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/bom-transfer": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/garment-ppm": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/processing-ppm": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/purchase-ppm": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/ppm-cancel": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/ppm-completion": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/garment-ppm-cancel": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/fabric-order": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/fabric-consumption": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/material-excess-plan": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/material-rate": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  // DANGER, and the reason this whole block is null: `excess_orders`
  // EXISTS — it is ORDERS' table (0328), read and written by
  // `lib/orders/pack-ratio-service.ts`. Counting it here would print
  // Orders' row count on a Planning card: not an empty number, a
  // confident WRONG one. Planning's own excess_orders never got created.
  "/planning/excess-order": null,
  "/planning/capacity-planning": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/production-planning": null, // status:"unavailable" — table dropped by 0332, screen cannot count
  "/planning/budgets": null, // status:"unavailable" — table dropped by 0332, screen cannot count

  // -------------------------------------------------------------- purchase
  "/purchase/orders": "purchase_orders",
  "/purchase/rfq": "rfqs",
  "/purchase/indents": "purchase_indents",
  "/purchase/grn": "grns",
  "/purchase/dc": "delivery_challans",
  "/purchase/over-budget": "over_budget_confirmations",
  "/purchase/rate-amendments": "po_rate_amendments",
  "/purchase/price-confirmations": "purchase_price_confirmations",
  "/purchase/po-cancellations": "po_cancellations",
  "/purchase/completions": "po_completions",
  "/purchase/vendors": "vendors",
  "/purchase/lab": "lab_tests",
  // Same work-queue case as Approve Amendment: this screen acknowledges rows in
  // `purchase_indents`, which the Indents card beside it already counts.
  "/purchase/indents/approval": null,

  // ---------------------------------------------------------------- stores
  "/stores/opening-stock": "opening_stocks",
  "/stores/requisitions": "material_requisitions",
  "/stores/interdept": "interdept_deliveries",
  "/stores/process-orders": "process_orders",
  "/stores/process-issues": "process_material_issues",
  "/stores/process-receipts": "process_material_receipts",
  "/stores/csp-receipts": "csp_receipts",
  "/stores/vendor-returns": "vendor_returns",
  // Adjustments and Transfers write `stock_ledger` entries rather than a
  // document of their own, so the only available count is "every stock
  // movement ever recorded, of any kind" — a large number that is not the
  // number on the card, over the biggest table in the schema.
  "/stores/adjustments": null,
  "/stores/transfers": null,

  // ------------------------------------------------------------ production
  "/production/job-orders": "production_job_orders",
  "/production/piece-rates": "contractor_piece_rates",
  "/production/inspections": "inspections",
  "/production/packing-lists": "packing_lists",
  "/production/despatch": "despatches",
  // A masters hub of its own (sewing operations, work types, production
  // lines) — several tables, so no single count is the count.
  "/production/masters": null,

  // -------------------------------------------------------------------- hr
  "/hr/workers": "workers",
  "/hr/staff": "staff",
  "/hr/contractors": "contractors",
  "/hr/lifecycle": "hr_lifecycle_events",
  // Attendance is marked for a DATE, not accumulated: `worker_attendance` is
  // one row per worker per day, so its count grows without bound and answers
  // "how many marks have ever been made", which is not what the card is for
  // (W3's audit).
  "/hr/attendance": null,
  "/hr/piece-records": "worker_piece_records",
  "/hr/leave": "hr_leaves",
  "/hr/payroll": "payroll_runs",
  "/hr/advances": "hr_advances",
  "/hr/adjustments": "hr_adjustments",
  "/hr/comp-events": "hr_comp_events",
  "/hr/statutory": "hr_statutory_docs",
  // A payslip is rendered from a payroll run; there is no payslips table, and
  // `payroll_lines` is a line-item table (one row per worker per run), so its
  // count answers a question nobody asked.
  "/hr/payslip": null,
  // Settings, not records — `payroll_settings` is one row per location.
  "/hr/settings": null,

  // ------------------------------------------------------------- logistics
  "/logistics/proforma": "proforma_invoices",
  "/logistics/lc": "lc_details",
  "/logistics/epcg": "epcg_declarations",
  "/logistics/incentives": "export_incentive_files",
  "/logistics/export-categories": "export_categories",
  "/logistics/order-categories": "order_category_assignments",

  // --------------------------------------------------------------- finance
  "/finance/accounts": "gl_accounts",
  "/finance/cost-centres": "cost_centres",
  "/finance/cost-heads": "cost_heads",
  "/finance/party-openings": "party_openings",
  "/finance/payables": "payables",
  "/finance/receivables": "receivables",
  "/finance/notes": "finance_notes",
  "/finance/bank-limits": "bank_limits",
  "/finance/bank-journals": "bank_journals",
  "/finance/cheques": "cheques",
  "/finance/forward-contracts": "forward_contracts",
  "/finance/exchange-rates": "exchange_rate_details",
  "/finance/provisional-invoices": "provisional_invoices",
  "/finance/domestic-invoices": "domestic_garment_invoices",
  "/finance/ledger": "journal_entries",
  "/finance/other-entries": "other_income_expenses",
  // Shipment P&L is a derived view over shipments, receivables and costs. Its
  // source table's count ("how many shipments exist") is not this card's
  // number, and the card is a report, not a list something is added to.
  "/finance/pnl": null,

  // ----------------------------------------------------------------- admin
  "/admin/divisions": "divisions",
  // `/admin/document-no-formats` was here until 2026-08-12. The screen moved to
  // Master Data ▸ System and the Admin card went with it, so this key belonged to
  // no card — and these key on the CARD'S OWN href, which is the property that
  // makes one place state one fact. Removed rather than repointed: the Master
  // Data hubs render their cards without a `count` at all, so a
  // `/masters/system/document-no-format` entry would be the same dead config one
  // href along. Assertion 15 would not have caught either — it only guards an
  // `unavailable` card naming a table.
  "/admin/users": "profiles",
  "/admin/roles": "roles",
  "/admin/assets": "assets",
  "/admin/couriers": "couriers",
  // One legal entity — `company_profile` is a singleton, so the count is
  // always 1 and says nothing.
  "/admin/company": null,
  // An append-only trail, not an inventory. "Audit Log: 148,203" is noise, and
  // counting it is a full scan of one of the largest tables in the schema.
  "/admin/audit": null,
};

/** The table a card counts, or `null` when it has none. */
export function hubCountTable(href: string): string | null {
  return HUB_COUNT_TABLES[href] ?? null;
}

/** Every href this file has an opinion about — countable or explicitly not. */
export function declaredCountHrefs(): string[] {
  return Object.keys(HUB_COUNT_TABLES);
}
