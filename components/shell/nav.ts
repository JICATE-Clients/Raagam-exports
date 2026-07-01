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
  Database,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { Module } from "@/lib/auth/types";

export interface NavItem {
  href: string;
  label: string;
  module: Module;
  icon: LucideIcon;
}

/** Primary navigation. Items are filtered by `<module>:view` permission. */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", module: "dashboard", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", module: "sales", icon: ShoppingBag },
  { href: "/orders", label: "Orders", module: "orders", icon: ClipboardList },
  { href: "/planning", label: "Planning", module: "planning", icon: Layers },
  {
    href: "/purchase",
    label: "Purchase",
    module: "materials_purchase",
    icon: Package,
  },
  { href: "/stores", label: "Stores", module: "stores", icon: Warehouse },
  {
    href: "/production",
    label: "Production",
    module: "production",
    icon: Factory,
  },
  {
    href: "/process",
    label: "Process Planning",
    module: "process_planning",
    icon: Workflow,
  },
  { href: "/hr", label: "HR & Payroll", module: "hr_payroll", icon: Users },
  {
    href: "/logistics",
    label: "Logistics",
    module: "logistics",
    icon: Ship,
  },
  { href: "/finance", label: "Finance", module: "finance", icon: Landmark },
  {
    href: "/integration",
    label: "Integration",
    module: "integration",
    icon: ArrowLeftRight,
  },
  { href: "/masters", label: "Master Data", module: "masters", icon: Database },
  {
    href: "/admin",
    label: "Administration",
    module: "system_admin",
    icon: Shield,
  },
];
