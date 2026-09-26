/**
 * Vectors for LOOSE FABRIC CONVERSION (0633) — `lib/orders/fabric-bom/loose-conversion.ts`.
 *
 *   npm run check:loose-conversion
 *
 * The figures are worked by hand from the spec's four equations, NOT read back
 * from the engine, so a change to the arithmetic fails here by name:
 *
 *   converted yarn  = collar cloth / (1 - collar knitting 2%)       = 102.041
 *   greige yarn     = converted / (1-2% unravel)(1-5% dye)(1-1% knit)
 *   body yarn       = 1000 / (1-5% dye)(1-1% knit)
 *   ONE purchase    = body + loose, rounded up once                  = 1173.975
 */

import {
  conversionLinksOf,
  conversionStepProblems,
  planConversions,
  withoutConversionSteps,
  yarnPurchaseWithConversion,
} from "../lib/orders/fabric-bom/loose-conversion";
import { isRefusal, yarnPurchase, type FabricComposition, type FabricGross, type RouteStage } from "../lib/orders/fabric-bom/yarn-process";
import { processesForFabric, type FabricProcessOption } from "../lib/orders/fabric-bom/processes";

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
const qtyOf = (r: unknown) => (r && typeof r === "object" && "qty" in r ? (r as { qty: number }).qty : r);

// ---------------------------------------------------------------------------
// Fixture — one 30S count used by the body AND knitted into the loose fabric
// AND (after unravelling) into the yarn-dyed collar. The spec's own premise.
// ---------------------------------------------------------------------------
const Y = "yarn-30s";
const BODY = "fab-body-sj";
const COLLAR = "fab-collar-yd";
const LOOSE = "fab-loose";
const KG = "uom-kg";

const comp = (id: string, name: string, yarn: string, yd = false): FabricComposition => ({
  fabric_id: id,
  fabric_name: name,
  components: [{ yarn_id: yarn, blend_pct: null }],
  yarn_dyed: yd,
});
const compositions = new Map<string, FabricComposition>([
  [BODY, comp(BODY, "SINGLE JERSEY", Y)],
  [COLLAR, comp(COLLAR, "FLAT KNIT COLLAR", Y, true)],
  [LOOSE, comp(LOOSE, "LOOSE FABRIC 30S", Y)],
]);
const step = (process_id: string, loss: number, kind: Partial<RouteStage> = {}): RouteStage => ({
  combo: null,
  loss_pct: loss,
  process_id,
  ...kind,
});
const routes = new Map<string, RouteStage[]>([
  [BODY, [step("KNIT", 1, { is_knitting: true }), step("DYE", 5, { is_dyeing: true })]],
  [COLLAR, [step("FLATKNIT", 2, { is_knitting: true })]],
  [LOOSE, [step("KNIT", 1, { is_knitting: true }), step("DYE", 5, { is_dyeing: true }), step("CONV", 2)]],
]);
const fabrics: FabricGross[] = [
  { fabric_id: BODY, combo: "NAVY", gross: 1000, uom_id: KG },
  { fabric_id: COLLAR, combo: "NAVY", gross: 100, uom_id: KG },
];
const isUnravelling = (id: string) => id === "CONV";
const base = { fabrics, compositions, routesByFabric: routes, ownStages: [], decimals: 3 };

// ---------------------------------------------------------------------------
// 1. The spec's arithmetic, on the same-count case.
// ---------------------------------------------------------------------------
const links = new Map([[Y, LOOSE]]);
const plan = planConversions({ links, fabrics, compositions, routesByFabric: routes, decimals: 3 });
const conv = plan.converted.get(Y);
check("1a converted yarn = collar / (1-2%) = 102.041", conv && !isRefusal(conv) ? conv.qty : conv, 102.041);
check("1b it feeds the yarn-dyed collar only", conv && !isRefusal(conv) ? conv.fabricIds : conv, [COLLAR]);
check(
  "1c loose demand is the converted weight, per colourway",
  plan.looseDemand.map((d) => [d.fabric_id, d.combo, d.gross]),
  [[LOOSE, "NAVY", 102.041]],
);
check(
  "1d loose fabric to knit = converted / (1-2%)(1-5%) = 109.604",
  conv && !isRefusal(conv) ? near(conv.looseKnitQty ?? 0, 102.041 / (0.98 * 0.95)) : conv,
  true,
);
const one = yarnPurchaseWithConversion(Y, plan, base);
check("1e ONE greige purchase: body + loose, rounded up once = 1173.975", qtyOf(one), 1173.975);
const bodyOnly = 1000 / (0.99 * 0.95);
const looseYarn = 102.041 / (0.99 * 0.95 * 0.98);
check("1f and that is exactly body + loose by the spec's formulas", near(1173.975, Math.ceil((bodyOnly + looseYarn) * 1000) / 1000), true);

