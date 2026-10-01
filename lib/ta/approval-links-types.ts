/**
 * Buyer approval by link (0668, doc/order/digitalisation-plan.md §4) — the
 * client-safe half: shapes and constants the TA Followup sheet, the public
 * page and the server all read. No server imports here.
 */

/** How long a link stays usable. */
export const LINK_VALID_DAYS = 14;
/** One reminder this many days after sending, if the buyer has not answered. */
export const LINK_REMIND_AFTER_DAYS = 3;

export const APPROVAL_LINK_BUCKET = "order-approval-docs";

export type ApprovalLinkStatus = "open" | "approved" | "rework" | "expired" | "revoked" | "superseded";

export const LINK_STATUS_LABEL: Record<ApprovalLinkStatus, string> = {
  open: "Waiting for buyer",
  approved: "Approved by buyer",
  rework: "Rework requested",
  expired: "Link expired",
  revoked: "Replaced by a newer link",
  superseded: "Answered by staff",
};

export type ApprovalLinkFile = { path: string; name: string; mime: string | null };

/** The latest link on an approval row, as the TA Followup sheet shows it. */
export type ApprovalLinkSummary = {
  status: ApprovalLinkStatus;
  recipientEmail: string;
  recipientName: string | null;
  createdAt: string;
  expiresAt: string;
  emailSentAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionComment: string | null;
  /** 0672: the buyer's approval sends the next approval's link automatically. */
  autoNext: boolean;
  /** 0672: what the buyer attached with the answer (signed, short-lived URLs). */
  buyerFiles: (ApprovalLinkFile & { url: string | null })[];
};

export type ApprovalLinkContact = { name: string | null; email: string };

export type ApprovalLinkInfo = {
  /** Buyer contacts with an email on the Customer master. */
  contacts: ApprovalLinkContact[];
  latest: ApprovalLinkSummary | null;
  emailConfigured: boolean;
};

export type SendApprovalLinkInput = {
  approvalRowId: string;
  email: string;
  name: string;
  message: string;
  files: ApprovalLinkFile[];
  /** 0672: send the next approval's link automatically after this one is approved. */
  autoNext: boolean;
};

/** 0672: the Mark Sent dialog's "email the buyer a link" choice. */
export type MarkSentLinkChoice = { email: string; name: string; autoNext: boolean };

export type SendApprovalLinkResult =
  | {
      ok: true;
      /** Shown once, to copy (WhatsApp) — the token is never stored. */
      url: string;
      emailed: boolean;
      /** Why it was not emailed, in words; null when it was. */
      emailNote: string | null;
    }
  | { ok: false; error: string };

/** What a buyer may attach on Rework (0672): photos or a PDF, three at most. */
export const BUYER_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const BUYER_FILE_MAX_BYTES = 10 * 1_048_576;
export const BUYER_FILE_MAX_COUNT = 3;

/** A one-file signed upload slot under the link's own buyer folder. */
export type BuyerUploadTarget =
  | { ok: true; path: string; uploadToken: string; name: string }
  | { ok: false; error: string };

export type DecideLinkResult =
  | { ok: true; decision: "approved" | "rework" }
  | { ok: false; error: string };

/** The RPC's refusal reasons, in the buyer's words. */
export const DECIDE_REFUSAL: Record<string, string> = {
  bad_decision: "Choose Approve or Rework.",
  name_required: "Please enter your name.",
  comment_required: "Please say what needs to change.",
  comment_too_long: "The comment is too long (2000 characters at most).",
  bad_files: "One of the attached files could not be accepted. Please attach it again.",
  not_found: "This link is not valid.",
  expired: "This link has expired. Please ask Raagam Exports for a new one.",
  approved: "This item has already been approved.",
  rework: "Rework has already been requested for this item.",
  revoked: "This link was replaced by a newer one. Please use the latest email.",
  superseded: "This item has already been answered.",
};

/** A token as minted: 32 random bytes, base64url, no padding. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
