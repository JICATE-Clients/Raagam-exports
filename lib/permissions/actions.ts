"use server";

/**
 * ACCESS CONTROL — the two saves (0658). A role's tree and a person's email
 * access go through the SAME normalisation (`payloadFromTree`, which also drops
 * any screen key the catalog does not know) and the same one-transaction RPCs,
 * so role access and email access can never be stored two different ways.
 *
 * No `export type` from this file — a "use server" module that re-exports a
 * type crashes at runtime (memory raagam-use-server-type-reexport).
 */

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { screenCatalog } from "./screen-catalog";
import { payloadFromTree, type PermissionTree } from "./effective";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const SCREEN = "/admin/access-control";

function rev() {
  revalidatePath(SCREEN);
  revalidatePath("/admin/users");
}

/** Create a role (when `roleId` is absent) and/or save its whole tree. */
export async function saveRoleAccess(input: {
  roleId?: string | null;
  name: string;
  description?: string | null;
  tree: PermissionTree;
  /** 0670: where this role's holders land after signing in; null = no preference. */
  homePath?: string | null;
}): Promise<Result<{ roleId: string }>> {
  const creating = !input.roleId;
  if (!(await can("system_admin", creating ? "create" : "edit"))) return { ok: false, error: "Forbidden" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the role a name." };

  // The DB refuses anything but an app path (0670's CHECK); trimming here only
  // turns a blank choice into "no preference".
  const home_path = input.homePath?.trim() || null;

  const s = await createClient();
  let roleId = input.roleId ?? null;
  if (creating) {
    const { data, error } = await s
      .from("roles")
      .insert({ name, description: input.description?.trim() || null, is_system: false, home_path })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.code === "23505" ? `A role named ${name} already exists.` : error.message };
    roleId = (data as { id: string }).id;
  } else {
    const { error } = await s
      .from("roles")
      .update({ name, description: input.description?.trim() || null, home_path })
      .eq("id", roleId as string);
    if (error) return { ok: false, error: error.code === "23505" ? `A role named ${name} already exists.` : error.message };
  }

  const { error: saveErr } = await s.rpc("save_role_permissions", {
    p_role: roleId,
    p_tree: payloadFromTree(input.tree, screenCatalog()),
  });
  if (saveErr) return { ok: false, error: saveErr.message };

  await writeAudit({
    action: creating ? "role.created" : "role.permissions_saved",
    entityType: "role",
    entityId: roleId as string,
    metadata: { name },
  });
  rev();
  return { ok: true, roleId: roleId as string };
}

