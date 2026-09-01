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
  /* The approval engine's own module (0500). Its three actions are the app's
     existing vocabulary rather than three new dotted keys — `edit` builds
     flows, `approve` acts on a run, `view` sees EVERY run rather than only your
     own queue. Seeing your own queue needs no permission at all: the queue RPC
     returns only rows you may act on, so the empty-handed case is an empty list,
     not a denial. The shim (0500) maps the engine's dotted keys onto this pair
     with an explicit CASE, so a key it does not know DENIES. */
  "approvals",
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
  approvals: "Approvals",
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
  "approvals",
];

/**
 * A unit (GST entity) the operator may act in — `public.locations`, as returned
 * by `my_locations()` (0483).
 *
 * Declared HERE rather than beside the resolver in `lib/auth/location.ts`
 * because that file is `server-only` and the chrome switcher is a Client
 * Component. `isolatedModules` would erase a type-only import across that
 * boundary today, but the erasure is a compiler setting rather than a promise —
 * this file already exists to be "shared across server + client", so the shared
 * type belongs in it.
 */
export interface AppLocation {
  id: string;
  code: string;
  name: string;
  /**
   * The house default unit (`locations.is_default`) — Head Office. Exactly one
   * location carries it. Carried on every row so the client can compute the
   * same landing fallback `current_location()` does, from the same list,
   * without a second query and therefore without a chance to disagree (0489).
   */
  isDefault: boolean;
}

export interface AppUser {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  isSuperAdmin: boolean;
  /** Where this person USUALLY works — an administrator's statement. Fallback only. */
  defaultLocationId: string | null;
  /**
   * The unit they are working in RIGHT NOW (`profiles.current_location_id`).
   * Every RLS policy narrows to `coalesce(current, default)` via
   * `current_location()`, so this is not a display preference — it decides what
   * every query in the request returns.
   */
  currentLocationId: string | null;
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
