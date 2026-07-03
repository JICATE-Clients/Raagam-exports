import type { ZodTypeAny } from "zod";
import type { Module } from "@/lib/auth/types";
import { buyerInput, itemInput, uomInput } from "@/lib/masters/types";
import {
  transporterInput,
  gstRateInput,
  currencyInput,
} from "@/lib/masters/extras-types";
import { vendorInput, VENDOR_TYPES } from "@/lib/purchase/types";
import {
  workerInput,
  staffInput,
  contractorInput,
  WORKER_TYPES,
} from "@/lib/hr/types";
import { taActivityInput } from "@/lib/orders/ta-activities/types";
import { workTypeInput, sewingOperationInput } from "@/lib/production/extras-types";
import { categoryInput } from "@/lib/logistics/export-categories/types";
import { glAccountInput, ACCOUNT_TYPES } from "@/lib/finance/types";
import { groupInput, centreInput } from "@/lib/finance/cost-centres/types";
import { costHeadInput, costItemInput } from "@/lib/finance/cost-heads/types";
import { courierInput } from "@/lib/admin/extras-types";

/**
 * Data Import/Export engine — one descriptor per importable/exportable entity.
 *
 * A descriptor is the single source of truth for: the Excel/CSV column layout
 * (import template + export headers), how each cell is coerced+validated (via
 * `kind` + the reused Zod `schema`), which table/module/permission it maps to,
 * and whether re-import upserts on a user-supplied `code` or inserts fresh.
 */

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "uuid"
  | "date"
  | "enum";

export interface IoField {
  /** DB column name (also the object key after coercion). */
  key: string;
  /** Spreadsheet column header. */
  header: string;
  kind: FieldKind;
  /** Shown in the template so users know which columns must be filled. */
  required?: boolean;
  /** Allowed values for `kind: "enum"`. */
  enumValues?: readonly string[];
}

export interface IoEntity {
  /** URL-safe id used by the toolbar + server actions (e.g. "buyers"). */
  key: string;
  /** Human label ("Customers"). */
  label: string;
  /** Supabase table. */
  table: string;
  /** Module permission root — note `materials_purchase`/`hr_payroll`, not purchase/hr. */
  module: Module;
  /** Paths to `revalidatePath` after a bulk write. */
  revalidate: string[];
  /**
   * Reused create-form Zod schema — the authoritative row validator.
   * Omit for `exportOnly` entities (transactional documents that can be
   * exported for reporting but not bulk-imported).
   */
  schema?: ZodTypeAny;
  /**
   * Column map driving template, parse and export. May be empty (`[]`) for an
   * `exportOnly` entity — export then auto-derives readable columns from the
   * row keys (see `lib/data-io/export.ts`).
   */
  fields: IoField[];
  /**
   * Unique column to upsert on (only where the user supplies `code`).
   * Omit ⇒ insert-only (entities whose `code` is DB-generated, e.g. vendors).
   */
  upsertConflict?: string;
  /**
   * Export only — no import, no bulk-delete. For posted transactional
   * documents (orders, invoices, journals…) where bulk write/delete is unsafe
   * and rows carry line-item children the flat engine can't represent.
   */
  exportOnly?: boolean;
}

const IS_ACTIVE: IoField = { key: "is_active", header: "Active", kind: "boolean" };

/**
 * Export-only entities — transactional documents. Exported for reporting/backup
 * but never bulk-imported (they carry line-item children) or bulk-deleted (they
 * are posted records). `fields: []` ⇒ export auto-derives readable columns from
 * the row keys. `table` is unused (no server import/delete runs for these).
 * Tuple: [key, label, table, module, route].
 */