/** Save a person's email-based access — the tree and the Active switch. */
export async function saveUserAccess(input: {
  email: string;
  active: boolean;
  note?: string | null;
  tree: PermissionTree;
  /**
   * 0665: the units this access reaches. OMITTED = leave them as they are —
   * the one-click Status switch and the bulk on/off save only the flag, and
   * must not wipe a person's units by not mentioning them.
   */
  locations?: { all: boolean; ids: string[] };
}): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return { ok: false, error: "Forbidden" };
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Choose the user." };

  const s = await createClient();

  // UNIT IS MANDATORY (user 2026-10-09): access that is switched ON must reach
  // at least one unit, or the person signs in to a screen with no data and
  // nothing saying why (0680: the allocation is the only source of a unit).
  // The units are judged as they will be AFTER this save — the ones sent, or,
  // when `locations` is omitted (Status switch, bulk), the ones already stored.
  // A super admin reaches every unit regardless, so is exempt. Switching
  // access OFF is never refused: the way out must stay open.
  if (input.active) {
    const { data: prof } = await s.from("profiles").select("is_super_admin").ilike("email", email).maybeSingle();
    if (!(prof as { is_super_admin?: boolean } | null)?.is_super_admin) {
      let hasUnit: boolean;
      if (input.locations) {
        hasUnit = input.locations.all || input.locations.ids.length > 0;
      } else {
        const [{ data: acc }, { data: locs }] = await Promise.all([
          s.from("user_access").select("all_locations").eq("user_email", email).maybeSingle(),
          s.from("user_access_locations").select("location_id").eq("user_email", email).limit(1),
        ]);
        hasUnit = !!(acc as { all_locations?: boolean } | null)?.all_locations || ((locs as unknown[] | null)?.length ?? 0) > 0;
      }
      if (!hasUnit) return { ok: false, error: "Unit is required — allocate at least one unit before giving access." };
    }
  }

  const { error } = await s.rpc("save_user_permissions", {
    p_email: email,
    p_tree: payloadFromTree(input.tree, screenCatalog()),
    p_active: input.active,
    p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  // After `save_user_permissions`, which creates the `user_access` row the
  // locations hang off. One wholesale replace: the ticks ARE the stored set.
  if (input.locations) {
    const { error: locErr } = await s.rpc("save_user_access_locations", {
      p_email: email,
      p_all: input.locations.all,
      p_locations: input.locations.all ? [] : input.locations.ids,
    });
    if (locErr) return { ok: false, error: locErr.message };
  }

  await writeAudit({
    action: input.active ? "user_access.saved" : "user_access.deactivated",
    entityType: "user_access",
    entityId: email,
  });
  rev();
  return { ok: true };
}

/**
 * DELETE A ROLE — the bin beside the pencil on By Role (user 2026-09-30).
 * Refused for a system role, and for a role anyone still holds: `user_roles`
 * cascades on delete, so removing a held role would silently strip every
 * holder of it. The screen greys the bin with the same two reasons.
 */
export async function deleteRole(roleId: string): Promise<Result> {
  if (!(await can("system_admin", "delete"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  const { data: role, error } = await s.from("roles").select("id, name, is_system").eq("id", roleId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!role) return { ok: false, error: "That role no longer exists." };
  const r = role as { id: string; name: string; is_system: boolean };
  if (r.is_system) return { ok: false, error: `${r.name} is a system role and cannot be deleted.` };
  const { count, error: cErr } = await s.from("user_roles").select("id", { count: "exact", head: true }).eq("role_id", roleId);
  if (cErr) return { ok: false, error: cErr.message };
  if ((count ?? 0) > 0) return { ok: false, error: `${r.name} is held by ${count} user(s) — remove it from them first.` };
  const { error: dErr, count: deleted } = await s.from("roles").delete({ count: "exact" }).eq("id", roleId);
  if (dErr) return { ok: false, error: dErr.message };
  if (!deleted) return { ok: false, error: "The role could not be deleted." };
  await writeAudit({ action: "role.deleted", entityType: "role", entityId: roleId, metadata: { name: r.name } });
  rev();
  return { ok: true };
}

/**
 * REMOVE EMAIL ACCESS FOR SOMEONE WITH NO LOGIN (0661) — the bin on a By User
 * row that has no login behind it, so there is no login to delete. The removal
 * is first saved as "switched off, nothing granted" (so `user_access_history`
 * records who removed what), then the row itself is deleted; its grants
 * cascade with it. A person WITH a login is deleted through `deleteUserLogin`.
 */
export async function removeUserAccess(email: string): Promise<Result> {
  if (!(await can("system_admin", "delete"))) return { ok: false, error: "Forbidden" };
  const e = email.trim().toLowerCase();
  if (!e) return { ok: false, error: "Choose the user." };
  const s = await createClient();
  const { error } = await s.rpc("save_user_permissions", { p_email: e, p_tree: [], p_active: false, p_note: "Access removed" });
  if (error) return { ok: false, error: error.message };
  const { error: delErr } = await createAdminClient().from("user_access").delete().eq("user_email", e);
  if (delErr) return { ok: false, error: delErr.message };
  await writeAudit({ action: "user_access.removed", entityType: "user_access", entityId: e });
  rev();
  return { ok: true };
}
