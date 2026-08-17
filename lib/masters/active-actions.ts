"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { activePatch } from "@/lib/masters/inactive";
import { getActiveEntity } from "@/lib/masters/active-registry";

export type SetActiveResult = { ok: true } | { ok: false; error: string };

/**
 * Switch one master row on or off, from its LISTING rather than its form.
 *
 * The client moved the Block control out of the create/edit screen and into the
 * row actions on 2026-08-17 (`active-registry.ts` has the wording). This is the
 * write half.
 *
 * ## THE STATE IS STATED POSITIVELY, ONCE
 *
 * `active` means "should this row be on?", and the inversion happens inside
 * `activePatch` — `is_active: true` but `inactive: false` are the same fact
 * spelled opposite ways, which is exactly the mistake worth making impossible.
 * Nothing here writes a column name or a boolean by hand.
 *
 * ## IT TAKES AN ENTITY KEY, NEVER A TABLE
 *
 * A server action is a public HTTP endpoint. A caller-supplied table name would
 * let anyone UPDATE anything the session's RLS permits, so the table comes from
 * the allowlist and an unknown key is refused. Same rule as `bulkSetActive`.
 *
 * ## BLOCKING IS GATED AS A DELETE, UNBLOCKING AS AN EDIT
 *
 * Deliberately asymmetric, and copied from `bulkSetActive` so the two cannot
 * drift. Switching a master OFF removes it from every picker in the app
 * (AGENTS.md, "Disabled rows"), which is the destructive direction and belongs
 * with `delete`; switching it back on is an ordinary edit. A single `edit` gate
 * would let a role that may correct a spelling also withdraw a master from
 * every screen that offers it.
 *
 * ## IT DOES NOT CONSULT THE DELETE GUARD, AND THAT IS THE POINT
 *
 * `deleteOrDeactivate` asks "is this row referenced?" because it is deciding
 * between deleting and deactivating. Here the operator has already decided:
 * they asked to block it. A row IN USE is the ordinary case for blocking — that
 * is what blocking is FOR, retiring a master that live documents still point at
 * — so refusing on a reference would refuse the main use.
 */
export async function setMasterActive(
  entityKey: string,
  id: string,
  active: boolean,
): Promise<SetActiveResult> {
  const entity = getActiveEntity(entityKey);
  if (!entity) return { ok: false, error: "Unknown entity" };
  if (!id) return { ok: false, error: "No record given" };

  if (!(await can(entity.module, active ? "edit" : "delete"))) {
    return { ok: false, error: "Forbidden" };
  }

  const s = await createClient();
  const { error } = await s
    .from(entity.table)
    .update(activePatch(entity.column, active))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: active ? "unblock" : "block",
    entityType: entity.table,
    entityId: id,
  });

  entity.revalidate.forEach((p) => revalidatePath(p));
  return { ok: true };
}
