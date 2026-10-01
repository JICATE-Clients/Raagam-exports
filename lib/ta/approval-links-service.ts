import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { fmtDate } from "@/lib/format";
import { sendEmail } from "@/lib/email/send";
import { SITE_URL, approvalLinkEmail, approvalReminderEmail } from "@/lib/email/approval-link";
import {
  APPROVAL_LINK_BUCKET,
  LINK_VALID_DAYS,
  type ApprovalLinkFile,
  type ApprovalLinkStatus,
} from "./approval-links-types";

/**
 * Buyer approval by link (0668) — server-only helpers shared by the TA
 * Followup action, the public page and the daily sweep.
 *
 * Reads take the CALLER'S client: the merchandiser's own session on the TA
 * Followup screen (RLS applies), the admin client on the public page and in
 * the sweep, where there is no session and the token / CRON_SECRET is the
 * authorisation.
 */

type SB = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/** 32 random bytes → 43 base64url characters. Never stored; only its hash is. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type ApprovalFacts = {
  rowId: string;
  amendmentId: string;
  approvalId: string | null;
  status: string;
  activeVersion: number;
  approval: string;
  /** `ta_approvals.short_name` — "PPSAMPLE" is how the Cutting lock finds PP Sample. */
  shortName: string | null;
  orderRef: string | null;
  customerId: string | null;
  customer: string | null;
  merchandiserId: string | null;
  /** The dispatch proof saved on Mark Sent (0672: shown to the buyer). */
  proofPath: string | null;
  proofMime: string | null;
  proofReference: string | null;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row) ?? null) : ((v as Row) ?? null));

