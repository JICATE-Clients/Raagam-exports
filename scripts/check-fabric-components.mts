/**
 * Vectors for `lib/orders/fabric-bom/component-map.ts` — Fabric BOM ▸
 * Components, the tab that maps garment panels to the cloth they are cut from.
 *
 * The client gave three association rules in writing on 2026-09-01 and listed
 * the third under "bugs to avoid". Every rule here is a FILTER on a dropdown,
 * which is the worst place for a defect to live: a list that offers too much
 * saves a wrong mapping silently, and a list that offers too little looks
 * exactly like a finished job. Neither shows up in a build, a type-check or a
 * screenshot.
 *
 * Six things are pinned, and each is a plausible implementation that reads
 * perfectly well.
 *
 * ## 1. "RIB MEANS NECK" IS DATA AND MUST NOT BECOME CODE
 *
 * The obvious reading of the client's sentence is a literal — `if (rib) return
 * NECK`. Section 2 runs the client's own tee and then a style that ribs a CUFF
 * as well, and asserts the cuff comes back. A hard-coded rule passes the first
 * and silently loses a panel on the second.
 *
 * ## 2. THE COLOURWAY AXIS MUST NOT COUNT AS "TAKEN"
 *
 * A line is one row per (style, colourway, structure, panel), so a WHITE and a
 * BLACK tee both name FRONT BODY legitimately. Collecting lines rather than
 * component IDS reports every panel as taken twice over and hands the second
 * colourway an empty dropdown. Section 4 pins the set and refutes the count.
 *
 * ## 3. RULE 3 IS STYLE-WIDE, NOT PER FABRIC
 *
 * Scoping the exclusion to one fabric passes every single-fabric test and
 * breaks the client's own Point 4 — Front Body would still be offered under the
 * Melange after being mapped to the Solid. Section 5 is that exact scenario.
 *
 * ## 4. THE HELD PANEL SURVIVES BOTH RULES
 *
 * A row must never filter itself out of its own list (rule 3), and must survive
 * the order re-declaring its panel onto another fabric (rule 2). Either omission
 * renders a filled cell empty and blanks a real FK on the next save — AGENTS.md's
 * "Disabled rows" data loss, arriving through a cascading filter. Sections 6-7.
 *
 * ## 5. THE DEFAULT IS UNAMBIGUOUS-ONLY
 *
 * `solePanel` must answer only when there is nothing to choose. "Take the first"
 * passes the client's rib example and guesses on every other style, and a
 * guessed FK reads on screen exactly like a chosen one. Section 8 refutes it.
 *
 * ## 6. A BLANK STYLE IS NOT A WILDCARD
 *
 * Fabric Lines lets a line leave Style blank meaning "every style". "Every
 * style's panels" is not a set this rule can honestly produce, so it must match
 * nothing rather than everything. Section 9.
 *
 * Runs under `tsx` for `check-yarn-process.mts`'s reason: the module imports an
 * `@/lib/...` alias at runtime and Node's ESM resolver reads neither the alias
 * nor the missing extension.
 */
import {
  availablePanels,
  componentsHiddenForLayout,
  declaredPanelsFor,
  fabricFormLabel,
  fabricGroupKey,
  layoutTypeLabel,
  panelsTakenInStyle,
  solePanel,
  FABRIC_FORM_OPTIONS,
  LAYOUT_TYPE_OPTIONS,
  type MappedLineLike,
  type StyleComponentDecl,
} from "../lib/orders/fabric-bom/component-map.ts";

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

const ids = (rows: readonly { component_id: string }[]) => rows.map((r) => r.component_id);

// ---------------------------------------------------------------------------
// 1. The fixtures — the client's own tee, as the live database holds it.
//
// Verified against the catalog on 2026-09-01: BOYS T SHIRT declares FRONT BODY,
// BACK BODY and SLEEVE against SINGLE JERSEY and NECK against 1X1 LYCRA RIB, all
// under the PIECES coordinate. These are those rows with readable ids.
// ---------------------------------------------------------------------------
const JERSEY = "cat-single-jersey";
const RIB = "cat-1x1-lycra-rib";
const PIECES = "coord-pieces";
const TOP = "coord-top";

