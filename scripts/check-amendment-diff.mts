// Verification vectors for lib/orders/amendments/diff.ts.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-amendment-diff.mts
//
// The diff is what makes a Garment Order Amendment answerable — the amendment
// restates the order, so "what changed?" only exists if it is computed. A wrong
// answer here is worse than no answer: it goes on the approval queue and into
// the audit line, and an approver signing "Price 4.50 → 4.90" is signing this
// function's output.
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted.

import {
  diffAmendment,
  summarise,
  changeCount,
  display,
  type TabDiff,
} from "../lib/orders/amendments/diff.ts";
import type { SeededAmendmentChildren } from "../lib/orders/amendments/order-seed.ts";

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

const EMPTY: SeededAmendmentChildren = {
  styles: [],
  dyeings: [],
  prints: [],
  structures: [],
  combos: [],
  priceDetails: [],
  approvalQtys: [],
  countrySizes: [],
};

const price = (
  style: string,
  type: string | null,
  p: number | string,
  unit: string | null = "PCS",
) => ({
  sno: 1,
  style_ref_no: style,
  style: style,
  article_no: "ART-1",
  price_type: type,
  unit,
  price: p as number,
});

const seed = (patch: Partial<SeededAmendmentChildren>): SeededAmendmentChildren => ({
  ...EMPTY,
  ...patch,
});

/** Just the rows of one tab, so a vector reads as the thing it is asserting. */
const tab = (d: TabDiff[], name: string) => d.find((t) => t.tab === name)!.rows;

/**
 * The kind of a tab's first row, or "(no rows)". Never indexes blindly: a
 * regression that empties a tab must be REPORTED, not thrown — a vector that
 * crashes takes every vector after it down with it, so the run says "1 problem"
 * when there might be six.
 */
const firstKind = (d: TabDiff[], name: string) => tab(d, name)[0]?.kind ?? "(no rows)";

// ---------- nothing changed ----------
check("identical documents diff to nothing", changeCount(diffAmendment(EMPTY, EMPTY)), 0);
const same1 = seed({ priceDetails: [price("TSH-001", "FOB", 4.5)] });
check("identical price rows", changeCount(diffAmendment(same1, same1)), 0);

// Every tab is still reported, so a caller can render stable badges.
//
// THE ASSERTION IS THE LIST, NOT THE COUNT, and that is a deliberate upgrade
// (2026-08-23). It used to be `.length === 12`, and the reasoning was sound —
// it is what caught 0407 adding a "Style(s) — Sizes" tab, because a child grid
// that saves but is never diffed is a change an amendment silently fails to
// report, and an approver signing off on a document whose list changed under
// them is the failure this exists to make impossible.
//
// What a COUNT cannot catch is a tab arriving under the wrong name, or two
// `diffTab` calls swapped: twelve is still twelve. Naming them fails on both,
// and it fails READABLY — the diff prints which name moved instead of "expected
// 12, actual 13". Same lesson the combo vectors record about asserting who got
// NAMED rather than how many rows came back.
//
// Still meant to be edited deliberately: add a line here only alongside the
// `diffTab` call that earned it, and in the same order `diffAmendment` returns.
check(
  "every tab is always returned, in order",
  diffAmendment(EMPTY, EMPTY).map((t) => t.tab),
  [
    "styles",
    "styleSizes",
    // 0458 — what a component is a part of. Ordered before the components for
    // the reason the schema is: it is what scopes their Coordinate cell.
    "styleCoordinates",
    // 0457 — the Style master's component list, merged into Order Info and so
    // amendable on the order for the first time.
    "styleComponents",
    "dyeings",
    "prints",
    "structures",
    "combos",
    "comboStructures",
    "prices",
    "approvalQtys",
    "quantities",
    "packTypes",
    "countrySizes",
  ],
);

// ---------- a changed value ----------
const before = seed({ priceDetails: [price("TSH-001", "FOB", 4.5)] });
const after = seed({ priceDetails: [price("TSH-001", "FOB", 4.9)] });
check("price change is one changed row", tab(diffAmendment(before, after), "prices").length, 1);
check("price change kind", firstKind(diffAmendment(before, after), "prices"), "changed");
check(
  "price change reads old → new",
  summarise(diffAmendment(before, after)),
  ["Prices · TSH-001 (FOB): Price 4.5 → 4.9"],
);