const EXPORT_ONLY: [string, string, string, Module, string][] = [
  // orders
  ["order_advised_items", "Advised Items", "order_advised_items", "orders", "/orders/advised-items"],
  // planning
  ["bom_amendments", "BOM Amendments", "bom_amendments", "planning", "/planning/bom-amendments"],
  ["budget_amendments", "Budget Amendments", "budget_amendments", "planning", "/planning/budget-amendments"],
  ["material_excess", "Material Excess", "material_excess", "planning", "/planning/material-excess"],
  ["ppm_issues", "PPM Issues", "ppm_issues", "planning", "/planning/ppm"],
  ["process_allocations", "Process Allocations", "process_allocations", "planning", "/planning/process-allocations"],
  ["pd_requests", "Product Development", "pd_requests", "planning", "/planning/product-dev"],
  ["shipment_plans", "Shipment Plans", "shipment_plans", "planning", "/planning/shipment-plans"],
  ["material_shortages", "Material Shortages", "material_shortages", "planning", "/planning/shortages"],
  ["sq_notes", "SQ Notes", "sq_notes", "planning", "/planning/sq-notes"],
  ["stock_completions", "Stock Completion", "stock_completions", "planning", "/planning/stock-completion"],
  // purchase
  ["purchase_indents", "Purchase Indents", "purchase_indents", "materials_purchase", "/purchase/indents"],
  ["over_budget_confirmations", "Over-budget Confirmations", "over_budget_confirmations", "materials_purchase", "/purchase/over-budget"],
  ["po_rate_amendments", "PO Rate Amendments", "po_rate_amendments", "materials_purchase", "/purchase/rate-amendments"],
  ["po_cancellations", "PO Cancellations", "po_cancellations", "materials_purchase", "/purchase/po-cancellations"],
  ["lab_tests", "Lab Tests", "lab_tests", "materials_purchase", "/purchase/lab"],
  // stores
  ["material_requisitions", "Material Requisitions", "material_requisitions", "stores", "/stores/requisitions"],
  ["vendor_returns", "Vendor Returns", "vendor_returns", "stores", "/stores/vendor-returns"],
  ["opening_stocks", "Opening Stock", "opening_stocks", "stores", "/stores/opening-stock"],
  ["csp_receipts", "CSP Receipts", "csp_receipts", "stores", "/stores/csp-receipts"],
  // production
  ["production_job_orders", "Job Orders", "production_job_orders", "production", "/production/job-orders"],
  ["contractor_piece_rates", "Piece Rates", "contractor_piece_rates", "production", "/production/piece-rates"],
  ["packing_lists", "Packing Lists", "packing_lists", "production", "/production/packing-lists"],
  ["inspections", "Inspections", "inspections", "production", "/production/inspections"],
  ["despatches", "Despatch", "despatches", "production", "/production/despatch"],
  // process
  ["knitting_programs", "Knitting Programs", "knitting_programs", "process_planning", "/process/knitting"],
  ["process_rate_amendments", "Process Rate Amendments", "process_rate_amendments", "process_planning", "/process/rate-amendments"],
  // hr transactions
  ["hr_advances", "Advances", "hr_advances", "hr_payroll", "/hr/advances"],
  ["hr_adjustments", "Allowances & Deductions", "hr_adjustments", "hr_payroll", "/hr/adjustments"],
  ["hr_comp_events", "Bonus & Increments", "hr_comp_events", "hr_payroll", "/hr/comp-events"],
  ["hr_leaves", "Leave & Encashment", "hr_leaves", "hr_payroll", "/hr/leave"],
  ["hr_lifecycle_events", "Lifecycle", "hr_lifecycle_events", "hr_payroll", "/hr/lifecycle"],
  ["worker_piece_records", "Piece Records", "worker_piece_records", "hr_payroll", "/hr/piece-records"],
  ["hr_statutory_docs", "Statutory Docs", "hr_statutory_docs", "hr_payroll", "/hr/statutory"],
  // logistics
  ["order_category_assignments", "Order Category Assignments", "order_category_assignments", "logistics", "/logistics/order-categories"],
  ["epcg_declarations", "EPCG Declarations", "epcg_declarations", "logistics", "/logistics/epcg"],
  ["export_incentive_files", "Export Incentives", "export_incentive_files", "logistics", "/logistics/incentives"],
  // finance documents
  ["exchange_rate_details", "Exchange Rates", "exchange_rate_details", "finance", "/finance/exchange-rates"],
  ["bank_limits", "Bank Limits", "bank_limits", "finance", "/finance/bank-limits"],
  ["bank_journals", "Bank Journals", "bank_journals", "finance", "/finance/bank-journals"],
  ["cheques", "Cheque Register", "cheques", "finance", "/finance/cheques"],
  ["domestic_garment_invoices", "Domestic Invoices", "domestic_garment_invoices", "finance", "/finance/domestic-invoices"],
  ["provisional_invoices", "Provisional Invoices", "provisional_invoices", "finance", "/finance/provisional-invoices"],
  ["forward_contracts", "Forward Contracts", "forward_contracts", "finance", "/finance/forward-contracts"],
  ["finance_notes", "Debit / Credit Notes", "finance_notes", "finance", "/finance/notes"],
  ["other_income_expenses", "Other Income / Expense", "other_income_expenses", "finance", "/finance/other-entries"],
  ["party_openings", "Party Openings", "party_openings", "finance", "/finance/party-openings"],
  // admin
  ["assets", "Assets", "assets", "system_admin", "/admin/assets"],
];

