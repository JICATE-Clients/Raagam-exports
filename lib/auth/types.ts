import { permissionAllows } from "@/lib/permissions/effective";
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
  /** 0659: still on the temporary password emailed at creation — the app
   *  layout sends them to /set-password until they choose their own. */
  mustChangePassword?: boolean;
  /**
   * Governs every `hasPermission()` call. While a Role Preview (see
   * `lib/auth/role-simulation.ts`) is active, this is FALSE even for a real
   * Super Admin — the whole point of the preview is that `hasPermission`,
   * `requirePermission` and `can` stop short-circuiting and start reading the
   * previewed role's `permissions` for real. Use `realIsSuperAdmin` for
   * "is this person actually a Super Admin" (e.g. showing the switcher itself).
   */
  isSuperAdmin: boolean;
  /**
   * The signed-in profile's OWN `is_super_admin` flag, unaffected by preview.
   * Gates the Role Preview switcher and its Server Action — never gates
   * anything else, or a previewed "Administrator" role could re-grant itself
   * the switcher by name collision.
   */
  realIsSuperAdmin: boolean;
  /**
   * The roles being previewed (`roles.id[]`) — empty when not previewing.
   * An ARRAY, not a single id: an operator commonly holds more than one role
   * at once (`user_roles` is a genuine many-to-many), and `permissions` below
   * is already the union across all of these, exactly as `my_permissions()`
   * unions a real user's `user_roles` rows.
   */
  simulatedRoleIds: string[];
  /**
   * A regular staff member's OWN `staff.id` (user 2026-10-01): they hold HR
   * access but no HR role, so the HR sidebar's Staff row reads "My Profile"
   * and opens /hr/staff/<this>, read-only. Null/absent = Admin or HR (the
   * list), or no staff record. Decided in `lib/auth/self-service.ts`.
   */
  myStaffId?: string | null;
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
  /**
   * SCREEN-LEVEL PERMISSIONS (0658) — `my_screen_permissions()`, from roles AND
   * active email access. `moduleMode`: keys granted module-wide by a source in
   * MODULE MODE. `screenGrants`: `screen_key|action` granted by a source in
   * SCREEN MODE. Absent (an older shape) = module mode everywhere, which is
   * exactly the answer before screen permissions existed.
   */
  moduleMode?: PermissionKey[];
  screenGrants?: string[];
}

/**
 * THE permission question, for server and client alike.
 *
 * Without `screen` it answers at MODULE grain, exactly as it always has. With
 * the screen the request is on (`currentScreen()` on the server, the pathname
 * on the client) it applies the screen rule — `permissionAllows` in
 * lib/permissions/effective.ts, the one definition, tested there: the module
 * grant stays the ceiling, and a screen-mode grant narrows it only on that
 * module's own screens.
 */
export function hasPermission(
  user: Pick<AppUser, "isSuperAdmin" | "permissions" | "moduleMode" | "screenGrants"> | null,
  module: Module,
  action: Action,
  screen?: { key: string; module: Module } | null,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const key = `${module}:${action}` as PermissionKey;
  if (!user.permissions.includes(key)) return false;
  if (!screen || !user.moduleMode) return true; // module grain — today's answer
  return permissionAllows(
    {
      isSuperAdmin: false,
      permissions: new Set(user.permissions),
      moduleMode: new Set(user.moduleMode),
      screenGrants: new Set(user.screenGrants ?? []),
    },
    module,
    action,
    screen,
  );
}
