import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getFile } from "@/lib/comms/files-service";
import { FileView } from "@/components/comms/file-view";

/**
 * One file from Pulse ▸ Files. `getFile` reads through RLS
 * (`comm_message_visible`), so a file the person may not read — or a guessed
 * id — renders not-found. Drawn beside Pulse's list (comms-shell.tsx).
 */
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requirePermission("communication", "view")]);
  const file = await getFile(id);
  if (!file) notFound();
  return <FileView key={id} file={file} />;
}
