/**
 * Vectors for `lib/orders/fabric-plan/route.ts` — the process route that turns
 * yarn into the fabric a Fabric BOM requires.
 *
 * THIS MODULE'S OUTPUT IS THE YARN PURCHASE. It is the largest single quantity in
 * a knitted order, and its failure mode is not a wrong pixel: a route that
 * arrives 5% under leaves the mill short at the last stage, after the yarn has
 * been dyed and cannot be topped up from stock.
 *
 * ## THE ONE THAT MATTERS: `/ (1 - L)` IS NOT `x (1 + L)`
 *
 * Loss is stated forward and the requirement is known at the END of the chain, so
 * every stage is solved backwards. The plausible alternative — grossing up by the
 * loss percentage — agrees at 0% and diverges immediately after, always in the
 * same direction, and each individual line still looks right. Section 2 is built
 * so the two disagree and says which answer is forbidden.
 *
 * ## THE SECOND ONE: 100% LOSS IS A DIVISION BY ZERO
 *
 * `x / 0` is `Infinity` in JS, not a throw, so an unguarded 100 escapes into the
 * UI as an ordinary-looking figure and onto a purchase order. Section 4 pins the
 * refusal, and refutes `Infinity` explicitly rather than only asserting the
 * message — a guard that returns the right sentence for the wrong reason would
 * pass a message-only test.
 *
 * Runs under `tsx` for `check-bom-requirement.mts`'s reason: the module imports
 * `@/lib/...` aliases at runtime and Node's ESM resolver reads neither the alias
 * nor the missing extension.
 */
