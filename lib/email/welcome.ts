import "server-only";

/**
 * THE WELCOME EMAIL a new login receives (user 2026-09-30): the application
 * link, their login email and their TEMPORARY password — with the one rule that
 * makes a password in an inbox tolerable stated plainly: it must be changed at
 * first sign-in (the app enforces it, 0659).
 *
 * Plain inline styles and a text twin: mail clients strip stylesheets, and a
 * text part is what keeps it out of spam folders.
 */

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://raagam-exports.vercel.app").replace(/\/+$/, "");

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function welcomeEmail(p: { name: string | null; email: string; password: string; resent?: boolean }) {
  const hello = p.name ? `Hello ${p.name},` : "Hello,";
  const lead = p.resent
    ? "Here are your new sign-in details for Raagam ERP."
    : "An account has been created for you on Raagam ERP.";
  const subject = p.resent ? "Your new Raagam ERP sign-in details" : "Your Raagam ERP account";
  const text = [
    hello,
    "",
    lead,
    "",
    `Application: ${APP_URL}`,
    `Email:       ${p.email}`,
    `Password:    ${p.password}`,
    "",
    "This is a temporary password. You will be asked to choose your own the first time you sign in.",
    "Do not share this email. If you did not expect it, tell your administrator.",
    "",
    "— Raagam Exports",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9dee4;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #1f7a3a;font-size:18px;font-weight:700;color:#1f4e8c">Raagam ERP</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 16px">${esc(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #d9dee4;border-radius:6px;background:#f8fafb">
<tr><td style="padding:10px 14px;font-size:13px;color:#52606d;width:110px">Application</td><td style="padding:10px 14px"><a href="${esc(APP_URL)}" style="color:#1f4e8c">${esc(APP_URL)}</a></td></tr>
<tr><td style="padding:10px 14px;font-size:13px;color:#52606d;border-top:1px solid #e4e7eb">Email</td><td style="padding:10px 14px;border-top:1px solid #e4e7eb">${esc(p.email)}</td></tr>
<tr><td style="padding:10px 14px;font-size:13px;color:#52606d;border-top:1px solid #e4e7eb">Password</td><td style="padding:10px 14px;border-top:1px solid #e4e7eb;font-family:Consolas,monospace;font-size:15px;font-weight:700">${esc(p.password)}</td></tr>
</table>
<p style="margin:16px 0 0"><a href="${esc(APP_URL)}/login" style="display:inline-block;background:#1f4e8c;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Sign in</a></p>
<p style="margin:20px 0 0;font-size:13px;color:#52606d">This is a temporary password. You will be asked to choose your own the first time you sign in. Do not share this email; if you did not expect it, tell your administrator.</p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e4e7eb;font-size:12px;color:#7b8794">Raagam Exports</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}
