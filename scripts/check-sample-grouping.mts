/**
 * check:sample-grouping — the batching arithmetic against the SPEC'S OWN RULES
 * (doc/sample/product-grouping-specification.md §5) and the live samples.
 *
 * `lib/sales/sample-grouping/calc.ts` is read by the Grouping screen, by the
 * server actions that store a group's net and MOQ weight, and by the
 * distribution. A wrong figure buys the wrong number of bags, so the rules are
 * pinned here — including the edges the spec's two cases leave open.
 *
 *   npx --yes tsx scripts/check-sample-grouping.mts
 */
import {
  batchingSaving,
  blendOf,
  distributeProblem,
  excessToStock,
  groupNetKg,
  groupingProblem,
  moqOrderWeight,
  proposeGroups,
  purchaseBasis,
  releasedCuttingKg,
  styleFabricKg,
  type StoredWeight,
} from "../lib/sales/sample-grouping/calc.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${label}: ${g}`);
  else {
    failures++;
    console.error(`FAIL ${label}: got ${g}, want ${w}`);
  }
}

// §5.2 — MOQ rounding. The spec's two cases, then its edges.
eq("§5.2 net 14.5 ≤ 60 buys the MOQ", moqOrderWeight(14.5), 60);
eq("§5.2 exactly the MOQ is still the MOQ", moqOrderWeight(60), 60);
eq("§5.2 61 kg rounds up to 3 batches of 30", moqOrderWeight(61), 90);
eq("§5.2 a whole number of batches does not round up", moqOrderWeight(90), 90);
eq("§5.2 a gram over a batch buys the next batch", moqOrderWeight(90.001), 120);
eq("§3 GRP-SS26-002: 8.2 kg against a 25 kg MOQ", moqOrderWeight(8.2, 25, 30), 25);
eq("nothing to buy buys nothing (not a whole bag)", moqOrderWeight(0), 0);
// The spec's MOQ is a whole number of batches, so `<=` vs `<` cannot be told apart
// at 60 / 30. A 50 kg MOQ on 30 kg batches can: exactly 50 buys 50, not 60.
eq("exactly a MOQ that is not a batch multiple buys the MOQ", moqOrderWeight(50, 50, 30), 50);
eq("just over it rounds to batches", moqOrderWeight(50.5, 50, 30), 60);
// 4.2 ÷ 1.4 is 3.0000000000000004 in floating point — it must not buy a 4th batch.
eq("floating-point quotient stays a whole batch count", moqOrderWeight(4.2, 1, 1.4), 4.2);
eq("a zero batch is never divided by", moqOrderWeight(61.5, 60, 0), 62);
eq("basis at the minimum", purchaseBasis(14.5, 60, 30), "MOQ");
eq("basis above it", purchaseBasis(61, 60, 30), "3 × 30 kg");

// §5.1 — net = Σ style weights.
eq("§5.1 net group weight", groupNetKg([15.45, 1.375, null]), 16.825);

// §5.3 — release and the balance that stays in sample stock.
eq("§5.3 released = weight × (1 + waste %)", releasedCuttingKg(2, 5), 2.1);
eq("§5.3 no waste releases the weight", releasedCuttingKg(1.375, 0), 1.375);
eq("§5.3 excess to sample stock", excessToStock(60, [15.45, 1.375], 0), 43.175);
eq("§5.3 a release the purchase covers", distributeProblem(60, [15.45], 10), null);
eq(
  "§5.3 a release bigger than the purchase is refused",
  distributeProblem(25, [20, 8], 0),
  "The styles need 3.0 kg more than the 25.0 kg bought — lower the cutting waste, or buy another batch.",
);

// The card: what batching saved against each style buying alone.
eq(
  "two styles alone buy two bags; batched, one",
  batchingSaving([{ itemKg: [14.5, 8], moqKg: 60, batchKg: 30 }]),
  { aloneKg: 120, batchedKg: 60, savedKg: 60, savedPct: 50 },
);
eq("no groups, no percentage", batchingSaving([]).savedPct, null);

