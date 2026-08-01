// ============================================================================
// What a published party row says about where it came from — the words only.
//
// Split out of components/masters/party-origin.tsx so the SERVER can say the
// same sentence. `deleteParty` (lib/masters/party-publish.ts) refuses to delete
// a published row too, and party-publish.ts is `server-only`: importing the
// component file would drag lucide-react and StatusPill into the server bundle
// to borrow one string. The badge and the hint stay over there; only the
// sentences live here, so there is still exactly one of each.
// ============================================================================

/**
 * What a published row IS, named the way the operator reads it. Must match
 * `PARTY_LINKS[*].into` and the `label` that `party_delete_subtree` (0378)
 * returns, because the row chip and the delete toast sit minutes apart and a
 * chip saying "Notify" over a toast saying "Notify Party" reads as two things.
 */
export const PARTY_ROLE = {
  customer: "Customer",
  consignee: "Consignee",
  notify: "Notify Party",
} as const;

export type PartyOrigin = {
  /** The master that published this row: "Applicant". */
  from: string;
  /** That record's name, so the operator knows which one to go and untick. */
  name: string;
  /** The tick box that made it: "Also Customer". */
  flag: string;
};

/** Hint under the read-only Name field. Identity belongs to the source. */
export function originNameHint(origin: PartyOrigin): string {
  return `Name comes from ${origin.from} ${origin.name} — edit it there.`;
}

/**
 * Why this row cannot be deleted from here. Deleting it while the flag stayed
 * ticked would simply republish it on the source's next save, so we point at
 * the tick box instead of pretending the delete is possible.
 *
 * Deleting the SOURCE is the supported way to remove it, and that takes this
 * row with it (0378) — but that is the source's screen, not this one.
 */
export function originDeleteBlock(origin: PartyOrigin): string {
  return `This came from ${origin.from} ${origin.name} — untick ${origin.flag} there to remove it.`;
}
