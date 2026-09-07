/**
 * Vectors for `lib/orders/fabric-bom/yarn-dyed.ts` — Fabric BOM ▸ [Detail] ▸
 * Yarn Dyed Details, the Mixing Details panel (0512).
 *
 * ## WHY THIS SCRIPT EXISTS AT ALL
 *
 * The only capture of this panel (client screenshot 2615) is a SINGLE-YARN
 * fabric, where the blend share is 1 and all three of Value, Calculated % and
 * Mixing % read the same pair of numbers — 60.00 and 40.00. Three columns
 * showing one number is not evidence that they are one number, and an
 * implementation that simply copies Value into all three passes the screenshot
 * perfectly. Section 2 is that implementation's refutation, and it is the whole
 * reason the file was written with `yarnShareOf` in it.
 *
 * ## THE FOUR FAILURE MODES PINNED HERE
 *
 * 1. The screenshot itself, reproduced exactly — so a future edit that breaks
 *    the captured document fails loudly.
 * 2. A BLEND, where Calculated % and Mixing % genuinely diverge. Refutes the
 *    copy-Value implementation and the treat-share-as-1 implementation.
 * 3. An UNDECLARED blend refuses rather than assuming 100%. This is the
 *    expensive one: a share silently taken as 1 prices a dye-house purchase off
 *    a number nobody stated, and it looks exactly like a declared figure.
 * 4. `Grey` is excluded from the panel AND from the denominator. Counting the
 *    undyed remainder dilutes every dyed repeat — 60/(60+40+0) is right and
 *    60/(60+40+50) is not, and both look plausible.
 *
 * Run: npm run check:yarn-dyed
 */

import {
  colorNetWeight,
  mixingDetailRows,
  type YdRepeatRow,
} from "../lib/orders/fabric-bom/yarn-dyed";
import type { FabricComposition } from "../lib/orders/fabric-bom/yarn-process";

let failures = 0;