// A style's kilos of one costing fabric — the live samples (2026-10-09).
const w = (fabric: string, size: string | null, g: number, loss = 0, dims?: [number, number, number]): StoredWeight => ({
  fabric_line_id: fabric,
  size_name: size,
  weight_g: g,
  length_cm: dims?.[0] ?? null,
  width_cm: dims?.[1] ?? null,
  gsm: dims?.[2] ?? null,
  wastage_pct: loss,
});
eq(
  "PRD/26-27/0001: S/M/L 20 each, costed in M only (250 g, 3 % loss)",
  styleFabricKg([w("f", "M", 250, 3)], "f", { bySize: { S: 20, M: 20, L: 20 }, total: 60 }),
  15.45,
);
eq(
  "PRD/26-27/0002: 5 pieces in M at 250 g, 10 % loss",
  styleFabricKg([w("f", "M", 250, 10)], "f", { bySize: { M: 5 }, total: 5 }),
  1.375,
);
eq(
  "a size with its own column uses it; one without takes the first column",
  styleFabricKg([w("f", "M", 200), w("f", "L", 220)], "f", { bySize: { S: 5, M: 5, L: 5 }, total: 15 }),
  3.1,
);
eq(
  "no size split: the whole Sample Qty weighs at the first column",
  styleFabricKg([w("f", "M", 200), w("f", "L", 220)], "f", { bySize: {}, total: 4 }),
  0.8,
);
eq(
  "a row saved with no size counts in every size",
  styleFabricKg([w("f", null, 100), w("f", "M", 50)], "f", { bySize: { M: 2, L: 2 }, total: 4 }),
  0.6,
);
eq(
  "only THIS fabric's rows count",
  styleFabricKg([w("f", "M", 200), w("rib", "M", 40)], "rib", { bySize: { M: 10 }, total: 10 }),
  0.4,
);
eq(
  "L × W × GSM wins over typed grams, as on the costing",
  styleFabricKg([w("f", "M", 999, 0, [50, 40, 180])], "f", { bySize: { M: 10 }, total: 10 }),
  0.36,
);
eq("a fabric with no weight on the costing has no kilos", styleFabricKg([w("other", "M", 200)], "f", { bySize: { M: 5 }, total: 5 }), null);

// The blend two styles must share.
eq(
  "yarn mix: largest share first",
  blendOf(
    [
      { name: "40 DINER ELASTANE", mix_pct: 5 },
      { name: "24'S BCI COTTON", mix_pct: 95 },
    ],
    "SOLID 1X1 LYCRA RIB",
    "1X1 LYCRA RIB",
  ),
  { label: "95% 24'S BCI COTTON / 5% 40 DINER ELASTANE", key: "95% 24'S BCI COTTON / 5% 40 DINER ELASTANE" },
);
eq(
  "direct rate, no mix: the typed quality stands in",
  blendOf([], "solid single  jersey (24's bci cotton)", "SINGLE JERSEY").key,
  "SOLID SINGLE JERSEY (24'S BCI COTTON)",
);
eq("nothing typed: the structure", blendOf([], "", "FLEECE").label, "FLEECE");

// Which candidates may share a group.
const c = (over: Partial<Parameters<typeof groupingProblem>[0][number]> = {}) => ({
  label: "PRD/26-27/0001",
  season: "Q1",
  season_year: 2026,
  fabric_structure_id: "sj",
  blend_key: "100% COTTON",
  kg: 2,
  group_code: null,
  ...over,
});
eq("two alike batch", groupingProblem([c(), c({ label: "PRD/26-27/0002", season: "q1 " })]), null);
eq("nothing ticked", groupingProblem([]), "Tick the styles to batch first.");
eq("already grouped", groupingProblem([c({ group_code: "GRP/Q1-26/001" })]), "PRD/26-27/0001 is already in GRP/Q1-26/001.");
eq("no kilos", groupingProblem([c({ kg: null })]), "PRD/26-27/0001 has no garment weight on its costing, so it has no kilos to batch.");
eq("no year", groupingProblem([c({ season_year: null })]), "PRD/26-27/0001 has no Season and Year — set them on Sample Entry first.");
eq("two seasons", groupingProblem([c(), c({ season: "Q2" })]), "A group is one season — every style picked must share the Season and Year.");
eq("two structures", groupingProblem([c(), c({ fabric_structure_id: "rib" })]), "A group is one fabric structure — every style picked must use the same one.");
eq("two blends", groupingProblem([c(), c({ blend_key: "95% COTTON / 5% ELASTANE" })]), "A group is one yarn blend — every style picked must be knitted from the same yarn.");

// Auto-group: what the screen proposes.
{
  const cand = (key: string, over: Partial<ReturnType<typeof c>> = {}) => ({ ...c(), key, ...over });
  const { proposals, alone } = proposeGroups(
    [
      cand("a", { kg: 2 }),
      cand("b", { kg: 5, season: "q 1" }),
      cand("rib", { fabric_structure_id: "rib", kg: 1 }),
      cand("odd", { blend_key: "OTHER", kg: 3 }),
      cand("done", { group_code: "GRP/Q1-26/009" }),
      cand("noKg", { kg: null }),
      cand("noYear", { season_year: null }),
    ],
    [{ id: "g1", group_code: "GRP/Q1-26/001", season: "Q1", season_year: 2026, fabric_structure_id: "rib", blend_key: "100% COTTON", netKg: 4 }],
  );
  eq(
    "auto-group: two alike batch (season spacing ignored); a lone rib joins its waiting Draft",
    proposals.map((p) => [p.candidates.map((x) => x.key), p.netKg, p.into?.code ?? null]),
    [
      [["a", "b"], 7, null],
      [["rib"], 1, "GRP/Q1-26/001"],
    ],
  );
  eq("auto-group: a lone style with nothing to join is listed, not proposed", alone.map((x) => x.key), ["odd"]);
}

if (failures) {
  console.error(`\nsample-grouping: ${failures} vector(s) FAILED`);
  process.exit(1);
}
console.log("\nsample-grouping: all vectors pass");
