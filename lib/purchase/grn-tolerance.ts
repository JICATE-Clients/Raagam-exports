/**
 * Over-receipt tolerance for a GRN line — the ONE reading of it that the
 * screen's banners, the Save gate and `createGrn` / `postGrn` all share.
 * The database holds the same rule (`grn_over_tolerance_lines`, 0620) and
 * refuses independently; this is the copy that answers on the keystroke.
 *
 * Plain TS, no imports: it is read by a client component and by a
 * `"use server"` action file alike.
 *
 * WHAT IS COUNTED is ACCEPTED quantity — Today Recd minus Shortage / Rej —
 * added to the PO line's `received_qty`, which has always been the cached
 * accepted quantity of posted GRNs (0008). A rejected roll did not enter stock
 * against the PO, so it must not push a line over tolerance. 0620's header
 * carries the reasoning.
 */

/** Quantities are numeric(14,3): compare at half a thousandth. */
const EPS = 0.0005;

export type ReceiptBand =
  /** Nothing received on this line today. */
  | "none"
  /** Received so far + today is still below the PO qty — a part delivery. */
  | "short"
  /** GREEN — exactly the PO qty. */
  | "exact"
  /** AMBER — over the PO qty, inside the approved tolerance. */
  | "within"
  /** RED — beyond tolerance; needs a Store Manager override. */
  | "over";

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The most this PO line may reach, tolerance included. Mirrors the SQL. */
export function toleranceLimit(ordered: number, tolerancePct: number): number {
  return round3(ordered * (1 + tolerancePct / 100));
}

export function receiptBand(p: {
  ordered: number;
  receivedSoFar: number;
  acceptedToday: number;
  tolerancePct: number;
}): ReceiptBand {
  if (!(p.acceptedToday > 0)) return "none";
  const total = p.receivedSoFar + p.acceptedToday;
  if (total > toleranceLimit(p.ordered, p.tolerancePct) + EPS) return "over";
  if (total > p.ordered + EPS) return "within";
  if (total >= p.ordered - EPS) return "exact";
  return "short";
}

/** Accepted today, from the two quantities the store keeper types. */
export function acceptedFrom(todayRecd: number, shortageRej: number): number {
  return round3(Math.max(0, (todayRecd || 0) - (shortageRej || 0)));
}
