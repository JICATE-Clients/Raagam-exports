/**
 * Vectors for `declaredColoursFor()` / `colourSourceFor()` in
 * `lib/orders/amendments/combo-rules.ts` — the rule that decides which of an
 * order's declared colours a combo structure may be given, from its Fabric Type
 * (client 2026-08-20).
 *
 * ## WHY THIS ONE IS VECTORED
 *
 * The rule it replaces was WRONG IN BOTH DIRECTIONS on live data and neither
 * direction announced itself. Against the order's real palette — six colours
 * tagged `Dyed` and one tagged `Melange` — a Solid fabric was offered GREY
 * MELANGE (a melange colour on a fabric that will be piece-dyed), and a Melange
 * fabric was offered nothing at all while GREY MELANGE sat declared on the very
 * tab the list reads from. One over-offers and one under-offers, and the cell is
 * a free-text Combobox, so BOTH look like a working field.
 *
 * That is the shape a vector file is for: the failure is a plausible list, not an
 * error. The interesting assertions here are §2 and §4 — what must NOT come back.
 *
 * ## THE THREE THAT WOULD SURVIVE A CARELESS REWRITE
 *
 * 1. **An empty match must stay empty.** The tempting "if nothing matched, show
 *    everything" fallback — which `declaredPrintOptions` legitimately has one
 *    door along — reintroduces the exact defect: it puts GREY MELANGE back on a
 *    solid the moment an order declares no `Dyed` row. §4.
 *
 * 2. **Melange reads BOTH grids.** `Melange` is an option on the yarn dyeing list
 *    and the fabric dyeing list alike. Scoping it to one section compiles, runs,
 *    and quietly returns nothing for every order that used the other. §3.
 *
 * 3. **A blank Fabric Type offers nothing.** A rule phrased "restrict only when
 *    melange" leaks through every state that is not melange — how the
 *    nominated-vendor rule broke twice. §5.
 *
 * Run: `npm run check:colour-by-type`.
 */
import {
  colourSourceFor,
  declaredColoursFor,
  takesAllOverPrint,
  type DeclaredColour,
} from "../lib/orders/amendments/combo-rules.ts";

let failed = 0;

