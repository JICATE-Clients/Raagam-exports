"use server";

import { requirePermission } from "@/lib/auth/server";
import { listDispatchRecipients } from "./admin-service";

/**
 * One dispatch's recipients and their read state — the Log's drill-down.
 * The RPC checks `system_admin:view` itself; this gate is the friendlier
 * refusal in front of it. Types are NOT re-exported from this file: a
 * `"use server"` module that re-exports a type crashes at runtime.
 */
export async function loadDispatchRecipients(dispatchId: string) {
  await requirePermission("system_admin", "view");
  try {
    return { ok: true as const, rows: await listDispatchRecipients(dispatchId) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
