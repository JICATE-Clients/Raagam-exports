/**
 * "Has this order's BOM been done?" — one vocabulary, now three readers.
 *
 * The BOM dashboard is a work QUEUE (which orders still need planning) and the
 * Garment Order list answers the same question from the order's side. Both read
 * this file. The ~8 copy-pasted `bomStatusTone` functions across
 * `app/(app)/planning/**` are what happens when each screen declares its own:
 * four states, five spellings, and no two lists agreeing on which colour "draft"
 * is.
 *
 * ## WHY IT MOVED OUT OF `material-bom-amendment/` (2026-08-17)
 *
 * Nothing in it is about MATERIAL. "Not started / draft / recorded / the order
 * moved under it / cannot be answered" is the shape of every BOM question, and
 * Fabric BOM (step 3 of the client's flow, `0426`) asks it identically. It sat
 * one folder down only because Material BOM asked first.
 *
 * The move is deliberately a `git mv` of THIS file rather than a second copy
 * beside it, which is the failure the paragraph above already records — and a
 * fabric module importing `material-bom-amendment/status` would have been the
 * shape that invites the copy: the path would read as borrowing, so the next
 * screen would fork it rather than depend on it. Three importers, all repointed.
 *
 * Client-safe, and `StatusTone` comes from `lib/ui/tone.ts` rather than the
 * `.tsx` so a server component can name a tone without pulling JSX into its
 * graph.
 *
 * ## FIVE STATES, AND TWO OF THEM ARE NOT IN THE CLIENT'S BRIEF
 *
 * The client named Pending and Updated. `draft`, `recalculate` and `unresolved`
 * are additions their own workflow requires, and the middle one is the point of
 * the whole staleness apparatus:
 *
 * - **recalculate** — the BOM is recorded, but the ORDER has moved since it was
 *   computed. Without this state an amended order silently keeps a material plan
 *   built for different quantities, and the "quantity controller" downstream
 *   controls against the wrong number. It is `danger`, not `warning`: every
 *   other tone lets a stale plan read as done.
 * - **unresolved** — the source order cannot be found, or carries no Approval
 *   Qty rows, so the question cannot be answered at all. Folding it into
 *   `updated` would be the *"restrict only in case X"* leak the nominated-vendor
 *   rule records: a guard phrased as an exception leaks through every state that
 *   is not the exception.
 */

import type { StatusTone } from "@/lib/ui/tone";

export const BOM_STATUSES = [
  "pending",
  "draft",
  "updated",
  "recalculate",
  "unresolved",
] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

/** As much of the BOM as the status needs. */
export type BomStatusInput = {
  is_draft: boolean;
  /** How many item lines it holds. A BOM with none has not been started. */
  lineCount: number;
  computed_basis_hash: string | null;
  computed_for_qty: number | null;
};

/** What the ORDER says right now, from `basisFingerprint` / `totalProductionOf`. */
export type OrderBasisNow = {
  /** null = the order could not be fingerprinted (no approval rows, or missing). */
  hash: string | null;
  qty: number | null;
};

/**
 * Is the stored requirement still the one this order implies?
 *
 * COMPARES THE HASH, NOT THE TOTAL. WHITE 300 / NAVY 200 becoming WHITE 200 /
 * NAVY 300 leaves the total at 500 while every colour-wise requirement row is
 * wrong — so a total comparison reports "fresh" over a plan that no longer
 * matches. `basisFingerprint` covers the shape as well as the sum.
 *
 * A BOM saved before the hash existed has `computed_basis_hash` null. That is
 * `unresolved`, not `stale`: there is nothing to compare, and claiming it moved
 * would be as much of a guess as claiming it did not.
 */
export function bomFreshness(
  bom: Pick<BomStatusInput, "computed_basis_hash">,
  now: OrderBasisNow,
): "fresh" | "stale" | "unresolved" {
  if (!now.hash || !bom.computed_basis_hash) return "unresolved";
  return bom.computed_basis_hash === now.hash ? "fresh" : "stale";
}

/**
 * The status for one order.
 *
 * `bom` is null when the order has no BOM at all — the queue's default and the
 * state every order starts in.
 */
export function bomStatusOf(bom: BomStatusInput | null, now: OrderBasisNow): BomStatus {
  // No document, or one with no lines. A BOM whose grid is empty has been opened
  // and not filled in, which for a work queue is the same as not started.
  if (!bom || bom.lineCount === 0) return "pending";
  if (bom.is_draft) return "draft";

  switch (bomFreshness(bom, now)) {
    case "fresh":
      return "updated";
    case "stale":
      return "recalculate";
    default:
      return "unresolved";
  }
}

export function bomStatusText(s: BomStatus): string {
  switch (s) {
    case "pending":
      return "Pending";
    case "draft":
      return "Draft";
    case "updated":
      return "Updated";
    case "recalculate":
      return "Recalculate";
    default:
      return "Unresolved";
  }
}

export function bomStatusTone(s: BomStatus): StatusTone {
  switch (s) {
    case "pending":
      return "warning";
    // NEUTRAL, not warning. `lib/ui/tone.ts`: neutral is "no claim", and a draft
    // makes none — it is work in progress, not work that has gone wrong.
    case "draft":
      return "neutral";
    case "updated":
      return "success";
    // DANGER for both, and deliberately: these are the two act-on-it states. A
    // stale plan that reads as amber gets left, and leaving it is the failure.
    case "recalculate":
    default:
      return "danger";
  }
}

/** One line explaining a status, for a tooltip or an empty state. */
export function bomStatusHint(s: BomStatus, qty: number | null): string {
  switch (s) {
    case "pending":
      return "No material plan yet.";
    case "draft":
      return "Saved as a draft — not yet recorded.";
    case "updated":
      return qty == null
        ? "Matches the order."
        : `Planned against ${qty.toLocaleString("en-IN")} pieces.`;
    case "recalculate":
      return "The order's quantities have changed since this plan was computed. Open it and save again.";
    default:
      return "The order has no Approval Qty rows to plan against.";
  }
}

/** Order of work for the dashboard: what needs doing, first. */
export const BOM_STATUS_RANK: Record<BomStatus, number> = {
  recalculate: 0,
  pending: 1,
  draft: 2,
  unresolved: 3,
  updated: 4,
};