// ---------- the normalisation that stops false positives ----------
// numeric columns come back as a string from some PostgREST responses and a
// number from others; without `same()` coercing, EVERY row would read changed.
check(
  "4.50 as a string is not a change",
  changeCount(diffAmendment(seed({ priceDetails: [price("A", "FOB", 4.5)] }), seed({ priceDetails: [price("A", "FOB", "4.50")] }))),
  0,
);
// Rows saved before the CAPITALS rule are not upper-cased in the DB.
check(
  "case and padding in the style key do not split a row",
  changeCount(diffAmendment(seed({ priceDetails: [price("tsh-001 ", "FOB", 4.5)] }), seed({ priceDetails: [price("TSH-001", "FOB", 4.5)] }))),
  0,
);
check(
  "null and empty string are the same emptiness",
  changeCount(diffAmendment(seed({ priceDetails: [price("A", "FOB", 4.5, null)] }), seed({ priceDetails: [price("A", "FOB", 4.5, "")] }))),
  0,
);

// ---------- added / removed ----------
check(
  "a new style is added, not changed",
  firstKind(diffAmendment(EMPTY, seed({ priceDetails: [price("NEW-1", "FOB", 1)] })), "prices"),
  "added",
);
check(
  "a dropped style is removed",
  firstKind(diffAmendment(seed({ priceDetails: [price("OLD-1", "FOB", 1)] }), EMPTY), "prices"),
  "removed",
);
// The removed-only branch is a separate loop in diffTab — a key present before
// and absent after is never visited by the walk over `after`.
check(
  "removed rows survive when the tab empties completely",
  summarise(diffAmendment(seed({ priceDetails: [price("OLD-1", "FOB", 1)] }), EMPTY)),
  ["Prices · OLD-1 (FOB): removed"],
);

// ---------- the discriminator that keeps two prices apart ----------
// One style legitimately carries an FOB and a CMT rate. Keying on the style
// alone would read the second as a change to the first.
const twoTypes = seed({ priceDetails: [price("TSH-001", "FOB", 4.5), price("TSH-001", "CMT", 1.2)] });
check("two price types on one style are two rows", changeCount(diffAmendment(EMPTY, twoTypes)), 2);
check(
  "changing only the CMT rate leaves FOB alone",
  summarise(
    diffAmendment(twoTypes, seed({ priceDetails: [price("TSH-001", "FOB", 4.5), price("TSH-001", "CMT", 1.5)] })),
  ),
  ["Prices · TSH-001 (CMT): Price 1.2 → 1.5"],
);

// ---------- duplicates are not collapsed ----------
// Two identical rows are two rows; bucketing them by key and comparing
// pairwise is what keeps a deleted duplicate visible.
check(
  "deleting one of two identical rows is one removal",
  summarise(
    diffAmendment(
      seed({ priceDetails: [price("A", "FOB", 1), price("A", "FOB", 1)] }),
      seed({ priceDetails: [price("A", "FOB", 1)] }),
    ),
  ),
  ["Prices · A (FOB): removed"],
);

// ---------- keyless tabs report added/removed only ----------
// A dyeing IS its value, so Navy → Black is a removal and an addition, never a
// "change" — there is no stable row identity to hang a change on.
const navy = seed({
  dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_name: "NAVY", color_id: "navy-id" }],
});
const black = seed({
  dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_name: "BLACK", color_id: "black-id" }],
});
check(
  "a recoloured dyeing is remove + add",
  tab(diffAmendment(navy, black), "dyeings").map((r) => r.kind).sort(),
  ["added", "removed"],
);
// Section is part of the key: the same colour on yarn and on fabric is two rows.
check(
  "yarn and fabric dyeings of one colour do not cancel out",
  changeCount(
    diffAmendment(
      navy,
      seed({
        dyeings: [
          { sno: 1, section: "fabric", dye_type: null, color_name: "NAVY", color_id: "navy-id" },
        ],
      }),
    ),
  ),
  2,
);
// 0403: the colour is TYPED now, so the typed name has to key the row on its
// own. Without `color_name` in the key these two rows — both id-less, which is
// every row a post-0403 screen produces — would collapse into one and a
// recoloured dyeing would report NOTHING.
check(
  "a retyped colour with no card id behind it is still remove + add",
  changeCount(
    diffAmendment(
      seed({
        dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_name: "NAVY", color_id: null }],
      }),
      seed({
        dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_name: "BLACK", color_id: null }],
      }),
    ),
  ),
  2,
);

