/**
 * IWO Material BOM — the typed Planned Qty, through the ORDER Material BOM's
 * own functions, to a purchase quantity (0584).
 *
 *     npm run check:iwo-material-bom
 *
 * The IWO copy replaces ONE link of the order chain — the exploded need
 * (pieces × items × wastage) becomes a typed Planned Qty — and reuses the rest:
 * `requiredWithProcessLoss` (MULTIPLIES, the client's 2026-09-19 decision for
 * accessories), `resolveLinePack` + `toPurchaseQty`, then MOQ and Round To.
 * The refutation below pins that accessories do NOT take the fabric DIVIDE
 * rule — 100 at 5% is 105, never 106.
 */

import { isRefusal } from "../lib/orders/material-bom/requirement.ts";
import {
  iwoMbProblems,
  iwoMbQuantity,
  keptIwoMbLines,
  type IwoMbLineFacts,
} from "../lib/orders/iwo-material-bom/rules.ts";
import {
  advisedAmong,
  advisedRefusal,
  iwoCeilingRefusal,
  iwoPurchaseHint,
  type IwoPurchaseCheck,
} from "../lib/orders/iwo-material-bom/purchase-gate.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else console.log(`ok    ${label}`);
}
function refute(label: string, actual: unknown, forbidden: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else console.log(`ok    ${label}`);
}

const NOS = "u-nos";
const BOX = "u-box";
const MTR = "u-mtr";
const uoms = new Map([
  [NOS, { id: NOS, code: "NOS", decimal_places_allowed: 0 }],
  [BOX, { id: BOX, code: "BOX", decimal_places_allowed: 2 }],
  [MTR, { id: MTR, code: "MTR", decimal_places_allowed: 2 }],
]);
const LABEL = "item-label";
// "1 BOX = 144 NOS" — the order BOM's conversion shape.
const conversions = [{ id: "c-box", item_id: LABEL, alt_qty: 1, alt_uom_id: BOX, base_qty: 144, base_uom_id: NOS }];

const line = (patch: Partial<IwoMbLineFacts>): IwoMbLineFacts => ({
  category_id: null,
  item_id: LABEL,
  specification: null,
  item_color_id: null,
  consumption_uom_id: NOS,
  purchase_uom_id: null,
  uom_conversion_id: null,
  planned_qty: 100,
  moq: null,
  round_to: null,
  is_advised: false,
  send_out: false,
  is_foc: false,
  ...patch,
});
const q = (l: IwoMbLineFacts, losses: (number | null)[] = []) => {
  const r = iwoMbQuantity(l, losses.map((loss_pct) => ({ loss_pct })), uoms, conversions);
  return isRefusal(r) ? r : { required: r.required, purchase: r.purchase };
};

// §1 — typed, no loss, no pack: bought as planned.
check("§1 100 NOS, no loss, no pack = 100", q(line({})), { required: 100, purchase: 100 });

// §2 — THE CLIENT'S RULE FOR ACCESSORIES: a loss MULTIPLIES.
check("§2 100 NOS at 5% = 105 (× 1.05)", q(line({}), [5]), { required: 105, purchase: 105 });
refute("§2 …and never the fabric divide's 106", q(line({}), [5]), { required: 106, purchase: 106 });

// §3 — two losses compound, and NOS rounds UP to whole units.
check("§3 5% then 3% = 100 × 1.05 × 1.03 = 108.15 → 109 NOS", q(line({}), [5, 3]), { required: 109, purchase: 109 });

// §4 — the pack: 500 NOS in boxes of 144 = 3.47 BOX (exact, the client's
// choice), then Round To 1 → 4 BOX.
check("§4 500 NOS in boxes of 144 = 3.47 BOX", q(line({ planned_qty: 500, purchase_uom_id: BOX })), { required: 500, purchase: 3.47 });
check("§4 …Round To 1 → 4 BOX", q(line({ planned_qty: 500, purchase_uom_id: BOX, round_to: 1 })), { required: 500, purchase: 4 });

