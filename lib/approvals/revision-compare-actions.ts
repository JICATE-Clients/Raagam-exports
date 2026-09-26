"use server";

import { requireUser } from "@/lib/auth/server";
import { loadRevisionCompare, type RevisionCompare } from "./revision-compare";

/**
 * The approval sheet's comparison, fetched when it opens. Signed-in only, the
 * same gate as `/approvals` itself; what the caller may READ is RLS's answer,
 * as it is on the revision page. No type is re-exported from here — a
 * "use server" file that does crashes at runtime (see `RevisionCompare`'s own
 * module for the type).
 */
export async function revisionCompareAction(entryId: string): Promise<RevisionCompare> {
  await requireUser();
  return loadRevisionCompare(entryId);
}
