/**
 * The report catalog — one entry per report page.
 *
 * Both the `/reports` landing grid and the `/reports` children in
 * `components/shell/nav.ts` map over this array. Before it existed they were two
 * hand-edited literals that nothing kept in sync, so a new report routinely
 * appeared in one place and not the other.
 *
 * Plain data apart from the lucide `icon` component reference, which `nav.ts`
 * already carries the same way.
 */

import {
  ArrowLeftRight,
  Factory,
  Layers,
  Percent,
  Truck,
  Boxes,
  ClipboardList,
  FileText,
  PackageCheck,
  PenTool,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { Module } from "@/lib/auth/types";

export interface ReportDefinition {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  module: Module;
}

export const REPORTS: ReportDefinition[] = [
  {
    slug: "item-movement",
    label: "Item Purchase & Consumption",
    description:
      "Ordered, received, consumed and closing stock — by item, class, category or attribute",
    icon: Boxes,
    module: "reports",
  },
  {
    slug: "item-ledger",
    label: "Item Movement Ledger",
    description: "Every movement behind the numbers — one row per transaction",
    icon: ArrowLeftRight,
    module: "reports",
  },
  {
    slug: "purchase-vs-receipt",
    label: "Purchase vs Receipt",
    description: "Ordered against received against what actually reached stock",
    icon: PackageCheck,
    module: "reports",
  },
  /*
   * A DOCUMENT, NOT AN ANALYSIS - and it is listed here anyway, deliberately.
   *
   * The four entries around it answer "what moved across the whole book" and
   * open with filters. This one is a per-order sheet that is signed and handed
   * to a supplier, so it lives on the order (`/orders/<id>/requirement`) beside
   * the Garment Order Sheet.
   *
   * It is in this catalog because that is where people LOOKED for it. A
   * document nobody can find is a document nobody uses, and the cost of the
   * entry is one card plus a chooser that asks which order - far less than the
   * cost of the operator giving up. The chooser exists precisely because a
   * per-order document has no list to land on.
   */
  {
    slug: "order-sheet",
    label: "Garment Order Sheet",
    description: "Styles, structures and components for one order - print, PDF or Excel",
    icon: FileText,
    module: "orders",
  },
  {
    slug: "accessories-requirement",
    label: "Accessories Requirement",
    description: "Trims and packing to buy for one order - print, PDF or Excel",
    icon: ClipboardList,
    module: "orders",
  },
  {
    slug: "shipment-pnl",
    label: "Shipment P&L",
    description: "Profitability by shipment — revenue vs. total cost",
    icon: TrendingUp,
    module: "reports",
  },
  {
    slug: "ta-performance",
    label: "T&A Staff Performance",
    description: "On-time completion by staff, for the Monthly Review Meeting",
    icon: UserCheck,
    module: "orders",
  },
  /* CAD COMPLETION (doc/order/cad.md §6.1, 0628) — the CAD department's
     efficiency: versions per style and Final Approval Lead Time (approval date
     − V1 allocation date). Read from the same `listCadStyles` the CAD Lifecycle
     screen lists. */
  {
    slug: "cad-completion",
    label: "CAD Completion",
    description: "Versions per style and the lead time from first allocation to buyer approval",
    icon: PenTool,
    module: "orders",
  },
  /* OVERRIDE EDIT REPORT (doc/email role system.md §7.3, R-18) — every field
     changed on an APPROVED order under a permission override, old → new, who,
     why and when, grouped by save. `module: "orders"` only decides who sees the
     tile; the page's own gate is `can_view_permission_overrides()` (MD and
     admins, D-7), the function the audit tables' RLS reads. */
  {
    slug: "override-edits",
    label: "Override Edit Report",
    description: "Post-approval edits made under a permission override — old → new, by whom and why",
    icon: ShieldAlert,
    module: "orders",
  },
  /* JOB WORK & TRANSIT (doc/stores/dc-plan.md Phase 4, 0784-0788) - read straight off the
     Process / Production DCs and Process Receipts, so they cannot disagree with Stores. */
  {
    slug: "stock-at-vendor",
    label: "Stock at Vendor",
    description: "Material out at dyers, knitters, printers and embroiderers - days out and overdue",
    icon: Factory,
    module: "stores",
  },
  {
    slug: "in-transit",
    label: "Material In Transit",
    description: "Sent between Raagam HO, Unit 2 and Unit 3 and not yet received",
    icon: Truck,
    module: "stores",
  },
  {
    slug: "bin-stock",
    label: "Bin Stock & Aging",
    description: "Stock per store, bin, item and lot - and how long each lot has sat there",
    icon: Layers,
    module: "stores",
  },
  {
    slug: "process-loss",
    label: "Process Loss by Vendor",
    description: "Actual against allowed loss per processor - and the excess flagged on bills",
    icon: Percent,
    module: "stores",
  },
];

export function reportHref(r: ReportDefinition): string {
  return `/reports/${r.slug}`;
}
