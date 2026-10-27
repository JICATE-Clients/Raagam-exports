import { ALLOWED_MIME, ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE } from "./types";

// ============================================================================
// Communication Hub — how an attachment is offered and shown (0737 / 0761).
//
// THE LIMITS ARE CONFIGURED ONCE: ALLOWED_MIME, ATTACHMENT_MAX_BYTES and
// ATTACHMENTS_PER_MESSAGE in lib/comms/types.ts, which scripts/check-comms.mts
// holds equal to the bucket row, comm_allowed_mime() and comm_send_message in
// the database. Changing one without the others fails the build — so a type
// the picker offers is always a type the server accepts.
//
// Pure: the composer, the message list and the checkers share it.
// ============================================================================

/** The `accept` attribute of the file input: extensions AND types, so the
 *  OS dialog filters on either. It is a convenience — the server decides. */
export const ACCEPT_ATTR = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx", ".csv", ".txt",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ...ALLOWED_MIME,
].join(",");

/** What the operator reads under the composer and on the attach button. */
export const ATTACHMENT_TYPES_LABEL =
  `PDF, Word, Excel, PowerPoint, CSV, TXT, PNG, JPG, WebP, GIF · up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB each · ${ATTACHMENTS_PER_MESSAGE} files per message`;

/** Shown inline as a picture. SVG is deliberately not an allowed type at all:
 *  it can carry script. */
export function isImageMime(mime: string): boolean {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime.toLowerCase());
}

/**
 * Safe to OPEN in a browser tab rather than only download: images, PDF and
 * plain text render as themselves and execute nothing. Office files and CSV
 * are download-only — the browser would hand them to an application anyway.
 */
export function isOpenableMime(mime: string): boolean {
  return isImageMime(mime) || ["application/pdf", "text/plain"].includes(mime.toLowerCase());
}

const KIND: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "text/csv": "CSV",
  "text/plain": "Text",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
};

/** "Excel" for an .xlsx — the file card's type label. */
export function fileKind(mime: string, fileName: string): string {
  const k = KIND[mime.toLowerCase()];
  if (k) return k;
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toUpperCase().slice(0, 8) : "File";
}
