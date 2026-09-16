/**
 * Vectors for `comboUpliftBreakdown` in `lib/orders/fabric-bom/yarn-process.ts`
 * — the ADDITIVE per-stage ladder built for the Yarn & Fabric Requirement
 * Report's stage-by-stage breakdown (Planned Wt entering KNITTING, then
 * DYEING, then COMPACTING…).
 *
 * THIS SCRIPT PROVES EXACTLY ONE THING: the ladder cannot disagree with
 * `comboUplift`, the function `check-yarn-process.mts` already owns and pins.
 * It does NOT re-assert the uplift-vs-backward-solve decision, the blend
 * share, or the colourway split — those are `check-yarn-process.mts`'s job,
 * and this file imports the same fixtures rather than inventing new ones so
 * a reader can see the two scripts are testing the same arithmetic from two
 * angles.
 *
 * ## WHAT "ADDITIVE" MEANS HERE, PRECISELY
 *
 * 1. For every input, `comboUpliftBreakdown(...).factor` equals
 *    `comboUplift(...)` — success mirrors success (same number), refusal
 *    mirrors refusal (same message).
 * 2. The ladder CHAINS: `steps[0].factorBefore === 1`, each step's
 *    `factorAfter` equals the next step's `factorBefore`, and the last
 *    step's `factorAfter === factor`.
 *
 * Both were DEMONSTRATED FAILING FIRST (2026-09-10) by commenting out the
 * `steps.push(...)` call in `comboUpliftBreakdown` while leaving the
 * `factor *= ...` line untouched — `factor` still came out right (proving a
 * bug here cannot hide behind a correct total) while every "the ladder
 * covers the same ground as `factor`" vector below failed on an empty
 * `steps` array. Reverted before this file was trusted.
 *
 * NUMBERS UPDATED 2026-09-11 for the backward-markup reversal (`/(1-L)`, not
 * `x(1+L)`) — see `comboUplift`'s own header in yarn-process.ts. This script
 * never asserted WHICH formula is correct (that is `check-yarn-process.mts`'s
 * job), so only the pinned figures below changed; the additivity/chaining
 * assertions themselves are formula-agnostic and are untouched.
 *
 * Runs under `tsx`, same reason as its sibling: `@/...` aliases and no
 * extension on the import specifier are both things Node's ESM resolver
 * cannot read on its own.
 */
import {
  clothPurchase,
  comboUplift,
  comboUpliftBreakdown,
  isRefusal,
  type StageUpliftStep,
} from "../lib/orders/fabric-bom/yarn-process.ts";
import { mixingDetailRows, type YdRepeatRow } from "../lib/orders/fabric-bom/yarn-dyed.ts";
import type { FabricComposition, FabricGross } from "../lib/orders/fabric-bom/yarn-process.ts";
/* §9 — WHERE THE CLOTH COMES FROM (0564). */
import {
  asFabricSource,
  sourceSuppressedReason,
  sourceSuppressedRow,
  suppressedBySource,
} from "../lib/orders/fabric-bom/fabric-source.ts";
/* §10 — WHICH ROUTE STEPS SURVIVE THE SAVE (2026-09-16). The one rule the save
   path and the screen both read; it lives in `processes.ts` because a
   `"use server"` file cannot export a sync predicate. */
import { processRowInScope } from "../lib/orders/fabric-bom/processes.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation produces. Borrowed from `check-yarn-process.mts`, which has
 *  had it since the formula reversal: §9 below needs it, because the shape it
 *  most has to refute (a suppressed step left standing at 0% loss) produces
 *  the RIGHT factor and the wrong ladder. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

type Stage = {
  combo: string | null;
  component_id?: string | null;
  loss_pct: number | null;
  stage_id?: string | null;
  process_id?: string | null;
  /** The process master's own kind flags (0564) — what §9's suppression
   *  reads. Optional, so every fixture above §9 is a route that suppresses
   *  nothing, which is exactly Rule 1. */
  is_knitting?: boolean | null;
  is_dyeing?: boolean | null;
};

/** The chaining invariant, checked generically — never one number at a time. */
function chains(steps: readonly StageUpliftStep[]): boolean {
  if (steps.length === 0) return true;
  if (steps[0].factorBefore !== 1) return false;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].factorBefore !== steps[i - 1].factorAfter) return false;
  }
  return true;
}

function agrees(stages: readonly Stage[], combo: string): { agree: boolean; note: string } {
  const uplift = comboUplift(stages, combo);
  const breakdown = comboUpliftBreakdown(stages, combo);

  if (isRefusal(uplift) !== isRefusal(breakdown)) {
    return { agree: false, note: "one refused and the other did not" };
  }
  if (isRefusal(uplift)) {
    const same = isRefusal(breakdown) && uplift.refused === breakdown.refused;
    return { agree: same, note: same ? "" : "refusal messages differ" };
  }
  if (isRefusal(breakdown)) return { agree: false, note: "unreachable" };

  const factorMatches = breakdown.factor === uplift;
  const lastStepMatches =
    breakdown.steps.length === 0
      ? breakdown.factor === 1
      : breakdown.steps[breakdown.steps.length - 1].factorAfter === breakdown.factor;

  return {
    agree: factorMatches && lastStepMatches && chains(breakdown.steps),
    note: !factorMatches
      ? "factor !== comboUplift"
      : !lastStepMatches
        ? "last step's factorAfter !== factor"
        : "chain broken",
  };
}

// ---------------------------------------------------------------------------
// 1. THREE STAGES, ONE UNSCOPED COLOURWAY — the doc's own compounding shape
//    (Knitting/Dyeing/Compacting all named PROCESS WISE, i.e. combo: null).
// ---------------------------------------------------------------------------

const THREE_STAGE: Stage[] = [
  { combo: null, loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, loss_pct: 2, stage_id: "DYED", process_id: "COMPACTING" },
];

{
  const r1 = agrees(THREE_STAGE, "WHITE");
  check("3-stage ladder agrees with comboUplift", r1.agree, true);

  const b = comboUpliftBreakdown(THREE_STAGE, "WHITE");
  if (!isRefusal(b)) {
    check("3-stage factor is 1/0.99 / 0.95 / 0.98", Number(b.factor.toFixed(6)), 1.084963);
    check("3-stage ladder has 3 steps", b.steps.length, 3);
    check("step 1 starts at 1", b.steps[0].factorBefore, 1);
    check("step 1 ends at 1/0.99", Number(b.steps[0].factorAfter.toFixed(6)), 1.010101);
    check("step 2 starts where step 1 ended", b.steps[1].factorBefore, b.steps[0].factorAfter);
    check("step 3 ends at the final factor", b.steps[2].factorAfter, b.factor);
    check("stage/process ids travel through unchanged", [b.steps[0].stage_id, b.steps[0].process_id], ["GREY", "KNITTING"]);
  } else {
    check("3-stage ladder must not refuse", "refused", "not refused");
  }
}