// ---------- booleans ----------
check(
  "countrywise flipping is a change",
  summarise(
    diffAmendment(
      seed({ countrySizes: [{ sno: 1, style_ref_no: "A", style: "A", article_no: null, countrywise: false }] }),
      seed({ countrySizes: [{ sno: 1, style_ref_no: "A", style: "A", article_no: null, countrywise: true }] }),
    ),
  ),
  ["Country/Sizewise · A: Countrywise No → Yes"],
);

// ---------- Quantities (0398) ----------
//
// The tab that SPLITS a style across countries, consignees and dates, so unlike
// every other tab it holds several rows per style. Its key is ref+sno for that
// reason, and these vectors are what hold that apart from the others.
const qty = (
  ref: string,
  sno: number,
  patch: Partial<SeededAmendmentChildren["quantities"][number]> = {},
) => ({
  sno,
  country_id: null,
  style_ref_no: ref,
  style_no: ref,
  consignee_id: null,
  assortment_type_id: null,
  po_qty: 1000,
  delivery_date: null,
  earlier_shipment_date: null,
  warehouse_id: null,
  discharge_port_id: null,
  ...patch,
});

check(
  "a quantity change is reported",
  summarise(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1, { po_qty: 1200 })] }))),
  ["Quantities · A: PO Qty 1000 → 1200"],
);
check(
  "an unchanged quantity is silent",
  changeCount(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1)] }))),
  0,
);
// THE REASON THE KEY CARRIES `sno`. Two rows for one style is the tab's whole
// purpose; keyed on the style alone the second would read as an edit of the
// first, and an approver would see a change nobody made.
check(
  "splitting a style into two rows is an ADD, not an edit",
  firstKind(
    diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1), qty("A", 2, { po_qty: 400 })] })),
    "quantities",
  ),
  "added",
);
check(
  "…and reports exactly one change",
  changeCount(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1), qty("A", 2)] }))),
  1,
);
check(
  "a removed quantity row is reported",
  firstKind(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [] })), "quantities"),
  "removed",
);
// A date is a plain ISO string here, and a null must not read as a change.
check(
  "null dates on both sides are not a change",
  changeCount(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1)] }))),
  0,
);
check(
  "setting a delivery date is a change",
  summarise(diffAmendment(seed({ quantities: [qty("A", 1)] }), seed({ quantities: [qty("A", 1, { delivery_date: "2026-09-30" })] }))),
  ["Quantities · A: Delivery Dt — → 2026-09-30"],
);

// ---------- Pack type(s) (0399) ----------
//
// The value IS the key, so this tab can only ever report added / removed. The
// vectors that matter are the two that would look like a "change" anywhere else.
const pack = (method: string, sno = 1) => ({ sno, pack_type: method });
const SOLID = "Solid Colour / Solid Size";
const ASSORT = "Assort Colour / Assort Size";

check(
  "adding a pack method is reported",
  summarise(diffAmendment(seed({ packTypes: [] }), seed({ packTypes: [pack(SOLID)] }))),
  [`Pack type(s) · ${SOLID}: added`],
);
check(
  "an unchanged pack method is silent",
  changeCount(diffAmendment(seed({ packTypes: [pack(SOLID)] }), seed({ packTypes: [pack(SOLID)] }))),
  0,
);
// SWAPPING A METHOD IS A REMOVE PLUS AN ADD, never a "changed". Same reading as
// a colour going Navy → Black: there is nothing about the row to edit except
// which method it is.
check(
  "swapping a method is two rows, not one change",
  changeCount(diffAmendment(seed({ packTypes: [pack(SOLID)] }), seed({ packTypes: [pack(ASSORT)] }))),
  2,
);
// RE-ORDERING IS NOT A CHANGE. `sno` is a row's position and shifts whenever an
// earlier row is deleted — the key deliberately ignores it, and this is the
// vector that holds that decision.
check(
  "re-ordering the same two methods is silent",
  changeCount(
    diffAmendment(
      seed({ packTypes: [pack(SOLID, 1), pack(ASSORT, 2)] }),
      seed({ packTypes: [pack(ASSORT, 1), pack(SOLID, 2)] }),
    ),
  ),
  0,
);
check(
  "a removed pack method is reported",
  firstKind(diffAmendment(seed({ packTypes: [pack(SOLID)] }), seed({ packTypes: [] })), "packTypes"),
  "removed",
);

