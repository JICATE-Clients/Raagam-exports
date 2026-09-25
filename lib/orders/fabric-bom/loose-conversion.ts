/**
 * LOOSE FABRIC CONVERSION (0633) — a yarn that is not bought dyed, but made by
 * knitting greige yarn into a temporary "loose fabric", dyeing it in the same
 * vessel as the body cloth (so the shades match exactly), and unravelling it
 * back into dyed yarn cones for the collar / cuff / stripe knitting.
 *
 * Spec: "Loose Fabric Conversion Workflow" (user, 2026-09-25). Storage and the
 * reasons for it are in `supabase/migrations/0633_loose_fabric_conversion.sql`.
 * Client-safe on purpose, for `yarn-process.ts`'s reason: the screen's preview
 * and the save path call THIS, so the figure shown and the figure stored are
 * one computation.
 *
 * ## HOW IT PLUGS INTO THE YARN ENGINE — NO SECOND FORMULA
 *
 * The spec's four equations are exactly what `yarnPurchase` already does to a
 * fabric, read backwards through its route:
 *
 *     converted yarn  = what the yarn-dyed cloths need          (target)
 *     dyed loose      = target      / (1 - unravelling loss)    ┐ the loose
 *     greige loose    = dyed loose  / (1 - dyeing loss)         │ fabric's own
 *     greige yarn     = greige loose/ (1 - knitting loss)       ┘ route
 *
 * So the loose fabric is treated as ONE MORE FABRIC whose required weight is
 * the target, grossed by its own route (KNITTING → DYEING → CONVERSION, the
 * three steps the screen injects), and shared out to its yarns by its blend.
 * That is also what gives the spec's CONSOLIDATION for free: the greige yarn
 * row is derived per yarn ITEM, so the loose fabric's demand and the body
 * cloth's demand for the same greige count land on the same row and the same
 * purchase figure — one Greige Yarn PO.
 *
 * ## WHICH DEMAND IS CONVERTED — THE YARN-DYED CLOTHS', AND ONLY THEIRS
 *
 * The converted yarn feeds yarn-dyed knitting (spec step 5: collars, cuffs,
 * stripes). A piece-dyed body knitted from the SAME count still needs greige
 * yarn — and in the spec's own premise it IS the same count ("one lot of
 * greige yarn for both body and loose fabric"). A yarn row is one per yarn
 * ITEM, so converting the whole row would unravel the body's greige too. The
 * split is by the cloth's own fabric type (`FabricComposition.yarn_dyed`, off
 * `items.fabric_type_id` server-side): yarn-dyed cloths' share is converted,
 * every other cloth's share is still bought.
 *
 * ## THE UNRAVELLING LOSS LIVES ON THE LOOSE FABRIC'S ROUTE, ONCE
 *
 * The CONVERSION step on the yarn only NAMES the source. Its loss is not
 * applied on the yarn side (`withoutConversionSteps`), because the loose
 * fabric's route carries the same step with the same loss, and applying both
 * would divide by (1 - L) twice.
 */

import { isRefusal, type Refusal } from "./requirement";
import { sourceBuysYarn, type FabricSource } from "./fabric-source";
import {
  comboUplift,
  yarnPurchase,
  type FabricComposition,
  type FabricGross,
  type RouteStage,
  type YarnComboWeight,
  type YarnFabricWeight,
  type YarnShade,
} from "./yarn-process";

/** A yarn's conversion link, off its CONVERSION step (`source_loose_fabric_id`).
 *  `null` = the step is there and no loose fabric is picked yet. */
export type ConversionLinks = ReadonlyMap<string, string | null>;

/**
 * Which yarns convert, and from which loose fabric — off the yarn steps.
 *
 * `isUnravelling` IS THE MASTER'S FLAG, never a name test: the screen passes
 * its loaded options, the server reads `processes.is_unravelling` itself.
 * The FIRST conversion step of a yarn wins; a second is refused by
 * `conversionStepProblems`, never silently merged.
 */
