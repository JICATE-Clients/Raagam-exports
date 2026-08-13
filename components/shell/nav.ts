import {
  LayoutDashboard,
  ShoppingBag,
  ClipboardList,
  Package,
  Warehouse,
  Factory,
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
import { MASTERS_SECTION_ACTIONS } from "@/lib/masters/masters-nav";
import { moduleNavChildren } from "@/lib/nav/module-groups";
import { REPORTS, reportHref } from "@/lib/reports/catalog";

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
 *
 * **A module lists GROUPS, never a screen that lives under another screen in
 * the same list.** Master Data set the shape — five sub-modules, their entities
 * on the hub pages — and `lib/nav/module-groups.ts` now applies it everywhere
 * else, so `children` here is derived rather than hand-listed. Before that,
 * Purchase showed "Indents" beside "Indent Approval" (a route *under* it),
 * Planning listed 20 screens that are really two families plus strays, and
 * Production / Logistics / Reports each repeated their own module root as their
 * first child — two rows for one page (client 2026-08-07).
 *
 * A module absent from that registry keeps a literal list here, and only two
 * are: Sales already listed five sub-modules, and Reports is derived from the
 * report catalog.
 */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", module: "dashboard", icon: LayoutDashboard },
  {
    href: "/sales",
    label: "Sales",
    module: "sales",
    icon: ShoppingBag,
    children: [
      { href: "/sales/opportunities-costing", label: "Opportunities & Costing" },
      { href: "/sales/sq-details", label: "SQ Details" },
      { href: "/sales/pipeline-orders", label: "Pipeline & Seasonal" },
      { href: "/sales/catalogues", label: "Catalogues & Pricing" },
      { href: "/sales/samples-development", label: "Samples & Development" },
    ],
  },
  {
    href: "/orders",
    label: "Orders",
    module: "orders",
    icon: ClipboardList,
    children: moduleNavChildren("/orders"),
  },
  {
    href: "/planning",
    label: "Planning",
    module: "planning",
    icon: LineChart,
    children: moduleNavChildren("/planning"),
  },
  {
    href: "/purchase",
    label: "Purchase",
    module: "materials_purchase",
    icon: Package,
    children: moduleNavChildren("/purchase"),
  },
  {
    href: "/stores",
    label: "Stores",
    module: "stores",
    icon: Warehouse,
    children: moduleNavChildren("/stores"),
  },
  {
    href: "/production",
    label: "Production",
    module: "production",
    icon: Factory,
    children: moduleNavChildren("/production"),
  },
  // Process Planning module removed — depends on Planning tables, pending rebuild
  {
    href: "/hr",
    label: "HR & Payroll",
    module: "hr_payroll",
    icon: Users,
    children: moduleNavChildren("/hr"),
  },
  {
    href: "/logistics",
    label: "Logistics",
    module: "logistics",
    icon: Ship,
    children: moduleNavChildren("/logistics"),
  },
  {
    href: "/finance",
    label: "Finance",
    module: "finance",
    icon: Landmark,
    children: moduleNavChildren("/finance"),
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
    // Derived from the catalog so a new report can never appear in the landing
    // grid but go missing from the nav (they used to be two hand-edited lists).
    // No "All Reports" child: the module label already navigates to /reports,
    // so it was a second sidebar row pointing at the page the first one opens.
    children: REPORTS.map((r) => ({ href: reportHref(r), label: r.label })),
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
    ],
  },
  {
    href: "/admin",
    label: "Administration",
    module: "system_admin",
    icon: Shield,
    children: moduleNavChildren("/admin"),
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

  // The module ROOT's entry, which `sectionActions` falls back to for every
  // Orders route without a key of its own — so it stays even though `/orders`
  // itself is now a card index with nothing to create on it.
  "/orders": ["New Order", "Import Orders", "Export List"],
  // The All Orders register, which is where those actions actually land since
  // it moved off the module root (2026-08-13).
  "/orders/all": ["New Order", "Import Orders", "Export List"],
  "/orders/styles": ["New Style"],
  "/orders/internal-work-orders": ["New Work Order"],
  // The ENTRY door. Named for what the screen IS, not for the table it writes.
  "/orders/garment-orders": ["New Garment Order"],
  // The AMEND door — same screen, and it deliberately cannot create: a "New"
  // here would mint a second `sales_orders` row for an operator who meant to
  // correct the first (see `openAdd` in the screen). So the action opens the
  // list rather than a form.
  //
  // A KEY, NOT A DELETION. `mobile-nav` falls back to `New ${singularize(label)}`
  // for a href with no entry, so removing this would re-invent the exact
  // "New Order Amendment" button the guard refuses to honour.
  "/orders/amendments": ["Find Order to Amend"],
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

  // Masters entity pages — generated from the same registries the hub pages
  // render from, so new masters get their ＋ action automatically.
  ...MASTERS_SECTION_ACTIONS,
};

/** Actions for a route, falling back to the module root if the section has none. */
export function sectionActions(sectionHref?: string, moduleHref?: string): string[] {
  if (sectionHref && SECTION_ACTIONS[sectionHref]) return SECTION_ACTIONS[sectionHref];
  if (moduleHref && SECTION_ACTIONS[moduleHref]) return SECTION_ACTIONS[moduleHref];
  return [];
}