// ---------- Style(s) ▸ sizes (0407) ----------
//
// The size IS the key, like a pack method, so this tab reports added / removed
// and nothing else. What is NOT like a pack method is that the key carries the
// STYLE too — and the two vectors that earn their place here are the ones that
// would pass against a size-only key while being wrong.
const size = (ref: string, sizeId: string, sno = 1) => ({
  sno,
  style_ref_no: ref,
  size_id: sizeId,
});
const M = "11111111-1111-1111-1111-111111111111";
const L = "22222222-2222-2222-2222-222222222222";

check(
  "adding a size is reported",
  firstKind(
    diffAmendment(seed({ styleSizes: [] }), seed({ styleSizes: [size("TSH-001", M)] })),
    "styleSizes",
  ),
  "added",
);
check(
  "an unchanged size list is silent",
  changeCount(
    diffAmendment(
      seed({ styleSizes: [size("TSH-001", M)] }),
      seed({ styleSizes: [size("TSH-001", M)] }),
    ),
  ),
  0,
);
// Re-sizing a line is a remove plus an add — there is nothing about the row to
// edit except which size it is. Same reading as a swapped pack method.
check(
  "swapping a size is two rows, not one change",
  changeCount(
    diffAmendment(
      seed({ styleSizes: [size("TSH-001", M)] }),
      seed({ styleSizes: [size("TSH-001", L)] }),
    ),
  ),
  2,
);
// THE ONE THAT NEEDS THE STYLE IN THE KEY, and it asserts the LABEL rather
// than the count — deliberately, because the count does not discriminate.
//
// Two styles on one PO both offering M is normal. Drop it from the first and a
// size-only key still buckets both rows together, still sees two before and one
// after, and still reports exactly one removal — so `changeCount(...) === 1`
// passes against the broken key and proves nothing. What it gets WRONG is which
// style it names: the row it reports as removed is whichever landed second in
// the bucket, so the approver is told TSH-002 lost a size it still has, while
// the style that actually lost one is not mentioned.
//
// Verified by being made to fail (key reduced to `size_id` alone → "TSH-002:
// removed") before being trusted.
check(
  "dropping a size names the style that lost it, not its neighbour",
  summarise(
    diffAmendment(
      seed({ styleSizes: [size("TSH-001", M), size("TSH-002", M)] }),
      seed({ styleSizes: [size("TSH-002", M)] }),
    ),
  ),
  ["Style(s) — Sizes · TSH-001: removed"],
);
// …and the same style listed under a differently-cased ref is the SAME style.
// `norm` matches `styleKey`; rows saved before the CAPITALS rule are lower-case
// in the database, so a case-sensitive key would report every one of them as
// removed-and-re-added the first time an order was re-saved.
check(
  "a lower-cased style ref is not a different style",
  changeCount(
    diffAmendment(
      seed({ styleSizes: [size("tsh-001 ", M)] }),
      seed({ styleSizes: [size("TSH-001", M)] }),
    ),
  ),
  0,
);
// Re-ordering is not a change: `sno` is a position and shifts whenever an
// earlier size is deleted.
check(
  "re-ordering the same two sizes is silent",
  changeCount(
    diffAmendment(
      seed({ styleSizes: [size("TSH-001", M, 1), size("TSH-001", L, 2)] }),
      seed({ styleSizes: [size("TSH-001", L, 1), size("TSH-001", M, 2)] }),
    ),
  ),
  0,
);

