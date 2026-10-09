/**
 * Sample Costing — the working copy behind the report's REVISE (client
 * 2026-10-09: "fabric rate, CMT and margin — the report should update
 * immediately").
 *
 * PURE and client-safe. The report keeps a copy of the saved costing, the
 * workbench edits it, and `withCalculatedQuotes` decides what PRICE that copy
 * quotes — the one thing the three edits do not move on their own.
 *
 * ## WHY THE PRICE NEEDS A RULE
 *
 * A costing stores the price it QUOTES per piece and size, typed by the
 * merchandiser (`quotes`), beside the price its costs CALCULATE. Change the fabric
 * rate and only the calculated one moves: the sheet would keep headlining the old
 * USD 4.30 over a cost that now supports 4.10, and the "report updates
 * immediately" would be true of every figure except the one the buyer reads.
 *
 * So while negotiating, the revision quotes what its costs calculate — rounded to
 * the cent, the same rounding the quotation PDF has always applied to an unquoted
 * piece — and the merchandiser can switch that off to hold the old quote and watch
 * only the margin move.
 */
import { costingSummary, quoteKey } from "./calc";
import { costingInputOf, type CostingDraft, type ExtraChargeDraft, type FabricDraft, type FabricProcessDraft, type PieceLineDraft, type TrimDraft, type WeightDraft, type YarnMixDraft } from "./types";

/** The draft with every piece × size quoting its CALCULATED price, to the cent.
 *  A piece with nothing to calculate yet (no exchange rate) keeps what it had,
 *  and so does any quote key in `held` (typed on the report). */
export function withCalculatedQuotes(draft: CostingDraft, held: ReadonlySet<string> = new Set()): CostingDraft {
  const summary = costingSummary(costingInputOf({ ...draft, quotes: {} }));
  const quotes: Record<string, string> = { ...draft.quotes };
  for (const g of summary.groups) {
    for (const p of g.pieces) {
      if (p.calc == null) continue;
      // A price the merchandiser typed is theirs: costs move around it, it does not move.
      if (held.has(quoteKey(p.pieceKey, g.size))) continue;
      quotes[quoteKey(p.pieceKey, g.size)] = (Math.round(p.calc * 100) / 100).toFixed(2);
    }
  }
  return { ...draft, quotes };
}

/** A deep copy the workbench can edit without touching the saved record. */
export const cloneDraft = (d: CostingDraft): CostingDraft => JSON.parse(JSON.stringify(d)) as CostingDraft;

// ---------------------------------------------------------------------------
// BLANK ROWS — what the report's "+ Add" controls append while revising.
//
// The entry screen builds the same rows in its own closures; these are the
// report's twins, kept pure so a vector can hold them to the same rules: every
// stamped key is "" / null / false EXCEPT what the operator picked, so an
// untouched row is still blank to the save-side filters (`isBlankTrim`,
// `isBlankPieceLine`, `isBlankExtra`).
// ---------------------------------------------------------------------------

const rid = (p: string) => `${p}${crypto.randomUUID()}`;

export const newYarnMix = (): YarnMixDraft => ({ key: rid("y"), item_id: null, yarn_name: "", mix_pct: "", rate: "" });
export const newFabricProcess = (): FabricProcessDraft => ({ key: rid("p"), process_id: null, process_name: "", rate: "" });
export const newFabric = (): FabricDraft => ({
  key: rid("f"),
  fabric_id: null,
  quality: "",
  yarn_rate: "",
  yarns: [newYarnMix()],
  knitting_rate: "",
  dyeing_rate: "",
  finishing_rate: "",
  process_loss_pct: "",
  is_direct: true,
  direct_rate: "",
  processes: [newFabricProcess()],
});
export const newTrim = (pieceKey: string, itemId: string | null = null, description = ""): TrimDraft => ({
  key: rid("t"),
  piece_key: pieceKey,
  item_id: itemId,
  description,
  qty: "",
  rate: "",
  is_direct: true,
  pack_price: "",
  pack_size: "",
});
export const newPieceLine = (kind: PieceLineDraft["kind"], processId: string | null, processName: string): PieceLineDraft => ({
  key: rid("l"),
  kind,
  process_id: processId,
  process_name: processName,
  rate: "",
});
export const newExtra = (section: ExtraChargeDraft["section"]): ExtraChargeDraft => ({ key: rid("x"), section, name: "", kind: "flat", value: "", sign: "add" });
/** One weight row per size column (or one "every size" row when the style has none). */
export const newWeightRows = (pieceKey: string, componentIds: string[], fabricKey: string | null, sizes: readonly (string | null)[]): WeightDraft[] =>
  (sizes.length ? sizes : [null]).map((size) => ({
    key: rid("w"),
    piece_key: pieceKey,
    fabric_key: fabricKey,
    component_ids: componentIds,
    size_name: size,
    weight_g: "",
    length_cm: "",
    width_cm: "",
    gsm: "",
    wastage_pct: "3",
  }));
