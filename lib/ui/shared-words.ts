/**
 * EACH WORD ONCE (user 2026-10-23): what every card in a pile says alike — a
 * series prefix, a year — is left off the card. These find it.
 */

/** The series prefix ("CST/26-27/") every value shares, up to its last "/" — or "". */
export function sharedPrefix(values: (string | null | undefined)[]): string {
  const vs = values.filter((v): v is string => !!v);
  if (vs.length === 0) return "";
  const cut = (v: string) => v.slice(0, v.lastIndexOf("/") + 1);
  const p = cut(vs[0]);
  return p && vs.every((v) => cut(v) === p) ? p : "";
}

/** The one value every entry shares, or null when they differ (or there are none). */
export function sharedValue(values: (string | null | undefined)[]): string | null {
  const vs = values.filter((v): v is string => !!v);
  return vs.length > 0 && vs.every((v) => v === vs[0]) ? vs[0] : null;
}
