/**
 * Vectors for `lib/orders/material-bom/process-loss.ts` — the compounding
 * process-loss rule and the UOM-aware rounding on top of it (client 2026-08-29).
 *
 * ## WHY THIS FILE EXISTS AT ALL
 *
 * 0465 shipped the Loss % column deliberately inert and said what wiring it
 * would need: "the loss COMPOUNDS along a chain (`prev_row_uid`), so two stages
 * at 5% is not 10%. That needs its own decision and its own vectors." The
 * decision was taken on 2026-08-29; these are the vectors it named.
 *
 * ## THE TWO THAT WOULD SURVIVE A CARELESS REWRITE
 *
 * 1. **Compounding vs summing.** `2% then 3%` is 1.0506, not 1.05. The
 *    difference is 0.06 units per 100 — invisible on a small line and a real
 *    shortfall on a large one, and the two implementations look equally
 *    plausible in a diff. `two stages compound, they do not sum` is the
 *    assertion that separates them.
 * 2. **Whole-unit rounding is scoped to countable UOMs.** Blanket rounding was
 *    built once and REJECTED by the client (see `uomPrecision`'s note), so a
 *    rewrite that "simplifies" this back to `Math.ceil` everywhere is reinstating
 *    a decision that was reversed. `metres keep their decimals` is the guard.
 *
 * Run: npx tsx scripts/check-process-loss.mts
 */

import {
  compoundLossFactor,
  isWholeUnitUom,
  PURCHASE_STAGE_GREIGE,
  purchaseStageOrGreige,
  requiredWithProcessLoss,
  roundRequirement,
  type ProcessLossRow,
} from "../lib/orders/material-bom/process-loss.ts";
import { isRefusal } from "../lib/orders/material-bom/requirement.ts";

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

/** Approximate compare, for the float products. */
function near(label: string, actual: unknown, expected: number, eps = 1e-9) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) < eps;
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ~${expected}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function row(p: Partial<ProcessLossRow> = {}): ProcessLossRow {
  return { row_uid: null, prev_row_uid: null, sno: 1, loss_pct: null, ...p };
}

// ---------------------------------------------------------------------------
// compoundLossFactor
// ---------------------------------------------------------------------------
{
  check("no processes multiplies by 1", compoundLossFactor([]), 1);
  check(
    "a process with no loss multiplies by 1",
    compoundLossFactor([row({ loss_pct: null }), row({ sno: 2, loss_pct: 0 })]),
    1,
  );
  near("one stage at 2%", compoundLossFactor([row({ loss_pct: 2 })]), 1.02);

  // THE ASSERTION THE WHOLE DECISION TURNS ON. Summing would give 1.05.
  near(
    "two stages compound, they do not sum",
    compoundLossFactor([row({ sno: 1, loss_pct: 2 }), row({ sno: 2, loss_pct: 3 })]),
    1.02 * 1.03,
  );
  check(
    "...and that is NOT the additive answer",
    Math.abs((compoundLossFactor([row({ sno: 1, loss_pct: 2 }), row({ sno: 2, loss_pct: 3 })]) as number) - 1.05) > 1e-6,
    true,
  );

  // The client's own worked example, end to end.
  check(
    "the client's example: 100 x 1.02 x 1.03 -> 106 Gross",
    requiredWithProcessLoss(100, [row({ sno: 1, loss_pct: 2 }), row({ sno: 2, loss_pct: 3 })], "GROSS", 2),
    106,
  );
  // ...AND THE UNROUNDED FIGURE THE CLIENT PUBLISHED, 105.06, WHICH THE GROSS
  // VECTOR ABOVE CANNOT SEE. It reads the figure through a `ceil`, so it asserts
  // only that the answer lands in (105, 106] — every wrong result inside that
  // window passes. Measured, not assumed: summing gives 105 and DOES fail it,
  // but a rewrite landing on 105.5 passes it and fails this one. Read on a
  // MEASURED unit, where the digits survive the rounding intact.
  check(
    "the client's example unrounded: 100 x 1.02 x 1.03 = 105.06",
    requiredWithProcessLoss(100, [row({ sno: 1, loss_pct: 2 }), row({ sno: 2, loss_pct: 3 })], "MTR", 2),
    105.06,
  );
  check(
    "the single-stage example: 30 Gross at 2% -> 31",
    requiredWithProcessLoss(30, [row({ loss_pct: 2 })], "GROSS", 2),
    31,
  );

  // ORDER DOES NOT CHANGE THE PRODUCT, which is what makes the flat list safe
  // today — but the walk keeps the sequence for when a stage's loss becomes
  // conditional on the one before it.
  near(
    "sno order does not change the product",
    compoundLossFactor([row({ sno: 2, loss_pct: 3 }), row({ sno: 1, loss_pct: 2 })]),
    1.02 * 1.03,
  );

  // Impossible percentages refuse rather than producing a vast number.
  check(
    "a 100% loss refuses — no finite input satisfies it",
    isRefusal(compoundLossFactor([row({ loss_pct: 100 })])),
    true,
  );
  check("a negative loss refuses", isRefusal(compoundLossFactor([row({ loss_pct: -1 })])), true);
  check("99.99% is allowed", isRefusal(compoundLossFactor([row({ loss_pct: 99.99 })])), false);
}

