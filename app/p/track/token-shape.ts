/*
 * Client-safe. The token's SHAPE rule is `isTrackingToken` in
 * lib/resolve/token.ts (it imports node:crypto, so it stays server-side); this
 * file only digs the token out of whatever the person pasted.
 */

/** The token inside whatever was pasted — a full link, a path, or the bare token. */
export function tokenFromPaste(input: string): string {
  const s = input.trim();
  const m = s.match(/\/p\/track\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return s.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ?? "";
}
