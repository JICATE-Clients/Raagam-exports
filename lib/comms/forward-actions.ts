"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";
import { allow } from "@/lib/rate-limit";
import { sendMessage } from "./actions";
import { listMyConversations } from "./service";
import { COMM_BUCKET, MESSAGE_MAX, type ConversationKind, type Visibility } from "./types";

/**
 * FORWARD A PHOTO (0812; user 2026-11-05, the "forward an image" board).
 *
 * A forward is an ordinary send whose photos were copied, not uploaded:
 *
 *   1. the SOURCE is read with the caller's client, so RLS decides whether
 *      they may see the message at all — and only its images are taken;
 *   2. each target must be one of the caller's own, open conversations
 *      (comm_my_conversations), checked BEFORE any byte is copied;
 *   3. the bytes are copied with the service role to a NEW key in the target's
 *      folder — never shared, because comm_attachments.storage_path is unique
 *      and deleting the original removes its bytes (deleteMessage);
 *   4. the copy gets its comm_upload_checks row (its source was inspected when
 *      it was first attached, and the type and size are storage's own), and
 *      sendMessage sends it — the same RPC, the same rules, as a typed message;
 *   5. comm_mark_forwarded labels the new message.
 *
 * A failure at one target does not undo the others; the result says how many
 * landed. A copy whose send did not land is removed on the spot.
 */

const MAX_TARGETS = 10;
const uuid = z.string().uuid();
const forwardInput = z.object({
  message_id: uuid,
  targets: z
    .array(z.object({ conversation_id: uuid, client_id: uuid }))
    .min(1)
    .max(MAX_TARGETS),
  caption: z.string().max(MESSAGE_MAX).nullable().default(null),
});
export type ForwardInput = z.input<typeof forwardInput>;

export type ForwardTarget = {
  id: string;
  kind: ConversationKind;
  title: string;
  other_user_id: string | null;
  visibility: Visibility;
  last_message_at: string | null;
};

type Fail = { ok: false; error: string };

/** Where the caller may forward to: their own conversations, newest first, closed channels left out. */
export async function forwardTargets(): Promise<{ ok: true; targets: ForwardTarget[] } | Fail> {
  const me = await getAppUser();
  if (!me) return { ok: false, error: "You are signed out." };
  try {
    const rows = await listMyConversations();
    return {
      ok: true,
      targets: rows
        .filter((c) => !c.is_archived)
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          title: c.title,
          other_user_id: c.other_user_id,
          visibility: c.visibility,
          last_message_at: c.last_message_at,
        })),
    };
  } catch {
    return { ok: false, error: "Your chats could not be loaded." };
  }
}

export async function forwardPhotos(
  input: ForwardInput,
): Promise<{ ok: true; sent: number; failed: number; error: string | null } | Fail> {
  const parsed = forwardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That forward could not be read." };
  const d = parsed.data;
  const me = await getAppUser();
  if (!me) return { ok: false, error: "You are signed out." };
  if (!allow(`comm-forward:${me.id}`, 10, 60_000)) return { ok: false, error: "You are forwarding too fast. Wait a moment." };

  // 1. The source, as the caller sees it.
  const s = await createClient();
  const { data: msg, error: msgErr } = await s
    .from("comm_messages")
    .select("id, deleted_at, comm_attachments!message_id(file_name, storage_path, mime_type, size_bytes)")
    .eq("id", d.message_id)
    .maybeSingle();
  if (msgErr || !msg) return { ok: false, error: "That message could not be found." };
  const src = msg as unknown as {
    deleted_at: string | null;
    comm_attachments: { file_name: string; storage_path: string; mime_type: string; size_bytes: number }[] | null;
  };
  if (src.deleted_at) return { ok: false, error: "That message was deleted." };
  const photos = (src.comm_attachments ?? []).filter((a) => a.mime_type.toLowerCase().startsWith("image/"));
  if (photos.length === 0) return { ok: false, error: "That message has no photo to forward." };

  // 2. Every target is one of the caller's own open chats.
  const mine = await forwardTargets();
  if (!mine.ok) return mine;
  const open = new Set(mine.targets.map((t) => t.id));
  const targets = [...new Map(d.targets.map((t) => [t.conversation_id, t])).values()];
  if (targets.some((t) => !open.has(t.conversation_id))) {
    return { ok: false, error: "You can forward only to chats you are in." };
  }

  const caption = d.caption && d.caption.trim() ? d.caption.trim() : null;
  const admin = createAdminClient();
  let sent = 0;
  let lastError: string | null = null;

  for (const t of targets) {
    const copies: { storage_path: string; file_name: string; mime_type: string; size_bytes: number }[] = [];
    const drop = async () => {
      if (copies.length === 0) return;
      const paths = copies.map((c) => c.storage_path);
      await admin.storage.from(COMM_BUCKET).remove(paths);
      await admin.from("comm_upload_checks").delete().in("storage_path", paths);
    };

    // 3–4. Copy each photo to a fresh key in the target's folder and check it in.
    let copyFailed = false;
    for (const p of photos) {
      const ext = (p.storage_path.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "jpg").toLowerCase();
      const dest = `${t.conversation_id}/${crypto.randomUUID()}.${ext}`;
      const { error: cpErr } = await admin.storage.from(COMM_BUCKET).copy(p.storage_path, dest);
      if (cpErr) {
        copyFailed = true;
        break;
      }
      copies.push({ storage_path: dest, file_name: p.file_name, mime_type: p.mime_type, size_bytes: p.size_bytes });
      const { error: chkErr } = await admin.from("comm_upload_checks").upsert({
        storage_path: dest,
        conversation_id: t.conversation_id,
        owner_id: me.id,
        mime_type: p.mime_type,
        size_bytes: p.size_bytes,
      });
      if (chkErr) {
        copyFailed = true;
        break;
      }
    }
    if (copyFailed) {
      await drop();
      lastError = "A photo could not be copied. Try again.";
      continue;
    }

    const r = await sendMessage({ conversation_id: t.conversation_id, client_id: t.client_id, body: caption, attachments: copies });
    if (!r.ok) {
      await drop();
      lastError = r.error;
      continue;
    }
    // A replay of a forward that already landed: these copies are surplus.
    if (!r.created) await drop();
    else {
      // 5. The label. Before 0812 is applied the function is missing; the
      // photo has still been forwarded, it simply is not labelled.
      await s.rpc("comm_mark_forwarded", { p_message: r.id });
    }
    sent += 1;
  }

  return { ok: true, sent, failed: targets.length - sent, error: lastError };
}