// ---------------------------------------------------------------------------
// The chain walk — flat today, branched tomorrow
// ---------------------------------------------------------------------------
{
  // THE LIVE SHAPE. Nothing writes `prev_row_uid`, so every row is a head. Several
  // heads is NOT fan-out, and reading it as such would refuse 100% of real lines.
  const flat = [
    row({ row_uid: "a", sno: 1, loss_pct: 2 }),
    row({ row_uid: "b", sno: 2, loss_pct: 3 }),
    row({ row_uid: "c", sno: 3, loss_pct: 1 }),
  ];
  near("a flat list is not fan-out", compoundLossFactor(flat), 1.02 * 1.03 * 1.01);

  // A real chain: greige -> dyed -> printed.
  const chain = [
    row({ row_uid: "dye", prev_row_uid: null, sno: 1, loss_pct: 2 }),
    row({ row_uid: "print", prev_row_uid: "dye", sno: 2, loss_pct: 3 }),
  ];
  near("a linear chain compounds", compoundLossFactor(chain), 1.02 * 1.03);

  // FAN-OUT REFUSES. 400 buttons go on to be engraved and 600 do not, so the two
  // paths carry different losses and one Required Qty is not defined.
  const fanOut = [
    row({ row_uid: "dye", sno: 1, loss_pct: 2 }),
    row({ row_uid: "engrave", prev_row_uid: "dye", sno: 2, loss_pct: 3 }),
    row({ row_uid: "pack", prev_row_uid: "dye", sno: 3, loss_pct: 1 }),
  ];
  check("fan-out refuses rather than guessing a branch", isRefusal(compoundLossFactor(fanOut)), true);

  // A DANGLING PREDECESSOR IS A HEAD, NOT A DROPPED STAGE. Omitting the row
  // would silently omit its loss, which under-orders.
  const dangling = [
    row({ row_uid: "a", sno: 1, loss_pct: 2 }),
    row({ row_uid: "b", prev_row_uid: "gone", sno: 2, loss_pct: 3 }),
  ];
  near("a dangling prev_row_uid still contributes its loss", compoundLossFactor(dangling), 1.02 * 1.03);

  // A CYCLE MUST NOT HANG, and must not lose a stage either.
  const cycle = [
    row({ row_uid: "a", prev_row_uid: "b", sno: 1, loss_pct: 2 }),
    row({ row_uid: "b", prev_row_uid: "a", sno: 2, loss_pct: 3 }),
  ];
  near("a cycle terminates and keeps both losses", compoundLossFactor(cycle), 1.02 * 1.03);
}

// ---------------------------------------------------------------------------
// UOM-aware rounding
// ---------------------------------------------------------------------------
{
  check("GROSS is a whole unit", isWholeUnitUom("GROSS"), true);
  check("PCS is a whole unit", isWholeUnitUom("pcs"), true);
  check("NOS is a whole unit", isWholeUnitUom(" nos "), true);
  // NBR IS THE FOURTH UNIT THE CLIENT NAMED and was the only one of the four
  // with no vector — in the constant, exercised by nothing. A list is edited
  // when the UOM master grows (see `WHOLE_UNIT_UOM_CODES`), and an entry no
  // vector reads is one an edit can drop without anything failing.
  check("NBR is a whole unit", isWholeUnitUom("NBR"), true);
  check("ROLLS is named though the master has none yet", isWholeUnitUom("ROLLS"), true);
  check("MTR is measured", isWholeUnitUom("MTR"), false);
  check("KGS is measured", isWholeUnitUom("KGS"), false);
  check("an unknown unit is measured — it fails SAFE", isWholeUnitUom("FURLONG"), false);
  check("a null unit is measured", isWholeUnitUom(null), false);

  // THE CLIENT'S OWN ROUNDING PAIR, read on the rounder directly: the same
  // 105.06 is 106 in a countable unit and stays 105.06 in a measured one. That
  // contrast IS the rule, and asserting the two sides side by side is what a
  // "simplify it to Math.ceil everywhere" rewrite has to break to pass.
  check("105.06 Gross rounds up to 106", roundRequirement(105.06, "GROSS", 2), 106);
  check("105.06 metres stays 105.06", roundRequirement(105.06, "MTR", 2), 105.06);
  check("30.6 Gross rounds up to 31", roundRequirement(30.6, "GROSS", 2), 31);
  check("30.1 Gross rounds up to 31", roundRequirement(30.1, "GROSS", 2), 31);
  check("an exact 30 Gross stays 30", roundRequirement(30, "GROSS", 2), 30);

  // THE REVERSAL'S SCOPE. Blanket rounding was rejected once; metres must keep
  // their decimals or this reinstates it.
  check("30.6 metres keeps its decimals", roundRequirement(30.6, "MTR", 2), 30.6);
  check("12.345 kg ceils to 2dp, not to 13", roundRequirement(12.345, "KGS", 2), 12.35);

  // The float artefact `ceilToPrecision` exists to absorb. A bare Math.ceil
  // would make this 151.
  check("a float artefact does not add a whole unit", roundRequirement(150.0000000000001, "GROSS", 2), 150);
}

