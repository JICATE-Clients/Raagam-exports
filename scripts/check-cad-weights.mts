/**
 * Vectors for `lib/orders/cad/weights.ts` — the CAD marker gram weights, and
 * what the Fabric BOM is allowed to take from them.
 *
 * THIS MODULE'S OUTPUT IS THE INPUT TO THE LARGEST LINE IN THE ORDER. Fabric
 * dominates the cost of a knitted garment, and everything the Fabric BOM engine
 * computes is a multiple of the consumption figure this file produces — so an
 * error here is multiplied by the whole order before anybody sees it, and it
 * arrives looking like an ordinary quantity.
 *
 * Four failures a plausible implementation ships, each of which passes an
 * arithmetic-only suite:
 *
 *  1. **The doubling.** A panel weighed on two markers of one sheet gets ADDED.
 *     `uq_occw_panel` (0460) cannot catch it — the sheet is the weight's
 *     grandparent — so the only guard is section 2, and the wrong answer is a
 *     perfectly ordinary-looking number twice the right one.
 *  2. **Rounding the consumption at the UOM's own precision.** Every UOM in this
 *     database declares 2 decimals, so `ceilToPrecision(0.045, dp)` turns a 45 g
 *     sleeve into 0.05 kg and over-orders it by 11% on every garment. Section 3
 *     asserts the right answer AND refutes that one by name.
 *  3. **Treating a missing weight as 0.** "Not measured yet" and "needs no
 *     fabric" produce the same empty cell and only one of them is an answer.
 *  4. **Seeding an unscoped BOM line off whichever style comes first.** A line
 *     with `style_ref_no` NULL covers EVERY style (0426); with two styles
 *     weighed there is no single figure, and picking one plans the order's
 *     fabric off the wrong garment with nothing on screen saying so.
 *  5. **Ignoring the fabric.** A FRONT BODY cut in single jersey and a FRONT
 *     BODY cut in 1x1 rib are two rows on the order (0457 keys its own table
 *     that way and calls the contrast yoke "an entirely normal garment") and two
 *     lines on the Fabric BOM — which has a structure axis and no coordinate
 *     one. Roll them together and BOTH lines take the whole body weight.
 *     Section 5 is the only thing standing between the two.
 *  6. **Dropping the fabric on the way IN.** Section 5 passes as long as the
 *     weights it is handed carry a fabric. If the FLATTENING nulls it — as this
 *     lane's first version did, on the combo tree, believing 0408's header after
 *     0409 had repointed the column — every section-5 vector stays green while
 *     the doubling is live on every order in the database. Section 6 starts from
 *     the SOURCE ROWS instead, and its end-to-end case uses combo-tree rows
 *     ONLY, with no 0457 rows at all: the exact shape of every live order.
 *
 * Runs under `tsx`. The import below uses a **.js specifier** for a file that is
 * .ts on disk: that is what `moduleResolution: "bundler"` expects, tsx resolves
 * it unchanged at runtime, and — unlike a `.ts` specifier — it needs no
 * `tsconfig.json` exclude entry to silence TS5097. The 24 older check scripts
 * are each excluded by hand; this one does not have to be.
 *
 *     npx --yes tsx scripts/check-cad-weights.mts
 */
import {
  componentWeightsForOrder,
  consumptionFromGrams,
  isRefusal,
  seedConsumptionFor,
  type CadWeightRow,
  type ComponentWeight,
  type SeedTargetLine,
} from "../lib/orders/cad/weights.js";
import {
  orderPanelRows,
  type ComboSource,
  type StyleComponentSource,
} from "../lib/orders/cad/panels.js";

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
 *  implementation produces. A vector that only states the right answer cannot
 *  say which wrong one it was guarding against. */
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

/** Asserts a refusal happened AND that its sentence names the thing at fault —
 *  a refusal nobody can read is a dead end, which is the failure the "empty and
 *  explain" rule exists to prevent. */