// ---------- Combos ▸ Structure Details (0408) ----------
//
// The tree is nested on the document and FLAT in the diff. These vectors exist
// because the flattening is where a nesting bug would hide: a structure that
// loses its combo in translation still diffs, it just diffs against the wrong
// row, and every one of these would pass on a count alone.
const comboRow = (
  ref: string,
  combo: string,
  structures: { structure_id: string; gsm?: number | null; composition_id?: string | null }[] = [],
) => ({
  sno: 1,
  style_ref_no: ref,
  style: ref,
  article_no: null,
  combo,
  combo_description: combo,
  structures: structures.map((st, i) => ({
    sno: i + 1,
    structure_id: st.structure_id,
    fabric_type: null,
    composition_id: st.composition_id ?? null,
    gsm: st.gsm ?? null,
    gsm_tolerance: null,
    item_sub_type: null,
    other_details: null,
    components: [],
  })),
});
const SJ = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RIB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// THE ONE THAT CORRECTED THE KEY (0408), and it has to be a RENAME.
//
// The obvious vector — add NAVY beside WHITE and expect one "added" — passes
// against the old style-only key too: both combos bucket together, the bucket
// goes from one row to two, and the extra row is reported as added with the
// right label. Count, kind and label all agree, so it proves nothing.
//
// A rename is where the two keys genuinely disagree. With the combo in the key
// a colourway IS its name, so WHITE becoming NAVY is one removed and one added
// — the same reading a swapped pack method and a recoloured dyeing both get.
// Keyed on the style alone the two land in one bucket and are compared field by
// field, so it reports a single "changed" row: an approver is told the
// description was edited, and never told the colourway is not the one they
// approved.
//
// Verified by being made to fail (key reduced to style|style → one changed row
// reading "Combo Description WHITE → NAVY") before being trusted.
check(
  "renaming a combo is a remove plus an add, not an edit",
  changeCount(
    diffAmendment(
      seed({ combos: [comboRow("TSH-001", "WHITE")] }),
      seed({ combos: [comboRow("TSH-001", "NAVY")] }),
    ),
  ),
  2,
);
check(
  "a second combo on the same style is an addition",
  firstKind(
    diffAmendment(
      seed({ combos: [comboRow("TSH-001", "WHITE")] }),
      seed({ combos: [comboRow("TSH-001", "WHITE"), comboRow("TSH-001", "NAVY")] }),
    ),
    "combos",
  ),
  "added",
);

// A tee is single jersey in the body and rib at the collar — the fact that
// corrected 0397. Both must survive the flattening as separate rows.
check(
  "two structures on one combo are two rows",
  changeCount(
    diffAmendment(
      seed({ combos: [comboRow("TSH-001", "WHITE")] }),
      seed({ combos: [comboRow("TSH-001", "WHITE", [{ structure_id: SJ }, { structure_id: RIB }])] }),
    ),
  ),
  2,
);

// A GSM change is a CHANGE to that fabric, not a new fabric — the structure is
// in the key and the GSM is a field, which is the whole distinction.
check(
  "a GSM change on one structure reads old → new",
  summarise(
    diffAmendment(
      seed({ combos: [comboRow("TSH-001", "WHITE", [{ structure_id: SJ, gsm: 200 }])] }),
      seed({ combos: [comboRow("TSH-001", "WHITE", [{ structure_id: SJ, gsm: 180 }])] }),
    ),
  ),
  ["Combos — Structures · TSH-001 · WHITE: GSM 200 → 180"],
);

// COMPOSITION IS STILL CALLED COMPOSITION, through three columns now: an FK to
// the `compositions` master (0408), the FABRIC that declares the blend (0430),
// and the master again (0434). Every one of those was a change of SOURCE, not
// of subject — the amendment document is read by the person who signed the
// order, and to them the composition changed.
//
// ASSERTS THE LABEL, not the count: a rename that forgot `diff.ts` would still
// produce exactly one row here, and a bucket keyed on the wrong field still
// produces one. Verified by breaking it first — relabelled "Fabric" the vector
// fails on the text, and with `composition_id` dropped from `fields` it fails
// with nothing reported at all.
check(
  "changing the composition a structure is made of reads as Composition",
  summarise(
    diffAmendment(
      seed({ combos: [comboRow("TSH-001", "WHITE", [{ structure_id: SJ, composition_id: "cmp-a" }])] }),
      seed({ combos: [comboRow("TSH-001", "WHITE", [{ structure_id: SJ, composition_id: "cmp-b" }])] }),
    ),
  ),
  ["Combos — Structures · TSH-001 · WHITE: Composition cmp-a → cmp-b"],
);