// Without the conversion the collar's yarn is simply bought: a different figure.
const plain = yarnPurchase(Y, fabrics, compositions, routes, [], 3);
check("1g no conversion → body + collar = 1165.305", qtyOf(plain), Math.ceil((bodyOnly + 100 / 0.98) * 1000) / 1000);

// ---------------------------------------------------------------------------
// 2. The unravelling loss is applied ONCE — the yarn's own CONVERSION step is
//    removed from the yarn arithmetic, whatever loss it carries.
// ---------------------------------------------------------------------------
const own = [
  { process_id: "YPURCH", combo: null, loss_pct: 0 },
  { process_id: "CONV", combo: null, loss_pct: 50 },
];
check("2a withoutConversionSteps drops only the CONVERSION step", withoutConversionSteps(own, isUnravelling).map((s) => s.process_id), ["YPURCH"]);
const twice = yarnPurchaseWithConversion(Y, plan, {
  ...base,
  ownStages: withoutConversionSteps(own, isUnravelling).map((s) => ({ combo: s.combo, loss_pct: s.loss_pct })),
});
check("2b a 50% loss typed on the yarn's CONVERSION step changes nothing", qtyOf(twice), 1173.975);

// ---------------------------------------------------------------------------
// 3. A separate collar count: the converted yarn buys NOTHING (0, not refused),
//    and the loose fabric's greige count carries the loose demand.
// ---------------------------------------------------------------------------
const X = "yarn-collar";
const comps3 = new Map(compositions);
comps3.set(COLLAR, comp(COLLAR, "FLAT KNIT COLLAR", X, true));
const plan3 = planConversions({ links: new Map([[X, LOOSE]]), fabrics, compositions: comps3, routesByFabric: routes, decimals: 3 });
const x3 = yarnPurchaseWithConversion(X, plan3, { ...base, compositions: comps3 });
check("3a the converted count buys 0 — a real answer", isRefusal(x3) ? x3 : [x3.qty, x3.byCombo.length], [0, 0]);
const y3 = yarnPurchaseWithConversion(Y, plan3, { ...base, compositions: comps3 });
check("3b the greige count = body + loose", qtyOf(y3), 1173.975);

// ---------------------------------------------------------------------------
// 4. Refusals — each in its own words.
// ---------------------------------------------------------------------------
const refusalOf = (l: Map<string, string | null>, c = compositions, f = fabrics) => {
  const r = planConversions({ links: l, fabrics: f, compositions: c, routesByFabric: routes, decimals: 3 }).converted.get(Y);
  return r && isRefusal(r) ? r.refused.split(" ").slice(0, 4).join(" ") : "not refused";
};
check("4a no source picked", refusalOf(new Map([[Y, null]])), "Pick the Source Loose");
const ydLoose = new Map(compositions);
ydLoose.set(LOOSE, comp(LOOSE, "LOOSE FABRIC 30S", Y, true));
check("4b a yarn-dyed loose fabric is refused", refusalOf(links, ydLoose), "LOOSE FABRIC 30S is");
check(
  "4c a loose fabric also cut on Manual is refused",
  refusalOf(links, compositions, [...fabrics, { fabric_id: LOOSE, combo: "NAVY", gross: 5, uom_id: KG }]),
  "LOOSE FABRIC 30S is",
);
const noYd = new Map(compositions);
noYd.set(COLLAR, comp(COLLAR, "FLAT KNIT COLLAR", Y, false));
check("4d nothing yarn-dyed to convert for", refusalOf(links, noYd), "No yarn-dyed fabric on");
const noMix = new Map(compositions);
noMix.delete(LOOSE);
check("4e a loose fabric with no mixing", refusalOf(links, noMix), "The source loose fabric");
const refusedPurchase = yarnPurchaseWithConversion(Y, planConversions({ links: new Map([[Y, null]]), fabrics, compositions, routesByFabric: routes, decimals: 3 }), base);
check("4f a refused conversion refuses the yarn's purchase too", isRefusal(refusedPurchase), true);