// ---------------------------------------------------------------------------
// 2. A STAGE SCOPED TO ONE COLOURWAY (`combo`) — the ladder must be EMPTY for
//    a colour that stage does not treat, not zero-length-but-wrong-factor.
// ---------------------------------------------------------------------------

const SCOPED_STAGE: Stage[] = [
  { combo: "PURPLE", loss_pct: 3, stage_id: "DYED", process_id: "DYEING" },
];

{
  const treated = comboUpliftBreakdown(SCOPED_STAGE, "PURPLE");
  const untreated = comboUpliftBreakdown(SCOPED_STAGE, "GREEN");
  if (!isRefusal(treated) && !isRefusal(untreated)) {
    check("scoped stage grosses the combo it names", Number(treated.factor.toFixed(6)), 1.030928);
    check("scoped stage leaves an untreated combo at 1", untreated.factor, 1);
    check("scoped stage leaves an untreated combo with no steps", untreated.steps.length, 0);
    check(
      "scoped stage agrees with comboUplift on the colour it treats",
      agrees(SCOPED_STAGE, "PURPLE").agree,
      true,
    );
    check(
      "scoped stage agrees with comboUplift on the colour it does not",
      agrees(SCOPED_STAGE, "GREEN").agree,
      true,
    );
  } else {
    check("scoped-stage vectors must not refuse", "refused", "not refused");
  }
}

// ---------------------------------------------------------------------------
// 3. AN OUT-OF-RANGE LOSS REFUSES IDENTICALLY ON BOTH FUNCTIONS.
// ---------------------------------------------------------------------------

const BAD_LOSS: Stage[] = [{ combo: null, loss_pct: 150 }];
{
  const u = comboUplift(BAD_LOSS, "WHITE");
  const b = comboUpliftBreakdown(BAD_LOSS, "WHITE");
  check("uplift refuses on an out-of-range loss", isRefusal(u), true);
  check("breakdown refuses on an out-of-range loss", isRefusal(b), true);
  check(
    "both refusals carry the same sentence",
    isRefusal(u) && isRefusal(b) ? u.refused === b.refused : false,
    true,
  );
}

// ---------------------------------------------------------------------------
// 4. NO STAGES AT ALL — the identity case (a solid order with nothing typed
//    on Fabric Process yet).
// ---------------------------------------------------------------------------

{
  const b = comboUpliftBreakdown([], "WHITE");
  if (!isRefusal(b)) {
    check("no stages -> factor 1", b.factor, 1);
    check("no stages -> no steps", b.steps.length, 0);
  } else {
    check("no-stages vector must not refuse", "refused", "not refused");
  }
}

// ---------------------------------------------------------------------------
// 5. A LARGER MIX, SPOT-CHECKED AGAINST `check-yarn-process.mts`'s OWN 1051.97
//    pin (3% then 2% on net 1000, i.e. 1000 / 0.97 / 0.98).
// ---------------------------------------------------------------------------

const PINNED: Stage[] = [
  { combo: null, loss_pct: 3, stage_id: "GREY", process_id: "P1" },
  { combo: null, loss_pct: 2, stage_id: "DYED", process_id: "P2" },
];
{
  const b = comboUpliftBreakdown(PINNED, "WHITE");
  if (!isRefusal(b)) {
    check("net 1000 / ladder = 1051.97 (the sibling script's own pin)", Number((1000 * b.factor).toFixed(2)), 1051.97);
  } else {
    check("pinned-mix vector must not refuse", "refused", "not refused");
  }
  check("pinned mix agrees with comboUplift", agrees(PINNED, "WHITE").agree, true);
}

// ---------------------------------------------------------------------------
// 6. THE LEGACY PDF'S OWN WORKED NUMBERS ("Yarn & fabric requirement.pdf",
//    2026-09-10) — KNITTING then DYEING, chained, exactly as printed.
// ---------------------------------------------------------------------------

/* ORDER MATCHES THE PHYSICAL WALK: Dyeing's own "To Ordered Wt" (1536.873) IS
   Knitting's own "Planned Wt" one section over in the PDF, so Dyeing's step
   comes first here — order does not change the FINAL total (division
   commutes, same as `comboUplift`'s own header says), but it is what lets
   `steps[0]` below mean "Dyeing alone" rather than "Knitting alone". */