// §5 — MOQ before Round To.
check("§5 MOQ 10 BOX lifts 3.47 to 10", q(line({ planned_qty: 500, purchase_uom_id: BOX, moq: 10 })), { required: 500, purchase: 10 });

// §6 — refusals name the fix.
check(
  "§6 a purchase unit with no pack refuses by name",
  q(line({ purchase_uom_id: MTR })),
  { refused: "This material has no pack conversion from MTR to NOS — add one on the material master, or buy in NOS" },
);
check("§6 no Cons. Uom refuses", q(line({ consumption_uom_id: null })), { refused: "Choose the Cons. Uom — the unit Planned Qty is in" });
check("§6 no Planned Qty refuses", q(line({ planned_qty: null })), { refused: "Enter the Planned Qty" });
check("§6 a loss of 100% refuses (never divides by zero)", isRefusal(iwoMbQuantity(line({}), [{ loss_pct: 100 }], uoms, conversions)), true);

// §7 — the line rules.
const blank = line({ item_id: null, consumption_uom_id: null, planned_qty: null });
check("§7 a blank seeded line is dropped", keptIwoMbLines([blank]).length, 0);
check("§7 an empty BOM is refused", iwoMbProblems([blank], []).map((p) => p.message), ["Add at least one accessory."]);
check(
  "§7 a started line owes its unit and its quantity",
  iwoMbProblems([line({ consumption_uom_id: null, planned_qty: null })], []).map((p) => p.message),
  ["Line 1: choose the Cons. Uom (the unit Planned Qty is in).", "Line 1: enter the Planned Qty."],
);
check(
  "§7 a process row for a material no longer on Items is refused",
  iwoMbProblems([line({})], [{ item_id: "other", stage: null, process_id: "p", loss_pct: 5, vendor_id: null }]).map((p) => p.message),
  ["Process row 1: that material is no longer on the Items list."],
);
check(
  "§7 an Advised tick alone makes a line started (it is the operator's own entry)",
  keptIwoMbLines([{ ...blank, is_advised: true }]).length,
  1,
);

// §8 — the Advised checkpoint (0586): what a purchase order may not buy.
const iwoCheck = (over: Partial<IwoPurchaseCheck>): IwoPurchaseCheck => ({
  code: "U2/IWO/2627/0005",
  iwo_for: "accessories",
  status: "draft",
  bom: { is_draft: true },
  advised: [
    { item_id: "label", name: "BRAND MAIN LABEL" },
    { item_id: "tape", name: "TWILL TAPE" },
    // The same material on a second BOM line is named once, not twice.
    { item_id: "label", name: "BRAND MAIN LABEL" },
  ],
  lines: [],
  committed: [],
  ...over,
});
check("§8 only the PO's own materials are judged", advisedAmong(iwoCheck({}), ["label", "button", null]), ["BRAND MAIN LABEL"]);
check("§8 a material on two BOM lines is named once", advisedAmong(iwoCheck({}), ["label", "tape"]), ["BRAND MAIN LABEL", "TWILL TAPE"]);
check("§8 a PO with nothing Advised is allowed", advisedRefusal(advisedAmong(iwoCheck({}), ["button"]), "U2/IWO/2627/0005"), null);
check(
  "§8 an Advised material is refused, naming it and the work order",
  advisedRefusal(["BRAND MAIN LABEL"], "U2/IWO/2627/0005"),
  "BRAND MAIN LABEL is still Advised on work order U2/IWO/2627/0005 — the buyer has not confirmed it. Untick Is Advised on IWO Material BOM once confirmed, then raise the purchase order.",
);
check(
  "§8 more than three names three and counts the rest",
  advisedRefusal(["A", "B", "C", "D", "E"], null)?.startsWith("A, B, C and 2 more are still Advised on this work order"),
  true,
);
check(
  "§8 the form says what is held before Save",
  iwoPurchaseHint(iwoCheck({ bom: { is_draft: false } })),
  "Limited to IWO Material BOM's purchase quantities — still Advised, cannot be bought: BRAND MAIN LABEL, TWILL TAPE",
);
check(
  // REVERSED ON PURPOSE (0595, user 2026-09-19): a Fabric work order's yarn is
  // now held to its Fabric BOM — with none, nothing on it can be bought.
  "§8 a Fabric work order with no Fabric BOM says nothing can be bought",
  iwoPurchaseHint(iwoCheck({ iwo_for: "fabric", bom: null, advised: [] })),
  "This work order has no Fabric BOM yet — nothing on it can be bought",
);
check(
  "§8 a saved Fabric BOM holds yarn to its purchase weights",
  iwoPurchaseHint(iwoCheck({ iwo_for: "yarn", bom: { is_draft: false }, advised: [] })),
  "Limited to the IWO Fabric BOM's yarn purchase weights",
);
check(
  "§8 no Material BOM yet says nothing can be bought (it agrees with the ceiling)",
  iwoPurchaseHint(iwoCheck({ bom: null, advised: [] })),
  "This work order has no Material BOM yet — nothing on it can be bought",
);
refute(
  "§8 a DRAFT BOM's tick still refuses (a stop sign from the moment it is stored)",
  advisedRefusal(advisedAmong(iwoCheck({ bom: { is_draft: true } }), ["tape"]), null),
  null,
);


