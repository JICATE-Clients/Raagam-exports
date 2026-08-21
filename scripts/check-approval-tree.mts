/**
 * Vectors for `buildApprovalTree` / `flattenApprovalTree`
 * (`lib/orders/amendments/approval-tree.ts`) — the Approval Qty tab's rows,
 * derived rather than typed (0435).
 *
 * ## WHY THIS IS VECTORED
 *
 * The tab used to be typed and is now joined, so every row on it is the output
 * of a three-way match on (style, combo, size). A join that silently misses
 * produces a screen that looks complete — a colour with every size showing 0 is
 * indistinguishable from a colour nobody has packed yet — and the number it
 * feeds is the PRODUCTION TARGET, which the floor cuts fabric against.
 *
 * ## THE TWO THAT WOULD SURVIVE A CARELESS REWRITE
 *
 * 1. **Rows come from the COMBOS tab, not from the breakup.** Deriving them from
 *    the breakup instead is the obvious implementation and it empties the whole
 *    tab until the Quantities tab is finished — the operator sees nothing, on a
 *    tab that used to let them type. §2 pins it: a declared colour with no
 *    assortment yet must still appear, with zeros.
 *
 * 2. **A typed number whose row disappeared is an ORPHAN, never a deletion.**
 *    Rename a colour on Combos, or drop a size from a style, and the join stops
 *    matching. Discarding the value would destroy the operator's work on a
 *    document they are about to sign, and nothing on screen would say so. §5.
 *
 * Run: `npm run check:approval-tree`.
 */
import {
  approvalKey,
  uniformApproval,
  buildApprovalTree,
  flattenApprovalTree,
  type ComboIdentity,
  type StyleIdentity,
} from "../lib/orders/amendments/approval-tree.ts";

