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
  comboUplift,
  comboUpliftBreakdown,
  isRefusal,
  type StageUpliftStep,
} from "../lib/orders/fabric-bom/yarn-process.ts";

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

type Stage = { combo: string | null; loss_pct: number | null; stage_id?: string | null; process_id?: string | null };

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

if (failed > 0) {
  console.error(`\n${failed} FAILED`);
  process.exit(1);
} else {
  console.log("\nAll fabric-bom-reports vectors passed.");
}
