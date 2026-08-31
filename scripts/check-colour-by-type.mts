/**
 * Vectors for the Fabric-Type rules in `lib/orders/amendments/combo-rules.ts` —
 * everything Garment Order ▸ Combos ▸ [Detail] (the "Structure Details" overlay)
 * decides FROM the fabric's Type: which declared colours a part may be offered,
 * whether its Colour cell is required at all, which colours a yarn-dyed fabric is
 * knitted FROM, and whether a tolerance counts as something the operator said.
 *
 * ## WHY THIS ONE IS VECTORED
 *
 * The rule it started life guarding was WRONG IN BOTH DIRECTIONS on live data and
 * neither direction announced itself. Against the order's real palette — six
 * colours tagged `Dyed` and one tagged `Melange` — a Solid fabric was offered GREY
 * MELANGE (a melange colour on a fabric that will be piece-dyed), and a Melange
 * fabric was offered nothing at all while GREY MELANGE sat declared on the very
 * tab the list reads from. One over-offers and one under-offers, and every cell
 * here is a free-text Combobox, so BOTH look like a working field.
 *
 * That is the shape a vector file is for: the failure is a plausible list, not an
 * error. The interesting assertions are the ones about what must NOT come back.
 *
 * ## THE ONES THAT WOULD SURVIVE A CARELESS REWRITE
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
 * 3. **A blank Fabric Type offers nothing and requires nothing.** A rule phrased
 *    "restrict only when melange" leaks through every state that is not melange —
 *    how the nominated-vendor rule broke twice. §5, §9.
 *
 * 4. **Offering a list and requiring an answer are ONE decision — except once.**
 *    `componentColourEntry` is that one function, and `yarn_dyed` is the
 *    exception it exists for: required, and offered nothing. Reverting
 *    `componentProblems` to the old `colourSourceFor(...) !== null` test compiles,
 *    runs, and silently makes Colour optional on every yarn-dyed part. §9, §10.
 *
 * 5. **A yarn-colour list narrows to its own style.** §11, and it is the
 *    cascading-filter defect in AGENTS.md one door along: a facet must narrow to
 *    the facet beside it. Nothing on screen says which style a colourway came
 *    from, so an unscoped list reads exactly like a scoped one.
 *
 * 6. **A prefilled tolerance is not an answer.** §8. `toleranceStated` decides
 *    whether a structure row is worth seeding from, storing, or carrying down;
 *    getting it wrong is silent in all three.
 *
 * ## THE DATA IS REAL
 *
 * `PALETTE` and `COMBOS` below are read out of the live catalog, not invented,
 * because the whole argument for these rules is what the real rows do under them.
 * Re-verified 2026-08-31 against `garment_order_amendment_dyeings`: **7 rows, and
 * every one of them is `section = 'fabric'`** — six `Dyed` plus one `Melange`
 * (GREY MELANGE). There is NO yarn-section dyeing row anywhere in the database.
 *
 * That single fact is the load-bearing argument for §11. A Yarn Color dropdown
 * sourced from the Color/Print palette — `declaredColoursFor(rows, "yarn_dyed")`,
 * which used to read the yarn grid's `Y/D` rows — would have been EMPTY on every
 * live order on the day it shipped, and nobody would have noticed, because the
 * cell also takes free text. So the yarn colours come from the Combos grid
 * instead, which cannot be empty where the field appears: Yarn Color lives inside
 * one combo's [Detail] overlay, so at least one combo always exists to offer.
 *
 * Run: `npm run check:colour-by-type`.
 */
