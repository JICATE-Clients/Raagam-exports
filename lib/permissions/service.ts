import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ACTIONS, type Action, type Module } from "@/lib/auth/types";
import { treeFromRows, type PermissionTree } from "./effective";

/**
 * ACCESS CONTROL — the page's reads (0658). One parallel batch: roles and
 * their trees, logins and their email access, and the permission catalog that
 * decides which actions each module offers. Admin-only reads (the tables are
 * RLS `system_admin:view`); a FAILED read throws — an Access Control page that
 * quietly shows "no permissions" would invite an admin to "fix" a role by
 * granting everything again.
 */

export interface AccessRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string | null;
  tree: PermissionTree;
  /** How many users hold it (any location). */
  holders: number;
}

export interface AccessUser {
  id: string;
  email: string;
  full_name: string | null;
  employee_code: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  roles: string[];
  /** Email-based access: null = never set up. */
  access: { is_active: boolean; note: string | null; updated_at: string } | null;
  tree: PermissionTree;
}

export interface AccessControlData {
  roles: AccessRole[];
  users: AccessUser[];
  offered: Partial<Record<Module, Action[]>>;
}

export async function loadAccessControl(): Promise<AccessControlData> {
  const s = await createClient();
  const [rolesR, permsR, rpR, rspR, profR, urR, uaR, upR, uspR] = await Promise.all([
    s.from("roles").select("id, name, description, is_system, created_at").order("name"),
    s.from("permissions").select("id, module, action"),
    s.from("role_permissions").select("role_id, permission_id"),
    s.from("role_screen_permissions").select("role_id, module, screen_key, action"),
    s.from("profiles").select("id, email, full_name, employee_code, is_active, is_super_admin").order("full_name"),
    s.from("user_roles").select("user_id, role_id"),
    s.from("user_access").select("user_email, is_active, note, updated_at"),
    s.from("user_permissions").select("user_email, module, action"),
    s.from("user_screen_permissions").select("user_email, module, screen_key, action"),
  ]);
  for (const [label, r] of [
    ["roles", rolesR], ["permissions", permsR], ["role permissions", rpR], ["role screen permissions", rspR],
    ["users", profR], ["user roles", urR], ["email access", uaR], ["email permissions", upR], ["email screen permissions", uspR],
  ] as const) {
    if (r.error) throw new Error(`Could not read ${label}: ${r.error.message}`);
  }

  const perms = (permsR.data ?? []) as { id: string; module: string; action: string }[];
  const permById = new Map(perms.map((p) => [p.id, p]));
  const offered: Partial<Record<Module, Action[]>> = {};
  for (const p of perms) {
    const list = (offered[p.module as Module] ??= []);
    if (!list.includes(p.action as Action)) list.push(p.action as Action);
  }
  for (const m of Object.keys(offered) as Module[]) {
    offered[m] = ACTIONS.filter((a) => offered[m]!.includes(a));
  }

  const rp = (rpR.data ?? []) as { role_id: string; permission_id: string }[];
  const rsp = (rspR.data ?? []) as { role_id: string; module: string; screen_key: string; action: string }[];
  const ur = (urR.data ?? []) as { user_id: string; role_id: string }[];

  const rolesRaw = (rolesR.data ?? []) as Omit<AccessRole, "tree" | "holders">[];
  const roleName = new Map(rolesRaw.map((r) => [r.id, r.name]));
  const roles: AccessRole[] = rolesRaw.map((r) => ({
    ...r,
    tree: treeFromRows(
      rp.filter((x) => x.role_id === r.id).flatMap((x) => {
        const p = permById.get(x.permission_id);
        return p ? [{ module: p.module, action: p.action }] : [];
      }),
      rsp.filter((x) => x.role_id === r.id),
    ),
    holders: new Set(ur.filter((x) => x.role_id === r.id).map((x) => x.user_id)).size,
  }));

  const ua = (uaR.data ?? []) as { user_email: string; is_active: boolean; note: string | null; updated_at: string }[];
  const up = (upR.data ?? []) as { user_email: string; module: string; action: string }[];
  const usp = (uspR.data ?? []) as { user_email: string; module: string; screen_key: string; action: string }[];
  const users: AccessUser[] = ((profR.data ?? []) as {
    id: string; email: string | null; full_name: string | null; employee_code: string | null; is_active: boolean; is_super_admin: boolean;
  }[])
    .filter((p) => !!p.email?.trim())
    .map((p) => {
      const email = (p.email as string).trim().toLowerCase();
      const acc = ua.find((a) => a.user_email === email) ?? null;
      return {
        id: p.id,
        email,
        full_name: p.full_name,
        employee_code: p.employee_code,
        is_active: p.is_active,
        is_super_admin: p.is_super_admin,
        roles: [...new Set(ur.filter((x) => x.user_id === p.id).map((x) => roleName.get(x.role_id)).filter((n): n is string => !!n))],
        access: acc ? { is_active: acc.is_active, note: acc.note, updated_at: acc.updated_at } : null,
        tree: treeFromRows(up.filter((x) => x.user_email === email), usp.filter((x) => x.user_email === email)),
      };
    });

  return { roles, users, offered };
}