function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}\n         got  ${g}\n         want ${w}`);
  }
}

/**
 * THE ORDER'S REAL PALETTE, read out of `garment_order_amendment_dyeings` on
 * 2026-08-20. Kept verbatim rather than invented, because the whole argument for
 * this change is what these seven rows did under the old gate.
 */
const PALETTE: DeclaredColour[] = [
  { section: "fabric", dye_type: "Dyed", color_name: "BLUE" },
  { section: "fabric", dye_type: "Dyed", color_name: "GREEN" },
  { section: "fabric", dye_type: "Dyed", color_name: "NAVY" },
  { section: "fabric", dye_type: "Dyed", color_name: "RED" },
  { section: "fabric", dye_type: "Dyed", color_name: "WHITE" },
  { section: "fabric", dye_type: "Dyed", color_name: "YELLOW" },
  { section: "fabric", dye_type: "Melange", color_name: "GREY MELANGE" },
];

console.log("\n§1  Each fabric type takes its own half of the palette");

check("solid takes the Dyed colours", declaredColoursFor(PALETTE, "solid"), [
  "BLUE",
  "GREEN",
  "NAVY",
  "RED",
  "WHITE",
  "YELLOW",
]);
check("melange takes the Melange colours", declaredColoursFor(PALETTE, "melange"), [
  "GREY MELANGE",
]);
check(
  "yarn_dyed takes the Y/D colours — this order declares none",
  declaredColoursFor(PALETTE, "yarn_dyed"),
  [],
);

console.log("\n§2  THE TWO LIVE DEFECTS THE OLD GATE HAD — assert they are gone");

// The old rule was `takesDyedColour(t) ? <every declared colour> : []`.
check(
  "a SOLID is never offered GREY MELANGE",
  declaredColoursFor(PALETTE, "solid").includes("GREY MELANGE"),
  false,
);
check(
  "a MELANGE is not offered nothing",
  declaredColoursFor(PALETTE, "melange").length > 0,
  true,
);

console.log("\n§3  Melange reads BOTH grids, deduped by name");

const BOTH_GRIDS: DeclaredColour[] = [
  { section: "yarn", dye_type: "Melange", color_name: "GREY MELANGE" },
  { section: "fabric", dye_type: "Melange", color_name: "GREY MELANGE" },
  { section: "yarn", dye_type: "Melange", color_name: "ECRU MELANGE" },
];
check(
  "a melange declared on the YARN grid is offered",
  declaredColoursFor([BOTH_GRIDS[0]], "melange"),
  ["GREY MELANGE"],
);
check(
  "a melange declared on the FABRIC grid is offered",
  declaredColoursFor([BOTH_GRIDS[1]], "melange"),
  ["GREY MELANGE"],
);
check(
  "the same colour on both grids is ONE option",
  declaredColoursFor(BOTH_GRIDS, "melange"),
  ["GREY MELANGE", "ECRU MELANGE"],
);
// A yarn dyeing's Y/D must not leak into the fabric-side solid list.
check(
  "solid does not read the yarn grid",
  declaredColoursFor(
    [{ section: "yarn", dye_type: "Y/D", color_name: "INDIGO" }],
    "solid",
  ),
  [],
);
check(
  "yarn_dyed reads Y/D on the yarn grid",
  declaredColoursFor(
    [{ section: "yarn", dye_type: "Y/D", color_name: "INDIGO" }],
    "yarn_dyed",
  ),
  ["INDIGO"],
);

console.log("\n§4  AN EMPTY MATCH STAYS EMPTY — never falls back to the palette");

check(
  "a solid on an order declaring only melange gets NOTHING",
  declaredColoursFor(
    [{ section: "fabric", dye_type: "Melange", color_name: "GREY MELANGE" }],
    "solid",
  ),
  [],
);
check(
  "an order declaring no colours at all offers none",
  declaredColoursFor([], "solid"),
  [],
);

console.log("\n§5  The branches that claim nothing");

check("printed takes no declared colour", colourSourceFor("printed"), null);
check("printed takes a print instead", takesAllOverPrint("printed"), true);
check("a BLANK fabric type takes no colour", colourSourceFor(""), null);
check("null takes no colour", colourSourceFor(null), null);
check("an unknown type takes no colour", colourSourceFor("woven"), null);
check("blank claims no print either", takesAllOverPrint(""), false);

// THE INVARIANT the pair has carried since 2026-08-12: exactly one of the two
// cells may claim a row, and neither claims an unanswered one. Asserted rather
// than trusted, because splitting `takesDyedColour` into a source object is
// precisely the kind of change that can let both answer yes.
for (const t of ["solid", "melange", "yarn_dyed", "printed", "", null]) {
  const colour = colourSourceFor(t) !== null;
  const print = takesAllOverPrint(t);
  check(`"${t ?? "null"}" is never claimed by both cells`, colour && print, false);
}

console.log("\n§6  Normalisation, and the free-text era");

check(
  "dye_type is matched case- and space-insensitively",
  declaredColoursFor(
    [{ section: "fabric", dye_type: "  dyed ", color_name: "olive" }],
    "solid",
  ),
  ["OLIVE"],
);
// The column was free TEXT until 2026-08-17. An unrecognised value matches
// nothing — safe here and ONLY here, because the cell is a Combobox over
// `color_name`: a colour that stops being OFFERED is still displayed and still
// saved. Nothing a stored row holds is lost.
check(
  "an unrecognised legacy dye_type matches nothing",
  declaredColoursFor(
    [{ section: "fabric", dye_type: "Fabric Dyed", color_name: "OLIVE" }],
    "solid",
  ),
  [],
);
check(
  "a blank colour name is not an option",
  declaredColoursFor(
    [{ section: "fabric", dye_type: "Dyed", color_name: "   " }],
    "solid",
  ),
  [],
);

console.log(
  failed === 0
    ? "\nOK — every colour-by-type vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