const FRONT = "cmp-front-body";
const BACK = "cmp-back-body";
const SLEEVE = "cmp-sleeve";
const NECK = "cmp-neck";
const CUFF = "cmp-cuff";

const TEE = "BOYS T SHIRT";
const POLO = "MENS POLO";

const decl = (
  style: string,
  coordinate: string | null,
  component: string,
  category: string,
): StyleComponentDecl => ({
  style_ref_no: style,
  coordinate_id: coordinate,
  component_id: component,
  fabric_category_id: category,
});

/** The client's tee: three jersey panels and a rib neck. */
const TEE_DECLS: StyleComponentDecl[] = [
  decl(TEE, PIECES, FRONT, JERSEY),
  decl(TEE, PIECES, BACK, JERSEY),
  decl(TEE, PIECES, SLEEVE, JERSEY),
  decl(TEE, PIECES, NECK, RIB),
];

/** A style that ribs a CUFF as well as a neck — the case a hard-coded
 *  "Rib means Neck" gets wrong. */
const POLO_DECLS: StyleComponentDecl[] = [
  decl(POLO, PIECES, FRONT, JERSEY),
  decl(POLO, PIECES, NECK, RIB),
  decl(POLO, TOP, CUFF, RIB),
];

const line = (
  style: string,
  structure: string | null,
  component: string | null,
): MappedLineLike => ({
  style_ref_no: style,
  structure_id: structure,
  component_id: component,
});

/** A style declaration carrying a stated Layout Type (0527) — `decl()` above
 *  never sets one, since rules 2/2b/3 do not read it. */
const declL = (
  style: string,
  coordinate: string | null,
  component: string,
  category: string,
  layout: string | null,
): StyleComponentDecl => ({ ...decl(style, coordinate, component, category), layout_type: layout });

// ---------------------------------------------------------------------------
// 2. RULE 2 — the list is filtered by the fabric's structure.
//
// The client: "when configuring a Single Jersey fabric, Neck is completely
// irrelevant and must be hidden from the selectable component list."
// ---------------------------------------------------------------------------
check(
  "2a jersey offers the three body panels",
  ids(declaredPanelsFor(TEE_DECLS, TEE, JERSEY)),
  [FRONT, BACK, SLEEVE],
);
refute(
  "2b jersey does NOT offer the neck",
  ids(declaredPanelsFor(TEE_DECLS, TEE, JERSEY)).includes(NECK),
  true,
);
check("2c rib offers the neck alone", ids(declaredPanelsFor(TEE_DECLS, TEE, RIB)), [NECK]);

/* THE ORDER IS THE ORDER'S OWN `sno`, not alphabetical and not id order. The
   operator entered FRONT, BACK, SLEEVE and the dropdown must read that way; a
   `.sort()` anywhere in the rule would put BACK first and make the list feel
   like it had been shuffled. */
refute(
  "2d the offered order is not alphabetised",
  ids(declaredPanelsFor(TEE_DECLS, TEE, JERSEY)),
  [BACK, FRONT, SLEEVE],
);

/* A STRUCTURE NOBODY DECLARED ANYTHING AGAINST ANSWERS EMPTY, never "everything".
   The fallback-to-the-master temptation is what AGENTS.md's nominated-vendor rule
   forbids by name: "empty and explain, never a silent fallback". */
check("2e an undeclared structure offers nothing", declaredPanelsFor(TEE_DECLS, TEE, "cat-fleece"), []);
check("2f no structure at all offers nothing", declaredPanelsFor(TEE_DECLS, TEE, null), []);

/* THE COORDINATE RIDES ALONG so the caller can fill its cell without a second
   pick. The rib neck is under PIECES; the polo's cuff is under TOP. */
check(
  "2g the coordinate travels with the panel",
  declaredPanelsFor(POLO_DECLS, POLO, RIB),
  [
    { coordinate_id: PIECES, component_id: NECK },
    { coordinate_id: TOP, component_id: CUFF },
  ],
);

