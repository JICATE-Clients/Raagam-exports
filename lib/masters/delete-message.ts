/** Client-safe toast wording for the shared delete-or-deactivate flow.
 *  `usedBy` is the friendly referencing-table name from delete-guard —
 *  when present the user learns WHERE the value is used (client 2026-07-23).
 *
 *  `alsoAffected` is the party masters only (0378): deleting an Applicant takes
 *  the Customer and Consignee it published, and the operator clicked one row.
 *  Roles, not names — `publishParty` syncs the name down on every save, so
 *  naming them would repeat the same word four times. Optional, so the other
 *  ~70 masters that call this pass nothing and read exactly as before. */
export function deletedToast(
  label: string,
  res: { inactive: boolean; usedBy?: string; alsoAffected?: string[] },
): string {
  const also = res.alsoAffected?.length ? `, along with the ${list(res.alsoAffected)} it created` : "";
  if (!res.inactive) return `${label} deleted${also}.`;
  const because = res.usedBy ? `${label} is used by ${res.usedBy}` : `${label} is in use`;
  return `${because} — marked inactive instead of deleted${also}. History preserved.`;
}

/** ["Customer"] → "Customer"; ["Customer","Consignee"] → "Customer and Consignee";
 *  three or more → "Customer, Consignee and Notify Party". */
function list(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
