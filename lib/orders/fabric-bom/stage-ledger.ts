/**
 * GREIGE IS ONE LOT (client 2026-09-19) — the two consolidations the Yarn &
 * Fabric Requirement report applies, lifted out of `./reports.ts` (which is
 * `server-only`) so `scripts/check-fabric-print-route.mts` can pin them.
 *
 * Grey yarn is bought, and grey cloth is knitted and heat-set, before any
 * colour exists. So a GREIGE-stage section prints one line per fabric with the
 * combined weight ("1070 KGS"), and the yarn drill-down lists one contribution
 * per fabric — never a line per garment colourway. Colour begins at dyeing.
 *
 * Type-only imports: nothing here runs Supabase.
 */
import type { StageBreakdownLine, YarnFabricContribution } from "./reports";

/**
 * One GREIGE section's lines, colourways summed. Kept apart even here:
 *
 * - a YARN-DYED cloth (`ydComboName`) — its colour pattern exists before it is
 *   knitted, so each combination is knitted as its own lot;
 * - a different panel branch (`component`) — a component-wise route;
 * - a different loss % — a colour-scoped greige step would be one.
 *
 * The dia survives only when every summed line agrees ("one distinct answer or
 * nothing", this module's rule everywhere). Order of first appearance is kept.
 */
export function mergeGreigeLines(lines: readonly StageBreakdownLine[]): StageBreakdownLine[] {
  const merged = new Map<string, StageBreakdownLine>();
  const dias = new Map<string, Set<string>>();
  for (const l of lines) {
    const key = JSON.stringify([l.itemId, l.component ?? "", l.ydComboName ?? "", l.lossPct]);
    const d = dias.get(key) ?? new Set<string>();
    if (l.dia) d.add(l.dia);
    dias.set(key, d);
    const held = merged.get(key);
    if (!held) {
      merged.set(key, {
        ...l,
        combo: l.ydComboName ? l.combo : null,
        fabricColour: l.ydComboName ? l.fabricColour : null,
      });
      continue;
    }
    held.plannedWt = Number((held.plannedWt + l.plannedWt).toFixed(6));
    held.toOrderedWt = Number((held.toOrderedWt + l.toOrderedWt).toFixed(6));
    held.plannedNos =
      held.plannedNos == null || l.plannedNos == null ? null : Number((held.plannedNos + l.plannedNos).toFixed(3));
    held.toOrderedNos =
      held.toOrderedNos == null || l.toOrderedNos == null ? null : Number((held.toOrderedNos + l.toOrderedNos).toFixed(3));
  }
  for (const [key, l] of merged) {
    const d = dias.get(key);
    l.dia = d && d.size === 1 ? [...d][0] : null;
  }
  return [...merged.values()];
}

/** One drill-down line per (fabric, panel branch), colourways summed. `combo`
 *  survives only when every summed row named the same one. */
export function consolidateContributions(rows: readonly YarnFabricContribution[]): YarnFabricContribution[] {
  const out = new Map<string, YarnFabricContribution>();
  for (const r of rows) {
    const key = JSON.stringify([r.fabricName, r.component ?? ""]);
    const held = out.get(key);
    if (!held) {
      out.set(key, { ...r });
      continue;
    }
    held.wt = Number((held.wt + r.wt).toFixed(6));
    if (held.combo !== r.combo) held.combo = null;
  }
  return [...out.values()];
}