const LEGACY_CHAIN: Stage[] = [
  { combo: null, loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
];
{
  const b = comboUpliftBreakdown(LEGACY_CHAIN, "RFD");
  if (!isRefusal(b)) {
    check(
      "legacy PDF: 1460.029 through Dyeing (5%) then Knitting (1%) = 1552.397",
      Number((1460.029 * b.factor).toFixed(3)),
      1552.397,
    );
    check(
      "legacy PDF: Dyeing's own step alone, 1460.029 -> 1536.873",
      Number((1460.029 * b.steps[0].factorAfter).toFixed(3)),
      1536.873,
    );
  } else {
    check("legacy-chain vector must not refuse", "refused", "not refused");
  }
}

// ---------------------------------------------------------------------------
// 8. THE COMPONENT AXIS (0528, wired 2026-09-15) — a route split "Component
//    Wise" is one sequence PER PANEL, and a weight belongs to an ENTRY that
//    names a set of panels. `stagesForGroup` is the resolution; these vectors
//    were run against the pre-fix engine first and FAILED there, because that
//    engine ignored `component_id` and STACKED every panel's steps.
// ---------------------------------------------------------------------------

/* Body runs four stages, Rib runs three. The client's own example. */
const SPLIT_ROUTE: Stage[] = [
  { combo: null, component_id: "BODY", loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, component_id: "BODY", loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, component_id: "BODY", loss_pct: 2, stage_id: "DYED", process_id: "STENTER" },
  { combo: null, component_id: "BODY", loss_pct: 2, stage_id: "DYED", process_id: "COMPACTING" },
  { combo: null, component_id: "RIB", loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, component_id: "RIB", loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, component_id: "RIB", loss_pct: 2, stage_id: "DYED", process_id: "COMPACTING" },
];
{
  const body = comboUpliftBreakdown(SPLIT_ROUTE, "WHITE", ["BODY"]);
  const rib = comboUpliftBreakdown(SPLIT_ROUTE, "WHITE", ["RIB"]);
  check(
    "component-wise: an entry naming BODY walks BODY's four steps only",
    isRefusal(body) ? "refused" : body.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "STENTER", "COMPACTING"],
  );
  check(
    "component-wise: an entry naming RIB walks RIB's three steps only",
    isRefusal(rib) ? "refused" : rib.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "COMPACTING"],
  );
  /* THE STACK, REFUTED BY NAME: seven stages compounded is 1/0.99/0.95/0.98/
     0.98/0.99/0.95/0.98 = 1.201169; BODY alone is 1/0.99/0.95/0.98/0.98 =
     1.107106. */
  check(
    "component-wise: BODY's factor is its own four stages, never all seven",
    isRefusal(body) ? "refused" : Number(body.factor.toFixed(6)),
    1.107106,
  );
  check("component-wise: comboUplift agrees for BODY", agrees(SPLIT_ROUTE, "WHITE").agree, true);
  const stacked = comboUplift(SPLIT_ROUTE, "WHITE", ["BODY"]);
  check(
    "component-wise: BODY via comboUplift is 1.107106, never the 1.201169 stack",
    isRefusal(stacked) ? "refused" : Number(stacked.toFixed(6)),
    1.107106,
  );

  /* An entry naming BOTH, with DIFFERENT routes: refuse, never pick or stack. */
  const both = comboUplift(SPLIT_ROUTE, "WHITE", ["BODY", "RIB"]);
  check(
    "component-wise: an entry spanning BODY and RIB (different routes) refuses",
    isRefusal(both) ? "refused" : both,
    "refused",
  );

  /* An entry naming a panel with NO route of its own gets the unscoped steps
     only — here there are none, so factor 1: "no route declared", the same
     reading a fabric with no route at all has always had. */
  const rope = comboUpliftBreakdown(SPLIT_ROUTE, "WHITE", ["WAIST ROPE"]);
  check(
    "component-wise: a panel with no route walks nothing (factor 1)",
    isRefusal(rope) ? "refused" : [rope.factor, rope.steps.length],
    [1, 0],
  );

  /* No component passed at all: the UNDER-count, never the stack. */
  const unknown = comboUpliftBreakdown(SPLIT_ROUTE, "WHITE");
  check(
    "component-wise: a caller naming no component gets unscoped steps only",
    isRefusal(unknown) ? "refused" : [unknown.factor, unknown.steps.length],
    [1, 0],
  );
}

/* Two panels declaring the IDENTICAL sequence: one distinct answer, so an
   entry spanning both is grossed by it ONCE. */
