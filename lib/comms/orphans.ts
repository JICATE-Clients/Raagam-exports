import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { COMM_BUCKET } from "./types";

/**
 * Delete Communication Hub uploads that never became an attachment (0761) —
 * a chip removed before sending, a send that failed, a tab closed mid-compose.
 * They are unreachable already (storage serves a comm-files object only to
 * someone who may read the message it is attached to, and these have none),
 * so this frees space; it never hides anything a person could see.
 *
 * A DAY OF GRACE: an upload younger than 24 h may still be about to be sent.
 * Bytes are removed through the storage API — deleting storage.objects rows in
 * SQL would leave the files behind. Runs inside the daily housekeeping job.
 */
export async function purgeOrphanCommFiles(): Promise<{ orphanFilesDeleted: number; error?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("comm_orphan_files", { p_hours: 24, p_limit: 500 });
  if (error) {
    // Before 0761 the sweep does not exist yet; that is not a failure of the job.
    if (error.code === "PGRST202" || error.code === "42883") return { orphanFilesDeleted: 0 };
    return { orphanFilesDeleted: 0, error: `comm orphan files: ${error.message}` };
  }
  const paths = ((data ?? []) as string[]).filter((p) => typeof p === "string");
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error: rmErr } = await admin.storage.from(COMM_BUCKET).remove(chunk);
    if (rmErr) return { orphanFilesDeleted: deleted, error: `comm orphan files: ${rmErr.message}` };
    await admin.from("comm_upload_checks").delete().in("storage_path", chunk);
    deleted += chunk.length;
  }
  return { orphanFilesDeleted: deleted };
}
