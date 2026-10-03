import { requirePermission, requireUser } from "@/lib/auth/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import UsersClient from "./users-client";

export interface ProfileRow {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  employee_code: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  /** 0659: still holding a temporary password (never signed in and chose one). */
  must_change_password: boolean;
  created_at?: string | null;
}

export interface UserRoleEntry {
  id: string;
  user_id: string;
  role_id: string;
  location_id: string | null;
  role_name: string;
}

export interface RoleOption {
  id: string;
  name: string;
  description: string | null;
}

/**
 * ONE ROW PER PERSON — HR & Payroll ▸ People ▸ Staff (the `staff` table; user 2026-09-30: "user
 * data need to fetch from hr module staff child"), joined to the login it has
 * (if any) by email or staff code (user 2026-09-30, screenshot 3143: "no need
 * create new user button … only we need fetch from hr master").
 *
 * Logins that match no employee (the admin accounts, the audit test logins)
 * are listed too — their roles still have to be manageable — as rows with no
 * employee behind them.
 */
export interface UserRow {
  key: string;
  /** The HR & Payroll ▸ People ▸ Staff row behind this person; null for a login with no staff row. */
  staffId: string | null;
  name: string | null;
  code: string | null;
  email: string | null;
  profile: ProfileRow | null;
  /** The login's creation, for the Created Date column (null = no login yet). */
  created_at: string | null;
}

export default async function UsersPage() {
  await requirePermission("system_admin", "view");
  const me = await requireUser();

  const supabase = await createClient();
  // STAFF IS READ WITH THE SERVICE ROLE, deliberately. `staff_read` needs
  // hr_payroll:view AND the CURRENT unit, so an administrator without payroll
  // access got an empty list — which reads as "no staff", not as a refusal —
  // and one with it saw only the unit picked in the topbar. This screen is
  // already gated on system_admin:view above, and it selects only the four
  // columns a login needs (no salary, no personal data).
  const admin = createAdminClient();

  const [
    { data: profilesData },
    { data: userRolesRaw },
    { data: rolesData },
    { data: employeesData },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, phone, full_name, employee_code, is_active, is_super_admin, must_change_password, created_at")
      .order("full_name"),
    supabase
      .from("user_roles")
      .select("id, user_id, role_id, location_id, roles(name)"),
    supabase
      .from("roles")
      .select("id, name, description")
      .order("name"),
    // Inactive / blocked staff are not listed (Disabled rows rule) — a login
    // for someone who has left is exactly what should not be creatable.
    admin
      .from("staff")
      .select("id, code, name, email")
      .eq("is_active", true)
      .or("blocked.is.null,blocked.eq.false")
      .order("name"),
  ]);

  const profiles = (profilesData ?? []) as ProfileRow[];

  // Flatten the joined user_roles → roles relation.
  // PostgREST types the foreign-key join as an array even for many-to-one;
  // cast through unknown to satisfy the compiler.
  const userRoles: UserRoleEntry[] = (
    (userRolesRaw ?? []) as unknown as Array<{
      id: string;
      user_id: string;
      role_id: string;
      location_id: string | null;
      roles: { name: string } | { name: string }[] | null;
    }>
  ).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    role_id: r.role_id,
    location_id: r.location_id,
    role_name: Array.isArray(r.roles)
      ? (r.roles[0]?.name ?? "Unknown")
      : (r.roles?.name ?? "Unknown"),
  }));

  const roles = (rolesData ?? []) as RoleOption[];

  const norm = (e: string | null | undefined) => e?.trim().toLowerCase() || null;
  const byEmail = new Map(profiles.filter((p) => norm(p.email)).map((p) => [norm(p.email)!, p]));
  const byCode = new Map(profiles.filter((p) => p.employee_code).map((p) => [p.employee_code!, p]));
  const claimed = new Set<string>();

  const rows: UserRow[] = (
    (employeesData ?? []) as Array<{ id: string; code: string | null; name: string | null; email: string | null }>
  ).map((e) => {
    const em = norm(e.email);
    const p = (em ? byEmail.get(em) : undefined) ?? (e.code ? byCode.get(e.code) : undefined) ?? null;
    if (p) claimed.add(p.id);
    return { key: `s:${e.id}`, staffId: e.id, name: e.name, code: e.code, email: e.email?.trim() || null, profile: p, created_at: p?.created_at ?? null };
  });
  for (const p of profiles) {
    if (claimed.has(p.id)) continue;
    rows.push({ key: `p:${p.id}`, staffId: null, name: p.full_name, code: p.employee_code, email: p.email, profile: p, created_at: p.created_at ?? null });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Everyone in HR & Payroll ▸ People ▸ Staff. Send welcome mail creates their login and emails the sign-in details."
      />
      <UsersClient rows={rows} userRoles={userRoles} roles={roles} meId={me.id} />
    </div>
  );
}