export const IO_ENTITIES: IoEntity[] = [
  {
    key: "buyers",
    label: "Customers",
    table: "buyers",
    module: "masters",
    revalidate: ["/masters"],
    schema: buyerInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "country", header: "Country", kind: "string" },
      { key: "currency_code", header: "Currency", kind: "string" },
      { key: "contact_email", header: "Email", kind: "string" },
      { key: "contact_phone", header: "Phone", kind: "string" },
      { key: "address", header: "Address", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "items",
    label: "Products",
    table: "items",
    module: "masters",
    revalidate: ["/masters"],
    schema: itemInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "category", header: "Category", kind: "string" },
      { key: "uom_id", header: "UOM Id", kind: "uuid" },
      IS_ACTIVE,
    ],
  },
  {
    key: "uoms",
    label: "Units of Measure",
    table: "uoms",
    module: "masters",
    revalidate: ["/masters"],
    schema: uomInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      IS_ACTIVE,
    ],
  },
  {
    key: "vendors",
    label: "Vendors",
    table: "vendors",
    module: "materials_purchase",
    revalidate: ["/purchase/vendors"],
    schema: vendorInput,
    // Vendor `code` is DB-generated → insert-only (no upsert key).
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      {
        key: "vendor_type",
        header: "Type",
        kind: "enum",
        enumValues: VENDOR_TYPES,
      },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "email", header: "Email", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      { key: "gst_number", header: "GST Number", kind: "string" },
      { key: "address", header: "Address", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "workers",
    label: "Workers",
    table: "workers",
    module: "hr_payroll",
    revalidate: ["/hr/workers"],
    schema: workerInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      {
        key: "worker_type",
        header: "Worker Type",
        kind: "enum",
        required: true,
        enumValues: WORKER_TYPES,
      },
      { key: "biometric_id", header: "Biometric Id", kind: "string" },
      { key: "shift_wage_per_day", header: "Shift Wage/Day", kind: "number" },
      { key: "hourly_wage", header: "Hourly Wage", kind: "number" },
      { key: "piece_rate", header: "Piece Rate", kind: "number" },
      { key: "esi_applicable", header: "ESI Applicable", kind: "boolean" },
      { key: "pf_applicable", header: "PF Applicable", kind: "boolean" },
      { key: "joined_date", header: "Joined Date", kind: "date" },
      IS_ACTIVE,
    ],
  },
  {
    key: "staff",
    label: "Staff",
    table: "staff",
    module: "hr_payroll",
    revalidate: ["/hr/staff"],
    schema: staffInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "designation", header: "Designation", kind: "string" },
      { key: "monthly_salary", header: "Monthly Salary", kind: "number" },
      { key: "esi_applicable", header: "ESI Applicable", kind: "boolean" },
      { key: "pf_applicable", header: "PF Applicable", kind: "boolean" },
      { key: "joined_date", header: "Joined Date", kind: "date" },
      IS_ACTIVE,
    ],
  },
  {
    key: "contractors",
    label: "Contractors",
    table: "contractors",
    module: "hr_payroll",
    revalidate: ["/hr/contractors"],
    schema: contractorInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      IS_ACTIVE,
    ],
  },

  // ── Masters config ────────────────────────────────────────────────────────
  {
    key: "transporters",
    label: "Transporters",
    table: "transporters",
    module: "masters",
    revalidate: ["/masters"],
    schema: transporterInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "gst_rates",
    label: "GST Rates",
    table: "gst_rates",
    module: "masters",
    revalidate: ["/masters"],
    schema: gstRateInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "rate_pct", header: "Rate %", kind: "number" },
      { key: "hsn_code", header: "HSN Code", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "currencies",
    label: "Currencies",
    table: "currencies",
    module: "masters",
    revalidate: ["/masters"],
    schema: currencyInput,
    upsertConflict: "code",
    // `currencies` has no is_active column → import/export only, no bulk-delete.
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "symbol", header: "Symbol", kind: "string" },
    ],
  },

  // ── Orders masters ────────────────────────────────────────────────────────
  {
    key: "ta_activities",
    label: "T&A Activities",
    table: "ta_activities",
    module: "orders",
    revalidate: ["/orders/ta-masters"],
    schema: taActivityInput,
    fields: [
      { key: "short_name", header: "Short Name", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "department", header: "Department", kind: "string" },
      { key: "sequence", header: "Sequence", kind: "number" },
      { key: "default_offset_days", header: "Offset Days", kind: "number" },
      IS_ACTIVE,
    ],
  },

  // ── Production masters ────────────────────────────────────────────────────
  {
    key: "work_types",
    label: "Work Types",
    table: "work_types",
    module: "production",
    revalidate: ["/production/masters"],
    schema: workTypeInput,
    fields: [
      { key: "stage", header: "Stage", kind: "string" },
      { key: "short_name", header: "Short Name", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      IS_ACTIVE,
    ],
  },
  {
    key: "sewing_operations",
    label: "Sewing Operations",
    table: "sewing_operations",
    module: "production",
    revalidate: ["/production/masters"],
    schema: sewingOperationInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "smv", header: "SMV", kind: "number" },
      { key: "notes", header: "Notes", kind: "string" },
      IS_ACTIVE,
    ],
  },

  // ── Logistics masters ─────────────────────────────────────────────────────
  {
    key: "export_categories",
    label: "Export Categories",
    table: "export_categories",
    module: "logistics",
    revalidate: ["/logistics/export-categories"],
    schema: categoryInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "description", header: "Description", kind: "string" },
      IS_ACTIVE,
    ],
  },

  // ── Finance masters ───────────────────────────────────────────────────────
  {
    key: "gl_accounts",
    label: "Chart of Accounts",
    table: "gl_accounts",
    module: "finance",
    revalidate: ["/finance/accounts"],
    schema: glAccountInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      {
        key: "account_type",
        header: "Account Type",
        kind: "enum",
        required: true,
        enumValues: ACCOUNT_TYPES,
      },
      IS_ACTIVE,
    ],
  },
  {
    key: "cost_centre_groups",
    label: "Cost Centre Groups",
    table: "cost_centre_groups",
    module: "finance",
    revalidate: ["/finance/cost-centres"],
    schema: groupInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      IS_ACTIVE,
    ],
  },
  {
    key: "cost_centres",
    label: "Cost Centres",
    table: "cost_centres",
    module: "finance",
    revalidate: ["/finance/cost-centres"],
    schema: centreInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "group_id", header: "Group Id", kind: "uuid" },
      IS_ACTIVE,
    ],
  },
  {
    key: "cost_heads",
    label: "Cost Heads",
    table: "cost_heads",
    module: "finance",
    revalidate: ["/finance/cost-heads"],
    schema: costHeadInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "category", header: "Category", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "cost_items",
    label: "Cost Items",
    table: "cost_items",
    module: "finance",
    revalidate: ["/finance/cost-heads"],
    schema: costItemInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "cost_head_id", header: "Cost Head Id", kind: "uuid" },
      IS_ACTIVE,
    ],
  },

  // ── Admin masters ─────────────────────────────────────────────────────────
  {
    key: "couriers",
    label: "Couriers",
    table: "couriers",
    module: "system_admin",
    revalidate: ["/admin/couriers"],
    schema: courierInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      IS_ACTIVE,
    ],
  },

  // ── Export-only transactional documents (generated) ───────────────────────
  ...EXPORT_ONLY.map(
    ([key, label, table, module, route]): IoEntity => ({
      key,
      label,
      table,
      module,
      revalidate: [route],
      exportOnly: true,
      fields: [],
    }),
  ),
];

/** Look up a descriptor by its `key`. */
export function getIoEntity(key: string): IoEntity | undefined {
  return IO_ENTITIES.find((e) => e.key === key);
}