const SAME_ROUTE_TWICE: Stage[] = [
  { combo: null, component_id: "FRONT", loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, component_id: "FRONT", loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, component_id: "BACK", loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, component_id: "BACK", loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
];
{
  const b = comboUpliftBreakdown(SAME_ROUTE_TWICE, "WHITE", ["FRONT", "BACK"]);
  check(
    "component-wise: FRONT and BACK with identical routes gross ONCE, not twice",
    isRefusal(b) ? "refused" : [b.steps.length, Number(b.factor.toFixed(6))],
    [2, 1.063264],
  );
}

/* An UNSCOPED step beside scoped ones (mid-edit, before Save drops the
   mismatch) applies to every panel, in its declared position. */
const MIXED: Stage[] = [
  { combo: null, component_id: null, loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, component_id: "BODY", loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: null, component_id: "RIB", loss_pct: 3, stage_id: "DYED", process_id: "DYEING" },
];
{
  const body = comboUpliftBreakdown(MIXED, "WHITE", ["BODY"]);
  check(
    "component-wise: an unscoped step applies to BODY alongside BODY's own",
    isRefusal(body) ? "refused" : body.steps.map((s) => [s.process_id, s.loss_pct]),
    [["KNITTING", 1], ["DYEING", 5]],
  );
}

/* BOTH AXES AT ONCE — a (colour, component) grain: BLACK · BODY is its own
   sequence and WHITE · BODY another; the colour filter still runs first. */
const BOTH_AXES: Stage[] = [
  { combo: "BLACK", component_id: "BODY", loss_pct: 6, stage_id: "DYED", process_id: "DYEING" },
  { combo: "WHITE", component_id: "BODY", loss_pct: 3, stage_id: "DYED", process_id: "DYEING" },
  { combo: "BLACK", component_id: "RIB", loss_pct: 8, stage_id: "DYED", process_id: "DYEING" },
];
{
  const blackBody = comboUpliftBreakdown(BOTH_AXES, "BLACK", ["BODY"]);
  const whiteBody = comboUpliftBreakdown(BOTH_AXES, "WHITE", ["BODY"]);
  check(
    "both axes: BLACK · BODY sees its own 6% only",
    isRefusal(blackBody) ? "refused" : blackBody.steps.map((s) => s.loss_pct),
    [6],
  );
  check(
    "both axes: WHITE · BODY sees its own 3% only",
    isRefusal(whiteBody) ? "refused" : whiteBody.steps.map((s) => s.loss_pct),
    [3],
  );
}

// ---------------------------------------------------------------------------
// THE YARN DYEING BLOCK (2026-09-16) — the legacy printout's second Yarn
// Requirement section, and the arithmetic `yarnFabricRequirementReport` builds
// it from.
//
// Its two halves are both owned elsewhere and are deliberately NOT
// re-implemented in the report: `mixingDetailRows` (yarn-dyed.ts) says what
// share of the CLOTH each stripe is, and the backward-markup `/(1-L)` is
// `comboUplift`'s. These vectors pin the JOIN of the two against the legacy
// PDF's own worked numbers, which is the part the report owns.
//
// Legacy, "Yarndyed _Format.pdf", YARN DYEING:
//   20'S COMBED COTTON  GREEN  510.500  5.00  537.368
//                       RED    340.299  4.00  354.478
//                       WHITE  170.201  3.00  175.465
//                       Total 1021.000        1067.311
// and its KNITTING section grosses that same cloth to 1021.000. So the
// stripes' shares are 50 / 33.33… / 16.67… of one 1021.000 kg cloth.
// ---------------------------------------------------------------------------

const YD_COTTON = "yd-cotton";
/** A single-yarn yarn-dyed cloth — the case where every stripe's share of the
 *  CLOTH equals its share of the YARN, because the yarn IS the cloth. */
const YD_JERSEY: FabricComposition = {
  fabric_id: "yd-jersey",
  fabric_name: "YD SINGLE JERSEY",
  components: [{ yarn_id: YD_COTTON, blend_pct: null }],
};
/** THE STRIPES, in legacy's own 6 / 4 / 2 proportion — 50%, 33.33%, 16.67%. */
const YD_REPEATS: YdRepeatRow[] = [6, 4, 2].map((value, i) => ({
  key: `r${i + 1}`,
  sno: i + 1,
  yarn_item_id: YD_COTTON,
  dye_type: "dyed" as const,
  color_name: "",
  uom_id: null,
  value,
  twisted_yarn: "",
}));

const ydMixing = mixingDetailRows(YD_REPEATS, YD_JERSEY, () => "20'S COMBED COTTON");
const KNIT_GROSS = 1021;
/** The report's own split: the cloth's gross-at-knitting x each stripe's
 *  `mixing_pct`. */
const ydPlanned = ydMixing.map((m) => Number(((KNIT_GROSS * (m.mixing_pct ?? 0)) / 100).toFixed(3)));

check("YARN DYEING: 1021.000 kg splits 6/4/2 into the legacy's own three weights", ydPlanned, [
  510.5, 340.333, 170.167,
]);
check(
  "…and the three shares sum back to the whole cloth, never to 99.99% of it",
  Number(ydPlanned.reduce((a, b) => a + b, 0).toFixed(3)),
  KNIT_GROSS,
);
/* LEGACY'S OWN 340.299 / 170.201 ARE NOT REPRODUCIBLE FROM 33.33 / 16.67, AND
   THAT IS THE POINT: it printed a ROUNDED percentage and computed from that
   rounded figure (1021 x 33.33% = 340.299 exactly). This engine computes from
   the EXACT share and displays the rounded one, so the weights are 340.333 /
   170.167 — and they sum to 1021.000 without legacy's trick of absorbing the
   rounding drift into the last row. Pinned so a future "fix" toward legacy's
   printed figures has to argue with this comment first. */
check(
  "…the displayed shares are the rounded ones: 50 / 33.33 / 16.67",
  ydMixing.map((m) => Number((m.mixing_pct ?? 0).toFixed(2))),
  [50, 33.33, 16.67],
);

/* THE PER-COLOUR MARKUP — `plannedWt / (1 - loss/100)`, the same backward
   solve the fabric route uses, applied to a stripe's weight. Legacy's GREEN
   row: 510.500 at 5.00% -> 537.368. */
const markup = (wt: number, lossPct: number) => Number((wt / (1 - lossPct / 100)).toFixed(3));
check("YARN DYEING: legacy's GREEN row, 510.500 at 5.00% loss = 537.368", markup(510.5, 5), 537.368);
check("YARN DYEING: legacy's RED row, 340.299 at 4.00% loss = 354.478", markup(340.299, 4), 354.478);
check("YARN DYEING: legacy's WHITE row, 170.201 at 3.00% loss = 175.465", markup(170.201, 3), 175.465);
check(
  "…and a yarn with NO treatment typed marks up by nothing, never by a default",
  markup(510.5, 0),
  510.5,
);

// ---------------------------------------------------------------------------
// THE `Nos/Mtrs` COUNT (2026-09-16) — legacy's sub-column beside each Wt.
//
// It is grossed by THE SAME LADDER FACTOR as the weight beside it, which is
// the whole reason it cannot drift from it: more pieces are knitted to survive
// the same losses. A count with its own factor is two answers about one cloth.
// ---------------------------------------------------------------------------

{
  const route = [
    { combo: null, loss_pct: 5 },
    { combo: null, loss_pct: 1 },
  ];
  const ladder = comboUpliftBreakdown(route, "", []);
  if (isRefusal(ladder)) {
    failed++;
    console.error("FAIL  Nos/Mtrs: the ladder refused a plain two-stage route");
  } else {
    const NET_WT = 100;
    const NET_NOS = 1070;
    const last = ladder.steps[ladder.steps.length - 1];
    check(
      "Nos/Mtrs is grossed by the same factor as the Wt beside it",
      Number(((NET_NOS * last.factorAfter) / (NET_WT * last.factorAfter)).toFixed(6)),
      Number((NET_NOS / NET_WT).toFixed(6)),
    );
    check(
      "…so a 1070-piece cutting requirement through 5% then 1% orders 1137.7 pieces",
      Number((NET_NOS * last.factorAfter).toFixed(1)),
      1137.7,
    );
  }
}

// ---------------------------------------------------------------------------
// 9. WHERE THE CLOTH COMES FROM (0564, 2026-09-16) — Default Rule 1 vs Rule 2,
//    `doc/order/fabriprocess.md` §2.
//
//    A fabric bought as ready-knitted GREIGE rolls does not pay for the
//    knitting somebody else did, and one bought as finished DYED rolls does
//    not pay for the dyeing either. The suppression is the one place this
//    reaches the arithmetic (`stagesForGroup`), so every ladder, every report
//    and the stored purchase weight follow from these vectors.
//
//    ## THE ASSERTION THAT ACTUALLY MATTERS IS THE STEP LIST, NOT THE FACTOR
//
//    The natural wrong implementation is to leave a suppressed step standing
//    with 0% loss. The backward markup is `/(1 - L/100)`, so a zero-loss step
//    multiplies by exactly 1 — the FACTOR comes out identical to the correct
//    answer and every arithmetic assertion below would pass. What would not
//    pass is `steps.map(process_id)`: a suppressed KNITTING would still be
//    there, the report would print a KNITTING row for cloth nobody knitted,
//    and the stage ledger would disagree with the purchase. So each vector
//    pins BOTH, and the list is the one that catches the shape.
//
//    DEMONSTRATED FAILING FIRST (2026-09-16) — see the report for the counts.
// ---------------------------------------------------------------------------

/* THE CLIENT'S OWN FOUR-STAGE ROUTE, the same one §8 uses for BODY, now
   carrying the process master's kind flags (0564). KNITTING is flagged
   `is_knitting`, DYEING `is_dyeing`; STENTER and COMPACTING are neither, and
   that is what makes them survive every source. */
const SOURCED_ROUTE: Stage[] = [
  { combo: null, loss_pct: 1, stage_id: "GREY", process_id: "KNITTING", is_knitting: true },
  { combo: null, loss_pct: 5, stage_id: "DYED", process_id: "DYEING", is_dyeing: true },
  { combo: null, loss_pct: 2, stage_id: "DYED", process_id: "STENTER" },
  { combo: null, loss_pct: 2, stage_id: "DYED", process_id: "COMPACTING" },
];

/* ---- THE SCREEN'S HALF READS THE SAME ANSWER AS THE ENGINE'S ------------ */

{
  /* The client's ruling (2026-09-16): a step a source has switched off is
     dropped from the arithmetic, KEPT on screen, drawn inert, with a line
     saying why. What these vectors pin is the half that could silently rot —
     that the row the screen greys and the step the ladder drops are decided by
     one predicate. A second copy on the screen side is how this module's last
     two silent-arithmetic bugs happened. */
  const OPTIONS = [
    { id: "KNITTING", is_knitting: true, is_dyeing: false },
    { id: "DYEING", is_knitting: false, is_dyeing: true },
    { id: "COMPACTING", is_knitting: false, is_dyeing: false },
  ];
  const rowsOf = (source: "yarn_knit" | "greige_purchase" | "dyed_purchase") =>
    OPTIONS.map((o) => o.id).filter((id) => sourceSuppressedRow({ process_id: id }, OPTIONS, source));

  check("inert rows: Rule 1 greys nothing", rowsOf("yarn_knit"), []);
  check("inert rows: greige purchase greys KNITTING alone", rowsOf("greige_purchase"), ["KNITTING"]);
  check("inert rows: dyed purchase greys KNITTING and DYEING", rowsOf("dyed_purchase"), [
    "KNITTING",
    "DYEING",
  ]);
  check(
    "inert rows: THE SCREEN AND THE LADDER AGREE — exactly the steps greyed are " +
      "exactly the steps the ladder dropped",
    (() => {
      const walked = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "dyed_purchase");
      if (isRefusal(walked)) return "refused";
      const kept = new Set(walked.steps.map((s) => s.process_id));
      const greyed = new Set(rowsOf("dyed_purchase"));
      /* STENTER is in SOURCED_ROUTE but not in OPTIONS above, so it is neither
         greyed nor claimed here; the assertion is over the three the screen
         knows about. */
      return ["KNITTING", "DYEING", "COMPACTING"].map((id) => [id, kept.has(id), greyed.has(id)]);
    })(),
    [
      ["KNITTING", false, true],
      ["DYEING", false, true],
      ["COMPACTING", true, false],
    ],
  );
  check(
    "inert rows: a half-typed row naming no process yet is never greyed — it is " +
      "work in progress, not a step the source switched off",
    sourceSuppressedRow({ process_id: null }, OPTIONS, "dyed_purchase"),
    false,
  );
  check(
    "inert rows: a process the master no longer lists is not greyed either — " +
      "the engine cannot tell what kind it is, so the screen must not claim to",
    sourceSuppressedRow({ process_id: "GONE" }, OPTIONS, "dyed_purchase"),
    false,
  );
  check(
    "inert rows: the reason names the SOURCE and says the row comes back",
    sourceSuppressedReason({ process_id: "KNITTING" }, OPTIONS, "greige_purchase"),
    "Not counted — this fabric is set to Greige Fabric Purchase, so this step " +
      "is already done when the cloth arrives. The row is kept; change the " +
      "Source back and it counts again.",
  );
  check(
    "inert rows: …and a step that IS counted has no reason at all, never an " +
      "empty string a renderer would draw a blank line for",
    sourceSuppressedReason({ process_id: "COMPACTING" }, OPTIONS, "greige_purchase"),
    null,
  );
}

