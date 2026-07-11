import {
  LayoutDashboard,
  ShoppingBag,
  ClipboardList,
  Layers,
  Package,
  Warehouse,
  Factory,
  Workflow,
  Users,
  Ship,
  Landmark,
  ArrowLeftRight,
  BarChart3,
  LineChart,
  Database,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { Module } from "@/lib/auth/types";

/** A sub-module link nested under a module. Inherits the parent's `module` permission. */
export interface SubNavItem {
  href: string;
  label: string;
}

export interface NavItem {
  href: string;
  label: string;
  module: Module;
  icon: LucideIcon;
  /** Sub-modules shown as an expandable tree under the module. */
  children?: SubNavItem[];
}

/**
 * Primary navigation. Items are filtered by `<module>:view` permission.
 * `children` are sub-modules of the same module (permission inherited) and only
 * ever point at real, navigable routes.
 */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", module: "dashboard", icon: LayoutDashboard },
  {
    href: "/sales",
    label: "Sales",
    module: "sales",
    icon: ShoppingBag,
    children: [
      { href: "/sales", label: "Opportunities / Pipeline" },
      { href: "/sales/styles", label: "Styles" },
      { href: "/sales/cost-sheets", label: "Cost Sheets" },
      { href: "/sales/quotes", label: "Quote Preparation" },
      { href: "/sales/quote-confirmations", label: "Confirm Quotes" },
      { href: "/sales/pd-requests", label: "PD Requests" },
      { href: "/sales/samples", label: "Samples" },
    ],
  },
  {
    href: "/orders",
    label: "Orders",
    module: "orders",
    icon: ClipboardList,
    children: [
      { href: "/orders", label: "All Orders" },
      { href: "/orders/styles", label: "Style" },
      { href: "/orders/material-bom", label: "Material BOM" },
      { href: "/orders/material-bom-amendment", label: "Material BOM Amendment" },
      { href: "/orders/color-cards", label: "Colour Cards" },
      { href: "/orders/garment-processes", label: "Garment Processes" },
      { href: "/orders/internal-work-orders", label: "Internal Work Orders" },
      { href: "/orders/amendments", label: "Order Amendment" },
      { href: "/orders/process-amendments", label: "Process Amendment" },
      { href: "/orders/approve-amendments", label: "Approve Amendment" },
      { href: "/orders/advised-items", label: "Advised Items" },
      { href: "/orders/packing-advice", label: "Packing List Advice" },
      { href: "/orders/cancellations", label: "Cancellation" },
      { href: "/orders/completions", label: "Completion" },
      { href: "/orders/ta-masters", label: "TA Activity" },
      { href: "/orders/ta-department-assign", label: "TA Department Assign" },
      { href: "/orders/ta-user-rights", label: "TA User Rights" },
      { href: "/orders/ta-style", label: "TA Style" },
      { href: "/orders/ta-plan", label: "TA Plan" },
      { href: "/orders/ta-followups", label: "TA Followups" },
      { href: "/orders/ta-completion", label: "TA Completion" },
    ],
  },
  {
    href: "/planning",
    label: "Planning",
    module: "planning",
    icon: Layers,
    children: [
      { href: "/planning/boms", label: "Bill of Materials" },
      { href: "/planning/budgets", label: "Budgets" },
      { href: "/planning/budget-amendments", label: "Budget Amendments" },
      { href: "/planning/bom-amendments", label: "BOM Amendments" },
      { href: "/planning/shortages", label: "Shortages" },
      { href: "/planning/shipment-plans", label: "Shipment Plans" },
      { href: "/planning/sq-notes", label: "SQ Notes" },
      { href: "/planning/iwo-boms", label: "IWO BOMs" },
      { href: "/planning/process-allocations", label: "Process Allocation" },
      { href: "/planning/material-excess", label: "Material Excess" },
      { href: "/planning/ppm", label: "Issue PPM" },
      { href: "/planning/stock-completion", label: "Stock Completion" },
      { href: "/planning/product-dev", label: "Product Development" },
    ],
  },
  {
    href: "/purchase",
    label: "Purchase",
    module: "materials_purchase",
    icon: Package,
    children: [
      { href: "/purchase/orders", label: "Purchase Orders" },
      { href: "/purchase/rfq", label: "RFQ" },
      { href: "/purchase/grn", label: "Goods Receipts" },
      { href: "/purchase/dc", label: "Delivery Challans" },
      { href: "/purchase/vendors", label: "Vendors" },
      { href: "/purchase/indents", label: "Indents" },
      { href: "/purchase/over-budget", label: "Over-budget Confirmation" },
      { href: "/purchase/rate-amendments", label: "Rate Amendments" },
      { href: "/purchase/po-cancellations", label: "Cancel PO" },
      { href: "/purchase/lab", label: "Lab / QC" },
    ],
  },
  {
    href: "/stores",
    label: "Stores",
    module: "stores",
    icon: Warehouse,
    children: [
      { href: "/stores/opening-stock", label: "Opening Stock" },
      { href: "/stores/requisitions", label: "Requisitions" },
      { href: "/stores/vendor-returns", label: "Vendor Returns" },
      { href: "/stores/csp-receipts", label: "CSP Receipts" },
    ],
  },
  {
    href: "/production",
    label: "Production",
    module: "production",
    icon: Factory,
    children: [
      { href: "/production", label: "Production Board" },
      { href: "/production/job-orders", label: "Job Orders" },
      { href: "/production/masters", label: "Planning Masters" },
      { href: "/production/piece-rates", label: "Piece Rates" },
      { href: "/production/packing-lists", label: "Packing Lists" },
      { href: "/production/inspections", label: "Inspections" },
      { href: "/production/despatch", label: "Despatch" },
    ],
  },
  {
    href: "/process",
    label: "Process Planning",
    module: "process_planning",
    icon: Workflow,
    children: [
      { href: "/process", label: "Process Jobs" },
      { href: "/process/knitting", label: "Knitting Programs" },
      { href: "/process/rfq", label: "Process RFQ" },
      { href: "/process/rate-amendments", label: "Rate Amendments" },
    ],
  },
  {
    href: "/hr",
    label: "HR & Payroll",
    module: "hr_payroll",
    icon: Users,
    children: [
      { href: "/hr/workers", label: "Workers" },
      { href: "/hr/staff", label: "Staff" },
      { href: "/hr/contractors", label: "Contractors" },
      { href: "/hr/attendance", label: "Attendance" },
      { href: "/hr/piece-records", label: "Piece Records" },
      { href: "/hr/payroll", label: "Payroll Runs" },
      { href: "/hr/payslip", label: "Payslips" },
      { href: "/hr/settings", label: "Settings" },
      { href: "/hr/advances", label: "Advances" },
      { href: "/hr/adjustments", label: "Allowances & Deductions" },
      { href: "/hr/comp-events", label: "Bonus & Increments" },
      { href: "/hr/leave", label: "Leave & Encashment" },
      { href: "/hr/lifecycle", label: "Lifecycle" },
      { href: "/hr/statutory", label: "Statutory Docs" },
    ],
  },
  {
    href: "/logistics",
    label: "Logistics",
    module: "logistics",
    icon: Ship,
    children: [
      { href: "/logistics", label: "Shipments" },
      { href: "/logistics/proforma", label: "Proforma Invoices" },
      { href: "/logistics/lc", label: "Letters of Credit" },
      { href: "/logistics/epcg", label: "EPCG Declarations" },
      { href: "/logistics/export-categories", label: "Export Categories" },
      { href: "/logistics/order-categories", label: "Order Category Assign" },
      { href: "/logistics/incentives", label: "Export Incentives" },
    ],
  },
  {
    href: "/finance",
    label: "Finance",
    module: "finance",
    icon: Landmark,
    children: [
      { href: "/finance/accounts", label: "Chart of Accounts" },
      { href: "/finance/cost-centres", label: "Cost Centres" },
      { href: "/finance/cost-heads", label: "Cost Heads & Items" },
      { href: "/finance/bank-limits", label: "Bank Limits" },
      { href: "/finance/payables", label: "Payables" },
      { href: "/finance/receivables", label: "Receivables" },
      { href: "/finance/ledger", label: "General Ledger" },
      { href: "/finance/notes", label: "Debit / Credit Notes" },
      { href: "/finance/cheques", label: "Cheque Register" },
      { href: "/finance/forward-contracts", label: "Forward Contracts" },
      { href: "/finance/other-entries", label: "Other Income / Expense" },
      { href: "/finance/party-openings", label: "Party Openings" },
      { href: "/finance/exchange-rates", label: "Exchange Rates" },
      { href: "/finance/provisional-invoices", label: "Provisional Invoices" },
      { href: "/finance/bank-journals", label: "Bank Journals" },
      { href: "/finance/domestic-invoices", label: "Domestic Invoices" },
      { href: "/finance/pnl", label: "Shipment P&L" },
    ],
  },
  {
    href: "/integration",
    label: "Integration",
    module: "integration",
    icon: ArrowLeftRight,
    children: [{ href: "/integration/tally", label: "Tally Export" }],
  },
  {
    href: "/reports",
    label: "Reports",
    module: "reports",
    icon: BarChart3,
    children: [
      { href: "/reports", label: "All Reports" },
      { href: "/reports/shipment-pnl", label: "Shipment P&L" },
    ],
  },
  {
    href: "/analytics",
    label: "Analytics",
    module: "reports",
    icon: LineChart,
  },
  {
    href: "/masters",
    label: "Master Data",
    module: "masters",
    icon: Database,
    children: [
      { href: "/masters/materials", label: "Materials" },
      { href: "/masters/associates", label: "Associates" },
      { href: "/masters/hr", label: "HR" },
      { href: "/masters/currencies", label: "Currencies" },
      { href: "/masters/gst", label: "GST" },
      { href: "/masters/system", label: "System" },
    ],
  },
  {
    href: "/admin",
    label: "Administration",
    module: "system_admin",
    icon: Shield,
    children: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/roles", label: "Roles & Permissions" },
      { href: "/admin/audit", label: "Audit Log" },
      { href: "/admin/assets", label: "Assets" },
      { href: "/admin/couriers", label: "Courier" },
    ],
  },
];