export function conversionLinksOf(
  yarns: readonly {
    item_id: string;
    stages: readonly { process_id?: string | null; source_loose_fabric_id?: string | null }[];
  }[],
  isUnravelling: (processId: string) => boolean,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const y of yarns) {
    const step = y.stages.find((st) => !!st.process_id && isUnravelling(st.process_id));
    if (step) out.set(y.item_id, step.source_loose_fabric_id ?? null);
  }
  return out;
}

/** The loose fabrics a document's yarns name — each needs a route and a
 *  composition, so both sides fold these into their fabric sets. */
export function linkedLooseFabricIds(links: ConversionLinks): string[] {
  return [...new Set([...links.values()].filter((id): id is string => !!id))];
}

/** Steps as `yarnPurchase` reads them, less the CONVERSION step — see the
 *  header, "THE UNRAVELLING LOSS LIVES ON THE LOOSE FABRIC'S ROUTE, ONCE". */
export function withoutConversionSteps<T extends { process_id?: string | null }>(
  steps: readonly T[],
  isUnravelling: (processId: string) => boolean,
): T[] {
  return steps.filter((st) => !st.process_id || !isUnravelling(st.process_id));
}

/** One converting yarn's answer. `qty` is the dyed yarn the unravelling must
 *  DELIVER — the CONVERSION step's `process_qty`. */
export type ConvertedYarn = {
  loose_fabric_id: string;
  qty: number;
  uom_id: string | null;
  byCombo: YarnComboWeight[];
  /** Which yarn-dyed cloths it feeds — dropped from the yarn's purchase. */
  fabricIds: string[];
  /** Greige loose fabric to KNIT — the target grossed by every step of the
   *  loose fabric's route except knitting. `null` when the route refuses. */
  looseKnitQty: number | null;
};

export type ConversionPlan = {
  converted: Map<string, ConvertedYarn | Refusal>;
  /** The loose fabrics' required weight, per colourway, as ordinary fabric
   *  slices — appended to every yarn's `fabrics` by `yarnPurchaseWithConversion`. */
  looseDemand: FabricGross[];
};

export type ConversionInput = {
  links: ConversionLinks;
  /** The BOM's own cloth slices — never including the loose fabrics. */
  fabrics: readonly FabricGross[];
  /** Must include the loose fabrics' compositions. */
  compositions: ReadonlyMap<string, FabricComposition>;
  /** Must include the loose fabrics' routes. */
  routesByFabric: ReadonlyMap<string, readonly RouteStage[]>;
  decimals: number | null;
  sourceByFabric?: ReadonlyMap<string, FabricSource>;
  /** For the refusal sentences; falls back to a generic noun. */
  nameOf?: (itemId: string) => string | null | undefined;
};