/* ---- the rule itself ---------------------------------------------------- */

check(
  "source rule: Rule 1 suppresses nothing at all",
  suppressedBySource("yarn_knit"),
  { yarnPurchase: false, knitting: false, dyeing: false },
);
check(
  "source rule: greige purchase suppresses Yarn Purchase AND Knitting, never Dyeing",
  suppressedBySource("greige_purchase"),
  { yarnPurchase: true, knitting: true, dyeing: false },
);
check(
  "source rule: dyed purchase suppresses all three",
  suppressedBySource("dyed_purchase"),
  { yarnPurchase: true, knitting: true, dyeing: true },
);
check(
  "source rule: an unknown string reads as Rule 1, never as 'suppress everything'",
  asFabricSource("something-else"),
  "yarn_knit",
);
check("source rule: a null source reads as Rule 1", asFabricSource(null), "yarn_knit");
check(
  "source rule: a real value survives the guard",
  asFabricSource("greige_purchase"),
  "greige_purchase",
);

/* ---- Rule 1 is BYTE-FOR-BYTE what it was -------------------------------- */

{
  const explicit = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "yarn_knit");
  const implicit = comboUpliftBreakdown(SOURCED_ROUTE, "", []);
  check(
    "Rule 1: naming the default source changes nothing a caller could observe",
    JSON.stringify(explicit),
    JSON.stringify(implicit),
  );
  check(
    "Rule 1: the four-stage route still walks all four, in order",
    isRefusal(explicit) ? "refused" : explicit.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "STENTER", "COMPACTING"],
  );
  check(
    "Rule 1: …and still factors 1.107106, §8's own pinned figure",
    isRefusal(explicit) ? "refused" : Number(explicit.factor.toFixed(6)),
    1.107106,
  );
}

/* ---- Rule 2: greige purchase -------------------------------------------- */

{
  const greige = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "greige_purchase");
  check(
    "greige purchase: KNITTING LEAVES THE LADDER — the step list, which a " +
      "zero-loss stand-in would fail and the factor alone would not",
    isRefusal(greige) ? "refused" : greige.steps.map((s) => s.process_id),
    ["DYEING", "STENTER", "COMPACTING"],
  );
  check(
    "greige purchase: 1/0.95/0.98/0.98 = 1.096035",
    isRefusal(greige) ? "refused" : Number(greige.factor.toFixed(6)),
    1.096035,
  );
  refute(
    "greige purchase: …and never Rule 1's 1.107106, which is what a suppressed " +
      "step left standing at 0% loss would still produce",
    isRefusal(greige) ? "refused" : Number(greige.factor.toFixed(6)),
    1.107106,
  );
  check(
    "greige purchase: the ladder still CHAINS after a step is removed — " +
      "factorBefore of the first is 1, not the removed step's output",
    isRefusal(greige) ? "refused" : greige.steps[0]?.factorBefore,
    1,
  );
  check(
    "greige purchase: comboUplift and comboUpliftBreakdown agree under a source",
    (() => {
      const u = comboUplift(SOURCED_ROUTE, "", [], "greige_purchase");
      return isRefusal(u) || isRefusal(greige) ? "refused" : u === greige.factor;
    })(),
    true,
  );
}

/* ---- dyed purchase ------------------------------------------------------ */