// §9 — the work-order ceiling (0587): refused outright, never warned.
const saved = (over: Partial<IwoPurchaseCheck>) =>
  iwoCheck({ bom: { is_draft: false }, advised: [], ...over });
const LABEL_LINE = { item_id: "label", name: "BRAND MAIN LABEL", purchase_qty: 105, uom: "NOS" };
const want = (entries: [string, number][]) => new Map(entries);
check("§9 up to the BOM's purchase quantity is allowed", iwoCeilingRefusal(saved({ lines: [LABEL_LINE] }), want([["label", 105]])), null);
check(
  "§9 one over is refused, quoting both figures and the unit",
  iwoCeilingRefusal(saved({ lines: [LABEL_LINE] }), want([["label", 106]])),
  "Purchase order quantity (106 NOS) exceeds the approved IWO Material BOM allocation (105 NOS) for BRAND MAIN LABEL on work order U2/IWO/2627/0005. Over-ordering on work orders is blocked.",
);
check(
  "§9 other POs count — 40 held + 70 here is over, and it says what room is left",
  iwoCeilingRefusal(saved({ lines: [LABEL_LINE], committed: [{ item_id: "label", qty: 40 }] }), want([["label", 70]])),
  "Purchase order quantity (70 NOS) plus 40 NOS already on other purchase orders exceeds the approved IWO Material BOM allocation (105 NOS) for BRAND MAIN LABEL on work order U2/IWO/2627/0005. This one can take at most 65 NOS. Over-ordering on work orders is blocked.",
);
check(
  "§9 …and exactly the room left passes",
  iwoCeilingRefusal(saved({ lines: [LABEL_LINE], committed: [{ item_id: "label", qty: 40 }] }), want([["label", 65]])),
  null,
);
check(
  "§9 two BOM lines of one material are summed (60 + 45 allows 105)",
  iwoCeilingRefusal(
    saved({ lines: [{ ...LABEL_LINE, purchase_qty: 60 }, { ...LABEL_LINE, purchase_qty: 45 }] }),
    want([["label", 105]]),
  ),
  null,
);
refute(
  "§9 a material the BOM does not plan is REFUSED (0 approved), not left unchecked as on an order",
  iwoCeilingRefusal(saved({ lines: [LABEL_LINE] }), want([["button", 1]])),
  null,
);
refute("§9 no Material BOM refuses", iwoCeilingRefusal(saved({ bom: null }), want([["label", 1]])), null);
refute("§9 a draft Material BOM refuses (a draft approves nothing)", iwoCeilingRefusal(saved({ bom: { is_draft: true }, lines: [LABEL_LINE] }), want([["label", 1]])), null);
refute(
  "§9 a line the BOM could not calculate refuses",
  iwoCeilingRefusal(saved({ lines: [{ ...LABEL_LINE, purchase_qty: null }] }), want([["label", 1]])),
  null,
);
refute(
  "§9 a material planned in two units refuses (the figures cannot be added)",
  iwoCeilingRefusal(saved({ lines: [LABEL_LINE, { ...LABEL_LINE, uom: "BOX" }] }), want([["label", 1]])),
  null,
);
// §9's old "a Fabric work order is not capped here" is REVERSED by §10 (0595).
check("§9 a zero-quantity line is not judged", iwoCeilingRefusal(saved({ bom: null }), want([["label", 0]])), null);
check(
  "§9 the allowance prints every decimal it has (never fmtNumber's 3)",
  iwoCeilingRefusal(saved({ lines: [{ ...LABEL_LINE, purchase_qty: 16.6667, uom: "BOX" }] }), want([["label", 17]]))?.includes("(16.6667 BOX)"),
  true,
);