/** The approval row and the few facts every surface names: item, RE No, customer. */
export async function approvalFacts(sb: SB, rowId: string): Promise<ApprovalFacts | null> {
  const { data, error } = await sb
    .from("garment_order_amendment_ta_approvals")
    .select(
      "id, amendment_id, approval_id, status, active_version, proof_path, mime_type, proof_reference, approval:ta_approvals(name, short_name), amendment:garment_order_amendments(customer_id, merchandiser_id, customer:customers(name), sales_order:sales_orders(order_number))",
    )
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(`The approval could not be read: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as Row;
  const amendment = one(r.amendment);
  return {
    rowId: String(r.id),
    amendmentId: String(r.amendment_id),
    approvalId: str(r.approval_id),
    status: String(r.status),
    activeVersion: Number(r.active_version ?? 1),
    approval: str(one(r.approval)?.name) ?? "Approval",
    shortName: str(one(r.approval)?.short_name),
    orderRef: str(one(amendment?.sales_order)?.order_number),
    customerId: str(amendment?.customer_id),
    customer: str(one(amendment?.customer)?.name),
    merchandiserId: str(amendment?.merchandiser_id),
    proofPath: str(r.proof_path),
    proofMime: str(r.mime_type),
    proofReference: str(r.proof_reference),
  };
}

/** PP Sample, found the way the Cutting Room Safety Lock finds it. */
export function isPpSample(facts: Pick<ApprovalFacts, "shortName">): boolean {
  return (facts.shortName ?? "").replace(/\s+/g, "").toUpperCase() === "PPSAMPLE";
}

export function parseFiles(v: unknown): ApprovalLinkFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((f) => f as Row)
    .filter((f) => typeof f?.path === "string")
    .map((f) => ({ path: String(f.path), name: str(f.name) ?? "File", mime: str(f.mime) }));
}

/** Signed URLs for the buyer page — short-lived, minted by the admin client. */
export async function signedFiles(
  files: ApprovalLinkFile[],
  ttlSeconds = 600,
): Promise<(ApprovalLinkFile & { url: string | null })[]> {
  if (!files.length) return [];
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(APPROVAL_LINK_BUCKET)
    .createSignedUrls(
      files.map((f) => f.path),
      ttlSeconds,
    );
  return files.map((f, i) => ({ ...f, url: data?.[i]?.signedUrl ?? null }));
}

export type PublicLinkView =
  | { state: "invalid" }
  | {
      state: "open" | "closed";
      status: ApprovalLinkStatus;
      approval: string;
      orderRef: string | null;
      customer: string | null;
      message: string | null;
      recipientName: string | null;
      expiresOn: string;
      decidedByName: string | null;
      decidedOn: string | null;
      files: (ApprovalLinkFile & { url: string | null })[];
      /** The dispatch proof saved on Mark Sent, and its courier reference (0672). */
      proof: (ApprovalLinkFile & { url: string | null }) | null;
      proofReference: string | null;
    };

/**
 * What the public page may show for a token — and nothing more: the item, the
 * RE No, the customer's name, the merchandiser's message and the files.
 */
export async function publicLinkView(token: string): Promise<PublicLinkView> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("ta_approval_links")
    .select(
      "id, approval_row_id, version, status, expires_at, message, recipient_name, files, decided_at, decided_by_name",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!link) return { state: "invalid" };

  const facts = await approvalFacts(admin, link.approval_row_id as string);
  if (!facts) return { state: "invalid" };

  let status = link.status as ApprovalLinkStatus;
  if (status === "open" && new Date(link.expires_at as string).getTime() < Date.now()) status = "expired";
  // Mirrors the RPC's own refusal, so the page does not offer buttons the
  // decision would refuse. The RPC is still the guard.
  if (status === "open" && (facts.status !== "sent" || facts.activeVersion !== Number(link.version))) {
    status = "superseded";
  }
  const open = status === "open";
  return {
    state: open ? "open" : "closed",
    status,
    approval: facts.approval,
    orderRef: facts.orderRef,
    customer: facts.customer,
    message: str(link.message),
    recipientName: str(link.recipient_name),
    expiresOn: fmtDate(link.expires_at as string),
    decidedByName: str(link.decided_by_name),
    decidedOn: link.decided_at ? fmtDate(link.decided_at as string) : null,
    // Files only while the link is live — a closed link shows its outcome only.
    files: open ? await signedFiles(parseFiles(link.files)) : [],
    // THE DISPATCH PROOF (0672, digitalisation-plan §4: "the proof file
    // (signed URL, 10 min)"). Read from the approval row's own column, never
    // from a path the client sent, so it can only ever be this row's proof.
    proof:
      open && facts.proofPath
        ? (await signedFiles([{ path: facts.proofPath, name: "Dispatch proof", mime: facts.proofMime }]))[0] ?? null
        : null,
    proofReference: open ? facts.proofReference : null,
  };
}

/* ===========================================================================
 * ISSUING A LINK — one routine for every way a link is born: the Mark Sent
 * dialog, the "Email buyer link" sheet, Resend, the reminder sweep and the
 * automatic next link (0672). It revokes any open link on the row, stores
 * only the token's hash, emails the buyer, and stamps email_sent_at.
 * ======================================================================== */

export type IssueLinkInput = {
  email: string;
  name: string | null;
  message: string | null;
  files: ApprovalLinkFile[];
  autoNext: boolean;
  /** Keep an existing deadline (the reminder rotates a link, it does not extend it). */
  expiresAt?: string;
  /** Use the reminder wording instead of the first-send email. */
  reminderOf?: { sentOn: string };
};

export type IssueLinkResult =
  | { ok: true; url: string; linkId: string; emailed: boolean; emailNote: string | null }
  | { ok: false; error: string };

export async function issueApprovalLink(sb: SB, facts: ApprovalFacts, input: IssueLinkInput): Promise<IssueLinkResult> {
  const { error: revokeErr } = await sb
    .from("ta_approval_links")
    .update({ status: "revoked" })
    .eq("approval_row_id", facts.rowId)
    .eq("status", "open");
  if (revokeErr) return { ok: false, error: revokeErr.message };

  const token = mintToken();
  const expires = input.expiresAt ?? new Date(Date.now() + LINK_VALID_DAYS * 86_400_000).toISOString();
  const { data: link, error: insErr } = await sb
    .from("ta_approval_links")
    .insert({
      approval_row_id: facts.rowId,
      amendment_id: facts.amendmentId,
      version: facts.activeVersion,
      token_hash: hashToken(token),
      recipient_email: input.email,
      recipient_name: input.name,
      message: input.message,
      files: input.files,
      auto_next: input.autoNext,
      expires_at: expires,
      // A rotated reminder link must not be reminded about again.
      reminder_sent_at: input.reminderOf ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (insErr || !link) return { ok: false, error: insErr?.message ?? "The link could not be saved" };

  const url = `${SITE_URL}/p/approve/${token}`;
  const base = {
    url,
    recipientName: input.name,
    approval: facts.approval,
    orderRef: facts.orderRef,
    customer: facts.customer,
    message: input.message,
    expiresOn: fmtDate(expires),
  };
  const mail = input.reminderOf
    ? approvalReminderEmail({ ...base, sentOn: input.reminderOf.sentOn })
    : approvalLinkEmail(base);
  const sent = await sendEmail({ to: input.email, ...mail });
  if (sent.sent) {
    await sb.from("ta_approval_links").update({ email_sent_at: new Date().toISOString() }).eq("id", link.id);
  }
  return {
    ok: true,
    url,
    linkId: String(link.id),
    emailed: sent.sent,
    emailNote: sent.sent
      ? null
      : sent.reason === "not_configured"
        ? "Email is not set up yet, so nothing was sent. Copy the link and send it to the buyer yourself."
        : `The email could not be sent (${sent.detail ?? "unknown error"}). Copy the link and send it yourself.`,
  };
}

/* ===========================================================================
 * THE NEXT APPROVAL (0672, "send the next approval's link automatically").
 * An order's approval rows in `ta_approvals.sequence` order; "next" is the
 * first row after this one that is not yet approved. Only a row the buyer
 * has PHYSICALLY RECEIVED (status `sent`) ever gets a link — a link is for an
 * item in the buyer's hands, the rule `sendApprovalLink` already enforces.
 * ======================================================================== */

type OrderRow = { id: string; status: string; sequence: number; target: string };

async function orderRows(sb: SB, amendmentId: string): Promise<OrderRow[]> {
  const { data } = await sb
    .from("garment_order_amendment_ta_approvals")
    .select("id, status, target_date, approval:ta_approvals(sequence)")
    .eq("amendment_id", amendmentId);
  return ((data ?? []) as unknown as Row[])
    .map((r) => ({
      id: String(r.id),
      status: String(r.status),
      sequence: Number(one(r.approval)?.sequence ?? Number.MAX_SAFE_INTEGER),
      target: String(r.target_date ?? "9999-12-31"),
    }))
    .sort((a, b) => a.sequence - b.sequence || a.target.localeCompare(b.target) || a.id.localeCompare(b.id));
}

/** The row after `rowId` in its order that still needs an answer, or null. */
export async function nextApprovalRow(sb: SB, amendmentId: string, rowId: string): Promise<OrderRow | null> {
  const rows = await orderRows(sb, amendmentId);
  const at = rows.findIndex((r) => r.id === rowId);
  if (at < 0) return null;
  return rows.slice(at + 1).find((r) => r.status !== "approved") ?? null;
}

/**
 * The buyer approved `decided` through a link that asked for the chain: send
 * the next approval's link now if it is already Sent, or tell the
 * merchandiser it will go the moment they mark it Sent. Never throws.
 */
export async function continueChain(
  sb: SB,
  decided: ApprovalFacts,
  recipient: { email: string; name: string | null },
): Promise<void> {
  try {
    const next = await nextApprovalRow(sb, decided.amendmentId, decided.rowId);
    if (!next) return;
    const nextFacts = await approvalFacts(sb, next.id);
    if (!nextFacts) return;
    if (nextFacts.status !== "sent") {
      await notifyMerchandiser(
        nextFacts,
        `Next for the buyer: ${nextFacts.approval}${nextFacts.orderRef ? ` (${nextFacts.orderRef})` : ""}`,
        `${decided.approval} was approved. When you mark ${nextFacts.approval} Sent, its link goes to ${recipient.email} automatically.`,
        "info",
      );
      return;
    }
    const { data: open } = await sb
      .from("ta_approval_links")
      .select("id")
      .eq("approval_row_id", nextFacts.rowId)
      .eq("status", "open")
      .maybeSingle();
    if (open) return; // the buyer already has a live link for it
    const res = await issueApprovalLink(sb, nextFacts, {
      email: recipient.email,
      name: recipient.name,
      message: `Thank you for approving ${decided.approval}. Please review ${nextFacts.approval} next.`,
      files: [],
      autoNext: true,
    });
    if (res.ok) {
      await notifyMerchandiser(
        nextFacts,
        `Link sent automatically: ${nextFacts.approval}${nextFacts.orderRef ? ` (${nextFacts.orderRef})` : ""}`,
        `${recipient.email} approved ${decided.approval}, so the link for ${nextFacts.approval} was ${res.emailed ? "emailed" : "created (email is not set up — send it from TA Followup)"}.`,
        "info",
      );
    }
  } catch {
    // never let the chain undo or block the decision that started it
  }
}

/**
 * A row was just marked Sent with no link of its own: if the approval before
 * it in the same order was approved through a chain link, send this one's
 * link to that buyer now. Returns what happened, for the caller's toast.
 */
export async function chainOnSent(sb: SB, rowId: string): Promise<{ sentTo: string; emailed: boolean } | null> {
  const facts = await approvalFacts(sb, rowId).catch(() => null);
  if (!facts || facts.status !== "sent") return null;
  const rows = await orderRows(sb, facts.amendmentId);
  const at = rows.findIndex((r) => r.id === rowId);
  if (at <= 0) return null;
  const prev = rows[at - 1];
  const { data: link } = await sb
    .from("ta_approval_links")
    .select("status, auto_next, recipient_email, recipient_name")
    .eq("approval_row_id", prev.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!link || link.status !== "approved" || !link.auto_next) return null;
  const prevFacts = await approvalFacts(sb, prev.id).catch(() => null);
  const res = await issueApprovalLink(sb, facts, {
    email: String(link.recipient_email),
    name: str(link.recipient_name),
    message: prevFacts ? `Thank you for approving ${prevFacts.approval}. Please review ${facts.approval} next.` : null,
    files: [],
    autoNext: true,
  });
  return res.ok ? { sentTo: String(link.recipient_email), emailed: res.emailed } : null;
}

/** Tells the order's merchandiser (an employee → their login). Never throws. */
export async function notifyMerchandiser(
  facts: Pick<ApprovalFacts, "merchandiserId" | "approval" | "orderRef">,
  title: string,
  body: string,
  type: "info" | "success" | "warning" | "danger" = "info",
): Promise<void> {
  if (!facts.merchandiserId) {
    await notify("ta.buyer_link", { permission: { module: "orders", action: "edit" } }, { title, body, href: "/orders/ta-followup", type });
    return;
  }
  await notify("ta.buyer_link", { employeeIds: [facts.merchandiserId] }, { title, body, href: "/orders/ta-followup", type });
}
