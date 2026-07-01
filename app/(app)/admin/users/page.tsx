import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
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

export interface LocationOption {
  id: string;
  code: string;
  name: string;
}

export default async function UsersPage() {
  await requirePermission("system_admin", "view");

  const supabase = await createClient();

  const [
    { data: profilesData },
    { data: userRolesRaw },
    { data: rolesData },
    { data: locationsData },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, phone, full_name, employee_code, is_active, is_super_admin")
      .order("full_name"),
    supabase
      .from("user_roles")
      .select("id, user_id, role_id, location_id, roles(name)"),
    supabase
      .from("roles")
      .select("id, name, description")
      .order("name"),
    supabase
      .from("locations")
      .select("id, code, name")
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
  const locations = (locationsData ?? []) as LocationOption[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Create user accounts and manage role assignments."
      />
      <UsersClient
        profiles={profiles}
        userRoles={userRoles}
        roles={roles}
        locations={locations}
      />
    </div>
  );
}