function refusedSaying(label: string, v: unknown, ...mustContain: string[]) {
  const r = refusalOf(v);
  if (r === null) {
    failed++;
    console.error(`FAIL  ${label}\n      expected a refusal, got ${JSON.stringify(v)}`);
    return;
  }
  const missing = mustContain.filter((m) => !r.includes(m));
  if (missing.length) {
    failed++;
    console.error(`FAIL  ${label}\n      refusal "${r}" does not name ${JSON.stringify(missing)}`);
    return;
  }
  console.log(`ok    ${label}  ("${r}")`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const S1 = "TSH-001";
const S2 = "SHR-002";
const TOP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOTTOM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FRONT = "11111111-1111-1111-1111-111111111111";
const SLEEVE = "22222222-2222-2222-2222-222222222222";
const RIB = "33333333-3333-3333-3333-333333333333";
const POCKET = "44444444-4444-4444-4444-444444444444";
/** `categories` rows — the ONE vocabulary every source of a panel speaks:
 *  `order_fabric_bom_lines.structure_id` (0426), the order's style components
 *  (0457) and the combo tree's structure row, which 0409 repointed off
 *  `config_lookups`. Checked in `pg_constraint`, not in 0408's header. */
const JERSEY = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const RIB_FABRIC = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const w = (over: Partial<CadWeightRow> = {}): CadWeightRow => ({
  style_ref_no: S1,
  coordinate_id: null,
  coordinate_name: null,
  component_id: FRONT,
  component_name: "FRONT BODY",
  fabric_category_id: null,
  fabric_category_name: null,
  grams: 120,
  dia: 30,
  layout_label: 'TSH-001 30"',
  ...over,
});

const names = (v: ComponentWeight[] | { refused: string }) =>
  isRefusal(v) ? v.refused : v.map((r) => [r.component_name, r.grams, r.coordinates, r.dia]);

/** With the fabric, for the section that is about the fabric. */
const fabrics = (v: ComponentWeight[] | { refused: string }) =>
  isRefusal(v)
    ? v.refused
    : v.map((r) => [r.component_name, r.fabric_category_name, r.grams, r.coordinates]);

// ---------------------------------------------------------------------------
// 1. The rollup: the spec's own example
// ---------------------------------------------------------------------------

console.log("\n-- 1. the sheet rolls up per (style, component) --");

check(
  "Front Body 120g, Sleeve 45g, Neck Rib 12g come back as three panels",
  names(
    componentWeightsForOrder([
      w(),
      w({ component_id: SLEEVE, component_name: "SLEEVE", grams: 45 }),
      w({ component_id: RIB, component_name: "NECK RIB", grams: 12 }),
    ]),
  ),
  [
    ["FRONT BODY", 120, 1, 30],
    ["SLEEVE", 45, 1, 30],
    ["NECK RIB", 12, 1, 30],
  ],
);

/*
 * SUMMING OVER COORDINATES IS THE DESTINATION'S RULE, NOT A CONVENIENCE.
 * `order_fabric_bom_lines` has a style, a combo, a structure and a component and
 * NO coordinate axis (0426) — so a set whose Top and Bottom both carry a FRONT
 * BODY maps to ONE line, and that line needs the fabric for the whole set.
 */
check(
  "a set's Top and Bottom front bodies are ONE panel of 200 g, from 2 coordinates",
  names(
    componentWeightsForOrder([
      w({ coordinate_id: TOP, coordinate_name: "TOP", grams: 120 }),
      w({ coordinate_id: BOTTOM, coordinate_name: "BOTTOM", grams: 80 }),
    ]),
  ),
  [["FRONT BODY", 200, 2, 30]],
);

check(
  "two styles keep their own panels apart",
  names(
    componentWeightsForOrder([
      w({ style_ref_no: S1, grams: 120 }),
      w({ style_ref_no: S2, grams: 95 }),
    ]),
  ),
  [
    ["FRONT BODY", 120, 1, 30],
    ["FRONT BODY", 95, 1, 30],
  ],
);

/*
 * THE DIA IS AGREEMENT-OR-NOTHING. Keeping the first would hand the Fabric BOM a
 * roll width that is right for one of the two panels it just added together.
 */
check(
  "two coordinates cut at different dias leave the dia unstated",
  names(
    componentWeightsForOrder([
      w({ coordinate_id: TOP, coordinate_name: "TOP", grams: 120, dia: 30 }),
      w({ coordinate_id: BOTTOM, coordinate_name: "BOTTOM", grams: 80, dia: 24 }),
    ]),
  ),
  [["FRONT BODY", 200, 2, null]],
);
refute(
  "...and it does NOT keep whichever dia came first",
  names(
    componentWeightsForOrder([
      w({ coordinate_id: TOP, coordinate_name: "TOP", grams: 120, dia: 30 }),
      w({ coordinate_id: BOTTOM, coordinate_name: "BOTTOM", grams: 80, dia: 24 }),
    ]),
  ),
  [["FRONT BODY", 200, 2, 30]],
);

// ---------------------------------------------------------------------------
// 2. The doubling, and the three other refusals
// ---------------------------------------------------------------------------

console.log("\n-- 2. what the rollup refuses --");

const doubled = componentWeightsForOrder([
  w({ layout_label: 'TSH-001 30"' }),
  w({ layout_label: 'TSH-001 24"' }),
]);

refusedSaying(
  "the same panel weighed on two markers is refused, naming both",
  doubled,
  "FRONT BODY",
  '30"',
  '24"',
);
refute(
  "...it is NOT silently added to 240 g",
  names(doubled),
  // The dia is 30 on both markers here ON PURPOSE. Written with `null` this
  // refute passed against the BROKEN engine — the doubled row came back with
  // dia 30 and the JSON simply differed. A refute that names the wrong wrong
  // answer is a vector nobody is guarded by (raagam-diff-vectors-assert-labels).
  [["FRONT BODY", 240, 2, 30]],
);

refusedSaying(
  "a panel with no weight yet is refused BY NAME, not treated as 0",
  componentWeightsForOrder([w(), w({ component_id: SLEEVE, component_name: "SLEEVE", grams: null })]),
  "SLEEVE",
);

refusedSaying(
  "a weight of 0 is refused — a panel that weighs nothing does not exist",
  componentWeightsForOrder([w({ grams: 0 })]),
  "FRONT BODY",
);

refusedSaying(
  "a coordinate is named in the refusal when there is one",
  componentWeightsForOrder([
    w({ coordinate_id: BOTTOM, coordinate_name: "BOTTOM", component_name: "SLEEVE", grams: null }),
  ]),
  "BOTTOM",
  "SLEEVE",
);

refusedSaying(
  "a row naming no component is refused",
  componentWeightsForOrder([w({ component_id: null, component_name: null })]),
  "component",
);

/*
 * AN EMPTY SHEET IS A REFUSAL, NOT AN EMPTY LIST. An empty list seeds nothing
 * and reads exactly like "this order needs no fabric" — the failure AGENTS.md
 * names under Cascading filters, where a wrong answer is indistinguishable from
 * a legitimate one.
 */
refusedSaying("a sheet with no rows at all is refused", componentWeightsForOrder([]), "No marker");
refute("...it is NOT an empty array", names(componentWeightsForOrder([])), []);

// ---------------------------------------------------------------------------
// 3. Grams -> a consumption
// ---------------------------------------------------------------------------

console.log("\n-- 3. grams into the Fabric BOM's unit --");

check("120 g is 0.12 KGS", consumptionFromGrams(120, "KGS"), 0.12);
check("12 g is 0.012 KGS", consumptionFromGrams(12, "KGS"), 0.012);
check("a lower-case unit code still resolves", consumptionFromGrams(120, "kgs"), 0.12);
check("1 g is 0.001 KGS — numeric(14,4) holds it", consumptionFromGrams(1, "KGS"), 0.001);

/*
 * THE 11% BUG. `uomPrecision` floors at 2 and every UOM in this database
 * declares 2, so rounding the consumption at the unit's own precision turns a
 * 45 g sleeve into 0.05 kg. The engine's ceiling belongs on the TOTAL
 * requirement, which is what production is short of — never on the input.
 */
check("45 g is 0.045 KGS", consumptionFromGrams(45, "KGS"), 0.045);
refute("...NOT 0.05, which is what the UOM's own 2 decimals would give", consumptionFromGrams(45, "KGS"), 0.05);

check("a fractional gram rounds UP, never down", consumptionFromGrams(45.55, "KGS"), 0.0456);

refusedSaying(
  "a length unit is refused and NAMES itself — a weight in metres means nothing",
  consumptionFromGrams(120, "MTR"),
  "MTR",
);
refute("...and it does not quietly convert as though grams were metres", consumptionFromGrams(120, "MTR"), 0.12);

refusedSaying("a count unit is refused too", consumptionFromGrams(120, "PCS"), "PCS");
refusedSaying("no unit chosen yet is refused", consumptionFromGrams(120, null), "unit");
refusedSaying("no weight is refused", consumptionFromGrams(null, "KGS"), "weight");
refusedSaying("a weight of 0 is refused", consumptionFromGrams(0, "KGS"), "more than 0");

// ---------------------------------------------------------------------------
// 4. Matching a weight to a Fabric BOM line
// ---------------------------------------------------------------------------

console.log("\n-- 4. seeding one Fabric BOM line --");

const sheet = componentWeightsForOrder([
  w({ style_ref_no: S1, component_id: FRONT, component_name: "FRONT BODY", grams: 120 }),
  w({ style_ref_no: S1, component_id: SLEEVE, component_name: "SLEEVE", grams: 45 }),
]);
if (isRefusal(sheet)) throw new Error(`fixture refused: ${sheet.refused}`);

const line = (over: Partial<SeedTargetLine> = {}): SeedTargetLine => ({
  sno: 1,
  style_ref_no: S1,
  component_id: FRONT,
  structure_id: null,
  uom_code: "KGS",
  ...over,
});

const seeded = seedConsumptionFor(line(), sheet);
check(
  "a scoped line takes its own component's weight",
  isRefusal(seeded) ? seeded.refused : [seeded.consumption, seeded.dia, seeded.from.component_name],
  [0.12, 30, "FRONT BODY"],
);

check(
  "the style match is case- and space-insensitive (styleKey, the Orders join key)",
  (() => {
    const r = seedConsumptionFor(line({ style_ref_no: " tsh-001 " }), sheet);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.12,
);

check(
  "a line covering EVERY style takes the figure when only one style is weighed",
  (() => {
    const r = seedConsumptionFor(line({ style_ref_no: null }), sheet);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.12,
);

/*
 * THE UNSCOPED-LINE TRAP. `style_ref_no` NULL means "every style on this order"
 * (0426), and a CAD weight is always for ONE style. With two weighed there is no
 * single answer, and the plausible implementation — take the first match —
 * plans the order's fabric off the wrong garment.
 */
const twoStyles = componentWeightsForOrder([
  w({ style_ref_no: S1, grams: 120 }),
  w({ style_ref_no: S2, grams: 95 }),
]);
if (isRefusal(twoStyles)) throw new Error(`fixture refused: ${twoStyles.refused}`);

const ambiguous = seedConsumptionFor(line({ style_ref_no: null }), twoStyles);
refusedSaying("an unscoped line over two weighed styles is refused, naming both", ambiguous, S1, S2);
refute(
  "...it does NOT take the first style's 0.12",
  isRefusal(ambiguous) ? ambiguous.refused : ambiguous.consumption,
  0.12,
);

refusedSaying(
  "a line naming no component cannot be seeded",
  seedConsumptionFor(line({ component_id: null }), sheet),
  "Line 1",
  "component",
);

refusedSaying(
  "a component the sheet never weighed is refused",
  seedConsumptionFor(line({ sno: 7, component_id: POCKET }), sheet),
  "Line 7",
);

refusedSaying(
  "a component weighed for another style only is refused, naming the style",
  seedConsumptionFor(line({ sno: 4, style_ref_no: S2 }), sheet),
  "Line 4",
  S2,
);

/*
 * THE LINE NUMBER TRAVELS WITH THE UNIT REFUSAL. Nine lines in metres produce
 * nine identical sentences otherwise, and the operator cannot tell which row to
 * open.
 */
refusedSaying(
  "a unit refusal carries the line number",
  seedConsumptionFor(line({ sno: 3, uom_code: "MTR" }), sheet),
  "Line 3",
  "MTR",
);

// ---------------------------------------------------------------------------
// 5. The fabric axis
// ---------------------------------------------------------------------------

console.log("\n-- 5. one panel, two fabrics --");

const yoke = componentWeightsForOrder([
  w({ fabric_category_id: JERSEY, fabric_category_name: "SINGLE JERSEY", grams: 120 }),
  w({ fabric_category_id: RIB_FABRIC, fabric_category_name: "1X1 RIB", grams: 30 }),
]);

check(
  "a FRONT BODY cut in two fabrics stays TWO panels",
  fabrics(yoke),
  [
    ["FRONT BODY", "SINGLE JERSEY", 120, 1],
    ["FRONT BODY", "1X1 RIB", 30, 1],
  ],
);
refute(
  "...it is NOT rolled into one 150 g panel",
  fabrics(yoke),
  [["FRONT BODY", "SINGLE JERSEY", 150, 2]],
);

if (isRefusal(yoke)) throw new Error(`fixture refused: ${yoke.refused}`);

check(
  "a BOM line naming the jersey structure takes the jersey weight",
  (() => {
    const r = seedConsumptionFor(line({ structure_id: JERSEY }), yoke);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.12,
);
check(
  "...and the rib line takes the rib weight",
  (() => {
    const r = seedConsumptionFor(line({ structure_id: RIB_FABRIC }), yoke);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.03,
);
refute(
  "...the rib line does NOT take the body's 0.12",
  (() => {
    const r = seedConsumptionFor(line({ structure_id: RIB_FABRIC }), yoke);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.12,
);

/*
 * THE UNSTRUCTURED LINE IS THE ONE THAT USED TO DOUBLE THE ORDER. With the
 * component weighed in two fabrics and the line naming neither, there is no
 * single answer — and the refusal has to say "set the Structure", not "scope the
 * style", because the styles already agree and sending the operator to the style
 * cell sends them to the wrong control.
 */
const noStructure = seedConsumptionFor(line({ structure_id: null }), yoke);
refusedSaying(
  "a line naming no structure over two fabrics is refused, naming both",
  noStructure,
  "SINGLE JERSEY",
  "1X1 RIB",
  "Structure",
);
refute(
  "...it does NOT take the first fabric's 0.12",
  isRefusal(noStructure) ? noStructure.refused : noStructure.consumption,
  0.12,
);

refusedSaying(
  "a line cutting a fabric the sheet never weighed is refused, naming what WAS weighed",
  seedConsumptionFor(line({ sno: 5, structure_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" }), yoke),
  "Line 5",
  "SINGLE JERSEY",
);

/*
 * A WEIGHT THAT NAMES NO FABRIC APPLIES TO THE LINE WHATEVER ITS STRUCTURE.
 * This is not laxity — it is the combo-tree fallback: that source states
 * structure in `config_lookups` and this column is a `categories` id, so a panel
 * from it carries NULL rather than a mis-cast id (the lookup-compat FK
 * mismatch). Filtering strictly would refuse every pre-0457 order.
 */
check(
  "an unstated fabric still seeds a line that names a structure",
  (() => {
    const r = seedConsumptionFor(line({ structure_id: JERSEY }), sheet);
    return isRefusal(r) ? r.refused : r.consumption;
  })(),
  0.12,
);

// ---------------------------------------------------------------------------
// 6. The two panel SOURCES — where the fabric has to survive
// ---------------------------------------------------------------------------

console.log("\n-- 6. the fabric survives the flattening --");

const PANEL_NAMES = {
  coordinates: new Map([[TOP, "TOP"]]),
  components: new Map([
    [FRONT, "FRONT BODY"],
    [SLEEVE, "SLEEVE"],
  ]),
  categories: new Map([
    [JERSEY, "SINGLE JERSEY"],
    [RIB_FABRIC, "1X1 RIB"],
  ]),
};

/** The combo tree as PostgREST nests it: components hang UNDER a structure, so
 *  the structure row is the panel's fabric. */
const comboTree = (
  structures: { structure_id: string | null; components: string[] }[],
  ref = S1,
): ComboSource => ({
  style_ref_no: ref,
  structures: structures.map((st) => ({
    structure_id: st.structure_id,
    components: st.components.map((c) => ({ coordinate_id: null, component_id: c })),
  })),
});

const panelTuples = (rows: ReturnType<typeof orderPanelRows>) =>
  rows.map((r) => [r.component_name, r.fabric_category_name]);

/*
 * THE ONE THAT WAS MISSING. `garment_order_amendment_combo_structures.
 * structure_id` is a `categories` id — 0409 repointed it off `config_lookups`,
 * and `pg_constraint` is the only place that says so. Nulling it here is
 * invisible to every other vector in this file.
 */
check(
  "a combo-tree panel keeps the fabric off its STRUCTURE row",
  panelTuples(
    orderPanelRows([], [comboTree([{ structure_id: JERSEY, components: [FRONT] }])], PANEL_NAMES),
  ),
  [["FRONT BODY", "SINGLE JERSEY"]],
);
refute(
  "...it does NOT arrive with no fabric",
  panelTuples(
    orderPanelRows([], [comboTree([{ structure_id: JERSEY, components: [FRONT] }])], PANEL_NAMES),
  ),
  [["FRONT BODY", null]],
);

check(
  "the order's own 0457 rows keep theirs too",
  panelTuples(
    orderPanelRows(
      [
        {
          style_ref_no: S1,
          coordinate_id: null,
          component_id: FRONT,
          fabric_category_id: RIB_FABRIC,
        } satisfies StyleComponentSource,
      ],
      [],
      PANEL_NAMES,
    ),
  ),
  [["FRONT BODY", "1X1 RIB"]],
);

check(
  "one panel in both sources collapses to ONE row",
  panelTuples(
    orderPanelRows(
      [{ style_ref_no: S1, coordinate_id: null, component_id: FRONT, fabric_category_id: JERSEY }],
      [comboTree([{ structure_id: JERSEY, components: [FRONT] }])],
      PANEL_NAMES,
    ),
  ),
  [["FRONT BODY", "SINGLE JERSEY"]],
);

check(
  "the SAME component under two structures stays TWO panels",
  panelTuples(
    orderPanelRows(
      [],
      [
        comboTree([
          { structure_id: JERSEY, components: [FRONT] },
          { structure_id: RIB_FABRIC, components: [FRONT] },
        ]),
      ],
      PANEL_NAMES,
    ),
  ),
  [
    ["FRONT BODY", "SINGLE JERSEY"],
    ["FRONT BODY", "1X1 RIB"],
  ],
);

check(
  "a source row with no component is dropped, not carried as a blank panel",
  orderPanelRows([], [comboTree([{ structure_id: JERSEY, components: [] }])], PANEL_NAMES).length,
  0,
);

/*
 * ## END TO END, FROM COMBO-TREE ROWS ONLY
 *
 * No 0457 rows at all — the shape of every order in the live database today.
 * Source rows -> panels -> weights -> two Fabric BOM lines. This is the vector
 * that fails when the flattening nulls the fabric, and the only one that does.
 */
const livePanels = orderPanelRows(
  [],
  [
    comboTree([
      { structure_id: JERSEY, components: [FRONT] },
      { structure_id: RIB_FABRIC, components: [FRONT] },
    ]),
  ],
  PANEL_NAMES,
);

/* The "" entry is for the BROKEN case and is what makes this section
 * diagnostic: with the fabric nulled the two panels collapse into one, and
 * without a weight for the nulled key the fixture would hand it 0 g and the
 * failure would read "weighs 0 g" — a fixture artefact, not the symptom. With
 * it, the collapsed panel weighs a real 120 g and the failure says what actually
 * goes wrong: the RIB line takes the BODY's 0.12. */
const liveGrams: Record<string, number> = { [JERSEY]: 120, [RIB_FABRIC]: 30, "": 120 };
const liveSheet = componentWeightsForOrder(
  livePanels.map((pnl) =>
    w({
      style_ref_no: pnl.style_ref_no,
      coordinate_id: pnl.coordinate_id,
      coordinate_name: pnl.coordinate_name,
      component_id: pnl.component_id,
      component_name: pnl.component_name,
      fabric_category_id: pnl.fabric_category_id,
      fabric_category_name: pnl.fabric_category_name,
      grams: liveGrams[pnl.fabric_category_id ?? ""] ?? 0,
    }),
  ),
);

/*
 * THE REFUSAL IS REPORTED, NOT CAST AWAY. An earlier draft wrote
 * `liveSheet as ComponentWeight[]`, and under the bug this section exists to
 * catch that cast turned a refusal into `weights.filter is not a function` — a
 * TypeError that aborted the run BEFORE the four end-to-end assertions, so the
 * suite failed without ever saying what was wrong. A vector that crashes is a
 * vector that has stopped explaining.
 */
const liveSeed = (structure: string) => {
  if (isRefusal(liveSheet)) return `the sheet itself refused: ${liveSheet.refused}`;
  const r = seedConsumptionFor(line({ structure_id: structure }), liveSheet);
  return isRefusal(r) ? r.refused : r.consumption;
};

check(
  "end to end, combo tree only: the two panels stay apart in the rollup",
  isRefusal(liveSheet) ? liveSheet.refused : liveSheet.length,
  2,
);

check("end to end, combo tree only: the jersey line takes 0.12", liveSeed(JERSEY), 0.12);
check("end to end, combo tree only: the rib line takes 0.03", liveSeed(RIB_FABRIC), 0.03);
refute("...neither line takes the summed 0.15", liveSeed(RIB_FABRIC), 0.15);
refute("...and nor does the jersey one", liveSeed(JERSEY), 0.15);

console.log(failed === 0 ? "\nOK — every CAD weight vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
