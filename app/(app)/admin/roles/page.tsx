import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import RolesClient from "./roles-client";

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface PermissionRow {
  id: string;
  module: string;
  action: string;
}

export interface RolePermissionRow {
  role_id: string;
  permission_id: string;
}

export default async function RolesPage() {
  await requirePermission("system_admin", "view");

  const supabase = await createClient();

  const [{ data: rolesData }, { data: permsData }, { data: rpData }] =
    await Promise.all([
      supabase.from("roles").select("id, name, description, is_system").order("name"),
      supabase.from("permissions").select("id, module, action"),
      supabase.from("role_permissions").select("role_id, permission_id"),
    ]);

  const roles = (rolesData ?? []) as RoleRow[];
  const permissions = (permsData ?? []) as PermissionRow[];
  const rolePermissions = (rpData ?? []) as RolePermissionRow[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles &amp; Permissions"
        description="Create roles and configure module-level permission matrices."
      />
      <RolesClient
        roles={roles}
        permissions={permissions}
        rolePermissions={rolePermissions}
      />
    </div>
  );
}