import {
  ITEM_SUB_TYPE_OPTIONS,
  asItemSubType,
  colourSourceFor,
  componentColourEntry,
  componentProblems,
  declaredColoursFor,
  toleranceStated,
  yarnColourOptions,
  type ColourwayLike,
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
 * 2026-08-20 and re-verified unchanged on 2026-08-31. Kept verbatim rather than
 * invented, because the whole argument for this change is what these seven rows
 * did under the old gate — and because their being ALL `fabric` is what decides
 * §11.
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

/**
 * Every value the Fabric Type column can hold, plus the ones it cannot — probed
 * together wherever an invariant has to hold for ALL of them rather than for the
 * three the screen offers. A rule that leaks does it through a state nobody
 * enumerated, which is the whole lesson of the nominated-vendor gate.
 */
const EVERY_TYPE: (string | null | undefined)[] = [
  "solid",
  "melange",
  "yarn_dyed",
  "printed",
  "",
  "woven",
  "SOLID",
  " solid ",
  null,
  undefined,
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
// YARN DYED TAKES NOTHING, AND THAT IS THE 2026-08-31 DECISION, not this order
// happening to declare no `Y/D` row. A yarn-dyed cloth is knitted from several
// pre-dyed yarns, so the finished panel's colour is a DESCRIPTION ("WHITE/BLUE
// STRIPE") and no declared colour can state it. See §9 for the half that makes
// the cell required anyway, and §3 for the vector that catches the branch being
// restored.
check(
  "yarn_dyed takes no declared colour at all",
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
// THE INVERSE OF WHAT THIS VECTOR USED TO ASSERT, and the inversion is the point.
// `colourSourceFor` had a `yarn_dyed → { types: ["Y/D"], sections: ["yarn"] }`
// branch and this line demanded INDIGO come back from it. The client's 2026-08-31
// instruction removed the branch — "exclude and hide the base fabric colors and
// the colors selected in the Yarn Color field … locked to manual-entry text input
// only" — so the honest implementation is an empty list and a text box, never a
// dropdown that happens to come out empty. Restoring the branch fails HERE, which
// is why the vector is kept pointed at the same row rather than deleted.
check(
  "yarn_dyed is offered NOTHING even when the order declares a Y/D colour",
  declaredColoursFor(
    [{ section: "yarn", dye_type: "Y/D", color_name: "INDIGO" }],
    "yarn_dyed",
  ),
  [],
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

check("a BLANK fabric type takes no colour", colourSourceFor(""), null);
check("null takes no colour", colourSourceFor(null), null);
check("undefined takes no colour", colourSourceFor(undefined), null);
check("an unknown type takes no colour", colourSourceFor("woven"), null);
// `printed` is no longer a value the column can hold (§7) and the source rule
// still has to answer for it, because `lib/data-io` and a stale seeded row are
// both string-shaped doors into this function.
check("printed takes no declared colour", colourSourceFor("printed"), null);
check("yarn_dyed has no colour SOURCE", colourSourceFor("yarn_dyed"), null);

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

console.log("\n§7  The Fabric Type vocabulary — `printed` is gone (client 2026-08-31)");

// "Fabric Type is meant to define the structural weave or dye category of the
// fabric. 'Printed' is an aesthetic processing step, not a base fabric type."
// The three that remain are exactly `order_fabrics.item_sub_type`'s CHECK, which
// is what made removing the fourth safe: nothing could ever produce one.
check(
  "three values, and printed is not among them",
  ITEM_SUB_TYPE_OPTIONS.map((o) => o.value),
  ["solid", "melange", "yarn_dyed"],
);
check("asItemSubType refuses printed", asItemSubType("printed"), null);
check("asItemSubType maps a cleared Select to null", asItemSubType(""), null);
check("asItemSubType refuses an unknown word", asItemSubType("woven"), null);
check("asItemSubType refuses null", asItemSubType(null), null);
check("asItemSubType is case-sensitive", asItemSubType("Solid"), null);
// Every option the screen renders must survive the narrowing that guards the
// column, or a value the operator can pick is a value the payload drops.
for (const o of ITEM_SUB_TYPE_OPTIONS) {
  check(`"${o.value}" round-trips through asItemSubType`, asItemSubType(o.value), o.value);
}

console.log("\n§8  `toleranceStated` — a PREFILL is not an answer");

// A new fabric starts on ±5 (`DEFAULT_GSM_TOLERANCE`), and three callers ask this
// question: `structSaysSomething` (whether `seedComboFromStyle` may still seed),
// `structureFilled` (whether the row is worth STORING) and `carryDownGsm` (which
// fills blanks only). Answer "true" for the prefill and all three break silently:
// the [Detail] overlay quietly stops seeding, one empty structure row per combo
// is written for ever, and the carry-down the client asked for declines every
// time. Nothing errors in any of the three.
check("blank string says nothing", toleranceStated(""), false);
check("whitespace says nothing", toleranceStated("   "), false);
check("null says nothing", toleranceStated(null), false);
check("undefined says nothing", toleranceStated(undefined), false);
check("the prefill as a string says nothing", toleranceStated("5"), false);
check("the prefill as a number says nothing", toleranceStated(5), false);
check("the prefill with spaces says nothing", toleranceStated(" 5 "), false);
check("the prefill written 5.0 says nothing", toleranceStated("5.0"), false);
check("the prefill written 05 says nothing", toleranceStated("05"), false);

// A HAND-TYPED 5 IS INDISTINGUISHABLE FROM THE PREFILL, and that is ACCEPTED
// rather than overlooked. The only row it costs is one whose SOLE content is a
// deliberate tolerance of exactly the default — a row that says nothing else
// about the cloth. Every other field on the structure votes independently, so
// the moment a GSM, a composition or a Fabric Type is answered the row counts.
// Closing this gap would need a "touched" flag per cell, which is state the
// server half (`structureFilled`) cannot see at all.

check("a tighter tolerance is an answer", toleranceStated("3"), true);
check("a looser tolerance is an answer", toleranceStated("8"), true);
// ZERO IS A REAL ANSWER — "no tolerance" is a statement about the cloth, and
// `gsmRange` already treats it as one (it prints the GSM itself rather than a
// range). A predicate that swallowed 0 would drop the row that says the buyer
// allows no variance at all.
check("zero as a number is an answer", toleranceStated(0), true);
check("zero as a string is an answer", toleranceStated("0"), true);
// GARBAGE IS CONTENT. `Number("abc")` is NaN and NaN !== 5, so a non-numeric or
// half-typed tolerance reads as stated and the row is KEPT — dropping it would
// delete what the operator was in the middle of typing.
check("a non-numeric tolerance is content", toleranceStated("abc"), true);
check("a half-typed exponent is content", toleranceStated("1e"), true);
check("a negative tolerance is content", toleranceStated("-5"), true);

console.log("\n§9  `componentColourEntry` — the coupling that was SPLIT");

//   "list"   offers this order's declared colours, and is REQUIRED
//   "manual" offers NOTHING, takes typed text, and is REQUIRED
//   null     offers nothing and is NOT required
check("solid answers from the list", componentColourEntry("solid"), "list");
check("melange answers from the list", componentColourEntry("melange"), "list");
check("yarn_dyed is typed by hand", componentColourEntry("yarn_dyed"), "manual");
check("a blank type answers nothing", componentColourEntry(""), null);
check("null answers nothing", componentColourEntry(null), null);
check("undefined answers nothing", componentColourEntry(undefined), null);
check("printed answers nothing", componentColourEntry("printed"), null);
check("an unknown type answers nothing", componentColourEntry("woven"), null);

// THE INVARIANT THAT REPLACES THE OLD ONE. Until 2026-08-12 the pair to keep
// apart was Colour and Print; `takesAllOverPrint` is deleted and the pairing that
// matters now is INSIDE this cell — a branch that OFFERS colours is always the
// list branch. No value may offer a palette while claiming manual entry, which
// would put a dropdown behind a field the client ordered locked to typing; and
// none may claim the list branch with no source to read, which would render an
// always-empty dropdown and hold the cursor in front of it.
for (const t of EVERY_TYPE) {
  const label = t === null ? "null" : t === undefined ? "undefined" : `"${t}"`;
  check(
    `${label}: "list" iff it has a colour source`,
    componentColourEntry(t) === "list",
    colourSourceFor(t) !== null,
  );
  check(
    `${label}: offering colours implies the list branch`,
    declaredColoursFor(PALETTE, t).length > 0 ? componentColourEntry(t) === "list" : true,
    true,
  );
}

// YARN DYED IS REQUIRED-BUT-OFFERS-NOTHING, and this pair of lines is the whole
// reason `componentColourEntry` exists. The old requiredness test was
// `colourSourceFor(...) !== null`, with a comment stating in capitals that the
// list the cell offers and the requiredness of the cell are ONE decision. That
// was right until Yarn Dyed broke it. REVERTING `componentProblems` TO THAT TEST
// COMPILES, RUNS, AND SILENTLY MAKES COLOUR OPTIONAL ON EVERY YARN-DYED PART —
// no error, no empty list, just a mandatory field that stops being mandatory.
check(
  "yarn_dyed offers no colours",
  declaredColoursFor(PALETTE, "yarn_dyed").length,
  0,
);
check(
  "…and is required all the same",
  componentColourEntry("yarn_dyed") !== null,
  true,
);

console.log("\n§10  `componentProblems` — requiredness FOR A STATE");

const part = (color = "", ids = true) => ({
  coordinate_id: ids ? "co-1" : null,
  component_id: ids ? "cp-1" : null,
  color_name: color,
});

check(
  "a filled yarn-dyed part with no colour is reported",
  componentProblems(part(), "yarn_dyed"),
  ["Colour is required"],
);
check(
  "the same part with a typed colour is fine",
  componentProblems(part("WHITE/BLUE STRIPE"), "yarn_dyed"),
  [],
);
check(
  "a filled solid part with no colour is reported",
  componentProblems(part(), "solid"),
  ["Colour is required"],
);
// NOT REPORTED UNDER A BLANK FABRIC TYPE. The app has nothing to fill the cell
// from and nothing to say why it is refusing, so an unconditional hold would cage
// the operator on an unanswerable cell — AGENTS.md's "requiring a hidden field is
// a record that cannot be saved with nothing on screen to say why", one door
// along: not hidden, but unanswerable.
check(
  "the same part under a BLANK fabric type is not reported",
  componentProblems(part(), ""),
  [],
);
check(
  "…nor under a null fabric type",
  componentProblems(part(), null),
  [],
);
// A PART THAT SAYS NOTHING AT ALL IS NOT AN ERROR — `addComp` opens a blank row
// to type into and `componentFilled` drops it on save, so reporting it would
// deaden Save the moment the overlay opened.
check(
  "a part that says nothing reports nothing",
  componentProblems(part("", false), "solid"),
  [],
);
check(
  "…even on yarn_dyed, where colour is required",
  componentProblems(part("", false), "yarn_dyed"),
  [],
);
// Naming a colour is saying something, so the identifying cells are then due.
check(
  "a part naming only a colour still owes its identity",
  componentProblems(part("WHITE", false), "solid"),
  ["Coordinate is required", "Component is required"],
);
check(
  "a whitespace colour does not satisfy the requirement",
  componentProblems(part("   "), "yarn_dyed"),
  ["Colour is required"],
);

console.log("\n§11  `yarnColourOptions` — the colours a yarn-dyed fabric is knitted FROM");

/**
 * REAL COMBO NAMES AND REAL STYLE REFS, read out of
 * `garment_order_amendment_combos` on 2026-08-31 — STL/26-27/0003 carries WHITE,
 * RED and GREY MELANGE; V-NECK carries GREEN, NAVY and RED.
 *
 * THE TWO ARE COMBINED ONTO ONE ORDER HERE, and that composition is the only
 * invented thing in the fixture: every amendment in the catalog today holds a
 * SINGLE style. Which is precisely why the cascade defect would ship unnoticed —
 * there is no live row that would expose it, and nothing on screen says which
 * style a colourway came from, so an unscoped list reads exactly like a scoped
 * one. RED appearing under both styles is the useful accident: it is what
 * distinguishes "narrowed correctly" from "deduped by luck".
 */
const COMBOS: ColourwayLike[] = [
  { style_ref_no: "STL/26-27/0003", combo: "WHITE" },
  { style_ref_no: "STL/26-27/0003", combo: "RED" },
  { style_ref_no: "STL/26-27/0003", combo: "GREY MELANGE" },
  { style_ref_no: "V-NECK", combo: "GREEN" },
  { style_ref_no: "V-NECK", combo: "NAVY" },
  { style_ref_no: "V-NECK", combo: "RED" },
];

check(
  "a style is offered its own colourways",
  yarnColourOptions(COMBOS, "STL/26-27/0003"),
  ["WHITE", "RED", "GREY MELANGE"],
);
check(
  "the other style is offered its own",
  yarnColourOptions(COMBOS, "V-NECK"),
  ["GREEN", "NAVY", "RED"],
);
// THE CASCADING-FILTER ASSERTION (AGENTS.md, "Cascading filters"): a facet
// narrows to the facet beside it. A PO with two styles has two independent sets
// of colourways, and offering style 2's NAVY under style 1 is the same defect the
// Material Attributes filter bar and the item-report filter bar both shipped.
check(
  "style 2's NAVY is NOT offered under style 1",
  yarnColourOptions(COMBOS, "STL/26-27/0003").includes("NAVY"),
  false,
);
check(
  "style 1's GREY MELANGE is NOT offered under style 2",
  yarnColourOptions(COMBOS, "V-NECK").includes("GREY MELANGE"),
  false,
);

// ORDER IS FIRST-SEEN, NOT SORTED. The Combos grid is the operator's own list and
// its order is the one they built; re-sorting alphabetically would make the
// dropdown disagree with the grid it came from. Sorted, style 1 would read
// GREY MELANGE, RED, WHITE — so the two vectors above already fail on a sort, and
// this one names the reason so the failure is readable.
check(
  "the grid's own order is preserved, not alphabetised",
  yarnColourOptions(COMBOS, "STL/26-27/0003")[0],
  "WHITE",
);

// A BLANK STYLE REF OFFERS EVERYTHING, and this is the deliberate OPPOSITE of the
// nominated-vendor "empty and explain" rule (AGENTS.md, "Nominated vendors").
// There a blank supply type means the answer is genuinely UNAPPROVABLE — the
// customer has not said who may supply — so offering every vendor would make the
// nomination list advisory. Here a blank style ref means an operator has not
// typed one onto a combo yet, and the order's own colourways are still the right
// vocabulary; there is no third party whose approval is being bypassed. Same
// three clauses `scopedStructures` and `declaredPrintOptions` already use on this
// screen.
check(
  "a blank style ref falls back to every colourway",
  yarnColourOptions(COMBOS, ""),
  ["WHITE", "RED", "GREY MELANGE", "GREEN", "NAVY"],
);
check("a null style ref falls back too", yarnColourOptions(COMBOS, null), [
  "WHITE",
  "RED",
  "GREY MELANGE",
  "GREEN",
  "NAVY",
]);
check("an undefined style ref falls back too", yarnColourOptions(COMBOS, undefined), [
  "WHITE",
  "RED",
  "GREY MELANGE",
  "GREEN",
  "NAVY",
]);
// A style ref matching no combo can only mean the grid moved on beneath the
// overlay. It falls back to the whole list, NEVER to `[]` — an empty dropdown
// there would read as "this style has no colours", which is a claim, not a gap.
check(
  "a style ref matching nothing falls back, never to empty",
  yarnColourOptions(COMBOS, "STL/26-27/9999"),
  ["WHITE", "RED", "GREY MELANGE", "GREEN", "NAVY"],
);

check(
  "style refs are matched case- and space-insensitively",
  yarnColourOptions(COMBOS, "  stl/26-27/0003 "),
  ["WHITE", "RED", "GREY MELANGE"],
);
check(
  "a stored style ref with stray spaces still matches",
  yarnColourOptions(
    [{ style_ref_no: " V-NECK ", combo: "GREEN" }],
    "v-neck",
  ),
  ["GREEN"],
);

check(
  "colour names are uppercased and trimmed",
  yarnColourOptions([{ style_ref_no: "S1", combo: " navy " }], "S1"),
  ["NAVY"],
);
check(
  "the same colourway twice is ONE option",
  yarnColourOptions(
    [
      { style_ref_no: "S1", combo: "WHITE" },
      { style_ref_no: "S1", combo: "white" },
    ],
    "S1",
  ),
  ["WHITE"],
);
check(
  "a blank combo name is not an option",
  yarnColourOptions(
    [
      { style_ref_no: "S1", combo: "   " },
      { style_ref_no: "S1", combo: null },
      { style_ref_no: "S1", combo: "WHITE" },
    ],
    "S1",
  ),
  ["WHITE"],
);
// A combo that names no style is part of the fallback list and is reachable from
// it — the row is real, the operator simply has not said which style it belongs
// to yet.
check(
  "a combo naming no style is still offered when nothing scopes",
  yarnColourOptions([{ combo: "ECRU" }], null),
  ["ECRU"],
);
check("no combos at all offers nothing", yarnColourOptions([], "S1"), []);
check("no combos and no style offers nothing", yarnColourOptions([], null), []);

console.log(
  failed === 0
    ? "\nOK — every colour-by-type vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