{
  const dyed = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "dyed_purchase");
  check(
    "dyed purchase: KNITTING and DYEING both leave; the finishing steps stay",
    isRefusal(dyed) ? "refused" : dyed.steps.map((s) => s.process_id),
    ["STENTER", "COMPACTING"],
  );
  check(
    "dyed purchase: 1/0.98/0.98 = 1.041233",
    isRefusal(dyed) ? "refused" : Number(dyed.factor.toFixed(6)),
    1.041233,
  );
  refute(
    "dyed purchase: …and never the greige answer, which keeps the 5% dyeing",
    isRefusal(dyed) ? "refused" : Number(dyed.factor.toFixed(6)),
    1.096035,
  );
}

/* ---- AN UNFLAGGED PROCESS SUPPRESSES NOTHING, AND ERRS UPWARD ------------ */

{
  /* The same route with the master's flags never ticked — 0564's seed not run,
     or a Knitting process added since. The step stays, so the greige demand is
     grossed by a knitting loss it should not carry. That is an OVER-buy, and
     it is pinned here so the direction of the failure is a decision on record
     rather than an accident. */
  const UNFLAGGED: Stage[] = SOURCED_ROUTE.map((s) => ({
    ...s,
    is_knitting: false,
    is_dyeing: false,
  }));
  const greige = comboUpliftBreakdown(UNFLAGGED, "", [], "greige_purchase");
  check(
    "an unflagged process master suppresses nothing — the whole route still walks",
    isRefusal(greige) ? "refused" : greige.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "STENTER", "COMPACTING"],
  );
  check(
    "…so the greige demand comes out HIGH (1.107106 over 1.096035), never short",
    isRefusal(greige) ? "refused" : greige.factor > 1.096035,
    true,
  );
}

/* ---- THE SUPPRESSION RUNS AFTER THE COMPONENT RESOLUTION ---------------- */

{
  /* Two panels that declare DIFFERENT routes still disagree whatever the cloth
     is bought as — the refusal is about what was DECLARED, and a source only
     decides which declared steps cost something. Suppressing first would make
     Body-with-knitting and Rib-without look identical and gross the entry by a
     sequence neither panel declares. */
  const BODY_KNITS_RIB_DOES_NOT: Stage[] = [
    { combo: null, component_id: "BODY", loss_pct: 1, process_id: "KNITTING", is_knitting: true },
    { combo: null, component_id: "BODY", loss_pct: 5, process_id: "DYEING", is_dyeing: true },
    { combo: null, component_id: "RIB", loss_pct: 5, process_id: "DYEING", is_dyeing: true },
  ];
  check(
    "an entry spanning two panels with different routes STILL refuses under " +
      "greige purchase — the source does not reconcile them",
    (() => {
      const r = comboUplift(BODY_KNITS_RIB_DOES_NOT, "", ["BODY", "RIB"], "greige_purchase");
      return isRefusal(r) ? "refused" : r;
    })(),
    "refused",
  );
  check(
    "…while BODY alone resolves, then loses its KNITTING to the source",
    (() => {
      const r = comboUpliftBreakdown(BODY_KNITS_RIB_DOES_NOT, "", ["BODY"], "greige_purchase");
      return isRefusal(r) ? "refused" : r.steps.map((s) => s.process_id);
    })(),
    ["DYEING"],
  );
}

/* ---- A MIXED ORDER: TWO FABRICS, TWO SOURCES ---------------------------- */

{
  /* The user's own example — greige rolls for the collar rib while the body is
     knitted in-house. The point is that ONE document holds both answers and
     neither leaks into the other. */
  const BODY_LADDER = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "yarn_knit");
  const RIB_LADDER = comboUpliftBreakdown(SOURCED_ROUTE, "", [], "greige_purchase");
  check(
    "mixed order: the knitted body walks four steps, the purchased rib three",
    [
      isRefusal(BODY_LADDER) ? "refused" : BODY_LADDER.steps.length,
      isRefusal(RIB_LADDER) ? "refused" : RIB_LADDER.steps.length,
    ],
    [4, 3],
  );
  check(
    "mixed order: and their factors differ by exactly the knitting step",
    isRefusal(BODY_LADDER) || isRefusal(RIB_LADDER)
      ? "refused"
      : Number((BODY_LADDER.factor / RIB_LADDER.factor).toFixed(6)),
    Number((1 / 0.99).toFixed(6)),
  );
}

/* ---- THE DEMAND LINE: ROLL WEIGHT IN THE REQUIREMENT'S OWN UNIT --------- */