let failed = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${what}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${what}\n      expected ${e}\n      actual   ${a}`);
  }
}

const S2 = "size-2y";
const S3 = "size-3y";
const S14 = "size-14y";

const STYLE: StyleIdentity = {
  style_ref_no: "00090/2627/C",
  style: "AUGUSTIN",
  article_no: "ART-1",
  // Declared order IS the data — a size run, not alphabetical.
  sizes: [S2, S3, S14],
};

const COMBOS: ComboIdentity[] = [
  { style_ref_no: "00090/2627/C", combo: "WHITE", combo_description: "WHITE" },
  { style_ref_no: "00090/2627/C", combo: "RED", combo_description: "RED" },
];

const BREAKUP = [
  { style_ref_no: "00090/2627/C", combo: "RED", size_id: S2, qty: 100 },
  { style_ref_no: "00090/2627/C", combo: "RED", size_id: S3, qty: 100 },
  { style_ref_no: "00090/2627/C", combo: "RED", size_id: S14, qty: 200 },
];

const tree = () =>
  buildApprovalTree({ styles: [STYLE], combos: COMBOS, breakup: BREAKUP, stored: [] });

// ---------------------------------------------------------------------------
// 1. The join
// ---------------------------------------------------------------------------

check(
  "a combo's sizes carry the breakup's pieces",
  tree().styles[0].combos.find((c) => c.combo === "RED")?.sizes.map((z) => z.qty),
  [100, 100, 200],
);
check(
  "the combo total is the sum of its sizes",
  tree().styles[0].combos.find((c) => c.combo === "RED")?.qty,
  400,
);
check(
  "sizes follow the STYLE's declared order, not the breakup's",
  tree().styles[0].combos.find((c) => c.combo === "RED")?.sizes.map((z) => z.size_id),
  [S2, S3, S14],
);

// Several destinations packing the same colour and size is normal — a split
// shipment. They must ADD, not overwrite: taking the last would under-report
// the production target by everything but the final destination.
check(
  "two destinations packing the same (combo, size) are summed",
  buildApprovalTree({
    styles: [STYLE],
    combos: COMBOS,
    breakup: [
      { style_ref_no: "00090/2627/C", combo: "RED", size_id: S2, qty: 60 },
      { style_ref_no: "00090/2627/C", combo: "RED", size_id: S2, qty: 40 },
    ],
    stored: [],
  }).styles[0].combos.find((c) => c.combo === "RED")?.sizes[0].qty,
  100,
);

// ---------------------------------------------------------------------------
// 2. Rows come from COMBOS — §1 of the header
// ---------------------------------------------------------------------------

check(
  "a declared colour with no assortment yet still appears, with zeros",
  tree().styles[0].combos.find((c) => c.combo === "WHITE")?.sizes.map((z) => z.qty),
  [0, 0, 0],
);
check(
  "…and so its combo total is 0, not absent",
  tree().styles[0].combos.find((c) => c.combo === "WHITE")?.qty,
  0,
);
check(
  "a style with no colours yet is present but empty — not dropped",
  buildApprovalTree({ styles: [STYLE], combos: [], breakup: [], stored: [] })
    .styles.map((st) => st.combos.length),
  [0],
);

// ---------------------------------------------------------------------------
// 3. Matching is case- and space-insensitive on the text keys
// ---------------------------------------------------------------------------

check(
  "a lower-cased style ref and colour still match the breakup",
  buildApprovalTree({
    styles: [STYLE],
    combos: COMBOS,
    breakup: [
      { style_ref_no: " 00090/2627/c ", combo: " red ", size_id: S2, qty: 100 },
    ],
    stored: [],
  }).styles[0].combos.find((c) => c.combo === "RED")?.sizes[0].qty,
  100,
);

// ---------------------------------------------------------------------------
// 4. The typed number is looked up, not positional
// ---------------------------------------------------------------------------

const STORED = [
  { style_ref_no: "00090/2627/C", combo: "RED", size_id: S3, approval_qty: "5" },
];

check(
  "a stored approval qty lands on its own size and nowhere else",
  buildApprovalTree({ styles: [STYLE], combos: COMBOS, breakup: BREAKUP, stored: STORED })
    .styles[0].combos.find((c) => c.combo === "RED")
    ?.sizes.map((z) => z.approvalQty),
  ["", "5", ""],
);

// ---------------------------------------------------------------------------
// 5. Orphans — §2 of the header
// ---------------------------------------------------------------------------

const RENAMED = buildApprovalTree({
  styles: [STYLE],
  combos: [
    { style_ref_no: "00090/2627/C", combo: "CRIMSON", combo_description: "CRIMSON" },
  ],
  breakup: BREAKUP,
  stored: STORED,
});

check(
  "renaming a colour orphans its typed number rather than deleting it",
  RENAMED.orphans.map((o) => [o.combo, o.approval_qty]),
  [["RED", "5"]],
);
check(
  "…and the orphan is still written on save",
  flattenApprovalTree(RENAMED).filter((r) => r.combo === "RED" && r.approval_qty === 5)
    .length,
  1,
);

// A ZERO IS NOT WORK. Every untouched line is stored as 0, so counting those as
// orphans would report a warning on every order that has ever been re-shaped.
check(
  "a stored ZERO that no longer matches is not an orphan",
  buildApprovalTree({
    styles: [STYLE],
    combos: [],
    breakup: [],
    stored: [
      { style_ref_no: "00090/2627/C", combo: "RED", size_id: S3, approval_qty: "0" },
    ],
  }).orphans.length,
  0,
);

// A legacy seeded row carries neither colour nor size and matches nothing. It
// must not be reported as an orphan unless it actually holds a number.
check(
  "a legacy row with no colour, no size and no number is not an orphan",
  buildApprovalTree({
    styles: [STYLE],
    combos: COMBOS,
    breakup: BREAKUP,
    stored: [
      { style_ref_no: "00090/2627/C", combo: "", size_id: null, approval_qty: "" },
    ],
  }).orphans.length,
  0,
);

// ---------------------------------------------------------------------------
// 6. A size the breakup names but the style does not
// ---------------------------------------------------------------------------

// Appended, never dropped: it is real pieces, and hiding it would make the combo
// total disagree with the sizes printed beneath it — a total nobody can add up.
const EXTRA = buildApprovalTree({
  styles: [{ ...STYLE, sizes: [S2] }],
  combos: COMBOS,
  breakup: BREAKUP,
  stored: [],
}).styles[0].combos.find((c) => c.combo === "RED");

check("a size only the breakup names is appended", EXTRA?.sizes.map((z) => z.size_id), [
  S2,
  S3,
  S14,
]);
check("…so the combo total still equals its sizes", EXTRA?.qty, 400);

// ---------------------------------------------------------------------------
// 7. The payload
// ---------------------------------------------------------------------------

check(
  "every derived line is written, not only the ones typed into",
  flattenApprovalTree(tree()).length,
  6, // 2 colours x 3 sizes
);
check(
  "the flattened row carries the derived qty as its snapshot",
  flattenApprovalTree(tree())
    .filter((r) => r.combo === "RED")
    .map((r) => r.qty),
  [100, 100, 200],
);

check("the key joins the three axes", approvalKey(" a ", " b ", "c"), "A|B|c");
check("a null size is its own key, not the string null", approvalKey("a", "b", null), "A|B|");

// -- 7. ONE ANSWER FOR A WHOLE COLOUR ---------------------------------------
//
// The tab asks per COLOUR and stores per SIZE (client 2026-08-21): the legacy
// screen made the operator type the same figure once per size, and its own data
// shows it -- every colour reading `2, 2, 2, 2, 2, 2` (screenshot 2443).
// `uniformApproval` is what lets one box stand for six stored values, and it
// has to REFUSE the moment they disagree: a box showing a figure that is not
// what is saved would have the next keystroke overwrite five real answers.
check("all the same is one answer", uniformApproval(["2", "2", "2"]), "2");
check("one size differing is mixed", uniformApproval(["2", "2", "3"]), null);
check("all untouched is one answer, and it is blank", uniformApproval(["", "", ""]), "");
check("surrounding space does not make it mixed", uniformApproval([" 2", "2 ", "2"]), "2");
check("a single size is trivially uniform", uniformApproval(["7"]), "7");
// NOTHING TO BE UNIFORM ABOUT. A colour with no sizes has no answer to show,
// and its caller says so in words rather than drawing an empty box.
check("no sizes at all is not an answer", uniformApproval([]), null);

// BLANK IS NOT ZERO, and this pair is what the function exists for. An
// untouched size holds "" and a size deliberately set to nought holds "0".
// Comparing with Number() would call these uniform, the box would show 0, and
// an operator tabbing through would write a zero over a size nobody had
// answered -- an approval quantity the floor then cuts fabric against.
check("blank beside zero is mixed, never zero", uniformApproval(["", "0"]), null);
check("all explicit zeros is a real answer", uniformApproval(["0", "0"]), "0");
// Numerically equal, textually not. Mixed is the honest answer: open the sizes
// and show what is stored rather than normalise a value nobody retyped.
check("a leading zero reads as mixed", uniformApproval(["02", "2"]), null);

console.log(
  failed === 0 ? "\nOK — every approval-tree vector holds." : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
