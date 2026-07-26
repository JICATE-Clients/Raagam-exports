import { can } from "@/lib/auth/server";
import type { Action, Module } from "@/lib/auth/types";
import { QuickActionGrid, type QuickAction } from "@/components/dashboard/cards";

/**
 * Section 05a — the eight shortcuts. Zero queries; permission checks resolve
 * from the already-loaded permission list, so this renders outside Suspense.
 *
 * Each entry is filtered on `<module>:create`, not `:view` — a shortcut that
 * lands on a screen where the user cannot actually create anything is worse
 * than no shortcut.
 */
const ACTIONS: (QuickAction & { module: Module; action: Action })[] = [
  {
    label: "Create sales order",
    hint: "Buyer, style, ship date",
    href: "/orders/order-booking",
    icon: "clipboard-list",
    tone: "primary",
    module: "orders",
    action: "create",
  },
  {
    label: "Raise purchase indent",
    hint: "Request material for stores",
    href: "/purchase/indents",
    icon: "file-plus",
    tone: "info",
    module: "materials_purchase",
    action: "create",
  },
  {
    label: "Create purchase order",
    hint: "From an approved indent",
    href: "/purchase/orders",
    icon: "package",
    tone: "accent",
    module: "materials_purchase",
    action: "create",
  },
  {
    label: "Receive goods",
    hint: "GRN against a PO",
    href: "/purchase/grn/new",
    icon: "truck",
    tone: "success",
    module: "materials_purchase",
    action: "create",
  },
  {
    label: "Add supplier",
    hint: "Vendor onboarding",
    href: "/purchase/vendors",
    icon: "user-plus",
    tone: "info",
    module: "materials_purchase",
    action: "create",
  },
  {
    label: "Material requisition",
    hint: "Issue stock to a department",
    href: "/stores/requisitions",
    icon: "warehouse",
    tone: "accent",
    module: "stores",
    action: "create",
  },
  {
    label: "Create job order",
    hint: "Production routing",
    href: "/production/job-orders",
    icon: "factory",
    tone: "warning",
    module: "production",
    action: "create",
  },
  {
    label: "Master data",
    hint: "Materials, buyers, styles",
    href: "/masters",
    icon: "layers",
    tone: "primary",
    module: "masters",
    action: "create",
  },
];

export async function QuickActionsSection() {
  const allowed = await Promise.all(
    ACTIONS.map(async (a) => ((await can(a.module, a.action)) ? a : null)),
  );
  const actions = allowed.filter((a): a is (typeof ACTIONS)[number] => a !== null);

  if (actions.length === 0) return null;
  return <QuickActionGrid actions={actions} />;
}
