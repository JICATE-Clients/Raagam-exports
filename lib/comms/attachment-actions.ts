"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";
import { allow } from "@/lib/rate-limit";
import { SNIFF_BYTES, sniffProblem } from "./file-sniff";
import { ALLOWED_MIME, ATTACHMENT_MAX_BYTES, COMM_BUCKET } from "./types";

/**
 * Attachment checks and links (0761).
 *
 * UPLOADS STILL GO STRAIGHT TO STORAGE from the browser (0737): the bucket is
 * private, its insert policy admits only an active member into the
 * conversation's folder, and it enforces the size and type allowlist itself.
 * What this file adds is the step 0737 never had — LOOKING AT THE BYTES:
 *
 *   verifyUpload(path)  the caller's own object (comm_upload_facts) → its first
 *                       8 KB read with the service role → file-sniff.ts → a
 *                       comm_upload_checks row, which comm_send_message
 *                       REQUIRES. A mismatch is deleted on the spot.
 *   discardUpload(path) a chip removed before sending: the caller's own,
 *                       unattached object is deleted now rather than waiting
 *                       for the nightly sweep.
 *
 * The service role is used for exactly three things here — reading bytes the
 * caller was just shown to own, deleting them, and writing the check row
 * (which no browser can) — never to decide WHO may see a file. Links are
 * signed with the CALLER's client, so storage's read policy
 * (comm_can_read_file → can this person read the message?) decides every one.
 */

type Fail = { ok: false; error: string };
function fail(error: string): Fail {
  return { ok: false, error };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The only key shape this app ever writes (attachmentPath): conv/uuid.ext. */
const KEY_RE = new RegExp(`^${UUID}/${UUID}\\.[a-z0-9]{1,8}$`, "i");
export async function isAttachmentKey(path: unknown): Promise<boolean> {
  return typeof path === "string" && KEY_RE.test(path);
}

type Facts = { conversation_id: string; size_bytes: number | null; mime_type: string; attached: boolean };

async function factsFor(path: string): Promise<{ facts: Facts | null; installed: boolean } | Fail> {
  const s = await createClient();
  const { data, error } = await s.rpc("comm_upload_facts", { p_path: path });
  if (error) {
    // Before 0761 is applied the function is missing; uploads then behave as
    // they did under 0737 (the send RPC does not ask for a check either).
    if (error.code === "PGRST202" || error.code === "42883") return { facts: null, installed: false };
    return fail("The file could not be checked.");
  }
  return { facts: ((data ?? []) as Facts[])[0] ?? null, installed: true };
}

export async function verifyUpload(path: string): Promise<{ ok: true } | Fail> {
  if (!(await isAttachmentKey(path))) return fail("That file could not be found.");
  const me = await getAppUser();
  if (!me) return fail("You are signed out.");
  if (!allow(`comm-upload:${me.id}`, 60, 60_000)) return fail("You are uploading too fast. Wait a moment.");

  const f = await factsFor(path);
  if ("ok" in f) return f;
  if (!f.installed) return { ok: true };
  const facts = f.facts;
  if (!facts) return fail("That upload could not be found. Attach the file again.");
  if (facts.attached) return fail("That file is already attached to a message.");

  const admin = createAdminClient();
  const drop = async (why: string): Promise<Fail> => {
    await admin.storage.from(COMM_BUCKET).remove([path]);
    return fail(why);
  };
  if (!facts.size_bytes || facts.size_bytes < 1 || facts.size_bytes > ATTACHMENT_MAX_BYTES) {
    return drop("Files must be under 20 MB.");
  }
  if (!(ALLOWED_MIME as readonly string[]).includes(facts.mime_type)) return drop("That file type cannot be shared here.");

  // The first bytes only — a ranged read of a short-lived link, never the
  // whole 20 MB. Nothing about the content is logged.
  const signed = await admin.storage.from(COMM_BUCKET).createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return fail("The file could not be checked. Try again.");
  let head: Uint8Array;
  try {
    const res = await fetch(signed.data.signedUrl, { headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` } });
    if (!res.ok && res.status !== 206) return fail("The file could not be checked. Try again.");
    head = new Uint8Array(await res.arrayBuffer()).slice(0, SNIFF_BYTES);
  } catch {
    return fail("The file could not be checked. Try again.");
  }
  const problem = sniffProblem(facts.mime_type, head);
  if (problem) return drop(problem);

  const { error } = await admin.from("comm_upload_checks").upsert({
    storage_path: path,
    conversation_id: facts.conversation_id,
    owner_id: me.id,
    mime_type: facts.mime_type,
    size_bytes: facts.size_bytes,
  });
  if (error) return fail("The file could not be checked. Try again.");
  return { ok: true };
}

/** A pending chip removed: delete the caller's own, never-attached upload. */
export async function discardUpload(path: string): Promise<{ ok: true } | Fail> {
  if (!(await isAttachmentKey(path))) return { ok: true };
  const f = await factsFor(path);
  if ("ok" in f) return f;
  // Not yours, already attached, or 0761 not applied: leave it (the nightly
  // sweep handles a true orphan; an attached file is not this call's to remove).
  if (!f.installed || !f.facts || f.facts.attached) return { ok: true };
  const admin = createAdminClient();
  await admin.storage.from(COMM_BUCKET).remove([path]);
  await admin.from("comm_upload_checks").delete().eq("storage_path", path);
  return { ok: true };
}

export type AttachmentLink = { path: string; url: string | null; thumb: string | null };

/**
 * Short-lived links (10 min) for images in view — a thumbnail (when the
 * project's image transformation is available; the screen falls back to the
 * original if it is not) and the original. Signed with the CALLER's client:
 * a path they may not read yields no link.
 */
export async function attachmentLinks(paths: string[]): Promise<{ ok: true; links: AttachmentLink[] } | Fail> {
  const wanted = Array.from(new Set(paths)).filter((p) => KEY_RE.test(p)).slice(0, 60);
  if (wanted.length === 0) return { ok: true, links: [] };
  const s = await createClient();
  const { data, error } = await s.storage.from(COMM_BUCKET).createSignedUrls(wanted, 600);
  if (error) return fail("Previews could not be loaded.");
  const full = new Map((data ?? []).map((d) => [d.path ?? "", d.error ? null : d.signedUrl]));
  const thumbs = await Promise.all(
    wanted.map(async (p) => {
      if (!full.get(p)) return null;
      const t = await s.storage
        .from(COMM_BUCKET)
        .createSignedUrl(p, 600, { transform: { width: 480, height: 480, resize: "contain" } });
      return t.error ? null : t.data?.signedUrl ?? null;
    }),
  );
  return { ok: true, links: wanted.map((p, i) => ({ path: p, url: full.get(p) ?? null, thumb: thumbs[i] })) };
}

/**
 * A one-minute link that DOWNLOADS (Content-Disposition: attachment, under the
 * original file name) rather than opening in the browser.
 */
export async function attachmentDownloadUrl(path: string, fileName: string): Promise<{ ok: true; url: string } | Fail> {
  if (!KEY_RE.test(path)) return fail("That file could not be found.");
  const name = (typeof fileName === "string" && fileName.trim() ? fileName.trim() : "attachment").slice(0, 255);
  const s = await createClient();
  const { data, error } = await s.storage.from(COMM_BUCKET).createSignedUrl(path, 60, { download: name });
  if (error || !data?.signedUrl) return fail("That file could not be downloaded.");
  return { ok: true, url: data.signedUrl };
}
