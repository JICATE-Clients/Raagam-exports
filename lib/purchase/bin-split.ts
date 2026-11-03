/**
 * BIN ROWS: BIN 1 TAKES IT ALL; ANOTHER BIN OPENS ONLY ON A BALANCE (user 2026-11-02,
 * screenshot 161807 + "Single Bin Full Qty Lock" note: "if Bin 1 holds the entire accepted
 * quantity, adding a second bin is locked — reduce Bin 1 first").
 *
 * Still no "+ Split bin" button (user 2026-11-02, screenshot 121250 — AGENTS.md "A table may
 * keep a blank end row INSTEAD of a + Add button"): the next bin is a blank END ROW. What
 * changed is WHEN that row exists — only while the picked bins hold less than the accepted
 * qty, so a full Bin 1 has nothing under it and no extra bin can be added by accident.
 *
 * One rule for every bin box on the receiving screens (GRN entry, Edit GRN, Pending QC):
 *   - nothing picked → ONE box;
 *   - every picked bin carries a qty. A qty the operator typed is theirs (`typed`); an
 *     untyped bin holds what is left — accepted minus the typed ones — in row order. So a
 *     lone untyped Bin 1 always holds the whole accepted qty and follows Today Recd;
 *   - picked qty < accepted → a blank end row waits, and the bin picked into it takes the
 *     balance (Bin 1 reduced 500 → 300: Bin 2 opens holding 200);
 *   - picked qty ≥ accepted → no end row (the lock);
 *   - a bin cleared → its row goes.
 * The save sends only the picked rows; the blank end row is never stored. The bins must hold
 * the accepted qty EXACTLY (`splitBinsProblem`, and `grn_post` re-checks).
 */
/** `typed`: the operator typed this qty — it is theirs, never re-filled. */
export type SplitRow = { key: string; binId: string; qty: string; typed?: boolean };

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** The rows with a bin picked — what is saved. */
export function pickedBins<T extends SplitRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => !!r.binId);
}

/** What the picked bins hold between them. */
export function binsHeld(rows: readonly SplitRow[]): number {
  return round3(pickedBins(rows).reduce((a, r) => a + num(r.qty), 0));
}

/** Accepted minus what the picked bins hold — > 0 unallocated, < 0 over. */
export function binBalance(rows: readonly SplitRow[], accepted: number): number {
  return round3(accepted - binsHeld(rows));
}

/**
 * Re-shape after any change: untyped bins refilled with what is left, then one blank end row
 * ONLY while there is a balance. `blank` makes a fresh empty row.
 */
export function withTailBin<T extends SplitRow>(rows: readonly T[], blank: () => T, accepted: number): T[] {
  const picked = pickedBins(rows);
  const spare = rows.find((r) => !r.binId);
  if (picked.length === 0) return [spare ?? blank()];
  let left = round3(accepted - picked.filter((r) => r.typed).reduce((a, r) => a + num(r.qty), 0));
  const out = picked.map((r) => {
    if (r.typed) return r;
    const take = round3(Math.max(0, left));
    left = round3(left - take);
    return { ...r, qty: String(take) };
  });
  if (binBalance(out, accepted) <= 0) return out;
  // The blank end row starts clean — a cleared row reused here forgets its typed qty.
  return [...out, { ...(spare ?? blank()), qty: "", typed: false }];
}

/** The bins' own refusal (null when fine). */
export function splitBinsProblem(rows: readonly SplitRow[], accepted: number): string | null {
  const picked = pickedBins(rows);
  if (picked.length === 0) return null;
  // A qty typed before anything was received has nothing to hold (screenshot 3987).
  if (accepted <= 0) return picked.some((r) => r.typed && num(r.qty) > 0) ? "Nothing received yet — enter the received qty first" : null;
  const empty = picked.findIndex((r) => num(r.qty) <= 0);
  if (empty >= 0) return `Bin ${empty + 1} holds nothing — clear it`;
  const bal = binBalance(rows, accepted);
  if (bal > 0) return `Unallocated ${bal} — put it in a bin`;
  if (bal < 0) return `Bins hold ${binsHeld(rows)} — must be ${round3(accepted)}`;
  return null;
}
