import "server-only";

/**
 * THE BUYER APPROVAL EMAIL (0668, doc/order/digitalisation-plan.md §4): one
 * item, one link, Approve or Rework, no login. Same inline-styled shell and
 * text twin as `welcome.ts`, for the same reasons.
 *
 * The REMINDER carries a fresh link (0672): the sweep rotates the token, since
 * only its hash is stored and the first one cannot be repeated.
 */

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://raagam-exports.vercel.app"
).replace(/\/+$/, "");

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Facts = {
  recipientName: string | null;
  approval: string;
  orderRef: string | null;
  customer: string | null;
  message: string | null;
  expiresOn: string;
};

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9dee4;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #1f7a3a;font-size:18px;font-weight:700;color:#1f4e8c">${esc(title)}</td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e4e7eb;font-size:12px;color:#7b8794">Raagam Exports</td></tr>
</table></td></tr></table></body></html>`;
}

function factsTable(f: Facts): string {
  const rows: [string, string][] = [["Item", f.approval]];
  if (f.orderRef) rows.push(["Order", f.orderRef]);
  if (f.customer) rows.push(["Customer", f.customer]);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #d9dee4;border-radius:6px;background:#f8fafb">${rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 14px;font-size:13px;color:#52606d;width:110px${i ? ";border-top:1px solid #e4e7eb" : ""}">${esc(k)}</td><td style="padding:10px 14px${i ? ";border-top:1px solid #e4e7eb" : ""}">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

export function approvalLinkEmail(f: Facts & { url: string }) {
  const hello = f.recipientName ? `Hello ${f.recipientName},` : "Hello,";
  const subject = `Approval needed: ${f.approval}${f.orderRef ? ` — ${f.orderRef}` : ""}`;
  const text = [
    hello,
    "",
    `Please review ${f.approval}${f.orderRef ? ` for order ${f.orderRef}` : ""} and choose Approve or Rework.`,
    ...(f.message ? ["", f.message] : []),
    "",
    `Open: ${f.url}`,
    "",
    `This link works until ${f.expiresOn} and only for this item. No login is needed.`,
    "",
    "— Raagam Exports",
  ].join("\n");
  const html = shell(
    "Approval needed",
    `<p style="margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 16px">Please review the item below and choose <b>Approve</b> or <b>Rework</b>.</p>
${factsTable(f)}
${f.message ? `<p style="margin:16px 0 0;white-space:pre-line">${esc(f.message)}</p>` : ""}
<p style="margin:20px 0 0"><a href="${esc(f.url)}" style="display:inline-block;background:#1f4e8c;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Review and answer</a></p>
<p style="margin:20px 0 0;font-size:13px;color:#52606d">This link works until ${esc(f.expiresOn)} and only for this item. No login is needed.</p>`,
  );
  return { subject, html, text };
}

/**
 * THE REMINDER CARRIES A WORKING LINK (0672). Only a token's hash is stored, so
 * the first link cannot be repeated — instead the sweep ROTATES it: a fresh
 * link with the same deadline, and the earlier one stops working. The email
 * says so, so a buyer who opens the old one is not surprised.
 */
export function approvalReminderEmail(f: Facts & { sentOn: string; url: string }) {
  const hello = f.recipientName ? `Hello ${f.recipientName},` : "Hello,";
  const subject = `Reminder: approval needed: ${f.approval}${f.orderRef ? ` — ${f.orderRef}` : ""}`;
  const text = [
    hello,
    "",
    `We are still waiting for your answer on ${f.approval}${f.orderRef ? ` for order ${f.orderRef}` : ""}, sent on ${f.sentOn}.`,
    "",
    `Open: ${f.url}`,
    "",
    `This link replaces the one in our earlier email and works until ${f.expiresOn}. No login is needed.`,
    "",
    "— Raagam Exports",
  ].join("\n");
  const html = shell(
    "Reminder: approval needed",
    `<p style="margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 16px">We are still waiting for your answer on the item below, sent on <b>${esc(f.sentOn)}</b>.</p>
${factsTable(f)}
<p style="margin:20px 0 0"><a href="${esc(f.url)}" style="display:inline-block;background:#1f4e8c;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Review and answer</a></p>
<p style="margin:20px 0 0;font-size:13px;color:#52606d">This link replaces the one in our earlier email and works until ${esc(f.expiresOn)}. No login is needed.</p>`,
  );
  return { subject, html, text };
}
