/**
 * BIN ROWS KEEP A BLANK END ROW — NO "+ Split bin" BUTTON (user 2026-11-02, screenshot
 * 121250: "how we add in Costing CMT process using Enter — remove the split bin button").
 * The app's rule for a table that grows (AGENTS.md "A table may keep a blank end row INSTEAD
 * of a + Add button", Costing 5): one row is always waiting; picking a bin in it makes it a
 * bin and a fresh blank appears under it. Nothing is created by a key aimed at moving.
 *
 * One rule for every bin box on the receiving screens (GRN entry, Edit GRN, Pending QC):
 *   - nothing picked → ONE box;
 *   - one bin picked → that bin + a blank end row (the qty is the whole accepted qty);
 *   - two or more   → a SPLIT: every picked bin carries an EDITABLE qty. The first bin
 *     pre-fills with the rest — accepted minus the others — until the operator types in it
 *     (user 2026-11-02, screenshot 3973: "why can't the bin qty be edited"); from then on
 *     it is theirs and the cell says in red when the split does not add up;
 *   - a bin cleared → its row goes (the blank end row is never doubled).
 * The save sends only the picked rows; the blank end row is never stored.
 */
/** `typed`: the operator typed this qty — it is theirs, never re-filled. */
export type SplitRow = { key: string; binId: string; qty: string; typed?: boolean };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** The rows with a bin picked — what is saved. */
export function pickedBins<T extends SplitRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => !!r.binId);
}

/**
 * Re-shape after any change: picked rows, the first holding the rest of `accepted`, then one
 * blank end row (once anything is picked). `blank` makes a fresh empty row.
 */
export function withTailBin<T extends SplitRow>(rows: readonly T[], blank: () => T, accepted: number): T[] {
  const picked = pickedBins(rows);
  const spare = rows.find((r) => !r.binId);
  if (picked.length === 0) return [spare ?? blank()];
  let out = picked;
  if (picked.length > 1 && !picked[0].typed) {
    const others = picked.slice(1).reduce((a, r) => a + num(r.qty), 0);
    out = [{ ...picked[0], qty: String(round3(Math.max(0, accepted - others))) }, ...picked.slice(1)];
  }
  // The blank end row starts clean — a cleared row reused here forgets its typed qty.
  return [...out, { ...(spare ?? blank()), qty: "", typed: false }];
}

/** The split's own refusal (null when fine) — only once two or more bins are picked. */
export function splitBinsProblem(rows: readonly SplitRow[], accepted: number): string | null {
  const picked = pickedBins(rows);
  if (picked.length < 2 || accepted <= 0) return null;
  if (picked.some((r) => num(r.qty) <= 0)) return "Enter a qty on every bin";
  const held = round3(picked.reduce((a, r) => a + num(r.qty), 0));
  return held === round3(accepted) ? null : `Bins hold ${held} — must be ${round3(accepted)}`;
}
