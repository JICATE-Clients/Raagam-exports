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
    note: "Legacy Configure ▸ Associates — the 17 children in legacy order. Each is a placeholder until its form is built from the legacy screenshot; some (Customer, Vendor, Employee, Account Head) may map to existing buyers/vendors/staff/gl_accounts tables — backing to be confirmed per child.",
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
      { slug: "employee", label: "Employee", singular: "Employee", description: "Employee master", type: "custom", custom: "employee" },
      { slug: "account-group", label: "Account Group", singular: "Account Group", description: "Chart-of-accounts groups", type: "custom", custom: "account_group" },
      { slug: "account-head", label: "Account Head", singular: "Account Head", description: "Ledger account heads", type: "custom", custom: "account_head" },
      { slug: "merchandising-team", label: "Merchandising Team", singular: "Merchandising Team", description: "Merchandising teams", type: "custom", custom: "merchandising_team" },
      { slug: "courier-delivery-address", label: "Courier Delivery Address", singular: "Courier Delivery Address", description: "Courier delivery addresses", type: "custom", custom: "courier_delivery_address" },
      { slug: "tcs-assign-to-customers", label: "TCS Assign to Customers", singular: "TCS Assignment", description: "TCS assignment to customers", type: "custom", custom: "tcs_assign" },
      { slug: "gst-assign-to-vendors", label: "GST Assign to Vendors", singular: "GST Assignment", description: "Bulk-assign GST Type & GSTIN to vendors", type: "custom", custom: "gst_assign" },
      { slug: "gst-assign-to-customers", label: "GST Assign to Customers", singular: "Customer GST Assignment", description: "Bulk-assign GSTIN to customers", type: "custom", custom: "customer_gst_assign" },
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
    note: "Legacy Configure ▸ GST — the 6 children in legacy order (screenshot). State + HSN detail are masters; the four Assign screens are bulk grids (like TCS Assign to Customers) that set gst_no / hsn_id on vendors / customers / materials / processes. (Old provisional GST Rate / Tax Type entries dropped — GST rate likely rides on HSN detail.)",
    children: [
      { slug: "state", label: "State", singular: "State", description: "GST state codes", type: "custom", custom: "gst_state" },
      { slug: "hsn-detail", label: "HSN detail", singular: "HSN Detail", description: "HSN master (code · description · GST rate)", type: "custom", custom: "hsn_detail" },
      { slug: "gst-no-assign-vendor", label: "GST No Assign to Vendor", singular: "GST No Assignment (Vendor)", description: "Assign GST numbers to vendors", type: "todo" },
      { slug: "gst-no-assign-customer", label: "GST No Assign to Customer", singular: "GST No Assignment (Customer)", description: "Assign GST numbers to customers", type: "todo" },
      { slug: "hsn-assign-material", label: "HSN Assign to Material", singular: "HSN Assignment (Material)", description: "Assign HSN codes to materials", type: "todo" },
      { slug: "hsn-assign-process", label: "HSN Assign to Process", singular: "HSN Assignment (Process)", description: "Assign HSN codes to processes", type: "todo" },
    ],
  },
  {
    slug: "system",
    label: "System",
    description: "Config, bulk-assign grids & data-maintenance utilities",
    status: "provisional",
    note: "Legacy Configure ▸ System — the children in legacy order (screenshots _161417 + _161547; list may be incomplete mid-scroll between 'Completion' and 'Assign Coordinator Type'). System is a maintenance/admin grab-bag, NOT a clean master set. Roughly: config masters (Document No format · Menu group · User · Company Detail · User defined stock · Garment rejection rule · Document Copy Name); BULK-ASSIGN grids (Cost Centre Assign · Department assign · Assign Coordinator Type / Fabric / Cutting Coordinators — clone the TCS-assign pattern); one-off DATA-MAINTENANCE 'Updation' utilities (BOMs / Original BOMs / BOM Amendments / Transaction Garments/Rates / Actual Cost / Document No / Cost Centre / Finance / Account Group / Ledger Updation — recompute/migrate data, likely admin tools not masters); workflow utilities (PO Completion Control / PO Completion / Completion / Excess Order and Receipt / Reset No of Copies Printed); Tally integration (Tally Porting · Tally Master Import). Several (User · Company Detail · Menu group) likely already live in Administration. Confirm per child which become real Master Data screens vs. live in Administration/Finance.",
    children: [
      { slug: "document-no-format", label: "Document No format", singular: "Document No Format", description: "Document numbering formats", type: "custom", custom: "document_no_format" },
      { slug: "garment-rejection-rule", label: "Garment rejection rule", singular: "Garment Rejection Rule", description: "Garment rejection rules", type: "custom", custom: "garment_rejection_rule" },
      { slug: "excess-order-and-receipt", label: "Excess Order and Receipt", singular: "Excess Order / Receipt", description: "Excess order & receipt tolerances", type: "todo" },
      { slug: "cost-centre-assign", label: "Cost Centre Assign", singular: "Cost Centre Assignment", description: "Assign cost centres", type: "todo" },
      { slug: "department-assign", label: "Department assign", singular: "Department Assignment", description: "Assign departments", type: "todo" },
      { slug: "menu-group", label: "Menu group", singular: "Menu Group", description: "Menu / permission groups", type: "todo" },
      { slug: "user", label: "User", singular: "User", description: "Application users", type: "todo" },
      { slug: "user-defined-stock", label: "User defined stock", singular: "User Defined Stock", description: "User-defined stock config", type: "todo" },
      { slug: "company-detail", label: "Company Detail", singular: "Company Detail", description: "Legal entity profile", type: "todo" },
      { slug: "boms-updation", label: "BOMs Updation", singular: "BOMs Updation", description: "Recompute BOMs (maintenance)", type: "todo" },
      { slug: "boms-updation-garment", label: "BOMs Updation (Garment)", singular: "BOMs Updation (Garment)", description: "Recompute garment BOMs (maintenance)", type: "todo" },
      { slug: "original-boms-updation", label: "Original BOMs Updation", singular: "Original BOMs Updation", description: "Recompute original BOMs (maintenance)", type: "todo" },
      { slug: "bom-amendments-updation", label: "BOM Amendments Updation", singular: "BOM Amendments Updation", description: "Recompute BOM amendments (maintenance)", type: "todo" },
      { slug: "transaction-updation-garments", label: "Transaction Updation (Garments)", singular: "Transaction Updation (Garments)", description: "Recompute garment transactions (maintenance)", type: "todo" },
      { slug: "transaction-updation-rates", label: "Transaction Updation (Rates)", singular: "Transaction Updation (Rates)", description: "Recompute transaction rates (maintenance)", type: "todo" },
      { slug: "actual-cost-updation", label: "Actual Cost Updation", singular: "Actual Cost Updation", description: "Recompute actual cost (maintenance)", type: "todo" },
      { slug: "document-no-updation", label: "Document No Updation", singular: "Document No Updation", description: "Recompute document numbers (maintenance)", type: "todo" },
      { slug: "cost-centre-updation", label: "Cost Centre Updation", singular: "Cost Centre Updation", description: "Recompute cost centres (maintenance)", type: "todo" },
      { slug: "finance-updation", label: "Finance Updation", singular: "Finance Updation", description: "Recompute finance (maintenance)", type: "todo" },
      { slug: "account-group-updation", label: "Account Group Updation", singular: "Account Group Updation", description: "Recompute account groups (maintenance)", type: "todo" },
      { slug: "ledger-updation", label: "Ledger Updation", singular: "Ledger Updation", description: "Recompute ledgers (maintenance)", type: "todo" },
      { slug: "reset-copies-printed", label: "Reset No of Copies Printed", singular: "Reset Copies Printed", description: "Reset printed-copy counters (maintenance)", type: "todo" },
      { slug: "document-copy-name", label: "Document Copy Name", singular: "Document Copy Name", description: "Document copy labels", type: "todo" },
      { slug: "po-completion-control", label: "PO Completion Control", singular: "PO Completion Control", description: "PO completion control", type: "todo" },
      { slug: "po-completion", label: "PO Completion", singular: "PO Completion", description: "Close completed POs (maintenance)", type: "todo" },
      { slug: "completion", label: "Completion", singular: "Completion", description: "Completion maintenance", type: "todo" },
      { slug: "assign-coordinator-type", label: "Assign Coordinator Type", singular: "Coordinator Type Assignment", description: "Assign coordinator types", type: "todo" },
      { slug: "assign-fabric-coordinators", label: "Assign Fabric Coordinators", singular: "Fabric Coordinator Assignment", description: "Assign fabric coordinators", type: "todo" },
      { slug: "assign-cutting-coordinators", label: "Assign Cutting Coordinators", singular: "Cutting Coordinator Assignment", description: "Assign cutting coordinators", type: "todo" },
      { slug: "tally-porting", label: "Tally Porting", singular: "Tally Porting", description: "Export data to Tally", type: "todo" },
      { slug: "tally-master-import", label: "Tally Master Import", singular: "Tally Master Import", description: "Import masters from Tally", type: "todo" },
    ],
  },
];

export function submoduleChildCount(s: SubmoduleDef): number {
  return s.slug === "materials" ? MATERIALS_CHILDREN.length : s.children.length;
}
export function findSubmodule(slug: string): SubmoduleDef | undefined {
  return SUBMODULES.find((s) => s.slug === slug);
}
export function findSubChild(sub: SubmoduleDef, slug: string): SubChild | undefined {
  return sub.children.find((c) => c.slug === slug);
}
