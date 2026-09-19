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

import { yarnShareOf, type FabricComposition, type Refusal, type YarnShade } from "./yarn-process";

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
 * NO PER-REPEAT UNIT CONVERSION ANY MORE (2026-09-15 correction — the Uom
 * picker moved OFF Repeats/Mixing Details entirely, onto the fabric LINE's
 * own `mixing_uom_id`, "already given in front" on the Fabric Lines grid).
 * The whole reason a repeat's value once needed converting was two repeats
 * of ONE yarn typed in different physical units (4cm + 2in dividing as 4/6
 * instead of the true 4/(4+5.08)) — which is now structurally impossible:
 * every repeat of a fabric group shares the SAME line-level unit, so a plain
 * ratio of raw values is already correct regardless of which unit that is
 * (cm, inch or a bare percentage all cancel out of a same-unit ratio).
 */
export function mixingDetailRows(
  repeats: readonly YdRepeatRow[],
  fabric: FabricComposition | null,
  yarnName: (id: string | null) => string,
): MixingDetailRow[] {
  const dyed = repeats.filter((r) => r.dye_type === "dyed");

  const shareValue = (r: YdRepeatRow): number | null => r.value;

  /* THE DENOMINATOR IS PER YARN, NOT PER PANEL. A fabric blending two yarns may
     dye each of them across its own set of colours, and one shared denominator
     would make each yarn's colours read as a fraction of both. */
  const totalByYarn = new Map<string, number>();
  for (const r of dyed) {
    const k = r.yarn_item_id ?? "";
    totalByYarn.set(k, (totalByYarn.get(k) ?? 0) + (shareValue(r) ?? 0));
  }

  return dyed.map((r, i) => {
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

       THE UNIT-CLASH REFUSAL IS GONE WITH THE UNIT PICKER IT DESCRIBED —
       every repeat of a fabric group now shares one line-level Uom, so two
       repeats of one yarn can no longer disagree about what unit they are in. */
    const refusal = isRefusal(share) ? share.refused : null;

    return {
      key: r.key,
      yarn_item_id: r.yarn_item_id,
      yarn_name: yarnName(r.yarn_item_id),
      dye_type: r.dye_type,
      /* "Color 1", "Color 2"… — the row's own POSITION among this fabric's
       * dyed repeats, computed here rather than trusted off `r.color_name`
       * (2026-09-15 correction, doc/order/check.md §3 + client transcript).
       * A repeat is a physical stripe position, never a real colour: the
       * SAME position holds a different actual colour per combo, which is
       * exactly why Combinations carries its own per-combo picker. Storing
       * a real name here would have this panel answer a question that is
       * Combinations' to answer, and disagree with it the moment a second
       * combo named a different colour for the same stripe. `i` is already
       * this row's 1-based rank among DYED repeats — `dyed` is the filtered,
       * order-preserving array `i` was destructured from just above. */
      color_name: `Color ${i + 1}`,
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

/** One Combinations row, as `yarnShadesFrom` needs to see it (0512 · 0560 · 0568). */
export type YdCombinationLike = {
  combo: string | null;
  /** The colours this combination puts at each stripe POSITION, in `sno`
   *  order, each carrying its own dye-house loss. */
  colors: readonly { sno: number; dyeing_loss_pct: number | null }[];
};

/**
 * THE DYED SHADES OF ONE CLOTH, ready for `yarnPurchase` (0568).
 *
 * ## IT JOINS THE TWO HALVES THAT LIVE IN DIFFERENT TABLES, ONCE
 *
 * A stripe's SHARE is on `order_fabric_bom_yd_repeats` — a feeder slot, the
 * same for every colourway. A stripe's COLOUR and that colour's dyeing LOSS are
 * on `order_fabric_bom_yd_combination_colors`, per colourway, because the same
 * slot holds GREEN on one combo and WHITE on the next (0560). Joined BY
 * POSITION, which is the only thing the two have in common and exactly how the
 * report's own Details cell already pairs them.
 *
 * ONE FUNCTION, TWO CALLERS, for this module's standing reason: the screen
 * previews `yarnPurchase` as the planner types and `writeYarns` stores what it
 * returns. Assembling the shades differently in those two places is how a
 * preview and a stored purchase weight come to disagree — the thing
 * `yarn-process.ts`'s header calls the one that must never happen.
 *
 * ## THE SHARE IS `calculated_pct`, NOT `mixing_pct`
 *
 * `calculated_pct` is a stripe's share of its own YARN and sums to 100 across
 * that yarn's dyed stripes; `mixing_pct` is its share of the CLOTH. By the time
 * `yarnPurchase` applies this, the cloth has already been divided by the blend,
 * so what is left to divide is the yarn — and dividing it by a share of the
 * cloth would shrink every shade by the blend a second time.
 *
 * On a single-yarn cloth the two are equal, which is exactly the case the
 * legacy printout captured and why the distinction has to be stated rather than
 * inferred from its numbers.
 *
 * ## A STRIPE WITH NO SHARE IS DROPPED, AND THAT REFUSES DOWNSTREAM
 *
 * `calculated_pct` is null when a yarn's repeats are all blank or all zero —
 * "not yet answered", which `mixingDetailRows` is careful to distinguish from
 * 0%. Dropping it leaves that yarn's shares short of 1, and `shadeDyeFactor`
 * refuses rather than grossing a partial split. Filling in a 0 here would make
 * the total look complete and buy short.
 *
 * ## A GREY REMAINDER IS NOT A SHADE
 *
 * `mixingDetailRows` already excludes `dye_type: 'grey'` — the undyed part of
 * the yarn goes through no dye house and loses nothing there. It is not in
 * these rows, and its share is not in the denominator.
 */
export function yarnShadesFrom(
  fabricId: string,
  repeats: readonly YdRepeatRow[],
  fabric: FabricComposition | null,
  combinations: readonly YdCombinationLike[],
  yarnName: (id: string | null) => string = () => "",
  /** YD PART (0596) — stamped on every shade so `shadeDyeFactor` grosses each
   *  part's weight by that part's stripes only. The caller passes ONE part's
   *  repeats and combinations; this does not filter them. */
  ydPart: string | null = null,
): YarnShade[] {
  const mixing = mixingDetailRows(repeats, fabric, yarnName);
  if (mixing.length === 0) return [];

  const out: YarnShade[] = [];
  for (const c of combinations) {
    const byPosition = [...c.colors].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));
    mixing.forEach((m, i) => {
      if (!m.yarn_item_id || m.calculated_pct == null) return;
      out.push({
        fabric_id: fabricId,
        yd_part: ydPart,
        yarn_id: m.yarn_item_id,
        combo: c.combo,
        share: m.calculated_pct / 100,
        /* A COLOUR THE COMBINATION NEVER NAMED LOSES NOTHING. The stripe still
           exists and still carries its share — it is the LOSS that is
           undeclared, and 0 is what undeclared means here (the column's own
           default). Skipping the row instead would short its yarn's shares and
           refuse the whole cloth over a blank percentage. */
        loss_pct: Number(byPosition[i]?.dyeing_loss_pct ?? 0),
      });
    });
  }
  return out;
}