// ---------------------------------------------------------------------------
// 5. Links read the master flag, first conversion step wins.
// ---------------------------------------------------------------------------
check(
  "5a conversionLinksOf",
  [...conversionLinksOf(
    [
      { item_id: "A", stages: [{ process_id: "DYE" }, { process_id: "CONV", source_loose_fabric_id: LOOSE }] },
      { item_id: "B", stages: [{ process_id: "YPURCH", source_loose_fabric_id: LOOSE }] },
    ],
    isUnravelling,
  )],
  [["A", LOOSE]],
);

// ---------------------------------------------------------------------------
// 6. The Save rules (screen and server read the same function).
// ---------------------------------------------------------------------------
const rules = (
  stages: { process_id: string; source_loose_fabric_id?: string | null }[],
  routeSteps: { item_id: string; process_id: string }[],
) =>
  conversionStepProblems({
    yarns: [{ name: "30S", stages }],
    links: conversionLinksOf([{ item_id: Y, stages }], isUnravelling),
    routeSteps,
    isUnravelling,
    fabricName: (id) => (id === LOOSE ? "LOOSE" : "BODY"),
  }).map((m) => m.split(" ").slice(0, 3).join(" "));
const looseRoute = [{ item_id: LOOSE, process_id: "KNIT" }, { item_id: LOOSE, process_id: "CONV" }];
check("6a a complete link passes", rules([{ process_id: "CONV", source_loose_fabric_id: LOOSE }], looseRoute), []);
check("6b a CONVERSION step must name its source", rules([{ process_id: "CONV" }], []), ["30S: pick the"]);
check(
  "6c one CONVERSION step per yarn",
  rules([{ process_id: "CONV", source_loose_fabric_id: LOOSE }, { process_id: "CONV", source_loose_fabric_id: LOOSE }], looseRoute),
  ["30S: a yarn"],
);
check(
  "6d a linked loose fabric may not lose its CONVERSION step (the spec's delete guard)",
  rules([{ process_id: "CONV", source_loose_fabric_id: LOOSE }], [{ item_id: LOOSE, process_id: "KNIT" }]),
  ["LOOSE is the"],
);
check(
  "6e CONVERSION on an ordinary cloth's route is refused",
  rules([{ process_id: "CONV", source_loose_fabric_id: LOOSE }], [...looseRoute, { item_id: BODY, process_id: "CONV" }]),
  ["BODY: CONVERSION (unravelling)"],
);

// ---------------------------------------------------------------------------
// 7. The Fabric Process ▾ offers CONVERSION on a loose fabric's route only.
// ---------------------------------------------------------------------------
const opt = (id: string, extra: Partial<FabricProcessOption> = {}): FabricProcessOption => ({
  id,
  code: null,
  name: id,
  inactive: false,
  for_fabric: true,
  is_print: false,
  is_dyeing: false,
  is_knitting: false,
  stage_roles: [],
  ...extra,
});
const opts = [opt("DYE", { is_dyeing: true }), opt("CONV", { is_unravelling: true })];
check("7a withheld by default", processesForFabric(opts).map((p) => p.id), ["DYE"]);
check("7b offered on a loose fabric's route", processesForFabric(opts, { looseFabricRoute: true }).map((p) => p.id), ["DYE", "CONV"]);
check("7c a held CONVERSION survives on a wrong route (twin + Save rule name it)", processesForFabric(opts, { currentValue: "CONV" }).map((p) => p.id), ["DYE", "CONV"]);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
