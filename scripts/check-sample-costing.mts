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
  type CostingInput,
  type FabricInput,
  type PieceInput,
} from "../lib/sales/sample-costing/calc.ts";
import { linesToWeights, weightsToLines } from "../lib/sales/sample-costing/matrix.ts";

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
  print_cost: "",
  embroidery_cost: "",
  wash_cost: "",
  testing_cost: "",
  bank_cost: "",
  ...o,
});
const w = (piece_key: string, fabric_key: string, weight_g: string, size_group_id: string | null = null) => ({
  piece_key,
  fabric_key,
  size_group_id,
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
    pieces: [piece({ key: "top", cmt: "30", print_cost: "38", testing_cost: "8" })],
    fabrics: [flat],
    weights: [w("top", "flat", "94"), w("top", "flat", "23")],
    trims: [{ piece_key: "top", qty: "1", rate: "20" }],
    terms: { margin_pct: "", garment_waste_pct: "", overhead_pct: "", discount_pct: "", freight_per_pc: "", insurance_per_pc: "", exchange_rate: "" },
    quotes: {},
  }).groups[0].pieces[0].net,
  213,
);
const base: CostingInput = {
  pieces: [piece({ key: "top", cmt: "30", print_cost: "38", testing_cost: "8" })],
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

// SIZE GROUPS — a row with no group (the rib) adds to every group
const sized = costingSummary({
  ...base,
  weights: [w("top", "flat", "162", "g1"), w("top", "flat", "258", "g2"), w("top", "flat", "40")],
});
eq("size groups: two costed", sized.groups.length, 2);
eq("size groups: g1 fabric = 162 + 40", sized.groups[0].pieces[0].fabric, 202);
eq("size groups: g2 fabric = 258 + 40", sized.groups[1].pieces[0].fabric, 298);

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

// UX plan P2.1 — the matrix. Body 162 / 258 / 270 and a 40 g rib typed once.
const mLines = [
  { key: "body", piece_key: "p", component_id: "c1", fabric_key: "f", wastage_pct: "3", cells: { g1: "162", g2: "258", g3: "270" } },
  { key: "rib", piece_key: "p", component_id: "c2", fabric_key: "f", wastage_pct: "3", cells: { g1: "40", g2: "", g3: "" } },
];
const mRows = linesToWeights(mLines, ["g1", "g2", "g3"]);
eq("P2.1 six rows written", mRows.length, 6);
eq("P2.1 rib inherits 40 g in g3", Number(mRows.find((r) => r.key === "rib|g3")?.weight_g), 40);
let mSeq = 0;
const back = weightsToLines(mRows, () => `k${mSeq++}`, () => null);
eq("P2.1 round-trip: two lines", back.lines.length, 2);
eq("P2.1 round-trip: inherited cell reads blank again", back.lines[1].cells.g2 === "", true);
eq("P2.1 no size groups → one All-sizes row per line", linesToWeights([{ ...mLines[0], cells: { all: "150" } }], []).length, 1);

if (failed) {
  console.error(`\n${failed} sample-costing vector(s) FAILED`);
  process.exit(1);
}
console.log("\nsample-costing: all vectors pass");