// APPROVAL QTY IS KEYED ON style + combo + SIZE (0413 · 0435), and this vector
// exists because the key was WRONG for two migrations without anything noticing.
// It was `style_ref_no` alone, from when the tab held one row per style; 0413
// split it by colour and 0435 by size, so a style now carries dozens of rows and
// every one of them landed in the same bucket.
//
// A COUNT VECTOR WOULD NOT HAVE CAUGHT IT — one changed row still reports one
// row under the broken key. What it reports is the WRONG row: an edit to RED
// shows up as a change to WHITE's line, on a document someone signs. So this
// asserts who got NAMED and what the number went from, not how many rows came
// back. Verified by breaking the key first: with `key: (r) => norm(r.style_ref_no)`
// the two changes below collapse into one line reading "0 → 7".
const approval = (
  style: string,
  combo: string | null,
  size_id: string | null,
  approval_qty: number,
) => ({
  sno: 1,
  style_ref_no: style,
  style,
  article_no: "ART-1",
  combo,
  combo_description: combo,
  size_id,
  qty: 100,
  approval_qty,
});

check(
  "two colours of one style are two approval rows, not one",
  summarise(
    diffAmendment(
      seed({
        approvalQtys: [
          approval("TSH-001", "WHITE", "size-2y", 0),
          approval("TSH-001", "RED", "size-2y", 0),
        ],
      }),
      seed({
        approvalQtys: [
          approval("TSH-001", "WHITE", "size-2y", 5),
          approval("TSH-001", "RED", "size-2y", 7),
        ],
      }),
    ),
  ),
  [
    "Approval Qty · TSH-001 · WHITE: Approval Qty 0 → 5",
    "Approval Qty · TSH-001 · RED: Approval Qty 0 → 7",
  ],
);

// THE ONE THAT ACTUALLY TESTS THE KEY, and the two above do not — which is
// worth stating, because they look like they do.
//
// `bucket` groups by key and then pairs rows WITHIN a bucket BY POSITION. So
// while the row order is identical, a style-only key still lines WHITE up with
// WHITE and RED with RED, and every edit is reported correctly. Proved by
// reverting the key to `norm(r.style_ref_no)`: the two vectors above still pass.
//
// The key earns its place the moment the rows SHIFT. Drop WHITE and the merged
// bucket pairs the surviving RED against WHITE's old row — so an untouched RED
// is reported as an edit (5 → 7) AND as removed, and the colour that actually
// went is never named. That is the Quantities spec's failure verbatim: "the
// second row looks like an edit of the first".
check(
  "dropping a colour names THAT colour and leaves the other alone",
  summarise(
    diffAmendment(
      seed({
        approvalQtys: [
          approval("TSH-001", "WHITE", "size-2y", 5),
          approval("TSH-001", "RED", "size-2y", 7),
        ],
      }),
      seed({ approvalQtys: [approval("TSH-001", "RED", "size-2y", 7)] }),
    ),
  ),
  ["Approval Qty · TSH-001 · WHITE: removed"],
);

// The same shape one level down: the SIZE has to split rows too, or dropping
// one size of a colour reads as an edit to the size beside it.
check(
  "dropping one size of a colour names that size's row, not its neighbour",
  summarise(
    diffAmendment(
      seed({
        approvalQtys: [
          approval("TSH-001", "RED", "size-2y", 5),
          approval("TSH-001", "RED", "size-14y", 9),
        ],
      }),
      seed({ approvalQtys: [approval("TSH-001", "RED", "size-14y", 9)] }),
    ),
  ),
  ["Approval Qty · TSH-001 · RED: removed"],
);

