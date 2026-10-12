/**
 * check:iwo-material-bom-fill — Sample ▸ Accessories Plan fills from costing
 * (user 2026-10-12): Planned Qty = Σ trim qty per garment × the sample's
 * pieces, one line per (SMP, material); a trim with no material, or a sample
 * with no pieces, is SAID, never silently dropped.
 *
 *   npx --yes tsx scripts/check-iwo-material-bom-fill.mts
 */
import { sampleFillLines } from "../lib/orders/iwo-material-bom/sample-fill.ts";

let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`ok    ${label}`);
  else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${w}\n      actual   ${g}`);
  }
}

const out = sampleFillLines([
  {
    style_id: "s1",
    label: "SMP/26-27/0001 · POLO",
    pieces: 3,
    trims: [
      { item_id: "btn", description: "BUTTON BODY", qty: 3 },
      { item_id: "btn", description: "BUTTON CUFF", qty: 2 },
      { item_id: "lbl", description: "MAIN LABEL", qty: 1 },
      { item_id: null, description: "HANG TAG", qty: 1 },
      { item_id: "thr", description: "THREAD", qty: 0 },
    ],
  },
  { style_id: "s2", label: "SMP/26-27/0002 · TEE", pieces: 5, trims: [{ item_id: "lbl", description: "MAIN LABEL", qty: 1 }] },
  { style_id: "s3", label: "SMP/26-27/0003 · CAP", pieces: 0, trims: [{ item_id: "lbl", description: "MAIN LABEL", qty: 1 }] },
]);
check(
  "per (SMP, material): two button rows sum per garment, × pieces; the same label on two SMPs is two lines",
  out.lines,
  [
    { style_id: "s1", item_id: "btn", planned_qty: 15 },
    { style_id: "s1", item_id: "lbl", planned_qty: 3 },
    { style_id: "s2", item_id: "lbl", planned_qty: 5 },
  ],
);
check("a trim with no material and a sample with no pieces are said, a zero trim is skipped quietly", out.skipped, [
  "SMP/26-27/0001 · POLO: HANG TAG (no material on the costing)",
  "SMP/26-27/0003 · CAP: no sample pieces in the SWO, so no quantity to plan",
]);
check("fractional per-garment qty keeps 4 places", sampleFillLines([{ style_id: "s", label: "S", pieces: 3, trims: [{ item_id: "t", description: null, qty: 0.3333 }] }]).lines[0].planned_qty, 0.9999);

if (failed) {
  console.error(`\n${failed} accessories-fill vector(s) failed.`);
  process.exit(1);
}
console.log("\nAccessories Plan fill: costing trims × sample pieces, per SMP.");
