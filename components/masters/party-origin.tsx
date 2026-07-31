import { Link2 } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";

// ============================================================================
// Origin of a published party row — the "Also …" tick boxes (0371)
//
// A row in Customer that nobody remembers creating is worse than no row at all:
// the operator edits it, someone unticks the box that made it, and the edit
// vanishes. So a published row says where it came from, everywhere it appears.
//
// One helper for all three target masters (Customer · Consignee · Notify)
// because the rule is one rule. Three copies is how the third one ends up
// saying "from Customer" on a row an Applicant published.
// ============================================================================

export type PartyOrigin = {
  /** The master that published this row: "Applicant". */
  from: string;
  /** That record's name, so the operator knows which one to go and untick. */
  name: string;
  /** The tick box that made it: "Also Customer". */
  flag: string;
};

type OriginCandidate = {
  id: string | null | undefined;
  source?: { name: string } | null;
  from: string;
  flag: string;
};

/**
 * First set link wins. The DB CHECK (0371) already guarantees at most one is
 * ever non-null, so the order of `candidates` is documentation, not logic.
 *
 * Falls back to "—" for the name rather than hiding the badge: the link exists
 * either way, and a badge that disappears when an embed fails to load would
 * make a published row look ordinary and deletable.
 */
export function partyOrigin(candidates: readonly OriginCandidate[]): PartyOrigin | null {
  for (const c of candidates) {
    if (c.id) return { from: c.from, name: c.source?.name ?? "—", flag: c.flag };
  }
  return null;
}

/** Muted chip for list rows and record headers. */
export function OriginBadge({ origin }: { origin: PartyOrigin | null }) {
  if (!origin) return null;
  return (
    // `title` on a wrapper, not on StatusPill: that pill is shared with every
    // other master and does not need a new prop for one caller's tooltip.
    <span title={`Created by ticking ${origin.flag} on ${origin.from} ${origin.name}`}>
      <StatusPill tone="info">
        <Link2 className="h-4 w-4 shrink-0" aria-hidden />
        from {origin.from}
      </StatusPill>
    </span>
  );
}

/** Hint under the read-only Name field. Identity belongs to the source. */
export function originNameHint(origin: PartyOrigin): string {
  return `Name comes from ${origin.from} ${origin.name} — edit it there.`;
}

/**
 * Why this row cannot be deleted from here. Deleting it while the flag stayed
 * ticked would simply republish it on the source's next save, so we point at
 * the tick box instead of pretending the delete is possible.
 */
export function originDeleteBlock(origin: PartyOrigin): string {
  return `This came from ${origin.from} ${origin.name} — untick ${origin.flag} there to remove it.`;
}
