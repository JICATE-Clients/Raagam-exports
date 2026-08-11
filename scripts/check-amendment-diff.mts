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
check("all ten tabs are always returned", diffAmendment(EMPTY, EMPTY).length, 10);

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
const navy = seed({ dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_id: "navy-id" }] });
const black = seed({ dyeings: [{ sno: 1, section: "yarn", dye_type: null, color_id: "black-id" }] });
check(
  "a recoloured dyeing is remove + add",
  tab(diffAmendment(navy, black), "dyeings").map((r) => r.kind).sort(),
  ["added", "removed"],
);
// Section is part of the key: the same colour on yarn and on fabric is two rows.
check(
  "yarn and fabric dyeings of one colour do not cancel out",
  changeCount(
    diffAmendment(navy, seed({ dyeings: [{ sno: 1, section: "fabric", dye_type: null, color_id: "navy-id" }] })),
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