{
  const RIB = "rib";
  const KG = "kg-uom";
  const slices: FabricGross[] = [
    { fabric_id: RIB, combo: "WHITE", gross: 100, uom_id: KG, refusal: null },
    { fabric_id: RIB, combo: "BLACK", gross: 50, uom_id: KG, refusal: null },
  ];
  const routes = new Map([[RIB, SOURCED_ROUTE]]);

  const greige = clothPurchase(RIB, "greige_purchase", slices, routes, 3, "COLLAR RIB");
  check(
    "demand line: a greige-purchase cloth asks for ROLL WEIGHT, per colourway",
    isRefusal(greige) ? "refused" : greige.byCombo.map((c) => [c.combo, c.gross]),
    [
      ["BLACK", 54.802],
      ["WHITE", 109.604],
    ],
  );
  check(
    "demand line: …totalling 164.406, i.e. 150 net grossed by 1.096035 and " +
      "rounded UP per lot exactly as a yarn purchase is",
    isRefusal(greige) ? "refused" : greige.qty,
    164.406,
  );
  refute(
    "demand line: …and never 150, which is the net with no route applied",
    isRefusal(greige) ? "refused" : greige.qty,
    150,
  );
  /* 166.067, NOT 166.066 — the figure a neutralised suppression actually
     produces, checked by running this file against one rather than by
     hand-computing it. A refutation pinned one digit off refutes nothing and
     passes silently, which is the same class of blindness as a check that
     never inspected the file. */
  refute(
    "demand line: …nor 166.067, the Rule 1 gross that charges the knitting " +
      "the market already did",
    isRefusal(greige) ? "refused" : greige.qty,
    166.067,
  );
  check(
    "demand line: the unit is the requirement's own — kilograms (0562), read " +
      "off the slice rather than named",
    isRefusal(greige) ? "refused" : greige.uom_id,
    KG,
  );
  check(
    "demand line: it is headed by the source, so greige and dyed rolls are " +
      "never totalled as one purchase",
    isRefusal(greige) ? "refused" : greige.label,
    "Greige Fabric Roll Weight",
  );
  /* 156.186 AND NOT 156.185, WHICH IS WHAT `150 x 1.041233` COMES TO. The
     difference is the per-lot ceiling: WHITE's 104.12328 rounds UP to 104.124
     and BLACK's 52.06164 to 52.062, and 104.124 + 52.062 = 156.186. Rounding
     each colour lot rather than the total is `yarnPurchase`'s own rule and
     its own reason — "a purchase per colour is a real lot, and rounding a
     total DOWN buys less than the order needs" — and it is pinned here so a
     future tidy-up to one round at the end has to argue with this comment. */
  check(
    "demand line: a dyed-roll purchase is headed differently and costs less " +
      "route (1/0.98/0.98, ceiled per lot, = 156.186)",
    (() => {
      const d = clothPurchase(RIB, "dyed_purchase", slices, routes, 3, "COLLAR RIB");
      return isRefusal(d) ? "refused" : [d.label, d.qty];
    })(),
    ["Dyed Fabric Roll Weight", 156.186],
  );
  check(
    "demand line: a Rule 1 cloth REFUSES a roll weight rather than answering 0 — " +
      "a 0.000 under a document that knits its own cloth reads as 'buy nothing'",
    (() => {
      const r = clothPurchase(RIB, "yarn_knit", slices, routes, 3, "COLLAR RIB");
      return isRefusal(r) ? r.refused : "answered";
    })(),
    "This fabric is knitted in-house, so no cloth is purchased for it",
  );
  check(
    "demand line: a refused requirement slice propagates and is never summed past",
    (() => {
      const r = clothPurchase(
        RIB,
        "greige_purchase",
        [slices[0], { fabric_id: RIB, combo: "BLACK", gross: null, uom_id: KG, refusal: "Enter the consumption for BLACK · S" }],
        routes,
        3,
        "COLLAR RIB",
      );
      return isRefusal(r) ? r.refused : "answered";
    })(),
    "COLLAR RIB: Enter the consumption for BLACK · S",
  );
  check(
    "demand line: a fabric with no requirement on this BOM refuses rather than " +
      "returning a zero line",
    (() => {
      const r = clothPurchase("other", "greige_purchase", slices, routes, 3, "OTHER");
      return isRefusal(r) ? r.refused : "answered";
    })(),
    "This fabric has no requirement on this BOM",
  );

  /* THE TWO IMPLEMENTATIONS PINNED TOGETHER. `yarnFabricRequirementReport`
     builds its FABRIC PURCHASE lines as `net * ladder.factor` inline — one
     gross feeding three readers in that function — and `clothPurchase` is the
     engine's own version of the same figure. They are asserted equal here
     rather than trusted to a comment, because they are the two numbers a
     buyer and a report would each act on.

     THEY AGREE ON THE PRODUCT AND DIFFER ON THE ROUNDING, ON PURPOSE, and
     that is asserted too rather than smoothed over. The report prints the
     ladder's own arithmetic (`toFixed(6)`) because it is showing a
     derivation; `clothPurchase` ceils each colour lot to the unit's precision
     because it is stating a purchase. 109.60345… prints as 109.603 and buys
     as 109.604, and that ordering — the purchase never below the derivation —
     is the half worth pinning. */
  const whiteLadder = comboUpliftBreakdown(SOURCED_ROUTE, "WHITE", [], "greige_purchase");
  check(
    "demand line: clothPurchase and the report's ladder agree on the raw " +
      "product, before either rounds it",
    isRefusal(whiteLadder) ? "refused" : Number((100 * whiteLadder.factor).toFixed(5)),
    109.60345,
  );
  check(
    "demand line: …and the purchase is the CEILED lot, never below the " +
      "derivation the report prints",
    isRefusal(whiteLadder) || isRefusal(greige)
      ? "refused"
      : (greige.byCombo.find((c) => c.combo === "WHITE")?.gross ?? 0) >= 100 * whiteLadder.factor,
    true,
  );
}

/* ==========================================================================
 * §10 — A SHARED SEQUENCE PLUS ONE COLOUR'S EXTRA STEP (2026-09-16)
 *
 * The client's own description of "Assort Color Wise": 99% of orders run every
 * colour through the same sequence, and a dark shade occasionally needs one
 * extra step (a Bio-wash) that the light ones do not.
 *
 * ## WHY THIS SECTION EXISTS AT ALL
 *
 * The ENGINE has always been able to express it — `stageCoversCombo` reads a
 * blank `combo` as "every colourway" and has since 0504. The SAVE PATH could
 * not: `normalizeProcesses` tested `scope.assort_color_wise !== !!p.combo`,
 * which deleted every uncoloured step the moment the toggle was on. So the
 * shared sequence had to be re-typed per colourway — four colours x three
 * steps + 1 = thirteen rows for what is four — and the one shape the feature
 * exists for was the one shape it refused.
 *
 * The rule is now `processRowInScope` (`lib/orders/fabric-bom/processes.ts`),
 * read by BOTH the save path and the screen. It could not live in `actions.ts`:
 * a `"use server"` file exports nothing but async Server Functions, so a
 * predicate two readers share cannot be tested — or even declared — there.
 *
 * ## MADE TO FAIL FIRST (2026-09-16)
 *
 * Every vector below was run against the PRE-FIX rule — `processRowInScope`'s
 * colour test temporarily restored to the two-way
 * `scope.assort_color_wise !== !!row.combo` — before the fix was trusted.
 * **9 of the 13 failed.** The four that passed are named UNCHANGED HALF in
 * their own labels: the component axis, and the colour-bearing row that is
 * still dropped when the toggle is off. A fix must be shown not to have moved
 * those, so they are kept here deliberately rather than counted as coverage.
 *
 * THE FIRST CUT OF THIS SECTION ONLY MANAGED 1 OF 10, and the reason is worth
 * recording because it is the trap the whole section is about. It handed
 * `SHARED_PLUS_EXTRA` straight to `comboUpliftBreakdown` — testing the ENGINE,
 * which reads a blank combo as "every colourway" and has done since 0504, and
 * which therefore passed against the bug exactly as every one of this file's
 * nine older sections did. The defect was never in the arithmetic; it was in
 * which rows reached it. Filtering the fixture through `processRowInScope`
 * first — modelling the save, as `normalizeProcesses` does — is what turned
 * five passing vectors into five discriminating ones.
 *
 * A vector suite that cannot fail against the defect it covers is the failure
 * mode this module has been bitten by twice (see §8's own header), and
 * "0 findings looks identical whether a check inspected the file or not".
 *
 * ## THE ORDERING RULING IS ASSERTED, NOT ASSUMED
 *
 * `sno` is now the step's position in the FABRIC'S WHOLE ROUTE rather than
 * within its group, so a colour's extra step keeps the place the operator put
 * it. The alternative — append each colour's extras after the shared steps —
 * would put the Bio-wash after COMPACTING, and it is refuted by name below.
 * ========================================================================== */

