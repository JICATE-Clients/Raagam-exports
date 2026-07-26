import { createElement } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeAlert,
  CircleAlert,
  CircleDashed,
  CircleDot,
  ClipboardList,
  Droplets,
  Factory,
  FilePlus,
  FileText,
  Gauge,
  IndianRupee,
  Layers,
  Package,
  PackageCheck,
  PackageX,
  Scissors,
  Ship,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Truck,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Name → component map for icons chosen on the server.
 *
 * The data layer picks an icon per tile, but a server module cannot hand a
 * React component across to the client, and it shouldn't import from
 * `components/` anyway. So it emits a name and this resolves it.
 *
 * A static map rather than a dynamic lookup into lucide's barrel: importing the
 * whole icon set to resolve six names would pull thousands of components into
 * the bundle. Unknown names fall back to a neutral glyph instead of throwing —
 * a mistyped icon name should not blank a dashboard section.
 */
const ICONS: Record<string, LucideIcon> = {
  "arrow-down-right": ArrowDownRight,
  "arrow-up-right": ArrowUpRight,
  "badge-alert": BadgeAlert,
  "circle-alert": CircleAlert,
  "circle-dashed": CircleDashed,
  "circle-dot": CircleDot,
  "clipboard-list": ClipboardList,
  droplets: Droplets,
  factory: Factory,
  "file-plus": FilePlus,
  "file-text": FileText,
  gauge: Gauge,
  "indian-rupee": IndianRupee,
  layers: Layers,
  package: Package,
  "package-check": PackageCheck,
  "package-x": PackageX,
  scissors: Scissors,
  ship: Ship,
  sparkles: Sparkles,
  spool: CircleDot,
  "trending-up": TrendingUp,
  "triangle-alert": TriangleAlert,
  truck: Truck,
  "user-plus": UserPlus,
  users: Users,
  warehouse: Warehouse,
};

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || CircleDashed;
}

/**
 * Convenience renderer: `<Icon name="truck" className="h-4 w-4" />`.
 *
 * Uses `createElement` rather than binding the looked-up component to a
 * capitalised local and rendering `<Cmp />`. That pattern reads as creating a
 * component during render, which the React Compiler lint rejects — and it isn't
 * merely a lint quirk: a component identity that changes between renders would
 * remount the subtree. `createElement` states plainly that we're picking an
 * element type from a fixed table, not defining anything.
 */
export function Icon({ name, className }: { name: string; className?: string }) {
  return createElement(iconFor(name), { className: className ?? "h-4 w-4" });
}
