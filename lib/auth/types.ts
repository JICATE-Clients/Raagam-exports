// RBAC vocabulary shared across server + client.

export const MODULES = [
  "dashboard",
  "system_admin",
  "masters",
  "sales",
  "orders",
  // future modules (catalog only this pass)
  "planning",
  "materials_purchase",
  "stores",
  "production",
  "process_planning",
  "hr_payroll",
  "logistics",
  "finance",
  "integration",
  "reports",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
] as const;
export type Action = (typeof ACTIONS)[number];

export type PermissionKey = `${Module}:${Action}`;

/** Human labels for the admin RBAC matrix. */
export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  system_admin: "System Administration",
  masters: "Master Data",
  sales: "Sales & Marketing",
  orders: "Order Management",
  planning: "Planning / BOM",
  materials_purchase: "Materials & Purchase",
  stores: "Store Management",
  production: "Production Tracking",
  process_planning: "Process Planning",
  hr_payroll: "HR & Payroll",
  logistics: "Logistics & Export Docs",
  finance: "Finance",
  integration: "System Integration",
  reports: "Reports & Analytics",
};

/** Modules actually shipped in this build pass (drive the nav). */
export const ACTIVE_MODULES: Module[] = [
  "dashboard",
  "sales",
  "orders",
  "planning",
  "materials_purchase",
  "stores",
  "production",
  "process_planning",
  "hr_payroll",
  "logistics",
  "finance",
  "integration",
  "reports",
  "masters",
  "system_admin",
];

export interface AppUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  isSuperAdmin: boolean;
  defaultLocationId: string | null;
  roleNames: string[];
  /** Effective permission keys, e.g. "orders:approve". */
  permissions: PermissionKey[];
}

export function hasPermission(
  user: Pick<AppUser, "isSuperAdmin" | "permissions"> | null,
  module: Module,
  action: Action,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.permissions.includes(`${module}:${action}`);
}
