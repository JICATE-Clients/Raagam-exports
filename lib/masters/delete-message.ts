/** Client-safe toast wording for the shared delete-or-deactivate flow.
 *  `usedBy` is the friendly referencing-table name from delete-guard —
 *  when present the user learns WHERE the value is used (client 2026-07-23). */
export function deletedToast(
  label: string,
  res: { inactive: boolean; usedBy?: string },
): string {
  if (!res.inactive) return `${label} deleted.`;
  return res.usedBy
    ? `${label} is used by ${res.usedBy} — marked inactive instead of deleted, history preserved.`
    : `${label} is in use — marked inactive instead of deleted, history preserved.`;
}
