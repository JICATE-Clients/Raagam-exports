/**
 * Fabric BOM ▸ [Detail] ▸ **Yarn Dyed Details** — the arithmetic (0512).
 *
 * Legacy screenshot 2615, client 2026-09-02. The overlay holds three panels and
 * only the first and third are typed:
 *
 *     Repeats      S No | Yarn | Type | Color | Uom | Value | Twisted Yarn
 *     Mixing Det.  Yarn | Type | Color | Uom | Value | Calculated % | Mixing % |
 *                  Twisted Yarn      <- THIS FILE
 *     Combinations Combo | YD Combo Name
 *
 * ## MIXING DETAILS IS DERIVED, AND THAT IS THE WHOLE DESIGN
 *
 * Same split 0493 made for Yarn Process: a figure the system can compute must
 * not be stored beside its own inputs, free to disagree with them. Every cell of
 * a Mixing Details row is either copied from a repeat or computed from one.
 *
 *     Calculated % = this repeat's value / the yarn's total DYED repeat value x 100
 *     Mixing %     = Calculated % x the yarn's blend share of the fabric
 *
 * ## THE SCREENSHOT CANNOT SEPARATE THE TWO PERCENTAGES, WHICH IS WHY THIS SAYS SO
 *
 * The captured document is a single-yarn fabric — 20'S BCI COTTON at two
 * colours, 60 and 40 — so the blend share is 1 and Value, Calculated % and
 * Mixing % all read 60.00 / 40.00. Three columns showing one number is not
 * evidence that they are one number. They diverge the moment a blend appears:
 *
 *     50/50 cotton-polyester, cotton dyed 60 NAVY / 40 WHITE
 *       Calculated %  NAVY 60      WHITE 40      (the colour split of the cotton)
 *       Mixing %      NAVY 30      WHITE 20      (their share of the CLOTH)
 *
 * `Mixing %` is the one the purchase side needs, because a dye house is given a
 * weight of cloth, not a weight of one of its yarns.
 *
 * ## IT ABSTAINS RATHER THAN ASSUMING A SHARE OF 1
 *
 * `yarnShareOf` (0493) is reused verbatim rather than re-derived here — one
 * implementation of "how much of this cloth is this yarn", read by the Yarn
 * Process tab, the budget and now this panel. It REFUSES where a fabric names
 * several yarns and none carries a `blend_pct`, and 0493 records that a null
 * `blend_pct` is the ordinary state for exactly the fabrics this overlay serves
 * (the material master hides the % column for Single Yarn and yarn-dyed
 * fabrics). So the refusal is a live path, not a defensive branch.
 *
 * A guessed share is the failure mode worth naming: it produces a Mixing % that
 * looks declared, prices a purchase, and is wrong by whatever the real blend is.
 * `mixing_pct: null` plus the refusal text is the honest answer.
 *
 * ## `Grey` IS NOT A COLOUR AND IS NOT COUNTED
 *
 * The screenshot's third repeat is `Grey | Grey | % | 0.00` — the undyed
 * remainder of the yarn, and legacy prints no Mixing Details row for it. It is
 * excluded from the denominator too: counting it would dilute every dyed
 * repeat's Calculated % by the undyed share, which is the one number on the
 * panel a dye house acts on.
 */

import { yarnShareOf, type FabricComposition, type Refusal } from "./yarn-process";

const isRefusal = (v: unknown): v is Refusal =>
  typeof v === "object" && v !== null && "refused" in v;

/**
 * PHYSICAL LENGTH UNITS `calculated_pct` KNOWS HOW TO CONVERT, IN CM PER
 * UNIT (backend calc spec, 2026-09-04, Formula 2: "the planner can enter
 * design pattern measurements in Centimetres or Inches instead of direct
 * percentages").
 *
 * Matched by `uoms.code`, uppercased — the master's own identity, never the
 * display `name` (`uomName` already exists for that). `MTR` is here even
 * though the spec names only cm/inch: it was already a selectable Uom on
 * this same Repeats panel before this change, and a stripe genuinely typed
 * in metres deserves the same conversion cm and inch get, not silent
 * exclusion for not being one of the two the spec happened to name.
 *
 * `INCH` (0532) did not exist on the `uoms` master until this feature needed
 * it — `CM` and `MTR` did.
 */
const LENGTH_CM_PER_UNIT: Record<string, number> = {
  CM: 1,
  MTR: 100,
  INCH: 2.54,
};

/** One typed row of the Repeats panel. */
export type YdRepeatRow = {
  key: string;
  sno: number;
  yarn_item_id: string | null;
  /** Legacy's Type dropdown. `grey` is the undyed remainder. */
  dye_type: "dyed" | "grey";
  color_name: string;
  uom_id: string | null;
  value: number | null;
  twisted_yarn: string;
};