import {
  STAGE_MODES,
  isRefusal,
  routeInput,
  routeLoss,
  routeQuantities,
  stageModeOf,
  stageProblem,
  type StageInput,
} from "../lib/orders/fabric-plan/route.ts";

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
 *  implementation produces. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refusalOf(v: unknown): string | null {
  return isRefusal(v) ? v.refused : null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const V = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const stage = (sno: number, loss: number, over: Partial<StageInput> = {}): StageInput => ({
  sno,
  process_id: P,
  mode: "in_house",
  vendor_id: null,
  loss_pct: loss,
  ...over,
});

/** Yarn purchase · knitting · dyeing · compacting — the client's own sequence. */
const ROUTE = [stage(1, 0), stage(2, 4), stage(3, 6), stage(4, 2)];

function qtys(stages: StageInput[], required: number, dp: number | null = 2) {
  const r = routeQuantities(stages, required, dp);
  if (isRefusal(r)) return r;
  return r.map((x) => ({ sno: x.sno, input: x.input, output: x.output }));
}

// ---------------------------------------------------------------------------
// 1. The chain ties together
// ---------------------------------------------------------------------------

check(
  "the LAST stage outputs exactly the requirement",
  (() => {
    const r = routeQuantities(ROUTE, 1000, 2);
    return isRefusal(r) ? null : r[r.length - 1].output;
  })(),
  1000,
);

check(
  "each stage's output is the next stage's input",
  (() => {
    const r = routeQuantities(ROUTE, 1000, 2);
    if (isRefusal(r)) return null;
    return r.slice(0, -1).every((s, i) => s.output === r[i + 1].input);
  })(),
  true,
);

check(
  "a lossless single stage passes the quantity straight through",
  qtys([stage(1, 0)], 500),
  [{ sno: 1, input: 500, output: 500 }],
);

// ---------------------------------------------------------------------------
// 2. THE VECTOR THIS FILE EXISTS FOR — solve backwards, never gross up
//
// One stage, 10% loss, 100 kg of output. Correct: 100 / 0.90 = 111.11…, rounded
// UP to 111.12. The plausible wrong answer is 100 x 1.10 = 110 — which then
// loses 11 and delivers 99, one percent short, looking entirely reasonable.
// ---------------------------------------------------------------------------

check("10% loss on 100 kg of output needs 111.12 kg in", qtys([stage(1, 10)], 100), [
  { sno: 1, input: 111.12, output: 100 },
]);
refute(
  "…never 110, which is grossing up by the loss instead of solving for it",
  (() => {
    const r = routeQuantities([stage(1, 10)], 100, 2);
    return isRefusal(r) ? null : r[0].input;
  })(),
  110,
);

// And the input really does deliver the output: 111.12 x 0.90 = 100.008 ≥ 100.
check(
  "the input actually yields the requirement",
  (() => {
    const r = routeQuantities([stage(1, 10)], 100, 2);
    return isRefusal(r) ? null : r[0].input * 0.9 >= 100;
  })(),
  true,
);
refute(
  "…which the grossed-up figure would not: 110 x 0.90 = 99",
  110 * 0.9 >= 100,
  true,
);

// The gap compounds along a route, which is why it is worth a whole section.
// 1000 -> compacting 2%: 1020.41 -> dyeing 6%: 1085.55 -> knitting 4%: 1130.79.
// The naive gross-up gives 1120, so the route is 10.79 kg short of a 1130.79 kg
// purchase — about 1%, on the largest line in the order, and 1120 looks fine.
check(
  "four stages at 0/4/6/2% need 1130.79 kg of yarn for 1000 kg of fabric",
  (() => {
    const r = routeQuantities(ROUTE, 1000, 2);
    return isRefusal(r) ? null : routeInput(r);
  })(),
  1130.79,
);
refute(
  "…never 1120, which is 1000 x (1 + 0.12)",
  (() => {
    const r = routeQuantities(ROUTE, 1000, 2);
    return isRefusal(r) ? null : routeInput(r);
  })(),
  1120,
);

// ---------------------------------------------------------------------------
// 3. Rounding is UP, AT EACH STAGE
//
// Each stage's input is a real quantity that gets issued or bought, so it is
// rounded where it is acted on. The compounding is bounded and in the safe
// direction; a shortfall at knitting is a roll that does not finish.
// ---------------------------------------------------------------------------

check(
  "a stage input rounds up at the UOM's precision",
  qtys([stage(1, 3)], 100),
  [{ sno: 1, input: 103.1, output: 100 }],
);
refute(
  "…not down to 103.09, which 100/0.97 = 103.092… truncates to",
  (() => {
    const r = routeQuantities([stage(1, 3)], 100, 2);
    return isRefusal(r) ? null : r[0].input;
  })(),
  103.09,
);

// The precision floor is 2 and is shared with every other quantity in the app —
// `uomPrecision` clamps to [2,6] because every live UOM stores 0 in the OTHER
// precision column, and honouring it would reinstate a round-up the client
// rejected. A route asking for 0 gets 2, exactly as the BOM engines do.
check(
  "a UOM claiming 0 decimals still gets 2",
  qtys([stage(1, 3)], 100, 0),
  [{ sno: 1, input: 103.1, output: 100 }],
);

check("the loss column adds up to input minus requirement", (() => {
  const r = routeQuantities(ROUTE, 1000, 2);
  if (isRefusal(r)) return null;
  const input = routeInput(r);
  return isRefusal(input) ? null : Math.abs(routeLoss(r) - (input - 1000)) < 0.005;
})(), true);

// ---------------------------------------------------------------------------
// 4. 100% LOSS IS A DIVISION BY ZERO, NOT A BIG NUMBER
// ---------------------------------------------------------------------------

check(
  "100% loss refuses, and names the stage",
  refusalOf(routeQuantities([stage(1, 0), stage(2, 100)], 100, 2)),
  "Stage 2: Loss must be less than 100% — nothing would come out",
);
refute(
  "…rather than returning Infinity, which reads as an ordinary number",
  (() => {
    const r = routeQuantities([stage(1, 100)], 100, 2);
    return isRefusal(r) ? "refused" : r[0].input;
  })(),
  Infinity,
);
check(
  "above 100% refuses too — the guard is not an equality test",
  refusalOf(routeQuantities([stage(1, 140)], 100, 2)),
  "Stage 1: Loss must be less than 100% — nothing would come out",
);
check(
  "a negative loss refuses",
  refusalOf(routeQuantities([stage(1, -5)], 100, 2)),
  "Stage 1: Loss cannot be negative",
);

// ---------------------------------------------------------------------------
// 5. What a stage must say before it can be computed
// ---------------------------------------------------------------------------

check("a stage with no process refuses", stageProblem(stage(1, 0, { process_id: null })), "Choose the process for this stage");
check(
  "a blank loss refuses — it is not read as 0",
  stageProblem(stage(1, 0, { loss_pct: null })),
  "Enter this stage's loss %, or 0 if there is none",
);
refute(
  "…and a blank loss is not silently treated as lossless",
  (() => {
    const r = routeQuantities([stage(1, 0, { loss_pct: null })], 100, 2);
    return isRefusal(r) ? "refused" : r[0].input;
  })(),
  100,
);

// REQUIREDNESS FOR A STATE, not for a column: a processor is mandatory on an
// out-processed stage and meaningless in-house.
check(
  "an out-processed stage needs a processor",
  stageProblem(stage(1, 0, { mode: "outsourced", vendor_id: null })),
  "Name the processor for an out-processed stage",
);
check(
  "…and with one it is fine",
  stageProblem(stage(1, 0, { mode: "outsourced", vendor_id: V })),
  null,
);
check(
  "an in-house stage needs no processor",
  stageProblem(stage(1, 0, { mode: "in_house", vendor_id: null })),
  null,
);
check(
  "a stage with no mode refuses",
  stageProblem(stage(1, 0, { mode: null })),
  "Say whether this stage is in-house or out-processed",
);

// The two words are `order_garment_processes`' own (0019). Spelling them a second
// way is what AGENTS.md records under Nominated vendors as compiling, running and
// quietly matching nothing.
check("the two modes, and only those two", [...STAGE_MODES], ["in_house", "outsourced"]);
check("case is not the operator's problem", stageModeOf("In_House"), "in_house");
check(
  "'out_process' is NOT a mode — the garment side spells it 'outsourced'",
  refusalOf(stageModeOf("out_process")),
  "Say whether this stage is in-house or out-processed",
);

// ---------------------------------------------------------------------------
// 6. Nothing to plan against
// ---------------------------------------------------------------------------

check(
  "an empty route refuses",
  refusalOf(routeQuantities([], 100, 2)),
  "This fabric has no process route yet",
);
check(
  "a requirement of 0 refuses — it is not 'nothing needed'",
  refusalOf(routeQuantities(ROUTE, 0, 2)),
  "No requirement to plan against — record the Fabric BOM first",
);
refute(
  "…and never answers 0, which on a yarn purchase reads as 'buy nothing'",
  (() => {
    const r = routeQuantities(ROUTE, 0, 2);
    return isRefusal(r) ? "refused" : routeInput(r);
  })(),
  0,
);

// ---------------------------------------------------------------------------
// 7. Order is the route's, not the caller's
// ---------------------------------------------------------------------------

check(
  "a route handed in the wrong order still computes in sequence",
  qtys([stage(4, 2), stage(1, 0), stage(3, 6), stage(2, 4)], 1000),
  qtys(ROUTE, 1000),
);

console.log(failed === 0 ? "\nOK — every fabric route vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
