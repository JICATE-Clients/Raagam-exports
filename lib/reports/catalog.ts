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
  Boxes,
  ClipboardList,
  FileText,
  PackageCheck,
  TrendingUp,
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
];

export function reportHref(r: ReportDefinition): string {
  return `/reports/${r.slug}`;
}