// ---------------------------------------------------------------------------
// 3. "RIB MEANS NECK" IS DATA. A style that ribs a cuff gets both.
//
// This is the section that catches the literal. `if (rib) return NECK` passes
// every assertion in section 2 and fails here.
// ---------------------------------------------------------------------------
check("3a a polo's rib offers the neck AND the cuff", ids(declaredPanelsFor(POLO_DECLS, POLO, RIB)), [
  NECK,
  CUFF,
]);
refute(
  "3b it is NOT hard-coded to the neck",
  ids(declaredPanelsFor(POLO_DECLS, POLO, RIB)),
  [NECK],
);

/* AND A STYLE'S DECLARATION IS ITS OWN. The tee and the polo are two rows of one
   BOM; reading the whole table would offer the polo's cuff on the tee. */
check(
  "3c one style's panels do not leak into another",
  ids(declaredPanelsFor([...TEE_DECLS, ...POLO_DECLS], TEE, RIB)),
  [NECK],
);

// ---------------------------------------------------------------------------
// 4. THE COLOURWAY AXIS IS NOT "TAKEN".
//
// One panel is one line PER COLOURWAY. A WHITE and a BLACK tee both naming FRONT
// BODY is one panel mapped once, not two.
// ---------------------------------------------------------------------------
const TWO_COLOURWAYS: MappedLineLike[] = [
  line(TEE, JERSEY, FRONT),
  line(TEE, JERSEY, FRONT), // the same panel, the other colourway
  line(TEE, JERSEY, BACK),
  line(TEE, JERSEY, BACK),
];

check(
  "4a two colourways of two panels are TWO taken panels",
  [...panelsTakenInStyle(TWO_COLOURWAYS, TEE)].sort(),
  [BACK, FRONT].sort(),
);
refute(
  "4b it counts panels, not lines",
  panelsTakenInStyle(TWO_COLOURWAYS, TEE).size,
  TWO_COLOURWAYS.length,
);

/* AND THE SECOND COLOURWAY STILL HAS SOMETHING TO OFFER. The failure this
   catches is a dropdown that empties itself as soon as an order has two colours
   — indistinguishable, on screen, from "everything is mapped". */
check(
  "4c sleeve is still offered with two colourways mapped",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: TWO_COLOURWAYS,
      styleRefNo: TEE,
      structureId: JERSEY,
      held: null,
    }),
  ),
  [SLEEVE],
);

/* A LINE WITH NO PANEL TAKES NOTHING. The blank row a grid opens with must not
   subtract an option. */
check("4d a blank line takes nothing", panelsTakenInStyle([line(TEE, JERSEY, null)], TEE).size, 0);

// ---------------------------------------------------------------------------
// 5. RULE 3 IS STYLE-WIDE — the client's Point 4, worked exactly.
//
//   "Map Front Body and Back Body to the Solid Single Jersey fabric. Click Add
//    Fabric to select Melange Single Jersey. Map only the Sleeve component to
//    this Melange Single Jersey fabric."
//
// Both fabrics are SINGLE JERSEY — the structure is the same and only the ITEM
// differs — so an exclusion scoped to the fabric, or to the structure, offers
// Front Body again under the Melange. That is a panel cut from two cloths.
// ---------------------------------------------------------------------------
const SOLID_MAPPED: MappedLineLike[] = [line(TEE, JERSEY, FRONT), line(TEE, JERSEY, BACK)];

check(
  "5a only the sleeve is left for the melange",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: SOLID_MAPPED,
      styleRefNo: TEE,
      structureId: JERSEY,
      held: null,
    }),
  ),
  [SLEEVE],
);
refute(
  "5b front body is NOT offered again on the second fabric",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: SOLID_MAPPED,
      styleRefNo: TEE,
      structureId: JERSEY,
      held: null,
    }),
  ).includes(FRONT),
  true,
);

/* ALL THREE MAPPED -> EMPTY. The client asked for this by name: "If all parts of
   a style have already been mapped, the selection list should display as
   empty." */
