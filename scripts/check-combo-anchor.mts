/**
 * Vectors for `fabricAnchorDefaults()` / `withFabricDefaults()` in
 * `lib/orders/amendments/combo-rules.ts` — multi-combo fabric anchoring, where
 * the FIRST FILLED colourway supplies Composition / GSM / Tolerance / Fabric
 * Type to every colourway entered after it (client 2026-08-29).
 *
 * ## WHY THIS ONE IS VECTORED
 *
 * The same reason `check-composition-match.mts` gives for its own rule: this
 * fills in fields the operator did not touch, with values that read as
 * authoritative. A GSM is the number the cloth is bought and costed against, so
 * a wrong copy is not a visibly wrong figure — it is a plausible one, sitting in
 * a cell nobody looked at, on the second and third colourway of a PO.
 *
 * ## THE ASSERTION THAT IS THE WHOLE POINT
 *
 * "No chain." The client rejected previous-combo inheritance by name, because a
 * typo in combo 2 would then reach combos 3, 4 and 5. The interesting test is
 * therefore not that copying works — it is that a DEGRADED middle combo supplies
 * nothing to the one after it. `a chain cannot form` below is that assertion, and
 * it is the one a "simplification" to `combos[i - 1]` would break while every
 * other vector here kept passing.
 *
 * Run: npx tsx scripts/check-combo-anchor.mts
 */

import {
  fabricAnchorDefaults,
  withFabricDefaults,
  type FabricAnchorLike,
} from "../lib/orders/amendments/combo-rules.ts";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const JERSEY = "cat-single-jersey";
const RIB = "cat-rib";
const COLLAR = "cat-collar";

function struct(p: Partial<FabricAnchorLike> = {}): FabricAnchorLike {
  return {
    structure_id: null,
    composition_id: null,
    gsm: "",
    gsm_tolerance: "",
    item_sub_type: "",
    fabric_type: "",
    ...p,
  };
}

const blank = (id: string) => struct({ structure_id: id });

/** WHITE — the primary record: two fabrics, both fully answered. */
const white = {
  key: "white",
  structures: [
    struct({
      structure_id: JERSEY,
      composition_id: "cmp-cotton",
      gsm: "200",
      gsm_tolerance: "5",
      item_sub_type: "solid",
      fabric_type: "main",
    }),
    struct({
      structure_id: RIB,
      composition_id: "cmp-cotton-lycra",
      gsm: "240",
      gsm_tolerance: "10",
      item_sub_type: "solid",
      fabric_type: "main",
    }),
  ],
};

// --- the anchor is found, and it is the FIRST filled combo -----------------
{
  const empty = { key: "empty", structures: [blank(JERSEY)] };
  const d = fabricAnchorDefaults([empty, white], "green");
  check("an unanswered combo is not the anchor", d.get(JERSEY)?.gsm, "200");
  check("the anchor supplies every fabric it holds", d.size, 2);
  check("each fabric brings its OWN numbers", d.get(RIB)?.gsm, "240");

  // A combo can never anchor itself: without `exceptKey` the first filled combo
  // would "inherit" from itself, a no-op that reads as working.
  check("a combo is not its own anchor", fabricAnchorDefaults([white], "white").size, 0);
  check("no filled combo yet means no defaults", fabricAnchorDefaults([empty], "x").size, 0);
  check("an empty grid means no defaults", fabricAnchorDefaults([], "x").size, 0);
}

// --- THE NO-CHAIN ASSERTION ------------------------------------------------
//
// White is right, Green was mistyped. Black must take White's 200, NOT Green's
// 999 — and it must do so even though Green is the combo immediately before it.
{
  const green = {
    key: "green",
    structures: [struct({ structure_id: JERSEY, gsm: "999", gsm_tolerance: "99" })],
  };
  const d = fabricAnchorDefaults([white, green], "black");
  check("a chain cannot form — the anchor is the FIRST filled combo", d.get(JERSEY)?.gsm, "200");
  check("nor does the degraded tolerance propagate", d.get(JERSEY)?.gsm_tolerance, "5");

  // And the same list read for GREEN itself still points at White — the anchor
  // does not depend on who is asking, only on who came first.
  check(
    "the anchor is the same whoever asks",
    fabricAnchorDefaults([white, green], "green").get(JERSEY)?.gsm,
    "200",
  );
}

// --- matched per fabric category, never "the first row" --------------------
{
  const d = fabricAnchorDefaults([white], "black");
  check("a fabric the anchor does not carry inherits nothing", d.get(COLLAR), undefined);
  check(
    "an unmatched structure is returned untouched",
    withFabricDefaults(blank(COLLAR), d),
    blank(COLLAR),
  );
  // A structure with no category cannot be matched, and must not collide with
  // every other unanswered structure under a shared `null` key.
  const noCategory = {
    key: "nc",
    structures: [struct({ gsm: "111" }), struct({ structure_id: JERSEY, gsm: "200" })],
  };
  check("a categoryless structure is not an anchor entry", fabricAnchorDefaults([noCategory], "x").size, 1);
  check("a categoryless row inherits nothing", withFabricDefaults(struct({ gsm: "" }), d).gsm, "");
}

// --- fills gaps, never overwrites ------------------------------------------
{
  const d = fabricAnchorDefaults([white], "black");
  const filled = withFabricDefaults(blank(JERSEY), d);
  check("a blank structure takes all five", [
    filled.composition_id,
    filled.gsm,
    filled.gsm_tolerance,
    filled.item_sub_type,
    filled.fabric_type,
  ], ["cmp-cotton", "200", "5", "solid", "main"]);

  // A PRINTED BLACK OVER A SOLID WHITE IS A REAL ORDER. An anchor that
  // overwrote would make it unenterable.
  const printed = withFabricDefaults(
    struct({ structure_id: JERSEY, item_sub_type: "printed" }),
    d,
  );
  check("a deliberate difference survives", printed.item_sub_type, "printed");
  check("and the gaps beside it are still filled", printed.gsm, "200");

  // Whitespace is not an answer — a box holding " " is a box the operator
  // cleared, and `gsm.trim()` is what the save and `carryDownGsm` both test.
  check("a whitespace GSM is treated as blank", withFabricDefaults(struct({ structure_id: JERSEY, gsm: "  " }), d).gsm, "200");

  // IDENTITY WHEN NOTHING CHANGES, so a caller can skip a re-render.
  const complete = struct({
    structure_id: JERSEY,
    composition_id: "x",
    gsm: "1",
    gsm_tolerance: "2",
    item_sub_type: "melange",
    fabric_type: "trims_fabric",
  });
  check("a fully answered structure comes back unchanged", withFabricDefaults(complete, d) === complete, true);
}

// --- an anchor that answers only SOME properties ---------------------------
//
// "Completely filled out" is the client's phrase, but a combo that has answered
// GSM and not yet Composition is still the primary record — copying the half it
// has is strictly better than copying nothing, and the other half stays blank
// rather than being invented.
{
  const partial = { key: "p", structures: [struct({ structure_id: JERSEY, gsm: "180" })] };
  const filled = withFabricDefaults(blank(JERSEY), fabricAnchorDefaults([partial], "x"));
  check("a partly answered anchor supplies what it has", filled.gsm, "180");
  check("and leaves the rest blank rather than inventing it", filled.composition_id, null);
}

console.log(
  failed === 0
    ? "\nOK — every combo-anchor vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
