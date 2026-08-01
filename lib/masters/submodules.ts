import { MATERIALS_CHILDREN } from "./registry";

/**
 * Master Data top level — the 6 legacy EDP2 "Configure" submodules and, for the
 * five non-Materials areas, their child masters.
 *
 * Materials owns a dedicated route (`/masters/materials`, richer — Attributes is
 * master-detail) so its children live in `registry.ts`. The other five render
 * through the generic `/masters/[submodule]` hub + `[entity]` resolver:
 *   - `link` children point at an existing editor (legacy `?tab=`) or another
 *     module, and simply redirect.
 *   - `todo` children aren't built yet and show a placeholder.
 */
export type SubChild =
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "link";
      href: string;
      external?: boolean; // owned by another module (shown with ↗)
    }
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "todo";
    }
  | {
      slug: string;
      label: string;
      singular: string;
      description: string;
      type: "custom"; // rich master with its own table + dedicated screen
      custom: string; // dispatch key for /masters/[submodule]/[entity]
    };

export type SubmoduleDef = {
  slug: string;
  label: string;
  description: string;
  status: "ready" | "provisional";
  note?: string;
  children: SubChild[]; // empty for Materials (handled by its own route)
};

export const SUBMODULES: SubmoduleDef[] = [
  {
    slug: "materials",
    label: "Materials",
    description: "Yarn, fabric, trim & specification masters",
    status: "ready",
    children: [],
  },
  {
    slug: "associates",
    label: "Associates",
    description: "Trading partners, parties, banks & accounts",
    status: "ready",
    children: [
      { slug: "country", label: "Country", singular: "Country", description: "Country master", type: "custom", custom: "country" },
      { slug: "port", label: "Port", singular: "Port", description: "Shipping ports", type: "custom", custom: "port" },
      { slug: "destination", label: "Destination", singular: "Destination", description: "Shipment destinations", type: "custom", custom: "destination" },
      { slug: "bank", label: "Bank", singular: "Bank", description: "Bank master", type: "custom", custom: "bank" },
      { slug: "applicant", label: "Applicant", singular: "Applicant", description: "LC / document applicants", type: "custom", custom: "applicant" },
      { slug: "receivable-term", label: "Receivable Term", singular: "Receivable Term", description: "Receivable terms", type: "custom", custom: "receivable_term" },
      { slug: "customer", label: "Customer", singular: "Customer", description: "Customer / buyer master", type: "custom", custom: "customer" },
      { slug: "notify", label: "Notify", singular: "Notify Party", description: "Export notify parties", type: "custom", custom: "notify" },
      { slug: "consignee", label: "Consignee", singular: "Consignee", description: "Export consignees", type: "custom", custom: "consignee" },
      { slug: "payment-term", label: "Payment Term", singular: "Payment Term", description: "Payment terms", type: "custom", custom: "payment_term" },
      { slug: "vendor", label: "Vendor", singular: "Vendor", description: "Suppliers / vendors", type: "custom", custom: "vendor" },
      // A test bench, not a master: type a GSTIN and every detail the system can
      // derive is listed, including the ones it CANNOT (those need the paid
      // lookup). Saves nothing, owns no table.
      { slug: "gst-number-check", label: "GST Number Check", singular: "GST Number Check", description: "Test what a GST number reveals — no data is saved", type: "custom", custom: "gstin_check" },
      { slug: "our-banks", label: "Our Banks", singular: "Our Bank", description: "Company's own bank accounts", type: "custom", custom: "our_bank" },
      { slug: "zones", label: "Zones", singular: "Zone", description: "Sales territory zones", type: "custom", custom: "zone" },
      // ----------------------------------------------------------------------
      // REMOVED 2026-08-01 (client): Employee, Account Group, Account Head,
      // Merchandising Team, Courier Delivery Address, TCS Assign to Customers,
      // GST Assign to Vendors, GST Assign to Customers, Certifications and
      // Default Account Head are not part of this business process. Screens,
      // services, actions and types are gone; their TABLES were deliberately
      // KEPT, so the rows survive and the masters can be restored from git if
      // the decision reverses. Do not re-add one of these without asking.
      // ----------------------------------------------------------------------
    ],
  },
  {
    slug: "hr",
    label: "HR",
    description: "Designations, departments & classifications",
    status: "ready",
    note: "Legacy Configure ▸ HR — the 12 children in legacy order. Each is a placeholder until its form is built from the legacy screenshot.",
    children: [
      { slug: "allowance", label: "Allowance", singular: "Allowance", description: "Salary allowance types", type: "custom", custom: "allowance" },
      { slug: "deduction", label: "Deduction", singular: "Deduction", description: "Salary deduction types", type: "custom", custom: "deduction" },
      { slug: "hostel-category", label: "Hostel Category", singular: "Hostel Category", description: "Hostel categories", type: "custom", custom: "hostel_category" },
      { slug: "holiday", label: "Holiday", singular: "Holiday", description: "Holiday calendar", type: "custom", custom: "holiday" },
      { slug: "work-timing", label: "Work Timing", singular: "Work Timing", description: "Work timing definitions", type: "custom", custom: "work_timing" },
      { slug: "working-hour", label: "Working Hour", singular: "Working Hour", description: "Working-hour rules", type: "custom", custom: "working_hour" },
      { slug: "leave-type", label: "Leave Type", singular: "Leave Type", description: "Leave types", type: "custom", custom: "leave_type" },
      { slug: "advance-loan-type", label: "Advance and Loan Type", singular: "Advance / Loan Type", description: "Advance & loan types", type: "custom", custom: "advance_loan_type" },
      { slug: "department", label: "Department", singular: "Department", description: "Org departments", type: "custom", custom: "department" },
      { slug: "designation", label: "Designation", singular: "Designation", description: "Job titles / designations", type: "custom", custom: "designation" },
      { slug: "employee-category", label: "Employee Category", singular: "Employee Category", description: "Employee categories", type: "custom", custom: "employee_category" },
      { slug: "pf-esi-control", label: "PF ESI Control", singular: "PF / ESI Control", description: "PF & ESI configuration", type: "custom", custom: "pf_esi_control" },
    ],
  },
  {
    slug: "currencies",
    label: "Currencies",
    description: "Currency master & FX",
    status: "ready",
    note: "Legacy Configure ▸ Currency — the currency master plus three exchange-rate registers (Quotes/Orders, Customs, Imports). Currency is built; the rate registers are placeholders until each legacy screen is captured.",
    children: [
      { slug: "currency", label: "Currency", singular: "Currency", description: "Code · name · symbol", type: "custom", custom: "currency" },
      { slug: "exchange-rate-quotes-orders", label: "Exchange rate (Quotes / Orders)", singular: "Exchange Rate (Quotes / Orders)", description: "FX rates used on quotations & orders", type: "custom", custom: "exchange_rate_quotes_orders" },
      { slug: "exchange-rate-customs", label: "Exchange rate (Customs)", singular: "Exchange Rate (Customs)", description: "Customs notified FX rates", type: "custom", custom: "exchange_rate_customs" },
      { slug: "exchange-rate-imports", label: "Exchange rate (Imports)", singular: "Exchange Rate (Imports)", description: "FX rates used on imports", type: "custom", custom: "exchange_rate_imports" },
    ],
  },
  {
    slug: "gst",
    label: "GST",
    description: "State codes, HSN classification & GST/HSN assignment",
    status: "ready",
    note: "Legacy Configure ▸ GST — State + HSN detail are masters; the two HSN Assign screens are bulk grids that set hsn_id on materials / processes. (Old provisional GST Rate / Tax Type entries dropped — GST rate likely rides on HSN detail. The two GST No Assign children were removed with the Associates screens they opened, 2026-08-01: a vendor's or customer's GSTIN is now set on that party's own master.)",
    children: [
      { slug: "state", label: "State", singular: "State", description: "GST state codes", type: "custom", custom: "gst_state" },
      { slug: "hsn-detail", label: "HSN detail", singular: "HSN Detail", description: "HSN master (code · description · GST rate)", type: "custom", custom: "hsn_detail" },
      { slug: "hsn-assign-material", label: "HSN Assign to Material", singular: "HSN Assignment (Material)", description: "Bulk-assign HSN codes to materials", type: "custom", custom: "hsn_assign_material" },
      { slug: "hsn-assign-process", label: "HSN Assign to Process", singular: "HSN Assignment (Process)", description: "Bulk-assign HSN codes to sub-contract processes", type: "custom", custom: "hsn_assign_process" },
    ],
  },
];

// --------------------------------------------------------------------------
// NOTE: The legacy "System" submodule has been dissolved (2026-07-18).
// - Divisions, Document No Format → /admin
// - Garment Rejection Rule → /masters/materials
// - All TODO items (Company, Updation utilities, Tally, Assign screens,
//   PO Completion, Excess tolerances, etc.) → /admin
// - User → already at /admin/users (duplicate removed)
// See project_gap_analysis memory for the full redistribution rationale.
// --------------------------------------------------------------------------

export function submoduleChildCount(s: SubmoduleDef): number {
  return s.slug === "materials" ? MATERIALS_CHILDREN.length : s.children.length;
}
export function findSubmodule(slug: string): SubmoduleDef | undefined {
  return SUBMODULES.find((s) => s.slug === slug);
}
export function findSubChild(sub: SubmoduleDef, slug: string): SubChild | undefined {
  return sub.children.find((c) => c.slug === slug);
}
