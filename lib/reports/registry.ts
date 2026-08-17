/**
 * THE REPORT FIELD REGISTRY — the contract behind `raagam-report-data`.
 *
 * Two jobs:
 *  1. Declare every field an item report can show or group by, as plain data, so
 *     report pages derive their columns instead of hand-listing them.
 *  2. Declare every table that feeds the item fact model, so a new child
 *     sub-module cannot be built without its material data reaching reports.
 *     `scripts/audit_reports.py` in the skill cross-checks the migrations
 *     against `REPORT_SOURCES` and flags anything carrying an item FK + a
 *     quantity column that is not listed here.
 *
 * NOTHING in this file may be a closure. It is imported from Server Components,
 * Client Components and a Python audit script alike; `ReportColumn.value`
 * closures are built from these descriptors in `columns.ts`, on the client.
 */

import type { Module } from "@/lib/auth/types";

// ---------------------------------------------------------------------------
// Field descriptors
// ---------------------------------------------------------------------------

export type FieldKind = "dimension" | "measure";

/**
 * How a value is rendered on screen and in PDF. Excel always receives the raw
 * number — see the `format` note on `ReportColumn`.
 */
export type ValueFormat = "text" | "number" | "qty" | "money" | "percent" | "date";

export interface ReportField {
  /** Matches a key on the fact row, or `attr:<Attribute name>` for a material attribute. */
  key: string;
  label: string;
  kind: FieldKind;
  format: ValueFormat;
  /** Table the value originates from — used by the audit script and the skill docs. */
  source: string;
  /** Dimensions only: may this be used as a group-by axis? */
  groupable?: boolean;
  /** Shown when the user has not chosen columns explicitly. */
  isDefault?: boolean;
  /** Why this measure can be wrong or empty — surfaced in the report footnotes. */
  caveat?: string;
}

// ---------------------------------------------------------------------------
// Dimensions — "each and every item, type, category"
// ---------------------------------------------------------------------------

export const ITEM_DIMENSIONS: ReportField[] = [
  { key: "item_name", label: "Material", kind: "dimension", format: "text", source: "items", groupable: true, isDefault: true },
  { key: "item_code", label: "Code", kind: "dimension", format: "text", source: "items", groupable: true },
  { key: "item_class_name", label: "Item Class", kind: "dimension", format: "text", source: "config_lookups", groupable: true, isDefault: true },
  { key: "category_name", label: "Category", kind: "dimension", format: "text", source: "categories", groupable: true, isDefault: true },
  { key: "sub_category_name", label: "Sub-category", kind: "dimension", format: "text", source: "category_sub_categories", groupable: true },
  { key: "stock_uom_code", label: "UOM", kind: "dimension", format: "text", source: "uoms", isDefault: true },
  { key: "store_name", label: "Store", kind: "dimension", format: "text", source: "stores", groupable: true },
  { key: "location_name", label: "Location", kind: "dimension", format: "text", source: "locations", groupable: true },
  { key: "month", label: "Month", kind: "dimension", format: "date", source: "report_item_movements", groupable: true },
];

/**
 * Material attributes are NOT listed here. They are discovered at runtime from
 * `attribute_values` and returned as the `attributes` jsonb on every fact row,
 * so an attribute added in Masters becomes a groupable dimension with no code
 * change. `attributeDimension()` wraps one for the group-by picker.
 */
export const ATTRIBUTE_KEY_PREFIX = "attr:";

export function attributeDimension(name: string): ReportField {
  return {
    key: `${ATTRIBUTE_KEY_PREFIX}${name}`,
    label: name,
    kind: "dimension",
    format: "text",
    source: "item_attribute_values",
    groupable: true,
  };
}

export function isAttributeKey(key: string): boolean {
  return key.startsWith(ATTRIBUTE_KEY_PREFIX);
}

