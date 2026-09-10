import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./types";

/**
 * Role Preview — lets a real Super Admin see the app exactly as another
 * OPERATOR would, holding one or more roles at once. Deliberately a COOKIE,
 * unlike the unit switcher (`lib/auth/location-actions.ts`), which is
 * deliberately NOT a cookie: a unit has to be visible to Postgres because RLS
 * narrows every query to it. A previewed role narrows nothing in Postgres —
 * `is_super_admin()` still governs RLS regardless of preview, on purpose (see
 * the note on `AppUser.isSuperAdmin` in `./types.ts`) — so the only thing that
 * needs to see this value is `getAppUser()`, and a cookie is the right tool
 * for state nothing else reads.
 *
 * MULTIPLE ROLES, NOT ONE. `user_roles` is a genuine many-to-many — its own
 * uniqueness is `(user_id, role_id, location_id)`, deliberately allowing
 * several rows per user — and `my_permissions()` (0003) unions every one of
 * them with `select distinct`. A preview of exactly one role at a time cannot
 * represent what a real "Manager" + "HR Executive" operator actually sees, so
 * this stores and resolves a SET of role ids, unioned the same way.
 */
const SIM_ROLE_COOKIE = "rbac_preview_roles";

export async function getPreviewedRoleIds(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(SIM_ROLE_COOKIE)?.value;
  if (!raw) return [];
  return raw.split(",").filter(Boolean);
}

export async function setPreviewedRoleCookie(roleIds: string[]) {
  const store = await cookies();
  if (roleIds.length === 0) {
    store.delete(SIM_ROLE_COOKIE);
    return;
  }
  store.set(SIM_ROLE_COOKIE, roleIds.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // A shift left on the desk, not a standing preference — expires with the
    // day rather than surviving a week of forgotten preview.
    maxAge: 60 * 60 * 12,
  });
}

export interface PreviewableRole {
  id: string;
  name: string;
  description: string | null;
}

/** Every role a Super Admin may preview. Only ever called behind `realIsSuperAdmin`. */
export async function listPreviewableRoles(): Promise<PreviewableRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("id, name, description")
    .order("name");
  return (data ?? []) as PreviewableRole[];
}

export interface RolesPreview {
  /** The subset of the requested ids that still exist — a stale/deleted role drops out. */
  ids: string[];
  names: string[];
  /** The UNION of every previewed role's grants, de-duplicated — never an intersection. */
  permissions: PermissionKey[];
}

/**
 * Resolve one or more roles' names + the UNION of their effective permission
 * keys — the same shape `getAppUser()` builds from `my_permissions()` for a
 * real session, so `hasPermission()` cannot tell the difference between "my
 * own grants across every role I hold" and "the roles I'm previewing".
 *
 * A plain `select` is enough: `roles`/`role_permissions`/`permissions` already
 * pass RLS for a real Super Admin (`has_permission('system_admin','view')`
 * short-circuits true on `is_super_admin`), so no new RPC or migration is
 * needed for this read.
 *
 * Returns null only when NONE of the given ids resolve (every one stale or
 * forged) — the caller then falls back to "not previewing" rather than
 * previewing an empty, permission-less role.
 */
export async function getRolesPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleIds: string[],
): Promise<RolesPreview | null> {
  if (roleIds.length === 0) return null;

  const [{ data: roles }, { data: rolePerms }] = await Promise.all([
    supabase.from("roles").select("id, name").in("id", roleIds),
    supabase
      .from("role_permissions")
      .select("permissions(module, action)")
      .in("role_id", roleIds),
  ]);

  const validRoles = (roles ?? []) as { id: string; name: string }[];
  if (validRoles.length === 0) return null;

  // DISTINCT union across every previewed role — the same additive rule
  // `my_permissions()` applies across a real operator's `user_roles` rows.
  // `permissions(module, action)` is a to-one embed (`role_permissions
  // .permission_id` is many-to-one onto `permissions.id`) and returns a
  // single object per row at runtime — but without a generated Database
  // type, supabase-js's inferred type for a nested select can't see that
  // cardinality. Same untyped-embed shape as `joined()` in
  // lib/admin/extras-service.ts and friends; unwrapped the same way.
  const seen = new Set<string>();
  const permissions: PermissionKey[] = [];
  for (const rp of (rolePerms ?? []) as Record<string, unknown>[]) {
    const p = rp.permissions as Record<string, unknown> | null;
    if (!p) continue;
    const key = `${p.module}:${p.action}` as PermissionKey;
    if (!seen.has(key)) {
      seen.add(key);
      permissions.push(key);
    }
  }

  return {
    ids: validRoles.map((r) => r.id),
    names: validRoles.map((r) => r.name),
    permissions,
  };
}
