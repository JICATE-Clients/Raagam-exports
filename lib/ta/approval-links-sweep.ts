import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { approvalFacts, issueApprovalLink, notifyMerchandiser, parseFiles } from "./approval-links-service";
import { LINK_REMIND_AFTER_DAYS } from "./approval-links-types";

/**
 * The buyer-link sweep (0668), run daily by `/api/cron/approval-links`.
 *
 *   1. EXPIRE — an open link past `expires_at` becomes `expired`, and the
 *      merchandiser is told the buyer never answered.
 *   2. REMIND — once, LINK_REMIND_AFTER_DAYS after sending, if still open: the
 *      buyer gets a reminder carrying a FRESH link (0672: the token is rotated,
 *      same deadline) and the merchandiser is alerted.
 *
 * CLAIM, THEN SEND — each batch is claimed by an UPDATE … RETURNING, so two
 * overlapping ticks cannot both send (the Work Flow sweep's rule).
 */

export type ApprovalLinkSweepResult = { expired: number; reminded: number; error?: string };

type LinkRow = {
  id: string;
  approval_row_id: string;
  recipient_email: string;
  recipient_name: string | null;
  email_sent_at: string | null;
  created_at: string;
  expires_at: string;
};

export async function sweepApprovalLinks(): Promise<ApprovalLinkSweepResult> {
  const out: ApprovalLinkSweepResult = { expired: 0, reminded: 0 };
  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    // ---- 1. Expire ----------------------------------------------------------
    const { data: expired, error: expErr } = await admin
      .from("ta_approval_links")
      .update({ status: "expired" })
      .eq("status", "open")
      .lt("expires_at", nowIso)
      .select("id, approval_row_id, recipient_email, recipient_name, email_sent_at, created_at, expires_at");
    if (expErr) return { ...out, error: expErr.message };
    for (const l of (expired ?? []) as LinkRow[]) {
      out.expired++;
      const facts = await approvalFacts(admin, l.approval_row_id).catch(() => null);
      if (facts) {
        await notifyMerchandiser(
          facts,
          `Buyer link expired: ${facts.approval}${facts.orderRef ? ` (${facts.orderRef})` : ""}`,
          `${l.recipient_email} did not answer. Follow up, or send a new link from TA Followup.`,
          "warning",
        );
      }
    }

    // ---- 2. Remind ----------------------------------------------------------
    const cutoff = new Date(Date.now() - LINK_REMIND_AFTER_DAYS * 86_400_000).toISOString();
    const { data: due, error: dueErr } = await admin
      .from("ta_approval_links")
      .update({ reminder_sent_at: nowIso })
      .eq("status", "open")
      .is("reminder_sent_at", null)
      .lt("created_at", cutoff)
      .gt("expires_at", nowIso)
      .select(
        "id, approval_row_id, recipient_email, recipient_name, email_sent_at, created_at, expires_at, message, files, auto_next",
      );
    if (dueErr) return { ...out, error: dueErr.message };
    for (const l of (due ?? []) as (LinkRow & { message: string | null; files: unknown; auto_next: boolean })[]) {
      out.reminded++;
      const facts = await approvalFacts(admin, l.approval_row_id).catch(() => null);
      if (!facts) continue;
      // Only remind the buyer by email if the first email actually went out —
      // a link the merchandiser copied to WhatsApp has no "earlier email", and
      // rotating it would kill the copy the buyer actually has.
      // THE REMINDER CARRIES A WORKING LINK (0672): the old token cannot be
      // repeated (only its hash is stored), so it is ROTATED — same message,
      // files and deadline, a fresh token, the old one revoked.
      if (l.email_sent_at) {
        await issueApprovalLink(admin, facts, {
          email: l.recipient_email,
          name: l.recipient_name,
          message: l.message,
          files: parseFiles(l.files),
          autoNext: !!l.auto_next,
          expiresAt: l.expires_at,
          reminderOf: { sentOn: fmtDate(l.email_sent_at) },
        });
      }
      await notifyMerchandiser(
        facts,
        `No buyer answer yet: ${facts.approval}${facts.orderRef ? ` (${facts.orderRef})` : ""}`,
        `${l.recipient_email} has not answered since ${fmtDate(l.created_at)}.${l.email_sent_at ? " A reminder email was sent." : ""}`,
        "info",
      );
    }
    return out;
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : "sweep failed" };
  }
}