/**
 * Create/quick actions per section route (keyed by `href`; first entry is the
 * primary action). Powers the mobile "peek sheet" nav — the ＋ button fires the
 * primary action, and the launcher lists all of them under "Quick actions".
 * A section with no entry here simply shows no create affordance.
 * Kept as a flat map (not nested in NAV) so it's trivial to extend per section.
 */
export const SECTION_ACTIONS: Record<string, string[]> = {
  // The ＋ quick action opens the single quick-add form via `?new=1`. Bulk
  // "Create Opportunities — By Customer" lives at /sales/create (pipeline button).
  "/sales": ["New Opportunity"],
  "/sales/quotes": ["Prepare Quote"],

  "/orders": ["New Order", "Import Orders", "Export List"],
  "/orders/styles": ["New Style"],
  "/orders/color-cards": ["New Colour Card"],
  "/orders/internal-work-orders": ["New Work Order"],
  "/orders/amendments": ["New Amendment"],
  "/orders/process-amendments": ["New Amendment"],
  // Advised Items landing is an accepted-order selector (no create form);
  // create happens on the per-order editor's "New advised item" button.
  "/orders/packing-advice": ["New Packing Advice"],
  "/orders/cancellations": ["New Cancellation"],
  "/orders/completions": ["New Completion"],
  "/orders/ta-masters": ["New TA Activity"],
  "/orders/ta-department-assign": ["New Assignment"],
  "/orders/ta-user-rights": ["Configure Rights"],
  "/orders/ta-style": ["New TA Style"],
  "/orders/ta-plan": ["New TA Plan"],
  "/orders/ta-completion": ["New TA Completion"],

  "/planning/boms": ["New BOM", "Import BOM"],
  "/planning/budgets": ["New Budget"],
  "/planning/shortages": ["Recalculate", "Export"],
  "/planning/shipment-plans": ["New Shipment Plan"],

  "/purchase/orders": ["New PO", "Import"],
  "/purchase/rfq": ["New RFQ"],
  "/purchase/grn": ["New GRN"],
  "/purchase/dc": ["New Delivery Challan"],
  "/purchase/vendors": ["New Vendor"],

  "/stores/opening-stock": ["New Opening Stock", "Import"],
  "/stores/requisitions": ["New MRS"],
  "/stores/vendor-returns": ["New Return"],
  "/stores/csp-receipts": ["New CSP Receipt"],

  "/hr/workers": ["New Worker", "Bulk Import"],
  "/hr/staff": ["New Staff"],
  "/hr/contractors": ["New Contractor"],
  "/hr/attendance": ["Mark Attendance"],
  "/hr/piece-records": ["New Piece Record"],
  "/hr/payroll": ["New Payroll Run"],
  "/hr/payslip": ["Generate"],

  "/logistics": ["New Shipment"],
  "/logistics/proforma": ["New Proforma Invoice"],
  "/logistics/lc": ["New Letter of Credit"],
  "/logistics/epcg": ["New EPCG Declaration"],

  "/finance/payables": ["New Bill"],
  "/finance/receivables": ["New Invoice", "Record Receipt"],
  "/finance/ledger": ["New Journal"],
  "/finance/notes": ["New Note"],
  "/finance/pnl": ["Export"],

  "/integration/tally": ["Run Export"],

  "/admin/users": ["New User"],
  "/admin/roles": ["New Role"],
};

/** Actions for a route, falling back to the module root if the section has none. */
export function sectionActions(sectionHref?: string, moduleHref?: string): string[] {
  if (sectionHref && SECTION_ACTIONS[sectionHref]) return SECTION_ACTIONS[sectionHref];
  if (moduleHref && SECTION_ACTIONS[moduleHref]) return SECTION_ACTIONS[moduleHref];
  return [];
}
