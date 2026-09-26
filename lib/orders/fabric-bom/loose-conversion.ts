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
 *
 * ## CONVERSION IS A YARN STEP ONLY (client spec 2026-09-26, "Exclude
 * CONVERSION Process from Fabric Process Tab")
 *
 * The unravelling loss used to live on the loose fabric's ROUTE, as a
 * CONVERSION step on Fabric Process. It now lives on the yarn: the CONVERSION
 * step's own Loss % (`stepLosses`), which a colour's Details Loss % overrides.
 * A route SAVED with its CONVERSION step still works — with no loss typed on
 * the yarn side, that route step's loss is the one applied, exactly as
 * before; with one typed, the route's is divided back out (below), so the one
 * physical loss is never taken twice.
 *
 * ## PER-COLOUR DETAILS (0645) — legacy's [Click] ▸ Details
 *
 * The step may carry one row per colourway (`conversion_details`): Loss %,
 * Loose Fabric, GSM, Dia (user 2026-09-25, legacy screenshots 3093–3096). A
 * colour's LOOSE FABRIC replaces the step's for that colour's demand; its
 * LOSS % REPLACES the loose fabric route's CONVERSION (unravelling) loss for
 * that colour — never adds to it. The injected route opens that step at the
 * spec's 2.00 %, so an added figure would divide by (1 − L) twice for the one
 * physical loss (caught 2026-09-26 against the spec's Step 2). Blank = the
 * route's loss stands; 0 = no unravelling loss for that colour. Needs the
 * master's flag (`isUnravelling`) to find that step on the route. GSM and Dia
 * are recorded, never multiplied. A colour with no row, or a row naming no
 * fabric, uses the step's own fabric.
 *
 * ONE ROW PER COLOUR, NOT PER STRIPE (user 2026-09-26, later: "one by one
 * one color"). When two colourways put different colours at one stripe —
 * Color 1 is WHITE on one and RED on the other — each is its own row, because
 * each is its own dye lot. A part is matched to a row by its COLOUR first, then
 * by its stripe position (a row saved while rows were per stripe), then by its
 * colourway (a row saved before either).
 *
 * ## THE ROWS ARE THE YARN'S STRIPE COLOURS (user 2026-09-26)
 *
 * A loose fabric is dyed to a YARN colour — the one Yarn Dyed Details puts at
 * a stripe position (Color 1, Color 2…) — not to the garment colourway. So a
 * Details row names a POSITION, and with `shades` passed each colourway's
 * converted weight is split across the positions this yarn feeds, by the
 * position's share of the yarn (`YarnShade.share`), each part taking its own
 * row's loose fabric and loss. A row still naming a garment colourway (saved
 * before this change) keeps answering for that colourway; a cloth with no
 * stripes declared takes the colourway's row, as before.
 */

import { isRefusal, type Refusal } from "./requirement";
import { ydPartKey } from "./component-map";
import { sourceBuysYarn, type FabricSource } from "./fabric-source";
import {
  comboUplift,
  conversionDetailsFromDraft,
  type ConversionDetailDraft,
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

/** One colourway of a CONVERSION step's Details (0645). */
export type ConversionDetail = {
  combo: string;
  loss_pct: number | null;
  source_loose_fabric_id: string | null;
  gsm: number | null;
  dia: string | null;
};

/** yarn → its CONVERSION step's per-colour details. Absent = none typed. */
export type ConversionDetails = ReadonlyMap<string, readonly ConversionDetail[]>;

/**
 * The per-colour details off the yarn steps — the twin of `conversionLinksOf`.
 * Takes the STORED rows (numbers) or the FORM's (text), and answers numbers
 * either way, so the screen's preview and the save read one shape.
 */
export function conversionDetailsOf(
  yarns: readonly {
    item_id: string;
    stages: readonly {
      process_id?: string | null;
      conversion_details?: readonly (ConversionDetail | ConversionDetailDraft)[] | null;
    }[];
  }[],
  isUnravelling: (processId: string) => boolean,
): Map<string, readonly ConversionDetail[]> {
  const out = new Map<string, readonly ConversionDetail[]>();
  for (const y of yarns) {
    const step = y.stages.find((st) => !!st.process_id && isUnravelling(st.process_id));
    const rows = step?.conversion_details ?? [];
    if (rows.length === 0) continue;
    out.set(
      y.item_id,
      rows.flatMap((r) =>
        typeof r.loss_pct === "string" || typeof r.gsm === "string"
          ? conversionDetailsFromDraft([r as ConversionDetailDraft]) // [] for a colourless row
          : [r as ConversionDetail],
      ),
    );
  }
  return out;
}

/**
 * yarn → its CONVERSION step's own Loss % (2026-09-26). Takes the form's text
 * or the stored number; a blank loss is left out, so a route saved before the
 * move keeps answering with its own CONVERSION step.
 */
export function conversionStepLossesOf(
  yarns: readonly {
    item_id: string;
    stages: readonly { process_id?: string | null; loss_pct?: number | string | null }[];
  }[],
  isUnravelling: (processId: string) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const y of yarns) {
    const step = y.stages.find((st) => !!st.process_id && isUnravelling(st.process_id));
    const raw = step?.loss_pct;
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.set(y.item_id, n);
  }
  return out;
}

/** A colourway's name as the details compare it — trimmed, upper-cased. */
const comboKey = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();

/** The loose fabrics a document's yarns name — each needs a route and a
 *  composition, so both sides fold these into their fabric sets. Includes the
 *  per-colour Details' fabrics (0645) when they are passed. */
export function linkedLooseFabricIds(links: ConversionLinks, details?: ConversionDetails): string[] {
  const ids = [...links.values()].filter((id): id is string => !!id);
  for (const [yarnId, rows] of details ?? []) {
    if (!links.has(yarnId)) continue;
    for (const r of rows) if (r.source_loose_fabric_id) ids.push(r.source_loose_fabric_id);
  }
  return [...new Set(ids)];
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
  /**
   * EACH COLOUR'S PART (2026-09-26) — for the Yarn & Fabric Requirement
   * report's CONVERSION block, printed under Yarn Purchase: the converted yarn
   * that colour needs (`delivered`), the unravelling loss applied to it, and
   * the loose fabric to unravel for it (`toLoose`). Summed they are the plan's
   * own figures; nothing here is computed a second way.
   */
  parts: {
    combo: string;
    position: string | null;
    colour: string | null;
    looseFabricId: string;
    delivered: number;
    lossPct: number | null;
    toLoose: number;
  }[];
};

export type ConversionPlan = {
  converted: Map<string, ConvertedYarn | Refusal>;
  /** The loose fabrics' required weight, per colourway, as ordinary fabric
   *  slices — appended to every yarn's `fabrics` by `yarnPurchaseWithConversion`. */
  looseDemand: FabricGross[];
};

export type ConversionInput = {
  links: ConversionLinks;
  /** Per-colour Details (0645) — optional; without them every colour uses the
   *  step's loose fabric and no extra loss, exactly as before. */
  details?: ConversionDetails;
  /** yarn → its CONVERSION step's own Loss % (2026-09-26, `conversionStepLossesOf`).
   *  A colour's Details loss wins over it; absent = the loose fabric route's
   *  CONVERSION step (a route saved before the move) answers, as before. */
  stepLosses?: ReadonlyMap<string, number | null>;
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
  /** The yarn-dyed stripes (`yarnShadesFrom`) — what splits a colourway's
   *  converted weight across Color 1, Color 2… Without them every colourway
   *  is one part, keyed by its own name (the pre-2026-09-26 behaviour). */
  shades?: readonly YarnShade[];
  /** The master's CONVERSION flag — which route step a colour's Details Loss %
   *  REPLACES (0645). Without it a Details loss cannot replace anything, so it
   *  is ignored rather than added on top. */
  isUnravelling?: (processId: string) => boolean;
};

export function planConversions(input: ConversionInput): ConversionPlan {
  const converted = new Map<string, ConvertedYarn | Refusal>();
  const looseDemand: FabricGross[] = [];
  const sources = input.sourceByFabric ?? new Map<string, FabricSource>();
  const cutFabricIds = new Set(input.fabrics.map((f) => f.fabric_id));
  const nameOf = (id: string, fallback: string) => input.nameOf?.(id) || fallback;

  for (const [yarnId, stepLooseId] of input.links) {
    const rows = input.details?.get(yarnId) ?? [];
    const detailFor = (combo: string | null | undefined) => rows.find((r) => comboKey(r.combo) === comboKey(combo));
    /* The step's own fabric, or — when only the Details name one — the first
       colour's, so a step answered wholly in the popup still converts. */
    const looseId = stepLooseId ?? rows.find((r) => r.source_loose_fabric_id)?.source_loose_fabric_id ?? null;
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

    /* EACH COLOURWAY'S WEIGHT, SPLIT ACROSS THE STRIPE COLOURS IT FEEDS.
       Per cloth, because each cloth has its own stripes and shares; a cloth
       with no stripes for this yarn stays one part, keyed by the colourway.
       The per-cloth figures are used only as PROPORTIONS of the colourway's
       own total — never summed into a new total — so rounding per cloth can
       never make the split disagree with `target`. */
    // combo -> "position\u0001colour" ("" = no stripes) -> weight
    const weightBy = new Map<string, Map<string, number>>();
    for (const f of feeds) {
      const one = yarnPurchase(yarnId, [f], input.compositions, input.routesByFabric, [], input.decimals, sources, []);
      if (isRefusal(one)) continue;
      for (const c of one.byCombo) {
        const ck = comboKey(c.combo);
        const held = weightBy.get(ck) ?? new Map<string, number>();
        weightBy.set(ck, held);
        const stripes = (input.shades ?? []).filter(
          (sh) =>
            sh.yarn_id === yarnId &&
            sh.fabric_id === f.fabric_id &&
            comboKey(sh.combo) === ck &&
            ydPartKey(sh.yd_part) === ydPartKey(f.yd_part) &&
            !!sh.position,
        );
        const total = stripes.reduce((sum, sh) => sum + sh.share, 0);
        if (stripes.length === 0 || total <= 0) {
          held.set("", (held.get("") ?? 0) + c.gross);
          continue;
        }
        for (const sh of stripes) {
          const k = `${sh.position ?? ""}\u0001${sh.colour ?? ""}`;
          held.set(k, (held.get(k) ?? 0) + (c.gross * sh.share) / total);
        }
      }
    }
    const demandParts: { combo: string; gross: number; position: string | null; colour: string | null }[] = [];
    for (const c of target.byCombo) {
      const split = weightBy.get(comboKey(c.combo));
      const sum = split ? [...split.values()].reduce((x, y) => x + y, 0) : 0;
      if (!split || sum <= 0 || (split.size === 1 && split.has(""))) {
        demandParts.push({ combo: c.combo, gross: c.gross, position: null, colour: null });
        continue;
      }
      for (const [k, w] of split) {
        const [position, colour] = k.split("\u0001");
        demandParts.push({
          combo: c.combo,
          gross: (c.gross * w) / sum,
          position: position || null,
          colour: colour || null,
        });
      }
    }

    let looseKnitQty: number | null = 0;
    let badLoss: string | null = null;
    const parts: ConvertedYarn["parts"] = [];
    for (const c of demandParts) {
      /* THIS COLOUR'S LOOSE FABRIC AND LOSS — by colour, else by stripe
         position, else by colourway (rows saved earlier), else the step's. */
      const d =
        (c.colour ? detailFor(c.colour) : undefined) ??
        (c.position ? detailFor(c.position) : undefined) ??
        detailFor(c.combo);
      const cLoose = d?.source_loose_fabric_id || looseId;
      const route = input.routesByFabric.get(cLoose) ?? [];
      /* A TYPED LOSS REPLACES THE ROUTE'S UNRAVELLING LOSS FOR THIS COLOUR.
         The demand is handed on already grossed by the colour's own loss and
         DIVIDED by the route's unravelling uplift, which the route multiplies
         back in downstream (`yarnPurchaseWithConversion`, `beforeKnitting`
         below) — so the one physical loss is applied once, at the colour's
         figure. */
      let gross = c.gross;
      const L = d?.loss_pct ?? input.stepLosses?.get(yarnId) ?? null;
      if (L != null && input.isUnravelling) {
        if (L < 0 || L >= 100) {
          badLoss = c.colour || c.position || c.combo || "every colourway";
          break;
        }
        const isU = input.isUnravelling;
        const routeU = comboUplift(route.filter((st) => !!st.process_id && isU(st.process_id)), c.combo);
        gross = c.gross / (1 - L / 100) / (isRefusal(routeU) ? 1 : routeU);
      }
      const beforeKnitting = comboUplift(route.filter((st) => !st.is_knitting), c.combo);
      if (isRefusal(beforeKnitting) || looseKnitQty == null) {
        looseKnitQty = null;
      } else {
        looseKnitQty += gross * beforeKnitting;
      }
      looseDemand.push({
        fabric_id: cLoose,
        combo: c.combo || null,
        gross,
        uom_id: target.uom_id,
      });
      parts.push({
        combo: c.combo,
        position: c.position,
        colour: c.colour,
        looseFabricId: cLoose,
        delivered: c.gross,
        lossPct: L,
        toLoose: gross,
      });
    }
    if (badLoss) {
      converted.set(yarnId, {
        refused: `Conversion Details: the Loss % for ${badLoss} must be at least 0 and below 100`,
      });
      continue;
    }

    converted.set(yarnId, {
      loose_fabric_id: looseId,
      qty: target.qty,
      uom_id: target.uom_id,
      byCombo: target.byCombo,
      fabricIds: [...new Set(feeds.map((f) => f.fabric_id))],
      looseKnitQty,
      parts,
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
    stages: readonly {
      process_id?: string | null;
      source_loose_fabric_id?: string | null;
      conversion_details?: readonly { source_loose_fabric_id?: string | null }[] | null;
    }[];
  }[];
  links: ConversionLinks;
  /** Per-colour Details (0645) — their fabrics count as linked too. */
  details?: ConversionDetails;
  routeSteps: readonly { item_id: string; process_id?: string | null }[];
  isUnravelling: (processId: string) => boolean;
  fabricName: (itemId: string) => string;
}): string[] {
  const out: string[] = [];
  for (const y of args.yarns) {
    const steps = y.stages.filter((st) => !!st.process_id && args.isUnravelling(st.process_id));
    if (steps.length > 1) {
      out.push(`${y.name}: a yarn is converted from one loose fabric — keep one CONVERSION step.`);
    } else if (
      steps.length === 1 &&
      !steps[0].source_loose_fabric_id &&
      !steps[0].conversion_details?.some((d) => d.source_loose_fabric_id)
    ) {
      /* The picker's `required` star and cursor hold, stated as a Save rule —
         "one declaration, four enforcers" (AGENTS.md, Mandatory fields). */
      out.push(`${y.name}: pick the Source Loose Fabric on its CONVERSION step.`);
    }
  }
  /* NO "ITS ROUTE MUST KEEP THE CONVERSION STEP" RULE (2026-09-26): CONVERSION
     is a yarn step only now, so a loose fabric's route is KNITTING -> DYEING and
     the unravelling loss is typed on the yarn. A route saved with the step
     still passes — it is honoured when the yarn names no loss. */
  const linked = new Set(linkedLooseFabricIds(args.links, args.details));
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