export function planConversions(input: ConversionInput): ConversionPlan {
  const converted = new Map<string, ConvertedYarn | Refusal>();
  const looseDemand: FabricGross[] = [];
  const sources = input.sourceByFabric ?? new Map<string, FabricSource>();
  const cutFabricIds = new Set(input.fabrics.map((f) => f.fabric_id));
  const nameOf = (id: string, fallback: string) => input.nameOf?.(id) || fallback;

  for (const [yarnId, looseId] of input.links) {
    if (!looseId) {
      converted.set(yarnId, {
        refused: "Pick the Source Loose Fabric on this yarn's CONVERSION step",
      });
      continue;
    }
    const loose = input.compositions.get(looseId);
    /* The composition already carries the cloth's name; the caller's lookup
       wins only where it has one (a loose fabric with no mixing has no
       composition to name it). */
    const looseName = nameOf(looseId, loose?.fabric_name || "The source loose fabric");
    if (!loose || loose.components.length === 0) {
      converted.set(yarnId, {
        refused:
          `${looseName} has no yarn mixing on the material master, so the greige yarn ` +
          "to knit it cannot be worked out — enter its Mixing on Master Data ▸ Materials",
      });
      continue;
    }
    if (loose.yarn_dyed) {
      converted.set(yarnId, {
        refused:
          `${looseName} is a yarn-dyed fabric. A loose fabric is knitted from GREIGE yarn and ` +
          "piece-dyed with the body — pick a greige fabric as the source",
      });
      continue;
    }
    if (cutFabricIds.has(looseId)) {
      converted.set(yarnId, {
        refused:
          `${looseName} is also cut for this garment on Manual. A loose fabric is unravelled, ` +
          "never cut — give the loose fabric its own fabric item",
      });
      continue;
    }
    /* A LOOSE FABRIC KNITTED FROM THE VERY COUNT IT BECOMES IS THE COMMON CASE
       AND IS NOT A CYCLE: its demand is greige (bought), and the loose fabric
       is not yarn-dyed, so it never feeds the converted half below. */

    /* THE YARN-DYED CLOTHS THIS YARN IS KNITTED INTO — the only demand the
       unravelling serves. Bought-as-cloth fabrics buy no yarn at all. */
    const feeds = input.fabrics.filter((f) => {
      const comp = input.compositions.get(f.fabric_id);
      return (
        !!comp?.yarn_dyed &&
        comp.components.some((c) => c.yarn_id === yarnId) &&
        sourceBuysYarn(sources.get(f.fabric_id) ?? "yarn_knit")
      );
    });
    if (feeds.length === 0) {
      converted.set(yarnId, {
        refused:
          "No yarn-dyed fabric on this BOM is knitted from this yarn, so nothing needs " +
          "converted dyed yarn — a conversion feeds yarn-dyed collars, cuffs and stripes " +
          "(check the fabric's Type on the material master)",
      });
      continue;
    }

    /* THE TARGET: the yarn-dyed cloths' own routes only. No yarn steps (the
       conversion replaces the yarn's dyeing) and no stripe shades (their dye
       loss is the loose fabric's DYEING step now). */
    const target = yarnPurchase(
      yarnId,
      feeds,
      input.compositions,
      input.routesByFabric,
      [],
      input.decimals,
      sources,
      [],
    );
    if (isRefusal(target)) {
      converted.set(yarnId, target);
      continue;
    }

    const route = input.routesByFabric.get(looseId) ?? [];
    let looseKnitQty: number | null = 0;
    for (const c of target.byCombo) {
      const beforeKnitting = comboUplift(route.filter((st) => !st.is_knitting), c.combo);
      if (isRefusal(beforeKnitting) || looseKnitQty == null) {
        looseKnitQty = null;
      } else {
        looseKnitQty += c.gross * beforeKnitting;
      }
      looseDemand.push({
        fabric_id: looseId,
        combo: c.combo || null,
        gross: c.gross,
        uom_id: target.uom_id,
      });
    }

    converted.set(yarnId, {
      loose_fabric_id: looseId,
      qty: target.qty,
      uom_id: target.uom_id,
      byCombo: target.byCombo,
      fabricIds: [...new Set(feeds.map((f) => f.fabric_id))],
      looseKnitQty,
    });
  }

  return { converted, looseDemand };
}

type Purchase = {
  qty: number;
  uom_id: string | null;
  byCombo: YarnComboWeight[];
  byFabric: YarnFabricWeight[];
};

/**
 * `yarnPurchase` for a document that may carry conversions — the ONE call the
 * screen's `weightFor` and the server's `normalizeYarns` both make.
 *
 *  - a CONVERTING yarn buys only what its non-yarn-dyed cloths (and any loose
 *    fabric knitted from it) need; with nothing left, it buys 0 — a real
 *    answer, never "no fabric uses this yarn";
 *  - EVERY yarn sees the loose fabrics' demand, so the greige count a loose
 *    fabric is knitted from is grossed by its route and added to that yarn's
 *    one purchase figure (the spec's consolidated Greige Yarn PO);
 *  - `ownStages` must already be free of CONVERSION steps
 *    (`withoutConversionSteps`).
 */
