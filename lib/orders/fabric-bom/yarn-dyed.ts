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
  /** Why `mixing_pct` is null, in `yarnShareOf`'s own words. */
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
 */
export function mixingDetailRows(
  repeats: readonly YdRepeatRow[],
  fabric: FabricComposition | null,
  yarnName: (id: string | null) => string,
): MixingDetailRow[] {
  const dyed = repeats.filter((r) => r.dye_type === "dyed");

  /* THE DENOMINATOR IS PER YARN, NOT PER PANEL. A fabric blending two yarns may
     dye each of them across its own set of colours, and one shared denominator
     would make each yarn's colours read as a fraction of both. */
  const totalByYarn = new Map<string, number>();
  for (const r of dyed) {
    const k = r.yarn_item_id ?? "";
    totalByYarn.set(k, (totalByYarn.get(k) ?? 0) + (r.value ?? 0));
  }

  return dyed.map((r) => {
    const total = totalByYarn.get(r.yarn_item_id ?? "") ?? 0;

    /* NO DIVISION BY ZERO, AND NO 0% EITHER. A yarn whose repeats are all blank
       or all zero has not been answered yet; printing 0.00% would state that
       none of it is dyed, which is a different claim from "not yet said". */
    const calculated = r.value == null || total === 0 ? null : (r.value / total) * 100;

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
       Mixing % is honestly 0, and the operator can see which one to fix. */
    const refusal = isRefusal(share) ? share.refused : null;

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
