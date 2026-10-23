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
import { costingSummary, quoteKey, sizesOf } from "./calc";
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

/**
 * THE INVERSE, FOR OPENING A SAVED COSTING (user 2026-10-22: "quoted is not updating
 * automatically based on calculated — why?"). The entry sheet follows Calculated only
 * while a Quoted box is BLANK, but a costing comes back from the database with its
 * quotes filled — `withCalculatedQuotes` above writes the calculated price into every
 * quote a revision saves. So every reopened costing read as if the merchandiser had
 * typed a price, and its quote froze while the costs moved underneath it.
 *
 * A stored quote that is EXACTLY its piece's Calculated price to the cent was never a
 * decision — it is the follow-the-costs price, written down. Blank it, so it follows
 * again. A quote that differs is someone's price and is kept. Nothing is lost: blank is
 * what the quotation already prints as the rounded Calculated (`offered`).
 */
export function releaseCalculatedQuotes(draft: CostingDraft): CostingDraft {
  const summary = costingSummary(costingInputOf({ ...draft, quotes: {} }));
  const quotes: Record<string, string> = { ...draft.quotes };
  let changed = false;
  for (const g of summary.groups) {
    for (const p of g.pieces) {
      const k = quoteKey(p.pieceKey, g.size);
      const stored = Number((quotes[k] ?? "").trim());
      if (p.calc == null || !(quotes[k] ?? "").trim() || !Number.isFinite(stored)) continue;
      if (Math.abs(stored - Math.round(p.calc * 100) / 100) < 0.000001) {
        delete quotes[k];
        changed = true;
      }
    }
  }
  return changed ? { ...draft, quotes } : draft;
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
    wastage_pct: "",
  }));

/**
 * EVERY STRUCTURE SAMPLE ENTRY ALLOCATED GETS ITS OWN COMPONENT CONSUMPTION LINE
 * (user 2026-10-22, screenshot 094415). The style's structures already become the
 * fabric lines; the weight lines used to point every fabric-less row at the FIRST of
 * them, so a style made in SINGLE JERSEY + 1X1 LYCRA RIB showed only the jersey and
 * the rib had to be picked again.
 *
 * Each piece that still has a fabric-less line keeps it, now naming the first
 * structure, and gains one line per further structure (in the table's sizes). A
 * structure some line already names is never added twice, so re-picking the style
 * cannot double the table. Lines carry no weight, so the save still drops any the
 * operator leaves untouched.
 */
export function weightsForFabrics(weights: WeightDraft[], fabricKeys: readonly string[], fallbackPieceKey: string): WeightDraft[] {
  const named = new Set(weights.map((w) => w.fabric_key).filter(Boolean));
  const todo = fabricKeys.filter((k) => !named.has(k));
  if (!todo.length) return weights;
  const sizes = sizesOf(weights);
  const open = [...new Set(weights.filter((w) => !w.fabric_key).map((w) => w.piece_key))];
  if (!open.length) return [...weights, ...todo.flatMap((k) => newWeightRows(fallbackPieceKey, [], k, sizes))];
  const [first, ...rest] = todo;
  return [
    ...weights.map((w) => (w.fabric_key ? w : { ...w, fabric_key: first })),
    ...open.flatMap((piece) => rest.flatMap((k) => newWeightRows(piece, [], k, sizes))),
  ];
}