export function yarnPurchaseWithConversion(
  yarnId: string,
  plan: ConversionPlan,
  base: {
    fabrics: readonly FabricGross[];
    compositions: ReadonlyMap<string, FabricComposition>;
    routesByFabric: ReadonlyMap<string, readonly RouteStage[]>;
    ownStages: Parameters<typeof yarnPurchase>[4];
    decimals: number | null;
    sourceByFabric?: ReadonlyMap<string, FabricSource>;
    shades?: readonly YarnShade[];
  },
): Purchase | Refusal {
  const conv = plan.converted.get(yarnId);
  if (conv && isRefusal(conv)) return conv;
  const sources = base.sourceByFabric ?? new Map<string, FabricSource>();

  const convertedFabrics = new Set(conv ? conv.fabricIds : []);
  const fabrics = [
    ...base.fabrics.filter((f) => !convertedFabrics.has(f.fabric_id)),
    ...plan.looseDemand,
  ];

  if (conv) {
    const stillBought = fabrics.some((f) => {
      const comp = base.compositions.get(f.fabric_id);
      return (
        !!comp &&
        comp.components.some((c) => c.yarn_id === yarnId) &&
        sourceBuysYarn(sources.get(f.fabric_id) ?? "yarn_knit")
      );
    });
    if (!stillBought) return { qty: 0, uom_id: conv.uom_id, byCombo: [], byFabric: [] };
  }

  return yarnPurchase(
    yarnId,
    fabrics,
    base.compositions,
    base.routesByFabric,
    base.ownStages,
    base.decimals,
    sources,
    base.shades ?? [],
  );
}

/**
 * THE SAVE RULES of a conversion, one sentence each — the screen's Save gate
 * and the server's refusal read this one function.
 *
 *  1. At most ONE conversion step per yarn, and it names its source.
 *  2. A linked loose fabric's route must still hold its CONVERSION step — the
 *     spec's "prevent deleting a Loose Fabric line while it is linked". The way
 *     to remove it is to remove the conversion on Yarn Process first.
 *  3. CONVERSION runs on a linked loose fabric's route and nowhere else.
 */
export function conversionStepProblems(args: {
  yarns: readonly {
    name: string;
    stages: readonly { process_id?: string | null; source_loose_fabric_id?: string | null }[];
  }[];
  links: ConversionLinks;
  routeSteps: readonly { item_id: string; process_id?: string | null }[];
  isUnravelling: (processId: string) => boolean;
  fabricName: (itemId: string) => string;
}): string[] {
  const out: string[] = [];
  for (const y of args.yarns) {
    const steps = y.stages.filter((st) => !!st.process_id && args.isUnravelling(st.process_id));
    if (steps.length > 1) {
      out.push(`${y.name}: a yarn is converted from one loose fabric — keep one CONVERSION step.`);
    } else if (steps.length === 1 && !steps[0].source_loose_fabric_id) {
      /* The picker's `required` star and cursor hold, stated as a Save rule —
         "one declaration, four enforcers" (AGENTS.md, Mandatory fields). */
      out.push(`${y.name}: pick the Source Loose Fabric on its CONVERSION step.`);
    }
  }
  const linked = new Set(linkedLooseFabricIds(args.links));
  for (const id of linked) {
    const kept = args.routeSteps.some(
      (p) => p.item_id === id && !!p.process_id && args.isUnravelling(p.process_id),
    );
    if (!kept) {
      out.push(
        `${args.fabricName(id)} is the source loose fabric of a yarn CONVERSION, so its route must ` +
          "keep the CONVERSION step — remove the conversion on Yarn Process first.",
      );
    }
  }
  const misplaced = new Set(
    args.routeSteps
      .filter((p) => !!p.process_id && args.isUnravelling(p.process_id) && !linked.has(p.item_id))
      .map((p) => p.item_id),
  );
  for (const id of misplaced) {
    out.push(
      `${args.fabricName(id)}: CONVERSION (unravelling) runs only on a loose fabric's route — pick ` +
        "the loose fabric on a yarn's CONVERSION step on Yarn Process.",
    );
  }
  return out;
}
