import { Link2 } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { PartyOrigin } from "@/lib/masters/party-origin-text";

// The two sentences live in lib/masters/party-origin-text.ts so the server can
// say them too — `deleteParty` refuses a published row with the very same
// words. Re-exported here because every screen already imports them from this
// file, and one string having one home matters more than which file it is.
export { originNameHint, originDeleteBlock } from "@/lib/masters/party-origin-text";
export type { PartyOrigin } from "@/lib/masters/party-origin-text";

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

/**
 * The mirror of OriginBadge, on the SOURCE side: what this row has published.
 *
 * It earns its place at delete time. Deleting an applicant now removes up to
 * six records (0378) and the confirm strip cannot say so — `RowActions` pins
 * that cell to a fixed width on purpose, and a sentence there would stretch
 * every one of the ~131 lists that share it. So the row carries the
 * consequence permanently instead of the click explaining it once.
 *
 * `roles` comes straight from the `also_*` booleans already on every list row —
 * no extra query. It is one level deep, deliberately: an applicant knows it
 * published a Customer, not whether that customer went on to publish a Notify.
 * Naming the first level is what makes "this deletes more than one thing" land;
 * the toast afterwards reports what actually went.
 */
export function PublishesBadge({ roles }: { roles: readonly string[] }) {
  if (roles.length === 0) return null;
  return (
    <span title={`Also published as ${roles.join(" and ")} — deleting this removes ${roles.length > 1 ? "those" : "that"} too.`}>
      <StatusPill tone="info">
        <Link2 className="h-4 w-4 shrink-0" aria-hidden />
        publishes {roles.join(" + ")}
      </StatusPill>
    </span>
  );
}