// `qty` IS DERIVED SINCE 0435 and deliberately not a diffed field: the change
// belongs to the Quantities tab, and reporting it here as well would print one
// edit twice under two headings.
check(
  "a derived quantity change is NOT reported on this tab",
  summarise(
    diffAmendment(
      seed({ approvalQtys: [approval("TSH-001", "RED", "size-2y", 5)] }),
      seed({
        approvalQtys: [
          { ...approval("TSH-001", "RED", "size-2y", 5), qty: 250 },
        ],
      }),
    ),
  ),
  [],
);

// THE ONE THAT NEEDS THE COMBO IN THE STRUCTURE KEY. The same fabric on two
// colourways is two rows; dropping it from WHITE while NAVY keeps it must name
// WHITE. Keyed on style+structure only, this names the wrong colourway.
check(
  "dropping a structure names the combo that lost it",
  summarise(
    diffAmendment(
      seed({
        combos: [
          comboRow("TSH-001", "WHITE", [{ structure_id: SJ }]),
          comboRow("TSH-001", "NAVY", [{ structure_id: SJ }]),
        ],
      }),
      seed({
        combos: [
          comboRow("TSH-001", "WHITE"),
          comboRow("TSH-001", "NAVY", [{ structure_id: SJ }]),
        ],
      }),
    ),
  ),
  ["Combos — Structures · TSH-001 · WHITE: removed"],
);

// ---------- Color/Print ▸ Structures — the Fabric Type (0415) ----------
//
// The tab reported NOTHING before 0415 (`fields: []`), which was complete while
// a structure row held only its own identity. It now carries Solid / Melange /
// Yarn Dyed / Printed, and a Type re-answered on a fabric the order already
// lists is precisely what an amendment document is for.
//
// THE FIRST TWO ASSERT THE KEY, NOT THE COUNT. Both of these produce exactly one
// row whichever way the spec is written — the distinction that matters is
// changed-vs-removed+added, and only reading the kind and the values can tell
// them apart. Verified by breaking it first: with `item_sub_type` back in the
// KEY the first vector reports "removed" + "added" and this fails; with
// `fields: []` restored it reports nothing at all and it fails the other way.
const structRow = (structure_id: string, item_sub_type: string | null) => ({
  sno: 1,
  structure_id,
  item_sub_type,
});

check(
  "re-typing a fabric is a CHANGE to it, not a different fabric",
  summarise(
    diffAmendment(
      seed({ structures: [structRow(SJ, "solid")] }),
      seed({ structures: [structRow(SJ, "printed")] }),
    ),
  ),
  ["Color/Print — Structures · Structure: Fabric Type solid → printed"],
);

check(
  "answering a blank Fabric Type is a change, not an addition",
  summarise(
    diffAmendment(
      seed({ structures: [structRow(SJ, null)] }),
      seed({ structures: [structRow(SJ, "yarn_dyed")] }),
    ),
  ),
  ["Color/Print — Structures · Structure: Fabric Type — → yarn_dyed"],
);

// A SECOND FABRIC IS STILL AN ADDITION. The field must not swallow the tab's
// original job: `structure_id` is the key, so a new structure is added even
// when it carries the same Type as the one already there.
check(
  "a second fabric of the same type is an addition",
  summarise(
    diffAmendment(
      seed({ structures: [structRow(SJ, "solid")] }),
      seed({ structures: [structRow(SJ, "solid"), structRow(RIB, "solid")] }),
    ),
  ),
  ["Color/Print — Structures · Structure: added"],
);

// AND AN UNTOUCHED TYPE IS SILENT — the guard against a field that reports on
// every save because null and "" are compared as different emptinesses.
check(
  "an unchanged Fabric Type is silent",
  summarise(
    diffAmendment(
      seed({ structures: [structRow(SJ, "melange")] }),
      seed({ structures: [structRow(SJ, "melange")] }),
    ),
  ),
  [],
);

// ---------- display never leaks a null at an approver ----------
check("display(null)", display(null), "—");
check("display(undefined)", display(undefined), "—");
check("display empty string", display(""), "—");
check("display false", display(false), "No");
check("display zero", display(0), "0");

console.log(
  failed === 0 ? "\nAll amendment-diff vectors passed." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
