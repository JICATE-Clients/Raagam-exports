/**
 * Vectors for the Fabric Process colour fold (client spec 2026-09-16 §2.2).
 *
 * `gatherByRoute` folds stored rows that agree on everything but colour into one
 * editable row carrying a multi-select; `expandByColour` unfolds them again.
 * Storage never changes — one colourway per row — so the ONE property that has
 * to hold is that the pair is lossless in both directions. A gather that drops a
 * field, or an expand that forgets one, would not throw: it would quietly
 * rewrite the operator's route on the next save, which is the class of silent
 * failure this module has been bitten by three times.
 *
 * Run: `npx tsx scripts/check-process-colour-fold.mts`
 */
import {
  blankFabricProcess,
  expandByColour,
  gatherByRoute,
  type FabricProcessRow,
} from "../lib/orders/fabric-bom/processes";

let failed = 0;
let ok = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    ok++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n        got  ${g}\n        want ${w}`);
  }
};

const FAB = "11111111-1111-1111-1111-111111111111";
let n = 0;
const newKey = () => `k${++n}`;

const step = (over: Partial<FabricProcessRow>): FabricProcessRow => ({
  ...blankFabricProcess(over.key ?? newKey(), FAB),
  stage_id: "DYED",
  process_id: "DYEING",
  loss_pct: "5",
  ...over,
});

// ---------------------------------------------------------------------------
// 1. The spec's own example: two colours share a step, a third has its own.
// ---------------------------------------------------------------------------
{
  const stored = [
    step({ key: "a", combo: "GREEN" }),
    step({ key: "b", combo: "RED" }),
    step({ key: "c", combo: "GREEN", process_id: "BRUSHING", loss_pct: "2" }),
  ];
  const g = gatherByRoute(stored);
  check("the spec's GREEN+RED share one displayed row", g.length, 2);
  check("...and it lists both colours in entry order", g[0].combos, ["GREEN", "RED"]);
  check("...while GREEN's own BRUSHING stays separate", g[1].combos, ["GREEN"]);
  check("...and the folded row remembers both stored keys", g[0].memberKeys, ["a", "b"]);
}

// ---------------------------------------------------------------------------
// 2. THE INVERSE PROPERTY. This is the one that matters.
// ---------------------------------------------------------------------------
{
  const stored = [
    step({ key: "a", combo: "GREEN" }),
    step({ key: "b", combo: "RED" }),
    step({ key: "c", combo: null, process_id: "KNITTING", stage_id: "GREIGE", loss_pct: "5" }),
  ];
  const back = gatherByRoute(stored).flatMap((g) => expandByColour(g, newKey));
  check("gather -> expand returns exactly the stored rows", back, stored);
}

// ---------------------------------------------------------------------------
// 3. A BLANK COLOUR IS "ALL COLOURS", NOT "NONE" — the 99% case.
// ---------------------------------------------------------------------------
{
  const stored = [step({ key: "a", combo: null })];
  const g = gatherByRoute(stored);
  check("a blank combo gathers to an EMPTY colour list", g[0].combos, []);
  check("...and expands back to a single blank-combo row", expandByColour(g[0], newKey).map((r) => r.combo), [null]);
}

// ---------------------------------------------------------------------------
// 4. THINGS THAT MUST NOT FOLD.
// ---------------------------------------------------------------------------
{
  const diffLoss = [step({ key: "a", combo: "WHITE", loss_pct: "3" }), step({ key: "b", combo: "GREEN", loss_pct: "5" })];
  check("different loss % never folds (the spec's WHITE 3 vs GREEN 5)", gatherByRoute(diffLoss).length, 2);

  const diffComponent = [
    step({ key: "a", combo: "GREEN", component_id: "BODY" }),
    step({ key: "b", combo: "GREEN", component_id: "CUFF" }),
  ];
  check("a component-wise split is a branch, not a colour of one", gatherByRoute(diffComponent).length, 2);

  const textLoss = [step({ key: "a", combo: "GREEN", loss_pct: "5" }), step({ key: "b", combo: "RED", loss_pct: "5.0" })];
  check('"5" and "5.0" stay apart — folding would rewrite one on save', gatherByRoute(textLoss).length, 2);

  const blanks = [
    blankFabricProcess("a", FAB),
    blankFabricProcess("b", FAB),
  ];
  check("two freshly-added blank rows never merge into one", gatherByRoute(blanks).length, 2);
}

// ---------------------------------------------------------------------------
// 5. EDITING A FOLDED ROW REWRITES ONLY ITS OWN MEMBERS.
// ---------------------------------------------------------------------------
{
  const stored = [step({ key: "a", combo: "GREEN" }), step({ key: "b", combo: "RED" })];
  const g = gatherByRoute(stored)[0];
  const dropped = expandByColour({ ...g, combos: ["GREEN"] }, newKey);
  check("removing RED leaves one row, reusing the first stored key", dropped.map((r) => [r.key, r.combo]), [["a", "GREEN"]]);

  const added = expandByColour({ ...g, combos: ["GREEN", "RED", "NAVY"] }, newKey);
  check("adding NAVY reuses both keys and mints exactly one", added.map((r) => r.combo), ["GREEN", "RED", "NAVY"]);
  check("...and the two existing rows keep their keys", added.slice(0, 2).map((r) => r.key), ["a", "b"]);
}

console.log(
  failed ? `\nFAILED — ${failed} failed, ${ok} ok.` : `\nOK — every process colour-fold vector holds (${ok} ok).`,
);
process.exit(failed ? 1 : 0);