/* ---- the rule: which steps survive the save ----------------------------- */

const COLOUR_WISE = { assort_color_wise: true, component_wise: false };
const UNIFIED = { assort_color_wise: false, component_wise: false };
const COMPONENT_WISE = { assort_color_wise: false, component_wise: true };

check(
  "shared steps: a step with NO colour survives a colour-wise route — this is " +
    "the 99% case, and it is what the old two-way guard deleted",
  processRowInScope({ combo: null, component_id: null }, COLOUR_WISE),
  true,
);
check(
  "shared steps: a colour's OWN extra step survives the same route",
  processRowInScope({ combo: "RED", component_id: null }, COLOUR_WISE),
  true,
);
check(
  "shared steps (UNCHANGED HALF): a step naming a colour is still dropped when " +
    "the toggle is OFF — a unified route has nowhere to put the branch",
  processRowInScope({ combo: "RED", component_id: null }, UNIFIED),
  false,
);
/* BLANK vs ABSENT vs WHITESPACE. Three things reach this rule meaning "no
   colour" — `null` from the screen, `undefined` from Zod's `.optional()`, and
   `""` from `capsTextNullable`'s trim — and a fourth, `"  "`, is what tells a
   `!!combo` test apart from `comboKey`'s. All four must survive a colour-wise
   route, because all four are what `stageCoversCombo` reads as "every
   colourway". A row kept under one meaning and computed under the other is the
   divergence `processRowInScope` exists to end. */
check(
  "shared steps: `undefined` combo (Zod's optional) means all colours, exactly " +
    "as `null` does",
  processRowInScope({ component_id: null }, COLOUR_WISE),
  true,
);
check(
  "shared steps: an EMPTY STRING combo means all colours too",
  processRowInScope({ combo: "", component_id: null }, COLOUR_WISE),
  true,
);
check(
  "shared steps: and a WHITESPACE combo does — the case that separates " +
    "`comboKey` from a bare `!!combo`, which would keep it as a colour",
  processRowInScope({ combo: "   ", component_id: null }, COLOUR_WISE),
  true,
);
check(
  "shared steps (UNCHANGED HALF): the component axis keeps its two-way test — " +
    "an uncomponented step is dropped from a component-wise route",
  processRowInScope({ combo: null, component_id: null }, COMPONENT_WISE),
  false,
);
check(
  "shared steps (UNCHANGED HALF): and a componented step is dropped from a " +
    "route that is not component-wise",
  processRowInScope({ combo: null, component_id: "BODY" }, UNIFIED),
  false,
);

/* ---- the arithmetic: two colours, two different and correct factors ------ */

/* ONE FABRIC'S ROUTE AS THE OPERATOR NOW TYPES IT: three shared steps, and
   RED's Bio-wash sitting between the dyeing and the compacting — MID-ROUTE,
   which is the position the ordering ruling has to preserve. */
const SHARED_PLUS_EXTRA: Stage[] = [
  { combo: null, loss_pct: 1, stage_id: "GREY", process_id: "KNITTING" },
  { combo: null, loss_pct: 5, stage_id: "DYED", process_id: "DYEING" },
  { combo: "RED", loss_pct: 3, stage_id: "WASHED", process_id: "BIOWASH" },
  { combo: null, loss_pct: 2, stage_id: "DYED", process_id: "COMPACTING" },
];

{
  /* THE ROUTE AS IT COMES BACK OUT OF A SAVE, not as it was typed — and that
     is the whole reason this block discriminates.
     `normalizeProcesses` writes only the steps `processRowInScope` keeps, so a
     report reads the SURVIVORS. Handing the typed array straight to
     `comboUpliftBreakdown` would test the engine, which was never wrong and
     passes against the bug; filtering first is what makes these vectors fail
     when the save rule is wrong. This mirrors `normalizeProcesses`'s own loop
     — one `.filter` standing in for its `continue`. */
  const saved = SHARED_PLUS_EXTRA.filter((s) =>
    processRowInScope({ combo: s.combo, component_id: s.component_id ?? null }, COLOUR_WISE),
  );
  const white = comboUpliftBreakdown(saved, "WHITE", []);
  const red = comboUpliftBreakdown(saved, "RED", []);

  /* THE LABELS, NOT THE COUNT. A vector asserting "RED walks 4 steps and WHITE
     walks 3" passes against a filter that picked the WRONG four. */
  check(
    "shared steps: WHITE walks the three shared steps and NOT the RED extra",
    isRefusal(white) ? "refused" : white.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "COMPACTING"],
  );
  check(
    "shared steps: RED walks the same three PLUS its own Bio-wash",
    isRefusal(red) ? "refused" : red.steps.map((s) => s.process_id),
    ["KNITTING", "DYEING", "BIOWASH", "COMPACTING"],
  );
  /* THE ORDERING RULING. Appending each colour's extras after the shared steps
     would give ["KNITTING","DYEING","COMPACTING","BIOWASH"] — the same four
     names and the same final factor, since multiplication commutes, but a
     per-stage ladder that reports the wrong Planned Wt entering each step, and
     a route that tells the dyehouse to bio-wash after compacting. */
  check(
    "shared steps: the extra keeps its MID-ROUTE place — never appended last, " +
      "which multiplies the same but plans a different route",
    isRefusal(red) ? "refused" : red.steps[2]?.process_id,
    "BIOWASH",
  );

  /* 1/(0.99 x 0.95 x 0.98) — the three shared losses, solved backwards. */
  check(
    "shared steps: WHITE's factor is the three shared losses and nothing else",
    isRefusal(white) ? "refused" : Number((100 * white.factor).toFixed(3)),
    108.496,
  );
  /* The same, over one more loss: 1/(0.99 x 0.95 x 0.97 x 0.98). */
  check(
    "shared steps: RED's factor is DIFFERENT and carries the extra 3%",
    isRefusal(red) ? "refused" : Number((100 * red.factor).toFixed(3)),
    111.852,
  );
}

if (failed > 0) {
  console.error(`\n${failed} FAILED`);
  process.exit(1);
} else {
  console.log("\nAll fabric-bom-reports vectors passed.");
}
