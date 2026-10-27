import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isCommsMissing } from "./service";
import type { MemberFilter, Workspace, WorkspacePerson } from "./workspace";

/**
 * Reads for the hub's workspace (0750). Every read is an RPC that decides, from
 * `auth.uid()`, what this caller may see — an ordinary member gets the active
 * directory, an owner / admin also gets the deactivated and the switched-off.
 * Nothing here uses the admin client.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (lib/comms/service.ts), with
 * two answers a screen must be able to draw instead of a stack trace:
 *   * `null` from getWorkspace() — 0750 is not applied yet;
 *   * WorkspaceDenied — the database refused THIS caller (42501), which is the
 *     permission-denied state, not a fault.
 */

export class WorkspaceDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDenied";
  }
}

class WorkspaceReadError extends Error {
  code: string | null;
  constructor(what: string, error: { message: string; code?: string | null }) {
    super(`Could not read ${what}: ${error.message}`);
    this.code = error.code ?? null;
  }
}

function fail(what: string, error: { message: string; code?: string | null }): never {
  if (error.code === "42501") throw new WorkspaceDenied(error.message);
  throw new WorkspaceReadError(what, error);
}

/**
 * The workspace and the caller's place in it, or null before 0750 is applied.
 * `cache()`: the hub layout and a page below it share one RPC.
 */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_workspace_me");
  if (error) {
    if (isCommsMissing(Object.assign(new Error(`comm_workspace_me: ${error.message}`), { code: error.code }))) return null;
    fail("the workspace", error);
  }
  return data as Workspace;
});

export async function listPeople(q: string | null, status: MemberFilter): Promise<{ rows: WorkspacePerson[]; total: number }> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_workspace_people", {
    p_q: q?.trim() || null,
    p_status: status,
    p_limit: 500,
    p_offset: 0,
  });
  if (error) fail("members", error);
  const rows = (data ?? []) as (WorkspacePerson & { total_count: number })[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/** One profile, or null when the id is unknown or not visible to the caller. */
export async function getPerson(userId: string): Promise<WorkspacePerson | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_workspace_person", { p_user: userId });
  if (error) {
    if (error.code === "22023") return null;
    fail("the member", error);
  }
  return ((data ?? []) as WorkspacePerson[])[0] ?? null;
}