function eq(what: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok   ${what} = ${g}`);
  } else {
    failures++;
    console.log(`  FAIL ${what}\n         got  ${g}\n         want ${w}`);
  }
}

const near = (v: number | null, want: number | null) =>
  v == null || want == null ? v === want : Math.abs(v - want) < 1e-9;

function eqNum(what: string, got: number | null, want: number | null) {
  if (near(got, want)) {
    console.log(`  ok   ${what} = ${got}`);
  } else {
    failures++;
    console.log(`  FAIL ${what}\n         got  ${got}\n         want ${want}`);
  }
}

const repeat = (p: Partial<YdRepeatRow> & { key: string }): YdRepeatRow => ({
  sno: 1,
  yarn_item_id: null,
  dye_type: "dyed",
  color_name: "",
  uom_id: null,
  value: null,
  twisted_yarn: "",
  ...p,
});

const names = (id: string | null) => (id ? `YARN ${id}` : "");

/** Every existing call below passes `null` uom ids, so `codes` answers ""
 *  for them — same as an unset Uom field — leaving sections 1-5 exercising
 *  the untouched single-unit path. Sections 6-7 use real ids. */
const UOM_CODES: Record<string, string> = { u_cm: "CM", u_in: "INCH", u_pct: "%", u_mtr: "MTR" };
const codes = (id: string | null) => (id ? (UOM_CODES[id] ?? "") : "");

// ---------------------------------------------------------------------------
console.log("\n1. The captured document (screenshot 2615) — one yarn, 60 / 40 / grey");
// ---------------------------------------------------------------------------
{
  const cotton: FabricComposition = {
    fabric_id: "F1",
    fabric_name: "YARN DYED SINGLE JERSEY",
    // Single Yarn: one component, no percentage. `yarnShareOf` reads this as
    // the whole cloth — the branch 0493 wrote for exactly this shape.
    components: [{ yarn_id: "C", blend_pct: null }],
  };
  const rows = mixingDetailRows(
    [
      repeat({ key: "1", sno: 1, yarn_item_id: "C", color_name: "COLOR 01", value: 60 }),
      repeat({ key: "2", sno: 2, yarn_item_id: "C", color_name: "COLOR 02", value: 40 }),
      repeat({ key: "3", sno: 3, yarn_item_id: "C", dye_type: "grey", color_name: "GREY", value: 0 }),
    ],
    cotton,
    names,
    codes,
  );

  eq("row count (the Grey repeat draws no row)", rows.length, 2);
  eq("colours", rows.map((r) => r.color_name), ["COLOR 01", "COLOR 02"]);
  eqNum("COLOR 01 Calculated %", rows[0].calculated_pct, 60);
  eqNum("COLOR 01 Mixing %", rows[0].mixing_pct, 60);
  eqNum("COLOR 02 Calculated %", rows[1].calculated_pct, 40);
  eqNum("COLOR 02 Mixing %", rows[1].mixing_pct, 40);
  eq("no refusals", rows.map((r) => r.refusal), [null, null]);
}

// ---------------------------------------------------------------------------
console.log("\n2. A BLEND — where Calculated % and Mixing % part company");
console.log("   50/50 cotton-polyester; the cotton is dyed 60 NAVY / 40 WHITE.");
// ---------------------------------------------------------------------------
{
  const blend: FabricComposition = {
    fabric_id: "F2",
    fabric_name: "YARN DYED PC JERSEY",
    components: [
      { yarn_id: "C", blend_pct: 50 },
      { yarn_id: "P", blend_pct: 50 },
    ],
  };
  const rows = mixingDetailRows(
    [
      repeat({ key: "1", yarn_item_id: "C", color_name: "NAVY", value: 60 }),
      repeat({ key: "2", yarn_item_id: "C", color_name: "WHITE", value: 40 }),
    ],
    blend,
    names,
    codes,
  );

  // The colour split WITHIN the cotton is unchanged by the blend...
  eqNum("NAVY Calculated %", rows[0].calculated_pct, 60);
  eqNum("WHITE Calculated %", rows[1].calculated_pct, 40);

  // ...but its share of the CLOTH is halved. REFUTES the implementation that
  // copies Value into every column (which would give 60 / 40) and the one that
  // treats the share as 1 (same answer, different bug).
  eqNum("NAVY Mixing % — NOT 60", rows[0].mixing_pct, 30);
  eqNum("WHITE Mixing % — NOT 40", rows[1].mixing_pct, 20);

  // And the two dyed colours of one yarn account for that yarn's whole share.
  eqNum(
    "Mixing % sums to the cotton's 50% of the cloth",
    (rows[0].mixing_pct ?? 0) + (rows[1].mixing_pct ?? 0),
    50,
  );
}

// ---------------------------------------------------------------------------
console.log("\n3. An UNDECLARED blend REFUSES — it does not quietly assume 100%");
// ---------------------------------------------------------------------------
{
  const undeclared: FabricComposition = {
    fabric_id: "F3",
    fabric_name: "YARN DYED STRIPE",
    // Two yarns, neither carrying a percentage — 11 of the 18 live mixing rows
    // are in this state (0493), so this is the ordinary case, not a corner.
    components: [
      { yarn_id: "A", blend_pct: null },
      { yarn_id: "B", blend_pct: null },
    ],
  };
  const rows = mixingDetailRows(
    [repeat({ key: "1", yarn_item_id: "A", color_name: "RED", value: 100 })],
    undeclared,
    names,
    codes,
  );

  eqNum("Calculated % is still answerable", rows[0].calculated_pct, 100);
  eqNum("Mixing % ABSTAINS — refutes 100", rows[0].mixing_pct, null);
  eq("and says why", typeof rows[0].refusal === "string" && rows[0].refusal.length > 0, true);
}

// ---------------------------------------------------------------------------
console.log("\n4. `Grey` is out of the DENOMINATOR, not merely out of the panel");
// ---------------------------------------------------------------------------
{
  const cotton: FabricComposition = {
    fabric_id: "F4",
    fabric_name: "YARN DYED SINGLE JERSEY",
    components: [{ yarn_id: "C", blend_pct: null }],
  };
  const rows = mixingDetailRows(
    [
      repeat({ key: "1", yarn_item_id: "C", color_name: "NAVY", value: 60 }),
      repeat({ key: "2", yarn_item_id: "C", color_name: "WHITE", value: 40 }),
      // A LARGE grey remainder. If it were counted the answers would be
      // 60/150 = 40% and 40/150 = 26.67% — both entirely plausible on screen.
      repeat({ key: "3", yarn_item_id: "C", dye_type: "grey", color_name: "GREY", value: 50 }),
    ],
    cotton,
    names,
    codes,
  );

  eq("still two rows", rows.length, 2);
  eqNum("NAVY Calculated % — 60/100, NOT 60/150", rows[0].calculated_pct, 60);
  eqNum("WHITE Calculated % — 40/100, NOT 40/150", rows[1].calculated_pct, 40);
}

// ---------------------------------------------------------------------------
console.log("\n5. An unanswered yarn prints nothing, not 0%");
// ---------------------------------------------------------------------------
{
  const cotton: FabricComposition = {
    fabric_id: "F5",
    fabric_name: "YARN DYED SINGLE JERSEY",
    components: [{ yarn_id: "C", blend_pct: null }],
  };
  const rows = mixingDetailRows(
    [repeat({ key: "1", yarn_item_id: "C", color_name: "NAVY", value: null })],
    cotton,
    names,
    codes,
  );
  eqNum("Calculated % of a blank value", rows[0].calculated_pct, null);
  eqNum("Mixing % of a blank value", rows[0].mixing_pct, null);
}

// ---------------------------------------------------------------------------
console.log("\n6. STRIPE WIDTHS IN cm AND inch CONVERT BEFORE THEY DIVIDE (Formula 2)");
console.log("   4cm + 2in — the spec's own worked example is 4cm + 2cm = 66.67/33.33;");
console.log("   this is the SAME ratio in different units: 4cm + 5.08cm.");
// ---------------------------------------------------------------------------
{
  const cotton: FabricComposition = {
    fabric_id: "F6",
    fabric_name: "YARN DYED STRIPE",
    components: [{ yarn_id: "C", blend_pct: null }],
  };
  const rows = mixingDetailRows(
    [
      repeat({ key: "1", yarn_item_id: "C", color_name: "GREEN", uom_id: "u_cm", value: 4 }),
      repeat({ key: "2", yarn_item_id: "C", color_name: "RED", uom_id: "u_in", value: 2 }),
    ],
    cotton,
    names,
    codes,
  );

  // 4 / (4 + 2*2.54) = 4 / 9.08 = 44.05...%; refutes the pre-fix reading of
  // 4 / (4+2) = 66.67%, which is what an implementation still summing raw
  // values regardless of unit would print.
  eqNum("GREEN Calculated % — unit-converted, NOT 66.67", rows[0].calculated_pct, (4 / 9.08) * 100);
  eqNum("RED Calculated % — unit-converted, NOT 33.33", rows[1].calculated_pct, (5.08 / 9.08) * 100);
  eq("neither the typed Value nor the Uom is rewritten", [rows[0].value, rows[1].value], [4, 2]);
}

// ---------------------------------------------------------------------------
console.log("\n7. A LENGTH UNIT MIXED WITH % ABSTAINS — it does not guess");
// ---------------------------------------------------------------------------
{
  const cotton: FabricComposition = {
    fabric_id: "F7",
    fabric_name: "YARN DYED STRIPE",
    components: [{ yarn_id: "C", blend_pct: null }],
  };
  const rows = mixingDetailRows(
    [
      repeat({ key: "1", yarn_item_id: "C", color_name: "GREEN", uom_id: "u_cm", value: 4 }),
      repeat({ key: "2", yarn_item_id: "C", color_name: "RED", uom_id: "u_pct", value: 40 }),
    ],
    cotton,
    names,
    codes,
  );

  eqNum("cm mixed with % — GREEN abstains rather than reading 4/44", rows[0].calculated_pct, null);
  eqNum("cm mixed with % — RED abstains too", rows[1].calculated_pct, null);
  // THE ABSTENTION SAYS WHY, the same rule Section 3's blend refusal already
  // holds to — a null with nothing beside it is indistinguishable on screen
  // from "nothing to declare" (the Mixing % cell's own note).
  eq("...and both rows say why, not just a blank —", [rows[0].refusal === null, rows[1].refusal === null], [false, false]);
}

// ---------------------------------------------------------------------------
console.log("\n8. NET WEIGHT PER COLOUR (Formula 3) — mixing_pct x the fabric's own gross");
console.log("   50/50 cotton-polyester, cotton dyed 60 NAVY / 40 WHITE, 1,000 kg of cloth.");
// ---------------------------------------------------------------------------
{
  const blend: FabricComposition = {
    fabric_id: "F8",
    fabric_name: "YARN DYED PC JERSEY",
    components: [
      { yarn_id: "C", blend_pct: 50 },
      { yarn_id: "P", blend_pct: 50 },
    ],
  };
  const mixing = mixingDetailRows(
    [
      repeat({ key: "1", yarn_item_id: "C", color_name: "NAVY", value: 60 }),
      repeat({ key: "2", yarn_item_id: "C", color_name: "WHITE", value: 40 }),
    ],
    blend,
    names,
    codes,
  );
  const withNet = colorNetWeight(mixing, 1000);

  // Mixing % is 30/20 (the cotton's colour split, halved for the blend share)
  // — Net Wt multiplies that straight onto the cloth's own 1,000 kg.
  eqNum("NAVY Net Wt — 30% of 1,000 kg", withNet[0].net_weight, 300);
  eqNum("WHITE Net Wt — 20% of 1,000 kg", withNet[1].net_weight, 200);

  const noRequirement = colorNetWeight(mixing, null);
  eqNum("no fabric requirement yet — Net Wt abstains, NOT 0", noRequirement[0].net_weight, null);

  const undeclared: FabricComposition = {
    fabric_id: "F9",
    fabric_name: "YARN DYED STRIPE",
    components: [
      { yarn_id: "A", blend_pct: null },
      { yarn_id: "B", blend_pct: null },
    ],
  };
  const refused = colorNetWeight(
    mixingDetailRows(
      [repeat({ key: "1", yarn_item_id: "A", color_name: "RED", value: 100 })],
      undeclared,
      names,
      codes,
    ),
    1000,
  );
  eqNum(
    "an unresolvable blend share still refuses — Net Wt abstains too, NOT 1000",
    refused[0].net_weight,
    null,
  );
}

console.log(
  failures === 0
    ? "\nAll yarn-dyed vectors pass.\n"
    : `\n${failures} yarn-dyed vector(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