// §10 — the YARN ceiling (0595, user 2026-09-19: approval "caps yarn POs"). A
// Yarn or Fabric work order is held to its IWO Fabric BOM's yarn purchase
// weights by the same rule, the BOM named in every sentence.
const YARN_LINE = { item_id: "cotton", name: "30'S COTTON", purchase_qty: 1111.112, uom: "KGS" };
const yarnSaved = (over: Partial<IwoPurchaseCheck>) => saved({ iwo_for: "yarn", lines: [YARN_LINE], ...over });
check("§10 a yarn up to its purchase weight is allowed", iwoCeilingRefusal(yarnSaved({}), want([["cotton", 1111.112]])), null);
check(
  "§10 over it is refused, naming the Fabric BOM",
  iwoCeilingRefusal(yarnSaved({}), want([["cotton", 1200]])),
  "Purchase order quantity (1,200 KGS) exceeds the approved IWO Fabric BOM allocation (1,111.112 KGS) for 30'S COTTON on work order U2/IWO/2627/0005. Over-ordering on work orders is blocked.",
);
check(
  "§10 a yarn the Fabric BOM does not buy is refused",
  iwoCeilingRefusal(yarnSaved({}), want([["lycra", 1]])),
  "This is not a yarn work order U2/IWO/2627/0005's Fabric BOM buys, so none of it is approved to buy. Plan it on IWO Fabric BOM first.",
);
check(
  "§10 a Fabric work order with no Fabric BOM refuses",
  iwoCeilingRefusal(saved({ iwo_for: "fabric", bom: null }), want([["cotton", 1]])),
  "Work order U2/IWO/2627/0005 has no Fabric BOM yet, so nothing on it is approved to buy. Plan it on IWO Fabric BOM first.",
);
check(
  "§10 a draft Fabric BOM refuses",
  iwoCeilingRefusal(yarnSaved({ bom: { is_draft: true } }), want([["cotton", 1]])),
  "Work order U2/IWO/2627/0005's Fabric BOM is still a draft, so nothing on it is approved to buy yet. Save it (not as a draft) first.",
);
check(
  "§10 other purchase orders count for yarn too",
  iwoCeilingRefusal(yarnSaved({ committed: [{ item_id: "cotton", qty: 1000 }] }), want([["cotton", 200]]))?.includes(
    "This one can take at most 111.112 KGS",
  ),
  true,
);
check(
  "§10 a yarn the BOM could not weigh refuses, naming the Fabric BOM",
  iwoCeilingRefusal(yarnSaved({ lines: [{ ...YARN_LINE, purchase_qty: null }] }), want([["cotton", 1]])),
  "The Fabric BOM for work order U2/IWO/2627/0005 could not work out a purchase quantity for 30'S COTTON. Fix that line on IWO Fabric BOM first.",
);

if (failed) {
  console.error(`\n${failed} IWO Material BOM vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Material BOM: the typed quantity reaches the order Material BOM's arithmetic intact.");