/** One derived row of the Mixing Details panel. */
export type MixingDetailRow = {
  key: string;
  yarn_item_id: string | null;
  yarn_name: string;
  dye_type: "dyed" | "grey";
  color_name: string;
  uom_id: string | null;
  value: number | null;
  /** This repeat's share of its own yarn, 0-100. Null when unanswerable. */
  calculated_pct: number | null;
  /** This repeat's share of the whole cloth, 0-100. Null when the blend is
   *  unknown — see the header; never silently 100. */
  mixing_pct: number | null;
  twisted_yarn: string;
  /** Why `mixing_pct` (and sometimes `calculated_pct` with it) is null — a
   *  unit clash across this yarn's repeats, or `yarnShareOf`'s own refusal. */
  refusal: string | null;
};

/**
 * Derive the Mixing Details panel from the Repeats panel.
 *
 * `fabric` is the cloth's composition (`getBomYarnComposition`), or null when
 * the master states none — in which case every share is unknown and every row
 * says so, rather than the panel disappearing. A panel that vanishes reads as
 * "nothing to declare"; a panel of refusals reads as "the master is incomplete",
 * which is the true statement and the actionable one.
 *
 * `uomCode` RESOLVES A REPEAT'S UNIT TO A PHYSICAL LENGTH, WHEN ONE OF ITS
 * SIBLINGS NEEDS IT (Formula 2). Before this, `calculated_pct` summed every
 * repeat's raw `value` regardless of `uom_id` — correct for the ordinary case
 * (every repeat for a yarn typed in the same unit, `%` included, where the
 * unit cancels out of the ratio) and silently wrong the moment two repeats of
 * one yarn used different PHYSICAL units: 4cm + 2in would divide as 4/6 and
 * 2/6, not the true 4/(4+5.08). So a yarn's repeats convert to a common unit
 * (cm) ONLY when they genuinely mix two or more units — a single unit,
 * whatever it is, is untouched and behaves exactly as before this change.
 * Where the mix cannot be resolved (a length unit alongside `%`, or a unit
 * this file does not know), the yarn ABSTAINS — `calculated_pct`/`mixing_pct`
 * both come back `null`, the same "—" the panel already shows for a blank or
 * disagreeing value, rather than a number computed from unlike quantities.
 */
export function mixingDetailRows(
  repeats: readonly YdRepeatRow[],
  fabric: FabricComposition | null,
  yarnName: (id: string | null) => string,
  uomCode: (id: string | null) => string,
): MixingDetailRow[] {
  const dyed = repeats.filter((r) => r.dye_type === "dyed");

  /* WHICH YARNS ACTUALLY MIX UNITS, AND WHICH OF THOSE MIXES ARE RESOLVABLE.
     Single-unit yarns (the ordinary case, `%` included) are left alone —
     `codes.size <= 1` — so this changes nothing for a repeat set that already
     worked. */
  const codesByYarn = new Map<string, Set<string>>();
  for (const r of dyed) {
    if (r.value == null) continue;
    const k = r.yarn_item_id ?? "";
    if (!codesByYarn.has(k)) codesByYarn.set(k, new Set());
    codesByYarn.get(k)!.add((uomCode(r.uom_id) || "").toUpperCase());
  }
  const mixedLengthYarns = new Set<string>();
  const unresolvableMixYarns = new Set<string>();
  for (const [k, codes] of codesByYarn) {
    if (codes.size <= 1) continue;
    if ([...codes].every((c) => c in LENGTH_CM_PER_UNIT)) mixedLengthYarns.add(k);
    else unresolvableMixYarns.add(k);
  }

  /* THE NORMALIZED VALUE FOR THE RATIO — `r.value` ITSELF NEVER CHANGES. The
     panel's own "Value" column prints exactly what the planner typed; only
     the percentage math reaches for the converted figure. */
  const shareValue = (r: YdRepeatRow): number | null => {
    if (r.value == null) return null;
    const k = r.yarn_item_id ?? "";
    if (unresolvableMixYarns.has(k)) return null;
    if (!mixedLengthYarns.has(k)) return r.value;
    const factor = LENGTH_CM_PER_UNIT[(uomCode(r.uom_id) || "").toUpperCase()];
    return factor == null ? null : r.value * factor;
  };

  /* THE DENOMINATOR IS PER YARN, NOT PER PANEL. A fabric blending two yarns may
     dye each of them across its own set of colours, and one shared denominator
     would make each yarn's colours read as a fraction of both. */
  const totalByYarn = new Map<string, number>();
  for (const r of dyed) {
    const k = r.yarn_item_id ?? "";
    totalByYarn.set(k, (totalByYarn.get(k) ?? 0) + (shareValue(r) ?? 0));
  }

  return dyed.map((r) => {
    const total = totalByYarn.get(r.yarn_item_id ?? "") ?? 0;
    const value = shareValue(r);

    /* NO DIVISION BY ZERO, AND NO 0% EITHER. A yarn whose repeats are all blank
       or all zero has not been answered yet; printing 0.00% would state that
       none of it is dyed, which is a different claim from "not yet said". */
    const calculated = value == null || total === 0 ? null : (value / total) * 100;

    let share: number | Refusal;
    if (!fabric) {
      share = { refused: "This fabric states no yarn composition on the material master" };
    } else if (!r.yarn_item_id) {
      share = { refused: "Name the yarn before its share of the cloth can be worked out" };
    } else {
      share = yarnShareOf(fabric, r.yarn_item_id);
    }

    /* A SHARE OF 0 IS AN ANSWER, NOT A REFUSAL. `yarnShareOf` returns 0 for a
       yarn the fabric does not name at all — a repeat left pointing at a yarn
       the master has since dropped from the composition. The row stays, its
       Mixing % is honestly 0, and the operator can see which one to fix.

       THE UNIT CLASH GETS ITS OWN WORDS, NOT A BARE "—". Without this, a
       `%`+physical-width mix on one yarn nulled `calculated`/`mixing_pct` and
       said nothing — the exact silent-blank failure this cell was built to
       avoid for the blend-share case (see the note above it). Checked before
       the blend refusal so the operator fixes the more upstream problem
       first: a unit clash makes the SHARE unanswerable regardless of what
       `yarnShareOf` would have said. */
    const refusal = unresolvableMixYarns.has(r.yarn_item_id ?? "")
      ? "This yarn's repeats mix % with a physical width (cm/inch) — pick one measure for all of this yarn's repeats before its share can be worked out."
      : isRefusal(share)
        ? share.refused
        : null;

    return {
      key: r.key,
      yarn_item_id: r.yarn_item_id,
      yarn_name: yarnName(r.yarn_item_id),
      dye_type: r.dye_type,
      color_name: r.color_name,
      uom_id: r.uom_id,
      value: r.value,
      calculated_pct: calculated,
      mixing_pct:
        calculated == null || isRefusal(share) ? null : calculated * (share as number),
      twisted_yarn: r.twisted_yarn,
      refusal,
    };
  });
}

