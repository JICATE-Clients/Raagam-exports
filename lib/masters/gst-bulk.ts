import type { z } from "zod";

// ============================================================================
// Shared bits of the two "GST Assign" bulk screens (vendors + customers).
//
// Deliberately NOT a "use server" module: every export of one of those has to
// be an async function, and this is a plain helper both actions call.
// ============================================================================

/**
 * The first validation issue, naming the value that caused it.
 *
 * One Save on these screens carries every edited row at once, so the bare
 * "Invalid GSTIN (e.g. 33ABCDE1234F1Z7)" that Zod produces leaves the operator
 * hunting through a few hundred rows for the one that failed. Zod's issue path
 * starts with the array index, which is all we need to quote the offending
 * value back.
 */
export function describeGstIssue(
  error: z.ZodError,
  rows: readonly { gst_no?: string | null }[],
): string {
  const issue = error.issues[0];
  if (!issue) return "Validation failed";
  const idx = typeof issue.path[0] === "number" ? issue.path[0] : null;
  const value = idx == null ? null : rows[idx]?.gst_no?.trim();
  return value ? `${issue.message} — “${value}”` : issue.message;
}
