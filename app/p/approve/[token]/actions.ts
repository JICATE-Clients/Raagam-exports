"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { allow, clientIp } from "@/lib/rate-limit";
import {
  approvalFacts,
  continueChain,
  hashToken,
  isPpSample,
  notifyMerchandiser,
} from "@/lib/ta/approval-links-service";
import {
  APPROVAL_LINK_BUCKET,
  BUYER_FILE_MAX_BYTES,
  BUYER_FILE_MAX_COUNT,
  BUYER_FILE_TYPES,
  DECIDE_REFUSAL,
  TOKEN_RE,
  type ApprovalLinkFile,
  type BuyerUploadTarget,
  type DecideLinkResult,
} from "@/lib/ta/approval-links-types";

/**
 * The buyer's Approve / Rework (0668, 0672). PUBLIC — this endpoint answers a
 * caller with no session, so the TOKEN is the whole authorisation: it is hashed
 * here and handed to `ta_link_decide`, which is executable by `service_role`
 * only and does every check itself (open, unexpired, row still `sent` at the
 * link's version, every attached path inside this link's own buyer folder).
 *
 * RATE LIMITED per address (lib/rate-limit.ts — per instance, see its header).
 */

const TOO_MANY = "Too many attempts. Please wait a minute and try again.";

export async function decideApprovalLink(
  token: string,
  decision: "approved" | "rework",
  name: string,
  comment: string,
  files: ApprovalLinkFile[] = [],
): Promise<DecideLinkResult> {
  if (!allow(`decide:${await clientIp()}`, 20, 60_000)) return { ok: false, error: TOO_MANY };
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, error: DECIDE_REFUSAL.not_found };
  if (decision !== "approved" && decision !== "rework") return { ok: false, error: DECIDE_REFUSAL.bad_decision };
  const cleanFiles = (Array.isArray(files) ? files : []).slice(0, BUYER_FILE_MAX_COUNT).map((f) => ({
    path: String(f?.path ?? "").slice(0, 500),
    name: String(f?.name ?? "File").slice(0, 255),
    mime: f?.mime ? String(f.mime).slice(0, 120) : null,
  }));

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ta_link_decide", {
    p_token_hash: hashToken(token),
    p_decision: decision,
    p_name: String(name ?? "").slice(0, 200),
    p_comment: String(comment ?? "").slice(0, 4000),
    p_files: cleanFiles,
  });
  if (error) return { ok: false, error: "Your answer could not be saved. Please try again." };

  const res = data as {
    ok: boolean;
    reason?: string;
    approval_row_id?: string;
    auto_next?: boolean;
    recipient_email?: string;
    recipient_name?: string | null;
    file_count?: number;
  };
  if (!res?.ok) return { ok: false, error: DECIDE_REFUSAL[res?.reason ?? ""] ?? "Your answer could not be saved." };

  // Tell the merchandiser, then continue the chain. Best-effort: the decision
  // is already committed and nothing below may undo it.
  try {
    const facts = res.approval_row_id ? await approvalFacts(admin, res.approval_row_id) : null;
    if (facts) {
      const who = String(name).trim();
      const order = facts.orderRef ? ` (${facts.orderRef})` : "";
      if (decision === "approved") {
        // PP SAMPLE UNLOCKS CUTTING. The Cutting Room Safety Lock
        // (lib/ta/worklist-actions.ts `cuttingBlockedReason`) reads only this
        // row's status, which the RPC just set to `approved` — so the lock is
        // already open; this line makes sure somebody hears about it.
        const cutting = isPpSample(facts) ? " Cutting can start for this order." : "";
        await notifyMerchandiser(
          facts,
          `${facts.approval} approved by buyer${order}`,
          `${who} approved it through the email link.${cutting}`,
          "success",
        );
        if (res.auto_next && res.recipient_email) {
          await continueChain(admin, facts, { email: res.recipient_email, name: res.recipient_name ?? null });
        }
      } else {
        const attached = res.file_count ? ` (${res.file_count} file${res.file_count === 1 ? "" : "s"} attached)` : "";
        await notifyMerchandiser(
          facts,
          `${facts.approval}: buyer asked for rework${order}`,
          `${who}: ${String(comment).trim().slice(0, 300)}${attached}`,
          "warning",
        );
      }
    }
  } catch {
    // never undo a saved decision over a notification
  }

  revalidatePath("/orders/ta-followup");
  return { ok: true, decision };
}

/**
 * Where the buyer's attachment goes (0672). Checks the link is still open, the
 * file is an allowed type and size, and returns a ONE-FILE signed upload URL
 * under this link's own folder — the browser uploads straight to private
 * storage, so the file never passes through this server and no bucket policy
 * is opened to the public. `ta_link_decide` later refuses any path outside
 * that folder.
 */
export async function buyerUploadTarget(
  token: string,
  fileName: string,
  mime: string,
  size: number,
): Promise<BuyerUploadTarget> {
  if (!allow(`upload:${await clientIp()}`, 15, 10 * 60_000)) return { ok: false, error: TOO_MANY };
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, error: DECIDE_REFUSAL.not_found };
  if (!BUYER_FILE_TYPES.includes(mime)) return { ok: false, error: "Only photos (JPG, PNG, WebP) or PDF files can be attached." };
  if (!Number.isFinite(size) || size <= 0 || size > BUYER_FILE_MAX_BYTES) {
    return { ok: false, error: `Each file can be at most ${Math.round(BUYER_FILE_MAX_BYTES / 1_048_576)} MB.` };
  }

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("ta_approval_links")
    .select("id, approval_row_id, amendment_id, status, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!link) return { ok: false, error: DECIDE_REFUSAL.not_found };
  if (link.status !== "open" || new Date(link.expires_at as string).getTime() < Date.now()) {
    return { ok: false, error: DECIDE_REFUSAL[String(link.status)] ?? DECIDE_REFUSAL.expired };
  }

  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  const path = `${link.amendment_id}/${link.approval_row_id}/buyer/${link.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(APPROVAL_LINK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "The file could not be prepared for upload. Please try again." };
  return { ok: true, path, uploadToken: data.token, name: String(fileName ?? "File").slice(0, 255) };
}
