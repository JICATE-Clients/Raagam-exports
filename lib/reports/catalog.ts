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