// ---------------------------------------------------------------------------
// requiredWithProcessLoss — the composition
// ---------------------------------------------------------------------------
{
  check("no processes returns the base untouched", requiredWithProcessLoss(30.6, [], "MTR", 2), 30.6);
  check(
    "a base refusal passes through unchanged",
    requiredWithProcessLoss({ refused: "Enter how many are used per piece" }, [row({ loss_pct: 2 })], "GROSS", 2),
    { refused: "Enter how many are used per piece" },
  );
  check(
    "a loss refusal reaches the cell",
    isRefusal(requiredWithProcessLoss(100, [row({ loss_pct: 100 })], "GROSS", 2)),
    true,
  );

  // WASTAGE AND PROCESS LOSS COMPOSE — they are different buffers and neither
  // restates the other. The base arriving here is already wastage-inflated.
  const withWastage = 103; // 100 + 3% cutting wastage, already ceilinged upstream
  check(
    "a dye loss applies on top of the line's wastage",
    requiredWithProcessLoss(withWastage, [row({ loss_pct: 2 })], "GROSS", 2),
    106, // ceil(103 * 1.02) = ceil(105.06)
  );

  // A measured unit keeps its precision through the loss too.
  check(
    "a metre line inflated by 2% keeps 2dp",
    requiredWithProcessLoss(100, [row({ loss_pct: 2 })], "MTR", 2),
    102,
  );
  check(
    "...and a fractional one ceils to 2dp rather than to a whole metre",
    requiredWithProcessLoss(30.6, [row({ loss_pct: 2 })], "MTR", 2),
    31.22, // 30.6 * 1.02 = 31.212 -> 31.22
  );
}

// ---------------------------------------------------------------------------
// The purchase stage — the ONE STRING a locked field depends on
// ---------------------------------------------------------------------------
{
  /**
   * THE CASE IS LOAD-BEARING AND NOBODY WOULD EVER SEE IT WRONG. The field is
   * locked on screen, so a drift to "GREIGE" or "greige" produces no error, no
   * rejected save and nothing an operator could report — just two spellings of
   * one value accumulating in one column, which is the failure 0475 documents
   * on this exact table. 0476 copies its DB default FROM this constant, so the
   * literal and its case are what keep the two halves agreeing.
   */
  check("the purchase stage is 'Greige', in title case", PURCHASE_STAGE_GREIGE, "Greige");

  /**
   * AND THE APP-SIDE COALESCE, WHICH THE MIGRATION CANNOT ASSERT. 0476's DO
   * block proves the COLUMN defaults correctly; it says nothing about the
   * writer. `normalizeItems` NAMES `purchase_stage` on every insert, and a
   * column default never fires against an explicit NULL — so the DB half can be
   * perfect while the app writes blanks for ever and nothing fails. That is not
   * hypothetical: 0475 shipped precisely that gap here.
   */
  check("a null purchase stage becomes Greige", purchaseStageOrGreige(null), "Greige");
  check("...and so does an empty string", purchaseStageOrGreige(""), "Greige");
  check("...and so does whitespace, which is a box the operator cleared", purchaseStageOrGreige("   "), "Greige");
  check("...and an undefined one", purchaseStageOrGreige(undefined), "Greige");

  /* A REAL VALUE SURVIVES, TRIMMED. The coalesce fills a blank; it does not
     overwrite an answer. A line saved before 0476 renders what it holds. */
  check("a stated stage is kept", purchaseStageOrGreige("DYED"), "DYED");
  check("...and trimmed", purchaseStageOrGreige("  DYED  "), "DYED");
}

console.log(
  failed === 0
    ? "\nOK — every process-loss vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
