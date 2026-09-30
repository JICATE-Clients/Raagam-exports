import "server-only";

/**
 * OUTBOUND EMAIL — Resend's HTTP API (user 2026-09-30: "which is easy" →
 * Resend). A plain `fetch`, no SDK dependency: one POST is all it takes, and
 * the build gains nothing to install or keep patched.
 *
 * Configured by two environment variables (Vercel ▸ Settings ▸ Environment
 * Variables, and `.env.local` for development):
 *   RESEND_API_KEY   the API key from resend.com
 *   EMAIL_FROM       the sender, e.g. "Raagam ERP <noreply@raagamexports.com>"
 *                    — its domain must be verified in Resend
 *
 * NOT CONFIGURED IS A STATE, NOT AN ERROR. Until both are set every send
 * answers `{ sent: false, reason: "not_configured" }` and the caller says so
 * on screen — creating a user never fails because mail is not set up yet.
 * A send that fails for any other reason says why, and never throws: the
 * thing the mail was about (a created login) has already happened.
 */

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "not_configured" | "failed"; detail?: string };

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!process.env.EMAIL_FROM?.trim();
}

export async function sendEmail(mail: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  if (!emailConfigured()) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { sent: false, reason: "failed", detail: `${res.status} ${(await res.text()).slice(0, 300)}` };
    }
    const body = (await res.json()) as { id?: string };
    return { sent: true, id: body.id ?? "" };
  } catch (e) {
    return { sent: false, reason: "failed", detail: e instanceof Error ? e.message : "unknown error" };
  }
}
