import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
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
  /**
   * 0661: false for someone given email access BEFORE they have a login — a
   * staff member picked on "+ Give email access". Their `id` is then
   * `email:<address>` (there is no profile id yet), and the access starts
   * counting the first time they sign in with that email.
   */
  has_login: boolean;
  roles: string[];
  /** Email-based access: null = never set up. */
  access: {
    is_active: boolean;
    note: string | null;
    updated_at: string;
    /** 0665: the units this email access reaches — every unit, or the listed ids. */
    all_locations: boolean;
    location_ids: string[];
  } | null;
  tree: PermissionTree;
}

/** A unit a person may be given (the topbar's switcher offers what they hold). */
export interface AccessLocation {
  id: string;
  name: string;
}

/** A person from HR ▸ Staff who can be given email access (has an email, no row above yet). */
export interface AccessStaffOption {
  email: string;
  name: string;
  code: string | null;
}

export interface AccessControlData {
  roles: AccessRole[];
  users: AccessUser[];
  offered: Partial<Record<Module, Action[]>>;
  /** For "+ Give email access": active staff with an email who are not already listed. */
  staffOptions: AccessStaffOption[];
  /** 0665: active units, for the email-access Locations picker. */
  locations: AccessLocation[];
}

export async function loadAccessControl(): Promise<AccessControlData> {
  const s = await createClient();
  const [rolesR, permsR, rpR, rspR, profR, urR, uaR, upR, uspR, ualR, locR] = await Promise.all([
    s.from("roles").select("id, name, description, is_system, created_at").order("name"),
    s.from("permissions").select("id, module, action"),
    s.from("role_permissions").select("role_id, permission_id"),
    s.from("role_screen_permissions").select("role_id, module, screen_key, action"),
    s.from("profiles").select("id, email, full_name, employee_code, is_active, is_super_admin").order("full_name"),
    s.from("user_roles").select("user_id, role_id"),
    s.from("user_access").select("user_email, is_active, note, updated_at, all_locations"),
    s.from("user_permissions").select("user_email, module, action"),
    s.from("user_screen_permissions").select("user_email, module, screen_key, action"),
    s.from("user_access_locations").select("user_email, location_id"),
    s.from("locations").select("id, name, is_active").order("name"),
  ]);
  for (const [label, r] of [
    ["roles", rolesR], ["permissions", permsR], ["role permissions", rpR], ["role screen permissions", rspR],
    ["users", profR], ["user roles", urR], ["email access", uaR], ["email permissions", upR], ["email screen permissions", uspR],
    ["email access locations", ualR], ["locations", locR],
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

  const ua = (uaR.data ?? []) as {
    user_email: string; is_active: boolean; note: string | null; updated_at: string; all_locations: boolean;
  }[];
  const ual = (ualR.data ?? []) as { user_email: string; location_id: string }[];
  /** One email access, as the screen reads it — its units folded in (0665). */
  const accessOf = (a: (typeof ua)[number]) => ({
    is_active: a.is_active,
    note: a.note,
    updated_at: a.updated_at,
    all_locations: !!a.all_locations,
    location_ids: ual.filter((x) => x.user_email === a.user_email).map((x) => x.location_id),
  });
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
        has_login: true,
        roles: [...new Set(ur.filter((x) => x.user_id === p.id).map((x) => roleName.get(x.role_id)).filter((n): n is string => !!n))],
        access: acc ? accessOf(acc) : null,
        tree: treeFromRows(up.filter((x) => x.user_email === email), usp.filter((x) => x.user_email === email)),
      };
    });

  /* HR ▸ STAFF, for naming access-only rows and for the picker. Read with the
     service role after the page's own system_admin gate: `staff_read` needs
     hr_payroll:view AND the current unit, so an administrator without payroll
     access would otherwise get an empty picker (the same reason the Users
     screen reads it this way). Only name, code and email. */
  const { data: staffRows, error: staffErr } = await createAdminClient()
    .from("staff")
    .select("code, name, email")
    .eq("is_active", true)
    .or("blocked.is.null,blocked.eq.false")
    .order("name");
  if (staffErr) throw new Error(`Could not read staff: ${staffErr.message}`);
  const staffByEmail = new Map<string, AccessStaffOption>();
  for (const r of (staffRows ?? []) as { code: string | null; name: string; email: string | null }[]) {
    const email = r.email?.trim().toLowerCase();
    if (email && !staffByEmail.has(email)) staffByEmail.set(email, { email, name: r.name, code: r.code });
  }

  // 0661: access given ahead of a login is a row too — otherwise it is saved and invisible.
  const withLogin = new Set(users.map((u) => u.email));
  for (const a of ua) {
    if (withLogin.has(a.user_email)) continue;
    const st = staffByEmail.get(a.user_email);
    users.push({
      id: `email:${a.user_email}`,
      email: a.user_email,
      full_name: st?.name ?? null,
      employee_code: st?.code ?? null,
      is_active: false,
      is_super_admin: false,
      has_login: false,
      roles: [],
      access: accessOf(a),
      tree: treeFromRows(up.filter((x) => x.user_email === a.user_email), usp.filter((x) => x.user_email === a.user_email)),
    });
  }

  const listed = new Set(users.map((u) => u.email));
  const staffOptions = [...staffByEmail.values()].filter((o) => !listed.has(o.email));

  /* Active units only — the Disabled-rows rule. A unit switched off after it was
     given stays in `location_ids` and is shown by the screen as held. */
  const locations = ((locR.data ?? []) as { id: string; name: string; is_active: boolean | null }[])
    .filter((l) => l.is_active !== false)
    .map((l) => ({ id: l.id, name: l.name }));

  return { roles, users, offered, staffOptions, locations };
}