export function attributeName(key: string): string {
  return key.slice(ATTRIBUTE_KEY_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Measures — "consumed, purchased, etc, all the way"
// ---------------------------------------------------------------------------

export const ITEM_MEASURES: ReportField[] = [
  { key: "qty_opening_balance", label: "Opening", kind: "measure", format: "qty", source: "report_item_stock_as_of", isDefault: true },
  { key: "qty_ordered", label: "Ordered", kind: "measure", format: "qty", source: "po_line_items", isDefault: true },
  { key: "qty_received", label: "Received", kind: "measure", format: "qty", source: "stock_ledger", isDefault: true },
  { key: "qty_issued", label: "Consumed", kind: "measure", format: "qty", source: "stock_ledger", isDefault: true },
  { key: "qty_returned", label: "Returned", kind: "measure", format: "qty", source: "stock_ledger" },
  { key: "qty_closing_balance", label: "Closing", kind: "measure", format: "qty", source: "report_item_stock_as_of", isDefault: true },

  { key: "qty_grn_accepted", label: "GRN accepted", kind: "measure", format: "qty", source: "grn_line_items", caveat: "GRN lines not linked to a PO line carry no material and are excluded." },
  { key: "qty_grn_rejected", label: "GRN rejected", kind: "measure", format: "qty", source: "grn_line_items", caveat: "Same PO-link limitation as GRN accepted." },
  { key: "qty_transfer_in", label: "Transfer in", kind: "measure", format: "qty", source: "stock_ledger" },
  { key: "qty_transfer_out", label: "Transfer out", kind: "measure", format: "qty", source: "stock_ledger" },
  { key: "qty_adjust_in", label: "Adjust in", kind: "measure", format: "qty", source: "stock_ledger" },
  { key: "qty_adjust_out", label: "Adjust out", kind: "measure", format: "qty", source: "stock_ledger" },
  // TWO SOURCES, ONE MEASURE — and the caveat has to say so. `qty_planned` sums
  // every `fact_kind = 'planned'` row, so Fabric BOM (0426) joined it the moment
  // its fragment landed in the view; nothing here had to be added for the number
  // to change. A caveat still reading "the Material BOM's stored requirement"
  // would then be describing half of what the column totals, on a measure whose
  // whole history is being believed while it was wrong. `source` names the
  // material table because a field carries one, and the reason the second is not
  // invisible is that it is written down here.
  { key: "qty_planned", label: "Planned", kind: "measure", format: "qty", source: "material_bom_amendment_requirements", caveat: "Material BOM and Fabric BOM stored requirements, added together — a plan, not a posting. A refused line is excluded rather than counted as zero." },
  { key: "qty_sent_out", label: "Sent to processor", kind: "measure", format: "qty", source: "dc_line_items", caveat: "Off-book: delivery challans never post a stock movement." },
  { key: "qty_came_back", label: "Back from processor", kind: "measure", format: "qty", source: "dc_line_items", caveat: "Off-book: delivery challans never post a stock movement." },

  { key: "value_ordered", label: "Ordered value", kind: "measure", format: "money", source: "po_line_items" },
  { key: "value_purchased", label: "Purchase value", kind: "measure", format: "money", source: "stock_ledger", isDefault: true },
  { key: "value_consumed", label: "Consumption value", kind: "measure", format: "money", source: "stock_ledger", isDefault: true, caveat: "Valued at resolve_item_rate(): last PO price, then yarn rate master, then budget rate." },
  { key: "value_closing_balance", label: "Closing value", kind: "measure", format: "money", source: "report_item_stock_as_of", caveat: "Blank where no rate could be resolved for the item." },
  { key: "movements", label: "Movements", kind: "measure", format: "number", source: "report_item_movements" },
];

export const DEFAULT_GROUP_BY = "item_name";

export function fieldByKey(key: string): ReportField | undefined {
  if (isAttributeKey(key)) return attributeDimension(attributeName(key));
  return [...ITEM_DIMENSIONS, ...ITEM_MEASURES].find((f) => f.key === key);
}

export function defaultMeasures(): ReportField[] {
  return ITEM_MEASURES.filter((m) => m.isDefault);
}

// ---------------------------------------------------------------------------
// Sources — every table whose rows become item facts
// ---------------------------------------------------------------------------

/**
 * `wired`        — feeds `report_item_movements` and shows up in reports.
 * `off_book`     — feeds reports but never posts a stock movement, so it does
 *                  not affect stock balances. Reported, and labelled as such.
 * `gap`          — carries material movement or demand in the real world but is
 *                  NOT in the fact model. Either the table has no item_id to
 *                  read, or it simply has not been wired in yet; `note` says
 *                  which. Declared here so the gap is visible, not silent.
 * `not_movement` — the audit heuristic flags it (item FK + a quantity column)
 *                  but it is a cache, a master or a costing projection, not a
 *                  transaction. Declared so the warning stays answered.
 */
export type SourceStatus = "wired" | "off_book" | "gap" | "not_movement";

export interface ReportSource {
  id: string;
  label: string;
  module: Module;
  /** `fact_kind` values this source emits in `report_item_movements`. */
  factKinds: string[];
  table: string;
  itemColumn: string | null;
  qtyColumn: string | null;
  dateColumn: string | null;
  postsToLedger: boolean;
  status: SourceStatus;
  note?: string;
}

export const REPORT_SOURCES: ReportSource[] = [
  {
    id: "stock_ledger",
    label: "Stock ledger",
    module: "stores",
    factKinds: ["opening", "received", "issued", "returned", "transfer_in", "transfer_out", "adjust_in", "adjust_out"],
    table: "stock_ledger",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: "txn_date",
    postsToLedger: true,
    status: "wired",
  },
  {
    id: "purchase_orders",
    label: "Purchase order lines",
    module: "materials_purchase",
    factKinds: ["ordered"],
    table: "po_line_items",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: "purchase_orders.order_date",
    postsToLedger: false,
    status: "wired",
  },
  {
    id: "grn_line_items",
    label: "GRN lines (as documented)",
    module: "materials_purchase",
    factKinds: ["grn_accepted", "grn_rejected"],
    table: "grn_line_items",
    itemColumn: "po_line_items.item_id",
    qtyColumn: "accepted_qty",
    dateColumn: "grns.grn_date",
    postsToLedger: false,
    status: "wired",
    note:
      "grn_line_items has NO item_id of its own — the material is reachable only " +
      "via po_line_item_id. Lines without a PO link are invisible to reporting. " +
      "Reported alongside the ledger's 'received' rows because GRN stock-in is " +
      "best-effort in grn-actions.ts and the two can silently diverge.",
  },
  {
    id: "material_requisitions",
    label: "Material requisitions (issue)",
    module: "stores",
    factKinds: ["issued"],
    table: "material_requisition_lines",
    itemColumn: "item_id",
    qtyColumn: "issued_qty",
    dateColumn: "material_requisitions.required_date",
    postsToLedger: true,
    status: "wired",
    note:
      "The only structured consumption document. department is free text — there " +
      "is no order / job / cost-centre link, so consumption cannot be attributed.",
  },
  {
    id: "opening_stocks",
    label: "Opening stock",
    module: "stores",
    factKinds: ["opening"],
    table: "opening_stock_lines",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: "opening_stocks.opening_date",
    postsToLedger: true,
    status: "wired",
  },
  {
    id: "vendor_returns",
    label: "Vendor returns / replacements",
    module: "stores",
    factKinds: ["issued", "received"],
    table: "vendor_return_lines",
    itemColumn: "item_id",
    qtyColumn: "return_qty",
    dateColumn: "vendor_returns.return_date",
    postsToLedger: true,
    status: "wired",
  },
  {
    id: "csp_receipts",
    label: "Customer-supplied receipts",
    module: "stores",
    factKinds: ["received"],
    table: "csp_receipt_lines",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: "csp_receipts.receipt_date",
    postsToLedger: true,
    status: "wired",
  },
  {
    id: "material_bom_amendments",
    label: "Material BOM (planned consumption)",
    module: "orders",
    factKinds: ["planned"],
    // 0418. It read `material_bom_amendment_items.quantity_nos`, which is the
    // NUMERATOR of a per-garment ratio and not a quantity at all — the view
    // multiplied it by `sales_orders.order_qty`, and the Garment Order screen
    // mints its sales_orders shell without one, so this measure was 0 in every
    // report. Not an error and not a blank column: "nothing planned", which is
    // a real and unremarkable answer, so it got believed rather than reported.
    table: "material_bom_amendment_requirements",
    itemColumn: "item_id",
    qtyColumn: "required_qty",
    dateColumn: "material_bom_amendments.amend_date",
    postsToLedger: false,
    status: "off_book",
    note: "The Material BOM's stored requirement, split by order / colour / size. A refused line stores NULL and is excluded rather than counted as zero.",
  },
  {
    id: "order_fabric_boms",
    label: "Fabric BOM (planned consumption)",
    module: "orders",
    factKinds: ["planned"],
    // 0426. The same shape as the Material BOM above and deliberately so: the
    // requirement is STORED, so this reads a number rather than re-deriving the
    // excess, approval and projection maths in SQL beside the TypeScript copy.
    //
    // IT SHARES `qty_planned` WITH THE MATERIAL BOM. Both emit
    // `fact_kind = 'planned'`, so an item report totals whichever of the two
    // applies to the item — and no item is in both, since one plans fabric and
    // the other trims. Splitting them into two measures was the alternative and
    // would put an always-blank column beside every figure.
    table: "order_fabric_bom_requirements",
    itemColumn: "item_id",
    qtyColumn: "required_qty",
    dateColumn: "order_fabric_boms.bom_date",
    postsToLedger: false,
    status: "off_book",
    note: "The Fabric BOM's stored requirement, split by colour or by colour and size. A refused line stores NULL and is excluded rather than counted as zero. Carries no rate: the money for a plan is the Budget's (step 7).",
  },
  {
    id: "delivery_challans",
    label: "Delivery challans (to processor)",
    module: "materials_purchase",
    factKinds: ["sent_out", "came_back"],
    table: "dc_line_items",
    itemColumn: "item_id",
    qtyColumn: "sent_qty",
    dateColumn: "delivery_challans.dc_date",
    postsToLedger: false,
    status: "off_book",
    note: "Material at a processor is invisible to stock_balances — DC posts no movement.",
  },

  // ---- Declared gaps: real material movement that cannot be reported yet ----
  {
    id: "order_fabric_plans",
    label: "Fabric Plan (process route)",
    module: "orders",
    factKinds: [],
    // 0427. THE FABRIC IS DELIBERATELY NOT REPORTED FROM HERE — it is the same
    // item the Fabric BOM already emits as `planned`, walked backwards through
    // the route. A fragment for it would double every fabric figure in every
    // item report.
    //
    // The YARN is genuinely new information and is the gap. A route names
    // PROCESSES, and "knitting consumes yarn X" is a conversion the yarn master
    // and the fabric's composition express — this table does not know it, so
    // `itemColumn` is null rather than pointed at the fabric it is NOT
    // consuming. Declaring the gap is the correct move; omitting the table is
    // what leaves it invisible.
    table: "order_fabric_plan_stages",
    itemColumn: null,
    qtyColumn: "input_qty",
    dateColumn: "order_fabric_plans.plan_date",
    postsToLedger: false,
    status: "gap",
    note:
      "The route's stage quantities — what must be available at each step. The " +
      "yarn at the head of the route is real demand and cannot be reported: a " +
      "stage names a process, not the item that process consumes.",
  },
  {
    id: "order_fabric_plan_lines",
    label: "Fabric Plan (planned fabric)",
    module: "orders",
    factKinds: [],
    // 0427, and declared SEPARATELY from `order_fabric_plans` above because a
    // ReportSource names one table and this one carries the item while the
    // stages carry the quantities.
    //
    // Its `required_qty` is a SNAPSHOT OF THE FABRIC BOM's stored requirement —
    // the same number, for the same item, already emitted as `planned` by
    // fragment 6 of report_item_movements. Reporting it again would show one
    // order's fabric demand twice, and the second copy would be
    // indistinguishable from a real increase.
    table: "order_fabric_plan_lines",
    itemColumn: "item_id",
    qtyColumn: "required_qty",
    dateColumn: "order_fabric_plans.plan_date",
    postsToLedger: false,
    status: "gap",
    note:
      "A snapshot of the Fabric BOM requirement this route was planned against. " +
      "The BOM already reports that quantity as `planned`; reporting it here too " +
      "would double every fabric figure.",
  },
  {
    id: "order_budgets",
    label: "Order Budget (costing)",
    module: "orders",
    factKinds: [],
    // 0428. A budget line carries an item and a quantity, so it has to be
    // declared — but it must NOT feed `report_item_movements`, and the reason is
    // the same one that keeps the Fabric Plan out: its fabric and material lines
    // are PULLED from the two BOMs, whose stored requirements already emit
    // `planned`. A fragment here would report the identical demand twice, and
    // the second copy would look like additional consumption rather than the
    // same consumption priced.
    //
    // The COST is the new information and is not an item movement at all — it is
    // a rate against a quantity somebody else computed. `lib/reports` slices
    // material; a budget belongs to a P&L report that does not exist yet.
    table: "order_budget_lines",
    itemColumn: "item_id",
    qtyColumn: "qty",
    dateColumn: "order_budgets.budget_date",
    postsToLedger: false,
    status: "gap",
    note:
      "Costing, not movement. Its fabric and material quantities are the BOM " +
      "requirements already reported as `planned`, so reporting them here would " +
      "double the demand. The rates are real information with no report to go to.",
  },
  {
    id: "production_entries",
    label: "Production entries",
    module: "production",
    factKinds: [],
    table: "production_entries",
    itemColumn: null,
    qtyColumn: "good_qty",
    dateColumn: "entry_date",
    postsToLedger: false,
    status: "gap",
    note:
      "Garment piece counts only — no item_id, no material consumption, no ledger " +
      "posting. Actual consumption against a production order cannot be reported.",
  },
  {
    id: "despatches",
    label: "Despatches",
    module: "logistics",
    factKinds: [],
    table: "despatches",
    itemColumn: null,
    qtyColumn: null,
    dateColumn: "despatch_date",
    postsToLedger: false,
    status: "gap",
    note: "No line items and no item_id; finished goods never leave stock.",
  },
  {
    id: "packing_lists",
    label: "Packing lists",
    module: "logistics",
    factKinds: [],
    table: "packing_list_lines",
    itemColumn: null,
    qtyColumn: "quantity",
    dateColumn: null,
    postsToLedger: false,
    status: "gap",
    note: "Carton/colour/size only — no item_id.",
  },
  {
    id: "shipment_lines",
    label: "Shipment lines",
    module: "logistics",
    factKinds: [],
    table: "shipment_lines",
    itemColumn: null,
    qtyColumn: "quantity",
    dateColumn: null,
    postsToLedger: false,
    status: "gap",
    note: "description is free text — no item_id, no uom_id.",
  },
  {
    id: "purchase_indent_lines",
    label: "Purchase indents",
    module: "materials_purchase",
    factKinds: [],
    table: "purchase_indent_lines",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: "purchase_indents.required_date",
    postsToLedger: false,
    status: "gap",
    note:
      "Has item_id + quantity and could be reported as demand-before-PO, but is " +
      "not in the fact union yet. Add an 'indented' fact_kind to surface " +
      "indent → PO → GRN conversion.",
  },
  {
    id: "rfq_lines",
    label: "RFQ lines",
    module: "materials_purchase",
    factKinds: [],
    table: "rfq_lines",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: null,
    postsToLedger: false,
    status: "gap",
    note: "Enquiry demand. Has item_id + quantity; not in the fact union yet.",
  },

  // ---- Flagged by the audit heuristic, but not transactions ----
  {
    id: "stock_balances",
    label: "Stock balances (cache)",
    module: "stores",
    factKinds: [],
    table: "stock_balances",
    itemColumn: "item_id",
    qtyColumn: "quantity",
    dateColumn: null,
    postsToLedger: false,
    status: "not_movement",
    note:
      "A trigger-maintained cache of the CURRENT balance, derived from " +
      "stock_ledger. Holds no history — use report_item_stock_as_of() instead.",
  },
  {
    id: "material_uom_conversions",
    label: "Alternative UOM conversions",
    module: "masters",
    factKinds: [],
    table: "material_uom_conversions",
    itemColumn: "item_id",
    qtyColumn: "alt_qty",
    dateColumn: null,
    postsToLedger: false,
    status: "not_movement",
    note: "Master data: conversion factors between units, not a movement.",
  },
  {
    id: "ioc_cons_details",
    label: "IOC costing consumption",
    module: "orders",
    factKinds: [],
    table: "ioc_cons_details",
    itemColumn: null,
    qtyColumn: "cons_qty",
    dateColumn: null,
    postsToLedger: false,
    status: "not_movement",
    note:
      "Costing-sheet consumption estimates. item_description is free text — " +
      "there is no item_id, and nothing here is a posting.",
  },
];

export function sourcesByStatus(status: SourceStatus): ReportSource[] {
  return REPORT_SOURCES.filter((s) => s.status === status);
}
