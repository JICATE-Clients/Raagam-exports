/**
 * check:sample-costing — the costing engine against the SPEC'S OWN NUMBERS
 * (doc/sample/sample-costing-specification.md §3.1, §3.2, §4.1, §4.2, §4.3).
 *
 * `lib/sales/sample-costing/calc.ts` is read by the screen's live summary, the
 * server's Submit (the 20 % margin floor) and the quotation PDF. A wrong figure
 * here is wrong in all three at once, so the worked examples are pinned.
 *
 *   npx --yes tsx scripts/check-sample-costing.mts
 */
import {
  MARGIN_FLOOR_PCT,
  costingSummary,
  componentCost,
  dimensionalGrams,
  fabricPricePerKg,
  fabricSubtotal,
  quoteKey,
  marginHealth,
  yarnMixTotal,
  yarnRateOf,
  solveTarget,
  fabricKgFor,
  trimCostPerPiece,
  type CostingInput,
  type FabricInput,
  type PieceInput,
} from "../lib/sales/sample-costing/calc.ts";
import { linesToWeights, weightsToLines } from "../lib/sales/sample-costing/matrix.ts";
import { buildRevisionHistory, type RevisionSource } from "../lib/sales/sample-costing/revision-history.ts";
import { historyForBuyer } from "../lib/sales/sample-costing/quotation.ts";
import { cleanSizes, offeredSizes, sizesNotInStyle } from "../lib/sales/sample-costing/style-sizes.ts";