check(
  "5c every panel mapped offers nothing",
  availablePanels({
    decls: TEE_DECLS,
    siblings: [...SOLID_MAPPED, line(TEE, JERSEY, SLEEVE)],
    styleRefNo: TEE,
    structureId: JERSEY,
    held: null,
  }),
  [],
);

/* ANOTHER STYLE'S MAPPINGS DO NOT SUBTRACT. A BOM covers many styles and FRONT
   BODY of a tee is not FRONT BODY of a polo, even though they wear one master
   row — 0494's header makes the same argument for refusing a `unique(bom_id,
   component_id)` constraint. */
check(
  "5d a polo's mapped panels do not narrow the tee",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [line(POLO, JERSEY, FRONT), line(POLO, JERSEY, BACK)],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: null,
    }),
  ),
  [FRONT, BACK, SLEEVE],
);

// ---------------------------------------------------------------------------
// 6. THE HELD PANEL SURVIVES RULE 3 — a row never filters itself out.
// ---------------------------------------------------------------------------
check(
  "6a the row's own panel is still offered",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [line(TEE, JERSEY, BACK)],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: FRONT,
    }),
  ),
  [FRONT, SLEEVE],
);

/* THE HARD CASE: the panel is held AND appears among the siblings, which is what
   a caller that forgets to exclude the row's own lines produces. The held value
   must still come back — that caller has a bug, but this must not turn it into
   silent data loss. */
check(
  "6b held survives even when the siblings name it",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [line(TEE, JERSEY, FRONT), line(TEE, JERSEY, BACK)],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: FRONT,
    }),
  ).includes(FRONT),
  true,
);

// ---------------------------------------------------------------------------
// 7. THE HELD PANEL SURVIVES RULE 2 TOO.
//
// A line mapped last week to a panel the order has since re-declared against a
// different fabric. It falls out of `declaredPanelsFor` entirely, and dropping
// it renders a filled cell empty and blanks a real FK on the next save.
// ---------------------------------------------------------------------------
check(
  "7a a no-longer-declared held panel is still offered",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: NECK, // the order declares NECK against RIB, not JERSEY
    }),
  ),
  [FRONT, BACK, SLEEVE, NECK],
);

/* IT IS APPENDED, NOT INTERLEAVED — last, so a caller that wants to tag it
   ("not declared", the `diaOptionsFor` shape) can find it without re-deriving
   the rule. */
check(
  "7b the survivor comes last",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: NECK,
    }),
  ).at(-1),
  NECK,
);

/* AND IT IS NOT DUPLICATED when it IS still declared — the rescue must not fire
   on a panel the filter already returned. */
check(
  "7c a declared held panel appears exactly once",
  ids(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [],
      styleRefNo: TEE,
      structureId: JERSEY,
      held: FRONT,
    }),
  ).filter((x) => x === FRONT).length,
  1,
);

// ---------------------------------------------------------------------------
// 8. RULE 2b — the default fires only when there is nothing to choose.
// ---------------------------------------------------------------------------
check(
  "8a rib on the client's tee defaults to the neck",
  solePanel(
    availablePanels({
      decls: TEE_DECLS,
      siblings: [],
      styleRefNo: TEE,
      structureId: RIB,
      held: null,
    }),
  )?.component_id ?? null,
  NECK,
);

/* AND IT BRINGS ITS COORDINATE, which is the whole reason the caller needs no
   second pick. */
check(
  "8b the default carries its coordinate",
  solePanel(declaredPanelsFor(TEE_DECLS, TEE, RIB))?.coordinate_id ?? null,
  PIECES,
);

/* THREE OPTIONS -> NO GUESS. "Take the first" returns FRONT here and looks
   entirely reasonable on screen. */
check(
  "8c jersey with three panels defaults to nothing",
  solePanel(declaredPanelsFor(TEE_DECLS, TEE, JERSEY)),
  null,
);
refute(
  "8d it does NOT take the first",
  solePanel(declaredPanelsFor(TEE_DECLS, TEE, JERSEY))?.component_id ?? null,
  FRONT,
);

/* A POLO'S RIB HAS TWO — neck and cuff — so a literal "rib defaults to neck"
   would fill a cell the operator has a real choice in. */
