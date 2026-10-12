/**
 * Sample ▸ Accessories Plan ▸ FILL FROM COSTING (user 2026-10-12).
 *
 * When the planner picks the SWO, the Items grid fills from each sample's
 * CURRENT costing trims: one line per (SMP, material),
 *
 *   Planned Qty = Σ trim qty per garment × the sample's pieces
 *
 * — the costing's `qty` is "units per garment" (0694), and the pieces are the
 * ones the SWO batched for that sample. Two trim rows of one material on one
 * costing (a button on the body and on the cuff) are one line. A trim with no
 * MATERIAL named (typed description only) cannot be a line — the grid needs a
 * material — so it is returned in `skipped` and said on screen, never dropped
 * silently. Nothing here writes: the screen puts the lines in the grid, the
 * planner edits them, and Save stores them. "Refill from Costing" runs the
 * same function again; a saved plan never changes by itself.
 *
 * PURE: the screen and `check:iwo-material-bom-fill` read one rule.
 */

export type SwoTrimSample = {
  style_id: string;
  /** "SMP/26-27/0001 · STYLE" — for the skipped message. */
  label: string;
  pieces: number;
  trims: { item_id: string | null; description: string | null; qty: number | null }[];
};

export type SampleFillLine = { style_id: string; item_id: string; planned_qty: number };

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function sampleFillLines(samples: readonly SwoTrimSample[]): { lines: SampleFillLine[]; skipped: string[] } {
  const lines: SampleFillLine[] = [];
  const skipped: string[] = [];
  for (const s of samples) {
    const perGarment = new Map<string, number>();
    for (const t of s.trims) {
      const q = t.qty ?? 0;
      if (!(q > 0)) continue;
      if (!t.item_id) {
        skipped.push(`${s.label}: ${(t.description ?? "").trim() || "a trim"} (no material on the costing)`);
        continue;
      }
      perGarment.set(t.item_id, (perGarment.get(t.item_id) ?? 0) + q);
    }
    if (!(s.pieces > 0)) {
      if (perGarment.size) skipped.push(`${s.label}: no sample pieces in the SWO, so no quantity to plan`);
      continue;
    }
    for (const [item_id, q] of perGarment) lines.push({ style_id: s.style_id, item_id, planned_qty: round4(q * s.pieces) });
  }
  return { lines, skipped };
}
