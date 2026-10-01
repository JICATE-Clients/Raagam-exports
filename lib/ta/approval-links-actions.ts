"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { emailConfigured } from "@/lib/email/send";
import { approvalFacts, issueApprovalLink, parseFiles, signedFiles } from "./approval-links-service";
import type {
  ApprovalLinkContact,
  ApprovalLinkInfo,
  ApprovalLinkStatus,
  SendApprovalLinkInput,
  SendApprovalLinkResult,
} from "./approval-links-types";

/**
 * TA Followup ▸ the buyer approval link (0668, 0672). Session client
 * throughout, so RLS (orders:view to read, orders:edit to write) is the guard
 * and `can()` the courteous half — the same stance as
 * `approvals-worklist-actions.ts`. The link itself is born in ONE place,
 * `issueApprovalLink`, whichever button asked for it.
 */

const LIST_PATH = "/orders/ta-followup";

/** The Customer master's contacts with an email, and the row's latest link. */
export async function getApprovalLinkInfo(approvalRowId: string): Promise<ApprovalLinkInfo | { error: string }> {
  if (!(await can("orders", "view"))) return { error: "Forbidden" };
  const sb = await createClient();
  const facts = await approvalFacts(sb, approvalRowId).catch(() => null);
  if (!facts) return { error: "That approval row no longer exists" };

  const [main, contacts, latest] = await Promise.all([
    // The customer's OWN Email (Customer master ▸ General) — the address most
    // often filled in. It leads the list; the Contacts tab's emails follow
    // (user 2026-10-01, screenshot 3196: "directly fetch from master").
    facts.customerId
      ? sb.from("customers").select("name, email").eq("id", facts.customerId).maybeSingle()
      : Promise.resolve({ data: null as { name: string | null; email: string | null } | null }),
    facts.customerId
      ? sb
          .from("customer_contacts")
          .select("contact_name, email_id, sno")
          .eq("customer_id", facts.customerId)
          .not("email_id", "is", null)
          .order("sno")
      : Promise.resolve({ data: [] as { contact_name: string | null; email_id: string | null }[] }),
    sb
      .from("ta_approval_links")
      .select(
        "status, recipient_email, recipient_name, created_at, expires_at, email_sent_at, decided_at, decided_by_name, decision_comment, auto_next, buyer_files",
      )
      .eq("approval_row_id", approvalRowId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const list: ApprovalLinkContact[] = [];
  const mainEmail = main.data?.email?.trim();
  if (mainEmail) list.push({ name: null, email: mainEmail });
  for (const c of (contacts.data ?? []) as { contact_name: string | null; email_id: string | null }[]) {
    const email = c.email_id?.trim();
    if (email && !list.some((x) => x.email.toLowerCase() === email.toLowerCase())) {
      list.push({ name: c.contact_name?.trim() || null, email });
    }
  }

  const l = latest.data;
  return {
    contacts: list,
    emailConfigured: emailConfigured(),
    latest: l
      ? {
          status: l.status as ApprovalLinkStatus,
          recipientEmail: l.recipient_email,
          recipientName: l.recipient_name,
          createdAt: l.created_at,
          expiresAt: l.expires_at,
          emailSentAt: l.email_sent_at,
          decidedAt: l.decided_at,
          decidedByName: l.decided_by_name,
          decisionComment: l.decision_comment,
          autoNext: !!l.auto_next,
          buyerFiles: await signedFiles(parseFiles(l.buyer_files)),
        }
      : null,
  };
}

const sendInput = z.object({
  approvalRowId: z.string().uuid(),
  email: z.string().trim().email("Enter a valid email address").max(320),
  name: z.string().trim().max(120),
  message: z.string().trim().max(2000),
  files: z
    .array(z.object({ path: z.string().min(1).max(500), name: z.string().max(255), mime: z.string().max(120).nullable() }))
    .max(10),
  autoNext: z.boolean(),
});

/**
 * Mints a link for ONE sent approval, revokes any older open link on the same
 * row, and emails it. The URL is returned either way — shown once to copy —
 * because email may not be configured yet, and a link sent over WhatsApp is
 * still a link the buyer can answer.
 */
export async function sendApprovalLink(input: SendApprovalLinkInput): Promise<SendApprovalLinkResult> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details" };
  const p = parsed.data;

  const sb = await createClient();
  const facts = await approvalFacts(sb, p.approvalRowId).catch(() => null);
  if (!facts) return { ok: false, error: "That approval row no longer exists" };
  if (facts.status !== "sent") {
    return { ok: false, error: "Mark the approval Sent first — a link is for an item the buyer has received." };
  }
  // Files must live under this row's own folder: a path from elsewhere in the
  // bucket would otherwise be served to the buyer through a signed URL.
  const prefix = `${facts.amendmentId}/${facts.rowId}/`;
  const files = parseFiles(p.files);
  if (files.some((f) => !f.path.startsWith(prefix) || f.path.includes(".."))) {
    return { ok: false, error: "A file is not attached to this approval" };
  }

  const res = await issueApprovalLink(sb, facts, {
    email: p.email,
    name: p.name || null,
    message: p.message || null,
    files,
    autoNext: p.autoNext,
  });
  if (!res.ok) return res;

  await writeAudit({
    action: "ta_approval.link_sent",
    entityType: "garment_order_amendment_ta_approvals",
    entityId: facts.rowId,
    metadata: { to: p.email, emailed: res.emailed, approval: facts.approval, order: facts.orderRef, autoNext: p.autoNext },
  });
  revalidatePath(LIST_PATH);
  return { ok: true, url: res.url, emailed: res.emailed, emailNote: res.emailNote };
}

/**
 * RESEND (0672) — one click, same buyer, message, files and chain choice as
 * the open link, with a fresh token and a fresh 14 days. Only the token's hash
 * is stored, so the same link cannot be sent twice: the old one is revoked and
 * its page tells the buyer to use the newest email.
 */
export async function resendApprovalLink(approvalRowId: string): Promise<SendApprovalLinkResult> {
  if (!(await can("orders", "edit"))) return { ok: false, error: "Forbidden" };
  if (!z.string().uuid().safeParse(approvalRowId).success) return { ok: false, error: "No approval given" };

  const sb = await createClient();
  const facts = await approvalFacts(sb, approvalRowId).catch(() => null);
  if (!facts) return { ok: false, error: "That approval row no longer exists" };
  if (facts.status !== "sent") return { ok: false, error: "This approval is no longer waiting for the buyer." };

  const { data: open } = await sb
    .from("ta_approval_links")
    .select("recipient_email, recipient_name, message, files, auto_next")
    .eq("approval_row_id", approvalRowId)
    .eq("status", "open")
    .maybeSingle();
  if (!open) return { ok: false, error: "There is no open link to resend — send a new one instead." };

  const res = await issueApprovalLink(sb, facts, {
    email: String(open.recipient_email),
    name: open.recipient_name ?? null,
    message: open.message ?? null,
    files: parseFiles(open.files),
    autoNext: !!open.auto_next,
  });
  if (!res.ok) return res;

  await writeAudit({
    action: "ta_approval.link_resent",
    entityType: "garment_order_amendment_ta_approvals",
    entityId: facts.rowId,
    metadata: { to: open.recipient_email, emailed: res.emailed, approval: facts.approval, order: facts.orderRef },
  });
  revalidatePath(LIST_PATH);
  return { ok: true, url: res.url, emailed: res.emailed, emailNote: res.emailNote };
}
