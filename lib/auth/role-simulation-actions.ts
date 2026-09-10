"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./server";
import { setPreviewedRoleCookie, getRolesPreview } from "./role-simulation";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Enter, change, or exit Role Preview. Pass every `roles.id` to hold at once
 * (an operator commonly holds more than one — see the note on
 * `AppUser.simulatedRoleIds`), or `[]` to return to the real Super Admin
 * identity.
 *
 * THE VALIDATION HERE IS THE SECURITY BOUNDARY, not the Topbar `<MultiSelect>`
 * that calls it — same reasoning `setCurrentLocation` gives for its own
 * re-check: a Server Action is a public endpoint, so `realIsSuperAdmin` and
 * every role id are re-checked against the database rather than trusted from
 * the client. `realIsSuperAdmin` specifically, never `isSuperAdmin` — a
 * session already mid-preview must still be able to change or exit it.
 */
export async function setRolePreview(roleIds: string[]): Promise<Result> {
  const user = await requireUser();
  if (!user.realIsSuperAdmin) {
    return { ok: false, error: "Only a Super Admin can preview roles." };
  }

  let validIds: string[] = [];
  if (roleIds.length > 0) {
    const supabase = await createClient();
    const preview = await getRolesPreview(supabase, roleIds);
    if (!preview) return { ok: false, error: "None of the selected roles exist anymore." };
    // A stale id quietly drops rather than failing the whole request — the
    // same fail-open reasoning `getAppUser()` applies when a cookie outlives
    // its role.
    validIds = preview.ids;
  }

  await setPreviewedRoleCookie(validIds);

  await writeAudit({
    action: validIds.length ? "role_preview.started" : "role_preview.exited",
    entityType: "roles",
    metadata: { roleIds: validIds.length ? validIds : user.simulatedRoleIds },
  });

  // Every nav surface and page guard reads `getAppUser()` off this same tree
  // (see the note on `getAppUser` in `lib/auth/server.ts`), so one revalidation
  // at the root is what makes a switch reach a screen already on-screen.
  revalidatePath("/", "layout");

  return { ok: true };
}