check("8e a polo's rib defaults to nothing", solePanel(declaredPanelsFor(POLO_DECLS, POLO, RIB)), null);

/* NOTHING AVAILABLE -> NULL, never a throw. `solePanel` is called on every
   "+ Add part", including the one after the last panel is mapped. */
check("8f nothing available defaults to nothing", solePanel([]), null);

/* THE THIRD ADD DOES DEFAULT — rule 4 falling out of rule 3 for free. Two jersey
   panels mapped leaves exactly one, so the operator's third click fills it in. */
check(
  "8g the last remaining panel fills itself",
  solePanel(
    availablePanels({
      decls: TEE_DECLS,
      siblings: SOLID_MAPPED,
      styleRefNo: TEE,
      structureId: JERSEY,
      held: null,
    }),
  )?.component_id ?? null,
  SLEEVE,
);

// ---------------------------------------------------------------------------
// 9. KEYS — a blank style is not a wildcard, and case is folded.
// ---------------------------------------------------------------------------
check("9a a blank style matches no declaration", declaredPanelsFor(TEE_DECLS, null, JERSEY), []);
check("9b a blank style takes nothing", panelsTakenInStyle(TWO_COLOURWAYS, null).size, 0);

/* CASE AND WHITESPACE ARE FOLDED. Values are stored in capitals app-wide since
   2026-08-18, but rows saved before that are not — so a line reading "boys t
   shirt " off an older document is the same style as "BOYS T SHIRT".
   `styleKey` is the one function that decides this, shared with the requirement
   engine; a second trim-and-upper-case helper is what would drift. */
check(
  "9c the style key folds case and trims",
  ids(declaredPanelsFor(TEE_DECLS, "  boys t shirt ", RIB)),
  [NECK],
);

/* THE GROUP KEY IS (style, structure, fabric) AND NOT THE COLOURWAY — which is
   what makes one [Detail] sheet cover every colour of one cloth. */
const g = (style: string, structure: string | null, item: string | null) =>
  fabricGroupKey({ style_ref_no: style, structure_id: structure, item_id: item });

check("9d two colourways of one cloth are one group", g(TEE, JERSEY, "itm-solid") === g(TEE, JERSEY, "itm-solid"), true);
check("9e solid and melange are two groups", g(TEE, JERSEY, "itm-solid") === g(TEE, JERSEY, "itm-melange"), false);
check("9f two styles are two groups", g(TEE, JERSEY, "itm-solid") === g(POLO, JERSEY, "itm-solid"), false);

/* THE SEPARATOR CANNOT BE FORGED. A style ref containing the joiner must not be
   able to collide with another group — the reason `SEP` is a control character
   rather than a hyphen or a pipe. */
check(
  "9g a style ref cannot forge another group's key",
  g(`${TEE}|${JERSEY}`, null, "itm-solid") === g(TEE, `|${JERSEY}`, "itm-solid"),
  false,
);

// ---------------------------------------------------------------------------
// 10. Open / Tubular — the client's Point 5 vocabulary.
// ---------------------------------------------------------------------------
check("10a exactly two forms", FABRIC_FORM_OPTIONS.map((o) => o.value), ["open", "tubular"]);
/* "Open" -> "Open Width" (client cleanup spec, 2026-09-04): the LABEL only —
   10a above still holds the value at "open", unrenamed. See FABRIC_FORM_OPTIONS'
   own note for why this now reads the same as LAYOUT_TYPE_OPTIONS' label
   without being the same column. */
check("10b labels are the 2026-09-04 spec's words", FABRIC_FORM_OPTIONS.map((o) => o.label), ["Open Width", "Tubular"]);
check("10c the label resolves", fabricFormLabel("tubular"), "Tubular");
/* AN UNANSWERED CELL PRINTS NOTHING, not "Open". A default here would report a
   roll form nobody chose, on a field the client called mandatory. */
check("10d an unanswered form has no label", fabricFormLabel(null), "");
check("10e an unknown value has no label", fabricFormLabel("circular"), "");

