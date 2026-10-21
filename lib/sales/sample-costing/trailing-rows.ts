import { newExtra, newFabricProcess, newPieceLine, newTrim, newWeightRows, newYarnMix } from "./revision-draft";
import { sizesOf } from "./calc";
import { isBlankExtra, isBlankPieceLine, isBlankProcess, isBlankTrim, isBlankYarn, type CostingDraft } from "./types";

/**
 * ENTER-ONLY ENTRY (Costing 5, user 2026-10-21: "no more add row concept, using only
 * the Enter key the user should work in costing entry end to end").
 *
 * Every table of the cost sheet ends with ONE blank row, always. Typing into it makes it a
 * line, and the next call puts a fresh blank under it — so no "+ Add" button is needed and
 * none is drawn. Enter on the blank row before anything is typed leaves the table
 * (`data-row-tail`, see `gridKeyNav`), so a keystroke never creates a row by itself: the
 * client's 2026-08-19 complaint ("enter key automatically creating the new section")
 * stays fixed.
 *
 * The blanks are never saved: `liveRows` and the payload drop every blank line, for every
 * table this tops up.
 *
 * KEYS ARE DETERMINISTIC (`tail-<n>`, the first free number), not `rid()`. This runs on
 * every render of the sheet, so a random key would remount the blank row each time —
 * and a row that remounts drops the cursor the operator just put in it. The same draft
 * always gets the same blank, so the row and its focus survive any re-render.
 *
 * Returns the SAME object when nothing is missing, so callers can compare by identity.
 */
export function withTrailingRows(d: CostingDraft): CostingDraft {
  const taken = new Set<string>();
  const note = (k: string) => taken.add(k);
  d.trims.forEach((t) => note(t.key));
  (d.extras ?? []).forEach((x) => note(x.key));
  d.weights.forEach((w) => note(w.key));
  d.pieces.forEach((p) => p.lines.forEach((l) => note(l.key)));
  d.fabrics.forEach((f) => {
    f.yarns.forEach((y) => note(y.key));
    f.processes.forEach((q) => note(q.key));
  });
  const free = (prefix: string) => {
    let i = 0;
    while (taken.has(`${prefix}tail-${i}`)) i++;
    const k = `${prefix}tail-${i}`;
    taken.add(k);
    return k;
  };

  let next = d;
  const first = d.pieces[0];

  // Garment processes and CMT operations: one blank line of each kind, on the first piece.
  if (first) {
    let lines = first.lines;
    for (const kind of ["embellishment", "cmt"] as const) {
      const has = d.pieces.some((p) => p.lines.some((l) => l.kind === kind && isBlankPieceLine(l)));
      if (!has) lines = [...lines, { ...newPieceLine(kind, null, ""), key: free(kind === "cmt" ? "c" : "e") }];
    }
    if (lines !== first.lines) next = { ...next, pieces: next.pieces.map((p) => (p.key === first.key ? { ...p, lines } : p)) };
  }

  if (!d.trims.some(isBlankTrim)) next = { ...next, trims: [...next.trims, { ...newTrim(first?.key ?? ""), key: free("t") }] };

  if (!(d.extras ?? []).some(isBlankExtra)) next = { ...next, extras: [...(next.extras ?? []), { ...newExtra("overhead"), key: free("x") }] };

  /* Component consumption groups its rows into lines by (piece, component, fabric), so a
     second line with neither would merge into the first: the open line is any group with
     no component and no fabric — typed weights or not. */
  if (!d.weights.some((w) => w.component_ids.length === 0 && !w.fabric_key)) {
    const base = free("w");
    const rows = newWeightRows(first?.key ?? "", [], null, sizesOf(d.weights)).map((w, i) => ({ ...w, key: `${base}-${i}` }));
    next = { ...next, weights: [...next.weights, ...rows] };
  }

  // Each priced fabric's Yarn and Processes tables. A bought-in (direct) fabric has neither.
  let fabricsChanged = false;
  const fabrics = d.fabrics.map((f) => {
    if (f.is_direct || !(f.fabric_id || f.quality.trim())) return f;
    let out = f;
    if (!f.yarns.some(isBlankYarn)) out = { ...out, yarns: [...out.yarns, { ...newYarnMix(), key: free(`y${f.key}-`) }] };
    if (!f.processes.some(isBlankProcess)) out = { ...out, processes: [...out.processes, { ...newFabricProcess(), key: free(`p${f.key}-`) }] };
    if (out !== f) fabricsChanged = true;
    return out;
  });
  if (fabricsChanged) next = { ...next, fabrics };

  return next;
}
