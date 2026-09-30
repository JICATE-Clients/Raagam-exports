"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Users                                                                */
/* ------------------------------------------------------------------ */

// Creating a login lives in lib/users/actions.ts (createUserFromStaff):
// picked from HR & Payroll ▸ People ▸ Staff, temporary password generated and emailed.

export async function assignRole(
  userId: string,
  roleId: string,
  locationId: string | null,
): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_roles")
    .insert({ user_id: userId, role_id: roleId, location_id: locationId });

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "role.assigned",
    entityType: "user_roles",
    entityId: userId,
    metadata: { roleId, locationId },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function removeRole(userRoleId: string): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("id", userRoleId);

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "role.removed",
    entityType: "user_roles",
    entityId: userRoleId,
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Roles                                                                */
/* ------------------------------------------------------------------ */

export async function createRole(data: {
  name: string;
  description: string;
}): Promise<Result> {
  if (!(await can("system_admin", "create"))) return { ok: false, error: "Forbidden" };

  if (!data.name) return { ok: false, error: "Role name is required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("roles")
    .insert({ name: data.name, description: data.description, is_system: false });

  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "role.created",
    metadata: { name: data.name },
  });

  revalidatePath("/admin/roles");
  return { ok: true };
}

export async function toggleRolePermission(
  roleId: string,
  permissionId: string,
  grant: boolean,
): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();

  if (grant) {
    const { error } = await supabase
      .from("role_permissions")
      .insert({ role_id: roleId, permission_id: permissionId });
    // 23505 = unique_violation — already granted, treat as success
    if (error && error.code !== "23505") return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .eq("permission_id", permissionId);
    if (error) return { ok: false, error: error.message };
  }

  await writeAudit({
    action: grant ? "permission.granted" : "permission.revoked",
    metadata: { roleId, permissionId },
  });

  revalidatePath("/admin/roles");
  return { ok: true };
}
