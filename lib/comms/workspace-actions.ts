"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { commErrorText } from "./types";
import { getPerson } from "./workspace-service";
import {
  setActiveInput,
  setRoleInput,
  workspaceSettingsInput,
  type SetActiveInput,
  type SetRoleInput,
  type WorkspacePerson,
  type WorkspaceSettingsInput,
} from "./workspace";

/**
 * Writes for the hub's workspace (0750).
 *
 * THE GUARD IS THE RPC (lib/comms/actions.ts says why at length). Each one
 * takes the actor from `auth.uid()` and re-checks the caller's workspace role,
 * the target's rank, self-changes, super admins and the ERP account status — so
 * a request built around this file is refused by Postgres the same way. This
 * file adds Zod at the door, a sentence instead of a driver message, and the
 * audit row (0737: membership / admin acts are audited from the server action).
 *
 * A NO-OP IS NOT AUDITED. Both member RPCs return whether anything changed;
 * setting a role someone already has writes nothing, logs nothing and says so.
 */

type Fail = { ok: false; error: string };
type Done = { ok: true; changed: boolean };

function fail(error: string): Fail {
  return { ok: false, error };
}

function revHub(): void {
  revalidatePath("/comms", "layout");
}

export async function updateWorkspaceSettings(input: WorkspaceSettingsInput): Promise<Done | Fail> {
  const parsed = workspaceSettingsInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the workspace settings.");
  const v = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_workspace_update", {
    p_name: v.name,
    p_description: v.description,
    p_status: v.status,
    p_members_can_create_groups: v.members_can_create_groups,
  });
  if (error) return fail(commErrorText(error, "The workspace settings could not be saved."));
  await writeAudit({
    action: "comms.workspace.update",
    entityType: "comm_workspace",
    metadata: { name: v.name, status: v.status, members_can_create_groups: v.members_can_create_groups },
  });
  revHub();
  return { ok: true, changed: true };
}

export async function setWorkspaceRole(input: SetRoleInput): Promise<Done | Fail> {
  const parsed = setRoleInput.safeParse(input);
  if (!parsed.success) return fail("Choose owner, admin or member.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_workspace_set_role", {
    p_user: parsed.data.user_id,
    p_role: parsed.data.role,
  });
  if (error) return fail(commErrorText(error, "The role could not be changed."));
  const changed = data === true;
  if (changed) {
    await writeAudit({
      action: "comms.workspace.set_role",
      entityType: "profile",
      entityId: parsed.data.user_id,
      metadata: { role: parsed.data.role },
    });
    revHub();
  }
  return { ok: true, changed };
}

export async function setWorkspaceActive(input: SetActiveInput): Promise<Done | Fail> {
  const parsed = setActiveInput.safeParse(input);
  if (!parsed.success) return fail("Keep the reason to 250 characters.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_workspace_set_active", {
    p_user: parsed.data.user_id,
    p_active: parsed.data.active,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return fail(commErrorText(error, parsed.data.active ? "The member could not be reactivated." : "The member could not be deactivated."));
  }
  const changed = data === true;
  if (changed) {
    await writeAudit({
      action: parsed.data.active ? "comms.workspace.reactivate" : "comms.workspace.deactivate",
      entityType: "profile",
      entityId: parsed.data.user_id,
      metadata: parsed.data.active ? {} : { reason: parsed.data.reason },
    });
    revHub();
  }
  return { ok: true, changed };
}

/** A profile for the sheet. Null = not found, or not visible to this caller. */
export async function loadWorkspacePerson(userId: string): Promise<{ ok: true; person: WorkspacePerson | null } | Fail> {
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) return { ok: true, person: null };
  try {
    return { ok: true, person: await getPerson(userId) };
  } catch (e) {
    return fail(e instanceof Error && e.name === "WorkspaceDenied" ? e.message : "The profile could not be loaded.");
  }
}