let failed = 0;
function eq(label: string, got: number | null | boolean, want: number | null | boolean, dp = 2) {
  const ok =
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) < 0.5 * 10 ** -dp
      : got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: got ${got}, want ${want}`);
}

const fabric = (o: Partial<FabricInput> & { key: string }): FabricInput => ({
  yarn_rate: "",
  yarns: [],
  knitting_rate: "",
  dyeing_rate: "",
  finishing_rate: "",
  process_loss_pct: "",
  is_direct: false,
  direct_rate: "",
  processes: [],
  ...o,
});
const piece = (o: Partial<PieceInput> & { key: string }): PieceInput => ({
  cmt: "",
  cmt_direct: true,
  lines: [],
  testing_cost: "",
  bank_cost: "",
  ...o,
});
const w = (piece_key: string, fabric_key: string, weight_g: string, size_name: string | null = null) => ({
  piece_key,
  fabric_key,
  size_name,
  weight_g,
  length_cm: "",
  width_cm: "",
  gsm: "",
  wastage_pct: "",
});

// §3.1 — 295 + 55 + 100 + (16 + 12 + 16 + 16 + 10) = 520; × 1.12 = 582.40
const brushBack = fabric({
  key: "f1",
  yarn_rate: "295",
  knitting_rate: "55",
  dyeing_rate: "100",
  process_loss_pct: "12",
  processes: ["16", "12", "16", "16", "10"].map((rate) => ({ rate })),
});
eq("§3.1 subtotal", fabricSubtotal(brushBack), 520);
eq("§3.1 price/kg", fabricPricePerKg(brushBack), 582.4);
eq("§3.1 direct rate overrides", fabricPricePerKg({ ...brushBack, is_direct: true, direct_rate: "600" }), 600);
eq("§3.1 nothing typed = no price", fabricPricePerKg(fabric({ key: "x" })), null);

// §3.2 — 582.40 / 1000 × 162 = 94.35; and the dimensional calc
eq("§3.2 component cost", componentCost(w("p", "f1", "162"), [brushBack]), 94.35);
eq("§3.2 L×W×GSM/10000", dimensionalGrams({ length_cm: "50", width_cm: "60", gsm: "200" }), 60);

/* §4.1 — THE SPEC'S OWN SUM IS OFF BY ONE: it prints "94 + 23 + 30 + 38 + 0 +
   0 + 20 + 8 = 214", and those terms add to 213. The engine adds correctly
   (first vector); the chain the spec then works from a net of 214 — 53.50 /
   10.70 / 4.28 / 273.92 — is pinned by costing the body at 95 g instead. */
const flat = fabric({ key: "flat", is_direct: true, direct_rate: "1000" }); // 1 g = ₹1
eq(
  "§4.1 the spec's terms really add to 213",
  costingSummary({
    pieces: [piece({ key: "top", cmt: "30", lines: [{ kind: "embellishment", rate: "38" }], testing_cost: "8" })],
    fabrics: [flat],
    weights: [w("top", "flat", "94"), w("top", "flat", "23")],
    trims: [{ piece_key: "top", qty: "1", rate: "20" }],
    terms: { margin_pct: "", garment_waste_pct: "", overhead_pct: "", discount_pct: "", freight_per_pc: "", insurance_per_pc: "", exchange_rate: "" },
    quotes: {},
  }).groups[0].pieces[0].net,
  213,
);
/* CMT AND EMBELLISHMENT FROM THE PROCESS MASTER (0692, user 2026-10-08). The
   same 213 reached three ways: the Direct rate; the Direct box UNTICKED with
   operation lines (the flat box then counts for nothing); and the Direct box
   TICKED with operation lines present (the lines then count for nothing).
   Embellishment is the sum of its own lines and never reads a CMT line. */
const netOf = (pc: PieceInput) =>
  costingSummary({
    pieces: [pc],
    fabrics: [flat],
    weights: [w("top", "flat", "94"), w("top", "flat", "23")],
    trims: [{ piece_key: "top", qty: "1", rate: "20" }],
    terms: { margin_pct: "", garment_waste_pct: "", overhead_pct: "", discount_pct: "", freight_per_pc: "", insurance_per_pc: "", exchange_rate: "" },
    quotes: {},
  }).groups[0].pieces[0];
eq("0692 direct rate + embellishment", netOf(piece({ key: "top", cmt: "30", lines: [{ kind: "embellishment", rate: "38" }], testing_cost: "8" })).net, 213);
eq(
  "0692 operations (10 + 12 + 8) replace the flat box, which then counts for nothing",
  netOf(piece({ key: "top", cmt: "999", cmt_direct: false, lines: [{ kind: "cmt", rate: "10" }, { kind: "cmt", rate: "12" }, { kind: "cmt", rate: "8" }, { kind: "embellishment", rate: "38" }], testing_cost: "8" })).net,
  213,
);
eq(
  "0692 Direct rate ticked: operation lines present count for nothing",
  netOf(piece({ key: "top", cmt: "30", cmt_direct: true, lines: [{ kind: "cmt", rate: "100" }, { kind: "embellishment", rate: "38" }], testing_cost: "8" })).net,
  213,
);
eq(
  "0692 embellishment sums its own lines only (20 + 18), never a CMT line",
  netOf(piece({ key: "top", cmt: "30", lines: [{ kind: "embellishment", rate: "20" }, { kind: "embellishment", rate: "18" }, { kind: "cmt", rate: "500" }], testing_cost: "8" })).process,
  38,
);
eq("0692 CMT figure when operations are used", netOf(piece({ key: "top", cmt_direct: false, lines: [{ kind: "cmt", rate: "10" }, { kind: "cmt", rate: "12" }] })).cmt, 22);
eq("0692 a blank rate is nothing", netOf(piece({ key: "top", cmt_direct: false, lines: [{ kind: "cmt", rate: "" }] })).cmt, 0);

const base: CostingInput = {
  pieces: [piece({ key: "top", cmt: "30", lines: [{ kind: "embellishment", rate: "38" }], testing_cost: "8" })],
  fabrics: [flat],
  weights: [w("top", "flat", "95"), w("top", "flat", "23")],
  trims: [{ piece_key: "top", qty: "1", rate: "20" }],
  terms: {
    margin_pct: "25",
    garment_waste_pct: "5",
    overhead_pct: "",
    discount_pct: "2",
    freight_per_pc: "2",
    insurance_per_pc: "1",
    exchange_rate: "83",
  },
  quotes: {},
};
const s1 = costingSummary(base).groups[0].pieces[0];
eq("§4.1 net", s1.net, 214);
eq("§4.1 margin", s1.margin, 53.5);
eq("§4.1 wastage", s1.wastage, 10.7);
eq("§4.1 discount", s1.discount, 4.28);
eq("§4.1 gross", s1.gross, 273.92);
// §4.2 — (273.92 + 2 + 1) / 83
eq("§4.2 calc price", s1.calc, 3.3364, 4);
eq("§4.2 no quote → margin is the typed 25 %", s1.effectiveMarginPct, 25);
eq("§4.2 missing rate → no calc price", costingSummary({ ...base, terms: { ...base.terms, exchange_rate: "" } }).groups[0].pieces[0].calc, null);

const quoted = costingSummary({ ...base, quotes: { [quoteKey("top", null)]: "3.40" } }).groups[0].pieces[0];
eq("§4.2 delta", quoted.delta, 3.4 - 3.3364, 4);
eq("§4.2 delta %", quoted.deltaPct, ((3.4 - 3.3364) / 3.3364) * 100);

// §5.2 — a quote that earns < 20 % flags; one that earns ≥ 20 % does not
const cheap = costingSummary({ ...base, quotes: { [quoteKey("top", null)]: "3.00" } });
eq("§5.2 cheap quote below floor", cheap.belowFloor, true);
eq("§5.2 floor is 20", MARGIN_FLOOR_PCT, 20);
eq("§5.2 typed 25 % clears", costingSummary(base).belowFloor, false);

// §4.3 — a SET's price is the sum of its pieces
const set = costingSummary({
  ...base,
  pieces: [...base.pieces, piece({ key: "pant", cmt: "25" })],
  weights: [...base.weights, w("pant", "flat", "100")],
  quotes: { [quoteKey("top", null)]: "4.12", [quoteKey("pant", null)]: "2.70" },
});
eq("§4.3 set quoted price", set.groups[0].total.quoted, 6.82);
eq(
  "§4.3 set calc = Σ pieces",
  set.groups[0].total.calc,
  (set.groups[0].pieces[0].calc ?? 0) + (set.groups[0].pieces[1].calc ?? 0),
  4,
);

// SIZES (0693) — a row with no size (the rib, or a legacy row) adds to every size
const sized = costingSummary({
  ...base,
  weights: [w("top", "flat", "162", "M"), w("top", "flat", "258", "L"), w("top", "flat", "40")],
});
eq("sizes: two costed", sized.groups.length, 2);
eq("sizes: M fabric = 162 + 40", sized.groups[0].pieces[0].fabric, 202);
eq("sizes: L fabric = 258 + 40", sized.groups[1].pieces[0].fabric, 298);
eq("sizes: the group is keyed by the size NAME", sized.groups[1].size === "L", true);
eq("sizes: a quote is keyed by piece × size name", costingSummary({ ...base, weights: [w("top", "flat", "162", "M")], quotes: { "top|M": "5" } }).groups[0].pieces[0].quoted, 5);

// UI/UX round (0690) ------------------------------------------------------------
// Yarn Mix: 60 % @ 295 + 40 % @ 180 = 177 + 72 = 249 — and it replaces the typed rate.
const blend = fabric({ key: "b", yarn_rate: "999", yarns: [{ mix_pct: "60", rate: "295" }, { mix_pct: "40", rate: "180" }] });
eq("ui §4.2 yarn mix weighted rate", yarnRateOf(blend), 249);
eq("ui §4.2 mix total", yarnMixTotal(blend), 100);
eq("ui §4.2 finishing joins the subtotal", fabricSubtotal(fabric({ key: "f", yarn_rate: "100", finishing_rate: "8" })), 108);
// Wastage allowance: 582.40 / 1000 × 162 × 1.03 = 97.18
eq("ui §4.3 wastage allowance", componentCost({ ...w("p", "f1", "162"), wastage_pct: "3" }, [brushBack]), 97.18);
// The UI spec's own rail: Net 175.70, Wastage 5 % 8.79, Overhead 3 % 5.27 → Gross Cost 189.76
const rail = costingSummary({
  pieces: [piece({ key: "r", cmt: "175.70" })],
  fabrics: [],
  weights: [],
  trims: [],
  terms: { margin_pct: "", garment_waste_pct: "5", overhead_pct: "3", discount_pct: "", freight_per_pc: "", insurance_per_pc: "", exchange_rate: "84" },
  quotes: {},
}).groups[0].pieces[0];
eq("ui §3 rail wastage", rail.wastage, 8.79);
eq("ui §3 rail overhead", rail.overhead, 5.27);
eq("ui §3 rail gross cost", rail.grossCost, 189.76);
// v2 §4.1 badges: ≥ 22 green, 15–21.9 yellow, < 15 red — the 20 % approval floor is separate.
eq("v2 §4.1 health 22 good", marginHealth(22) === "good", true);
eq("v2 §4.1 health 21.9 tight", marginHealth(21.9) === "tight", true);
eq("v2 §4.1 health 15 tight", marginHealth(15) === "tight", true);
eq("v2 §4.1 health 14.9 poor", marginHealth(14.9) === "poor", true);
eq("v2 approval floor unchanged at 20", MARGIN_FLOOR_PCT, 20);

// UX plan P2.4 — target solver. Net 214, wastage 5 %, discount 2 %, freight 2 + insurance 1, rate 83.
// Target $3.10 → INR 3.10 × 83 − 3 = 254.30; margin = (254.30 − 214 × 1.03) / 214 = 15.83 %.
const tgt = solveTarget({ net: 214 }, base.terms, 3.1, 1, 0.118);
eq("P2.4 margin at target", tgt?.marginPct ?? null, 15.83);
eq("P2.4 below floor", tgt?.clearsFloor ?? null, false);
// Net that clears 20 %: 254.30 ÷ (1 + .05 − .02 + .20) = 206.75 → cut 7.25
eq("P2.4 cost cut to reach 20 %", tgt?.costCut ?? null, 7.25);
eq("P2.4 cut per kg of fabric", tgt?.perKgFabric ?? null, 61.44);
// Feeding the solved margin back as the quoted price reproduces the target.
eq("P2.4 round-trip", costingSummary({ ...base, quotes: { [quoteKey("top", null)]: "3.10" } }).groups[0].pieces[0].effectiveMarginPct, 15.83);
eq("P2.4 fabric kg incl. allowance", fabricKgFor([{ ...w("p", "f", "100"), wastage_pct: "3" }], null), 0.103, 3);

// 0693 — the SIZE matrix. Body 162 / 258 / 270 across M, L, XL and a 40 g rib typed once;
// Loss % is one box per size, a blank one inherits the first size's.
const mLines = [
  { key: "body", piece_key: "p", component_id: "c1", fabric_key: "f", cells: { M: "162", L: "258", XL: "270" } },
  { key: "rib", piece_key: "p", component_id: "c2", fabric_key: "f", cells: { M: "40", L: "", XL: "" } },
];
const mSizes = ["M", "L", "XL"];
const mLoss = { M: "3", L: "", XL: "5" };
const mRows = linesToWeights(mLines, mSizes, mLoss);
eq("matrix: six rows written", mRows.length, 6);
eq("matrix: rib inherits 40 g in XL", Number(mRows.find((r) => r.key === "rib|XL")?.weight_g), 40);
eq("matrix: the row carries its SIZE NAME", mRows.find((r) => r.key === "body|L")?.size_name === "L", true);
eq("matrix: loss typed on XL is written on XL's rows", Number(mRows.find((r) => r.key === "body|XL")?.wastage_pct), 5);
eq("matrix: blank loss on L inherits M's 3", Number(mRows.find((r) => r.key === "rib|L")?.wastage_pct), 3);
let mSeq = 0;
const back = weightsToLines(mRows, () => "k" + mSeq++, () => null);
eq("matrix round-trip: two lines", back.lines.length, 2);
eq("matrix round-trip: inherited cell reads blank again", back.lines[1].cells.L === "", true);
eq("matrix round-trip: sizes in first-seen order", JSON.stringify(back.sizes), JSON.stringify(mSizes));
eq("matrix round-trip: XL keeps its own 5 %", back.loss.XL, "5");
eq("matrix round-trip: L's inherited loss reads blank again", back.loss.L, "");
eq("matrix: no sizes chosen → one All-sizes row per line", linesToWeights([{ ...mLines[0], cells: { all: "150" } }], [], { all: "3" }).length, 1);
eq("matrix: that row has no size", linesToWeights([{ ...mLines[0], cells: { all: "150" } }], [], {})[0].size_name, null);
eq("matrix: an unfinished first column still writes (so it is reported)", linesToWeights([{ ...mLines[0], cells: { M: "" } }], ["M"], {}).length, 1);

// A LEGACY ROW (no size, saved before 0693) fills the FIRST size column; nothing is dropped.
const legacy = [
  { ...w("p", "f", "100", null), key: "a", component_id: "c1", wastage_pct: "3" },
  { ...w("p", "f", "30", "L"), key: "b", component_id: "c1", wastage_pct: "4" },
];
const lg = weightsToLines(legacy, () => "x", () => null);
eq("legacy: the one sized row defines the only size", JSON.stringify(lg.sizes), JSON.stringify(["L"]));
eq("legacy: the no-size grams land in that first column", lg.lines.length === 1 && lg.lines[0].cells.L !== undefined, true);
const lgOnly = weightsToLines([{ ...w("p", "f", "100", null), key: "a", component_id: "c1", wastage_pct: "3" }], () => "x", () => null);
eq("legacy: a sheet with no size at all keeps its grams in the All-sizes column", lgOnly.lines[0].cells.all, "100");
eq("legacy: …and its loss", lgOnly.loss.all, "3");

// THE SIZES ARE THE STYLE'S, AND THE OPERATOR CHOOSES (user 2026-10-08) — style-sizes.ts.
function eqs(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failed++;
  console.log((ok ? "ok  " : "FAIL") + " " + label + ": got " + g + ", want " + w);
}
eqs("style sizes: nothing held → every style size is on offer, in the style's order", offeredSizes(["S", "M", "L"], []), ["S", "M", "L"]);
eqs("style sizes: a held size drops off the list", offeredSizes(["S", "M", "L"], ["M"]), ["S", "L"]);
eqs("style sizes: case and spaces are ignored", offeredSizes(["S", " xl ", "L"], ["XL"]), ["S", "L"]);
eqs("style sizes: a repeated size is one size", cleanSizes(["S", "s", " S ", "", "M"]), ["S", "M"]);
eqs("style sizes: a held size the style no longer has is reported", sizesNotInStyle(["S", "M"], ["M", "XXL"]), ["XXL"]);
eqs("style sizes: nothing held → nothing to report", sizesNotInStyle(["S", "M"], []), []);
eqs("style sizes: a style with no sizes offers nothing (the operator cannot invent one)", offeredSizes([], []), []);

// TRIMS BY CONSUMPTION (user 2026-10-08, the Trims Consumption spec) — trimCostPerPiece.
const trimCost = (o: Partial<Parameters<typeof trimCostPerPiece>[0]>) =>
  trimCostPerPiece({ qty: "", rate: "", is_direct: false, pack_price: "", pack_size: "", ...o });
eq("trims: carton ₹120 ÷ 40 garments × 1 = ₹3.00", trimCost({ pack_price: "120", pack_size: "40", qty: "1" }).cost, 3);
eq("trims: thread cone ₹120 ÷ 50 garments = ₹2.40", trimCost({ pack_price: "120", pack_size: "50", qty: "1" }).cost, 2.4);
eq("trims: buttons ₹144 gross ÷ 144 × 4 = ₹4.00", trimCost({ pack_price: "144", pack_size: "144", qty: "4" }).cost, 4);
eq("trims: elastic ₹15 a metre × 0.5 m, pack size blank = ₹7.50", trimCost({ pack_price: "15", qty: "0.5" }).cost, 7.5);
eq("trims: Direct rate ₹25 with no consumption typed = ₹25.00", trimCost({ is_direct: true, rate: "25" }).cost, 25);
eq("trims: Direct rate ₹5 ignores a consumption typed while on Package price (that set is hidden)", trimCost({ is_direct: true, rate: "5", qty: "2" }).cost, 5);
eq("trims: a pre-0694 line (no is_direct) is a Direct line, the flat rate", trimCostPerPiece({ qty: "1", rate: "5" }).cost, 5);
eq("trims: Package price ignores a Direct rate typed before the switch was flipped", trimCost({ rate: "99", pack_price: "120", pack_size: "40", qty: "1" }).cost, 3);
eq("trims: pack size 0 is never divided (cost 0, finite)", Number.isFinite(trimCost({ pack_price: "120", pack_size: "0", qty: "1" }).cost) && trimCost({ pack_price: "120", pack_size: "0", qty: "1" }).cost === 0, true);
eqs("trims: pack size 0 is reported", trimCost({ pack_price: "120", pack_size: "0", qty: "1" }).problem, "pack_size");
eqs("trims: a negative pack size is reported", trimCost({ pack_price: "120", pack_size: "-5", qty: "1" }).problem, "pack_size");
eqs("trims: a price with no consumption is reported", trimCost({ pack_price: "120", pack_size: "40" }).problem, "consumption");
eqs("trims: nothing typed is not a problem", trimCost({}).problem, null);
eq(
  "trims: the per-piece cost feeds the piece's Trims subtotal",
  costingSummary({
    ...base,
    trims: [{ piece_key: "top", qty: "1", rate: "", is_direct: false, pack_price: "120", pack_size: "40" }],
  }).groups[0].pieces[0].trims,
  3,
);

// 2026-10-08 — the "+ Add" charge rows of Overheads and Price & quote.
// Net 100. Overheads: flat ₹10 + 5 % of net = ₹15 → gross cost 115.
// Price: + flat ₹6, − 2 % of net (₹2) → +₹4 through the price; margin 20 % → price 115 + 20 + 4 = 139.
const xTerms = { margin_pct: "20", garment_waste_pct: "", overhead_pct: "", discount_pct: "", freight_per_pc: "", insurance_per_pc: "", exchange_rate: "1" };
const xExtras = [
  { section: "overhead" as const, kind: "flat" as const, value: "10", sign: "add" as const },
  { section: "overhead" as const, kind: "pct" as const, value: "5", sign: "add" as const },
  { section: "price" as const, kind: "flat" as const, value: "6", sign: "add" as const },
  { section: "price" as const, kind: "pct" as const, value: "2", sign: "deduct" as const },
];
const xIn = { pieces: [piece({ key: "x", cmt: "100" })], fabrics: [], weights: [], trims: [], terms: xTerms, quotes: {}, extras: xExtras };
const xp = costingSummary(xIn).groups[0].pieces[0];
eq("extras: overhead rows add to the gross cost", xp.extraOverhead, 15);
eq("extras: gross cost carries them", xp.grossCost, 115);
eq("extras: a deduct row is negative, a surcharge positive", xp.priceAdj, 4);
eq("extras: price = gross cost + margin + price charges", xp.gross, 139);
eq("extras: a price charge passes through the margin (still 20 %)", xp.effectiveMarginPct, 20);
eq("extras: absent rows change nothing", costingSummary({ ...xIn, extras: undefined }).groups[0].pieces[0].gross, 120);
eq("extras: the set total sums them", costingSummary({ ...xIn, pieces: [piece({ key: "x", cmt: "100" }), piece({ key: "y", cmt: "100" })] }).groups[0].total.extraOverhead, 30);
const xs = solveTarget({ net: 100 }, xTerms, 139, 1, 0, xExtras);
eq("extras: the target solver reads them (139 leaves 20 %)", xs?.marginPct ?? null, 20);

// ---- revision history (client 2026-10-09: "the sample rev will happen in the report") ----
{
  const rev = (id: string, version: number, o: { target?: number | null; computed?: number | null; margin?: number | null } = {}): RevisionSource => ({
    id,
    version,
    status: "approved",
    is_draft: false,
    costing_date: "2026-10-08",
    computed_fob: o.computed ?? null,
    target_fob: o.target ?? null,
    profit_loss_pct: o.margin ?? null,
    currency_code: "USD",
  });
  eq("history: a costing never revised has none (a one-row table says nothing)", buildRevisionHistory([rev("a", 1, { target: 4.3 })], "a").length, 0);
  const h = buildRevisionHistory([rev("c", 3, { target: 3.9 }), rev("a", 1, { target: 4.3 }), rev("b", 2, { target: 4.1 })], "c");
  eq("history: every revision is listed", h.length, 3);
  eq("history: oldest first however the rows arrive (Rev 0 leads)", h[0].version, 1);
  eq("history: exactly one row is 'this report'", h.filter((r) => r.current).length, 1);
  eq("history: and it is the one asked for", h[2].current, true);
  eq("history: the first revision has no change", h[0].changePct, null);
  eq("history: 4.30 → 4.10 is −4.7 %", h[1].changePct, -4.7, 1);
  eq("history: 4.10 → 3.90 is −4.9 %", h[2].changePct, -4.9, 1);
  const fallback = buildRevisionHistory([rev("a", 1, { computed: 3.9453 }), rev("b", 2, { computed: 3.5 })], "b");
  eq("history: an unquoted revision carries its calculated price, to the cent", fallback[0].price, 3.95);
  const gap = buildRevisionHistory([rev("a", 1, { target: 4 }), rev("b", 2), rev("c", 3, { target: 3.6 })], "c");
  eq("history: an unpriced revision shows no price", gap[1].price, null);
  eq("history: …and the next change is measured from the last PRICED one (4.00 → 3.60)", gap[2].changePct, -10, 1);
  const withMargin = buildRevisionHistory([rev("a", 1, { target: 4.3, margin: 31.5 }), rev("b", 2, { target: 4.1, margin: 27.9 })], "b");
  eq("internal history carries each revision's margin", withMargin[0].marginPct, 31.5, 1);
  eq("quotation history: the margin is stripped, so the buyer's page cannot print it", historyForBuyer(withMargin).some((r) => "marginPct" in r), false);
  eq("quotation history: the price survives", historyForBuyer(withMargin)[1].price, 4.1);
}

if (failed) {
  console.error(`\n${failed} sample-costing vector(s) FAILED`);
  process.exit(1);
}
console.log("\nsample-costing: all vectors pass");
