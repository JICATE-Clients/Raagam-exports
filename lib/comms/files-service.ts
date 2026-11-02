import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ConversationKind } from "./types";

/**
 * Pulse ▸ Files (user 2026-10-31, the Pulse Communities mockup): every file
 * shared in the person's chats, groups, channels and Announcements, newest
 * first.
 *
 * NO NEW FUNCTION, NO MIGRATION. `comm_attachments` already carries its
 * conversation, uploader and date, and its SELECT policy is
 * `comm_message_visible(message_id)` (0737) — exactly the files whose message
 * the person may read, including the cut-off for someone who left. A file on a
 * deleted message is dropped here (its row outlives the delete until the
 * nightly sweep).
 */

export type FileKind = "doc" | "sheet" | "pdf" | "image" | "other";

export interface PulseFile {
  id: string;
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  conversation_kind: ConversationKind | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
  uploaded_by_name: string | null;
  kind: FileKind;
}

export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv" || ["xls", "xlsx", "csv", "ods"].includes(ext)) return "sheet";
  if (m.includes("word") || m.includes("document") || m.includes("presentation") || m.startsWith("text/") || ["doc", "docx", "odt", "txt", "ppt", "pptx", "rtf"].includes(ext))
    return "doc";
  return "other";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECT =
  "id, message_id, conversation_id, file_name, mime_type, size_bytes, storage_path, uploaded_by, created_at, comm_messages!message_id(deleted_at)";

type Row = {
  id: string;
  message_id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
  comm_messages: { deleted_at: string | null } | null;
};

async function hydrate(rows: Row[]): Promise<PulseFile[]> {
  const live = rows.filter((r) => !r.comm_messages?.deleted_at);
  if (live.length === 0) return [];
  const s = await createClient();
  const convIds = Array.from(new Set(live.map((r) => r.conversation_id)));
  const people = Array.from(new Set(live.map((r) => r.uploaded_by).filter((v): v is string => !!v && UUID_RE.test(v))));
  const { data: { user } } = await s.auth.getUser();
  const [convR, namesR, membersR] = await Promise.all([
    s.from("comm_conversations").select("id, kind, name").in("id", convIds),
    people.length ? s.rpc("creator_names", { ids: people }) : Promise.resolve({ data: [], error: null }),
    // A direct chat is titled after the OTHER person.
    s.from("comm_members").select("conversation_id, user_id").in("conversation_id", convIds),
  ]);
  if (convR.error) throw new Error(`Could not read conversations: ${convR.error.message}`);
  if (namesR.error) throw new Error(`Could not read names: ${namesR.error.message}`);
  if (membersR.error) throw new Error(`Could not read members: ${membersR.error.message}`);
  const convs = new Map(((convR.data ?? []) as { id: string; kind: ConversationKind; name: string | null }[]).map((c) => [c.id, c]));
  const directOther = new Map<string, string>();
  for (const m of (membersR.data ?? []) as { conversation_id: string; user_id: string }[]) {
    if (m.user_id !== user?.id && convs.get(m.conversation_id)?.kind === "direct") directOther.set(m.conversation_id, m.user_id);
  }
  const otherIds = Array.from(new Set(directOther.values())).filter((id) => !people.includes(id));
  const extra = otherIds.length ? await s.rpc("creator_names", { ids: otherIds }) : { data: [], error: null };
  if (extra.error) throw new Error(`Could not read names: ${extra.error.message}`);
  const names = new Map(
    ([...((namesR.data ?? []) as { id: string; full_name: string | null }[]), ...((extra.data ?? []) as { id: string; full_name: string | null }[])]).map(
      (p) => [p.id, p.full_name],
    ),
  );
  return live.map((r) => {
    const c = convs.get(r.conversation_id);
    const title =
      c?.kind === "channel"
        ? `# ${c.name ?? "channel"}`
        : c?.kind === "direct"
          ? names.get(directOther.get(r.conversation_id) ?? "") ?? "Direct message"
          : c?.name?.trim() || "Group";
    return {
      id: r.id,
      message_id: r.message_id,
      conversation_id: r.conversation_id,
      conversation_title: title,
      conversation_kind: c?.kind ?? null,
      file_name: r.file_name,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      storage_path: r.storage_path,
      created_at: r.created_at,
      uploaded_by_name: r.uploaded_by === user?.id ? "You" : r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
      kind: fileKind(r.mime_type, r.file_name),
    };
  });
}

/** The newest 200 files the person may read. */
export async function listMyFiles(): Promise<PulseFile[]> {
  const s = await createClient();
  const { data, error } = await s.from("comm_attachments").select(SELECT).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not read files: ${error.message}`);
  return hydrate((data ?? []) as unknown as Row[]);
}

/** One file, or null when it does not exist or the person may not read it. */
export async function getFile(id: string): Promise<PulseFile | null> {
  if (!UUID_RE.test(id)) return null;
  const s = await createClient();
  const { data, error } = await s.from("comm_attachments").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  if (!data) return null;
  return (await hydrate([data as unknown as Row]))[0] ?? null;
}