// ---------------------------------------------------------------------------
// 11. RULE 4 — the Layout Type filter (0527, "Fab Rail"), Manual's shape.
//
// `componentsHiddenForLayout` is a HIDE-list over the whole `components`
// master, not an allow-list built from `declaredPanelsFor` — Manual's picker
// offers every master component today regardless of style declarations, and
// this rule may only ever REMOVE from that, never add a restriction the
// style hasn't earned. Proven wrong first: an allow-list implementation
// passes 11a-11c and fails 11d (an undeclared component would vanish).
// ---------------------------------------------------------------------------
check(
  "11a no Layout Type chosen hides nothing",
  [...componentsHiddenForLayout(TEE_DECLS, TEE, null)],
  [],
);

const LAYOUT_DECLS: StyleComponentDecl[] = [
  declL(TEE, PIECES, FRONT, JERSEY, "open_width"),
  declL(TEE, PIECES, BACK, JERSEY, "open_width"),
  declL(TEE, PIECES, NECK, RIB, "tubular"),
  // SLEEVE carries no declaration at all.
];

check(
  "11b a component declared ONLY tubular is hidden under open_width",
  componentsHiddenForLayout(LAYOUT_DECLS, TEE, "open_width").has(NECK),
  true,
);
check(
  "11c that same component is offered under tubular",
  componentsHiddenForLayout(LAYOUT_DECLS, TEE, "tubular").has(NECK),
  false,
);
check(
  "11d an UNDECLARED component (Sleeve) is never hidden, either way",
  [
    componentsHiddenForLayout(LAYOUT_DECLS, TEE, "open_width").has(SLEEVE),
    componentsHiddenForLayout(LAYOUT_DECLS, TEE, "tubular").has(SLEEVE),
  ],
  [false, false],
);
check(
  "11e a declared-but-matching component is never hidden",
  componentsHiddenForLayout(LAYOUT_DECLS, TEE, "open_width").has(FRONT),
  false,
);

/* ONE UNSTATED DECLARATION AMONG SEVERAL IS ENOUGH TO KEEP IT — a component
   named under two coordinates, one saying `tubular` and one saying nothing,
   is a style that has not finished answering, not a style that has excluded
   the open_width row. The weaker implementation (hide if ANY stated
   declaration disagrees) fails this: it would hide CUFF here. */
const MIXED_DECLS: StyleComponentDecl[] = [
  declL(POLO, PIECES, CUFF, RIB, "tubular"),
  declL(POLO, TOP, CUFF, RIB, null),
];
check(
  "11f one null declaration among several keeps the component visible",
  componentsHiddenForLayout(MIXED_DECLS, POLO, "open_width").has(CUFF),
  false,
);

/* A component whose every declaration agrees with the chosen layout is kept,
   even declared twice (two coordinates, same answer). */
const AGREEING_DECLS: StyleComponentDecl[] = [
  declL(POLO, PIECES, CUFF, RIB, "open_width"),
  declL(POLO, TOP, CUFF, RIB, "open_width"),
];
check(
  "11g a component declared twice, both agreeing, is not hidden",
  componentsHiddenForLayout(AGREEING_DECLS, POLO, "open_width").has(CUFF),
  false,
);

check(
  "11h scoped to the style — a different style's declarations do not hide it here",
  componentsHiddenForLayout(LAYOUT_DECLS, POLO, "open_width").size,
  0,
);

check("11i exactly two Layout Types", LAYOUT_TYPE_OPTIONS.map((o) => o.value), [
  "open_width",
  "tubular",
]);
check("11j labels are the spec's own words", LAYOUT_TYPE_OPTIONS.map((o) => o.label), [
  "Open Width",
  "Tubular",
]);
check("11k the label resolves", layoutTypeLabel("open_width"), "Open Width");
check("11l an unanswered Layout Type has no label", layoutTypeLabel(null), "");
check("11m an unknown value has no label", layoutTypeLabel("open"), "");

// ---------------------------------------------------------------------------
console.log(failed === 0 ? "\nall vectors pass" : `\n${failed} vector(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