/**
 * One Mixing Details row, with the KILOGRAMS its colour actually needs
 * (backend calc spec, 2026-09-04, Formula 3: "Net Color Yarn Weight_i =
 * Total Fabric Consumption Weight x (P_i / 100)").
 */
export type MixingDetailWithNet = MixingDetailRow & { net_weight: number | null };

/**
 * `mixing_pct` WAS ALREADY `P_i` — this is the one multiplication Formula 3
 * adds, and nothing else, which is worth stating because it would be easy to
 * re-derive the share here a second time instead of trusting the row that
 * already answered it.
 *
 * `fabricTotalGross` IS THE OPEN FABRIC'S OWN REQUIREMENT, summed across
 * whatever colourways (order combos) it serves — NOT `yarnNetByCombo`'s
 * figure in `./yarn-process.ts`, which answers a different question ("how
 * much of yarn X, total, across every fabric on this BOM that uses it") at a
 * coarser grain (per yarn, never per individual dyed colour). This is
 * additive to that function, never a replacement: `yarnPurchase` still buys
 * against the coarser figure, and this is the dye house's own question —
 * "of THIS cloth, how many kg is each colour" — which nothing in this app
 * answered before Formula 2 made `mixing_pct` trustworthy across mixed
 * units.
 *
 * `null` PROPAGATES RATHER THAN BEING TREATED AS ZERO, on both sides: a
 * fabric with no calculated requirement yet (`fabricTotalGross` null) or a
 * colour whose share is unanswerable (`mixing_pct` null, the abstain path
 * `mixingDetailRows` already takes) both leave `net_weight` null — an
 * unanswered question, never a purchase of 0 kg standing in for one.
 */
export function colorNetWeight(
  rows: readonly MixingDetailRow[],
  fabricTotalGross: number | null,
): MixingDetailWithNet[] {
  return rows.map((r) => ({
    ...r,
    net_weight:
      fabricTotalGross == null || r.mixing_pct == null
        ? null
        : fabricTotalGross * (r.mixing_pct / 100),
  }));
}

/**
 * Does this fabric group have anything yarn-dyed to declare?
 *
 * USED ONLY TO DECIDE A HINT, NEVER TO HIDE THE PANEL. The overlay's tabs are
 * always reachable: a planner opening Yarn Dyed Details on a solid fabric is
 * asking a reasonable question and should get an empty grid with a line saying
 * why, not a missing tab they cannot tell from a broken one.
 */
export function ydRepeatsAnswered(repeats: readonly YdRepeatRow[]): boolean {
  return repeats.some((r) => r.yarn_item_id || r.color_name.trim() || r.value != null);
}
