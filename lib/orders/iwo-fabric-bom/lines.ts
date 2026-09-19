/**
 * IWO Fabric BOM — the fabric-line rules, ONCE (step 2: Fabric Allocation +
 * Fabric Consumption).
 *
 * Pure functions, no server imports: the screen reads them for its Save gate
 * and the action reads them again before it writes — the
 * `iwo-material-bom/rules.ts` shape too, so a Save button can never allow what
 * the server then refuses.
 *
 * ## WHAT A LINE OWES, AND WHY EACH
 *
 *   - **Fabric** — the line IS a fabric; everything downstream (the Fabric
 *     Process route, the Yarn Process blend split) is keyed to `item_id`.
 *   - **Stage** — the state the cloth is required in (GREIGE / DYED …). The
 *     IWO screen's own fabric grid already makes it mandatory; the copy must
 *     not be laxer than the screen it replaces.
 *   - **Req Wt (KGS)** — SRS §4: on an IWO the weight is TYPED, because the
 *     garment breakdown that computes it on an order is bypassed. A line with
 *     no weight plans nothing.
 *   - **Mixing Uom on a yarn-dyed cloth** — the order screen's rule, called
 *     through `missingFabricLineFields` rather than restated, so the two
 *     screens cannot disagree about what a yarn-dyed line owes.
 *
 * `No Of Colors`, Colour, Form, GSM and Finish Dia are OFFERED, never demanded
 * — the order screen's reading of the same columns.
 */

import { missingFabricLineFields } from "@/lib/orders/fabric-bom/fabric-line-rules";
import type { IwoColourBy } from "./yarn";

/** A line as the rules read it. Numbers may be NaN — a typed non-number —
 *  which is refused by name rather than read as blank. */
export type IwoFabricLineFacts = {
  structure_id: string | null;
  item_id: string | null;
  color_name?: string | null;
  fabric_form: string | null;
  mixing_uom_id: string | null;
  no_of_colors: number | null;
  gsm: number | null;
  finish_dia?: string | null;
  stage_id: string | null;
  req_kgs: number | null;
};

export type IwoFabricLineField =
  | "item_id"
  | "stage_id"
  | "req_kgs"
  | "gsm"
  | "no_of_colors"
  | "mixing_uom_id";

export type IwoFabricLineProblem = {
  /** Position in the grid AS SENT, blank rows included — the S No the
   *  operator sees beside the row. */
  row: number;
  field: IwoFabricLineField;
  /** Which section of the screen shows the field. */
  section: "lines" | "consumption";
  message: string;
};

/**
 * THE BLANK-ROW FILTER TESTS ONLY WHAT THE OPERATOR TYPES (AGENTS.md, default
 * rows). The grid seeds one blank row and it reaches the action; every clause
 * below is a field the seed leaves empty, so an untouched row is dropped
 * rather than stored as a phantom line.
 */
export const isBlankIwoFabricLine = (l: IwoFabricLineFacts): boolean =>
  !l.structure_id &&
  !l.item_id &&
  !l.color_name?.trim() &&
  !l.fabric_form &&
  !l.mixing_uom_id &&
  l.no_of_colors == null &&
  l.gsm == null &&
  !l.finish_dia?.trim() &&
  !l.stage_id &&
  l.req_kgs == null;

export function keptIwoFabricLines<T extends IwoFabricLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoFabricLine(l));
}

/**
 * Everything stopping a save, in screen order. `fabricTypeOf` resolves a
 * fabric's Solid / Melange / Yarn Dyed name — the SCREEN reads it off the
 * loaded master, the ACTION off `items` again, never off the payload.
 */
export function iwoFabricLineProblems(
  lines: readonly IwoFabricLineFacts[],
  fabricTypeOf: (itemId: string) => string | null,
): IwoFabricLineProblem[] {
  const out: IwoFabricLineProblem[] = [];
  lines.forEach((l, i) => {
    if (isBlankIwoFabricLine(l)) return;
    const row = i + 1;
    const need = (
      field: IwoFabricLineField,
      section: IwoFabricLineProblem["section"],
      message: string,
    ) => out.push({ row, field, section, message: `Fabric line ${row}: ${message}` });

    if (!l.item_id) {
      need("item_id", "lines", "choose the fabric.");
      // Nothing else on the line can be judged without the cloth.
      return;
    }
    for (const p of missingFabricLineFields(l, fabricTypeOf(l.item_id))) {
      need(p.field, "lines", `${p.message}.`);
    }
    if (l.no_of_colors != null && !(Number.isInteger(l.no_of_colors) && l.no_of_colors >= 1 && l.no_of_colors <= 99)) {
      need("no_of_colors", "lines", "No Of Colors must be a whole number from 1 to 99.");
    }
    if (!l.stage_id) need("stage_id", "consumption", "choose the Stage.");
    if (l.gsm != null && !(l.gsm > 0)) need("gsm", "consumption", "GSM must be a number more than 0.");
    if (l.req_kgs == null) need("req_kgs", "consumption", "enter the Req Wt (KGS).");
    else if (!(l.req_kgs > 0)) need("req_kgs", "consumption", "Req Wt must be a number more than 0.");
  });
  return out;
}

// ---------------------------------------------------------------------------
// For = Yarn (step 4) — the Yarn Lines grid
// ---------------------------------------------------------------------------

/**
 * A yarn line on a For = Yarn BOM (screenshot 2937): the yarn, its Stage
 * (GREY / DYED), and either the Planned Weight typed (GREY) or its shades
 * (DYED, 0592). Its process stages are Yarn Process's, and a line with only
 * stages typed still counts as started — it is the operator's work, not a
 * seeded blank.
 *
 * ## WHAT STAGE MEANS (client audio, 2026-09-19 — REVERSES 0581)
 *
 *   - **GREY** — raw grey yarn, ONE weight, no colour breakdown. So no shades,
 *     no step scoped to a colour, and no dyeing step: dyeing a yarn is what
 *     makes it DYED, and the planner says so with the Stage.
 *   - **DYED** — the shades, a weight each, and HOW the colour is got
 *     (`colour_by`): **Dyed Purchase** buys each shade dyed, so a dyeing step
 *     here would dye it twice; **Yarn Dyeing** buys the grey total and dyes it,
 *     so EVERY shade needs a dyeing step For that shade — one step per shade is
 *     what gives the Budget one dyeing line (and one rate) per shade.
 *
 * "Is this a dyeing step" is the process master's `is_dyeing` (0557; 0592 set
 * it on YARN DYEING) — read by the CALLER and handed in as `dyeing`, so this
 * file stays pure. Not the step's Stage: a winding step after dyeing sits in
 * the DYED stage and is not a dyeing step.
 */
export type IwoYarnShadeFacts = { color_name?: string | null; planned_kgs: number | null };

/** A Yarn Process step as the rules read it — only steps naming a process. */
export type IwoYarnStepFacts = { combo: string | null; dyeing: boolean };

export type IwoYarnLineFacts = {
  item_id: string | null;
  buy_stage_id: string | null;
  planned_kgs: number | null;
  hasStages?: boolean;
  colour_by?: IwoColourBy | null;
  shades?: readonly IwoYarnShadeFacts[];
  steps?: readonly IwoYarnStepFacts[];
};

/** THE SHADE BLANK-ROW FILTER — the Shades grid seeds one blank row, and it
 *  tests only what is typed, so an untouched seed is never stored. */
export const isBlankIwoYarnShade = (s: IwoYarnShadeFacts): boolean =>
  !s.color_name?.trim() && s.planned_kgs == null;

export function keptIwoYarnShades<T extends IwoYarnShadeFacts>(shades: readonly T[] | undefined): T[] {
  return (shades ?? []).filter((s) => !isBlankIwoYarnShade(s));
}

export const isBlankIwoYarnLine = (l: IwoYarnLineFacts): boolean =>
  !l.item_id &&
  !l.buy_stage_id &&
  l.planned_kgs == null &&
  !l.hasStages &&
  !l.colour_by &&
  keptIwoYarnShades(l.shades).length === 0;

export function keptIwoYarnLines<T extends IwoYarnLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoYarnLine(l));
}

/** Where the fix is: the line itself, its Shades, or its Yarn Process steps. */
export type IwoYarnLineProblem = { row: number; message: string; section?: "yarnLines" | "yarns" };

export type IwoYarnRuleContext = {
  /** Is this `yarn_stage` id the DYED one? `stageRank` ≥ 1 at the call site. */
  isDyedStage: (stageId: string) => boolean;
  /** The BOM's Yarn Colour panel names — what a shade may be. */
  yarnColours: readonly string[];
};

const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * What a kept yarn line owes, by its Stage (see the type above). At least one
 * line: a For = Yarn BOM with no yarn plans nothing. A yarn listed twice is
 * refused here rather than by the unique index, naming the rows.
 *
 * `ctx` defaults to "no stage is DYED" — every pre-0592 caller's reading.
 */
export function iwoYarnLineProblems(
  lines: readonly IwoYarnLineFacts[],
  ctx: IwoYarnRuleContext = { isDyedStage: () => false, yarnColours: [] },
): IwoYarnLineProblem[] {
  const out: IwoYarnLineProblem[] = [];
  const firstRowOf = new Map<string, number>();
  const panel = new Set(ctx.yarnColours.map(up).filter(Boolean));
  let kept = 0;
  lines.forEach((l, i) => {
    if (isBlankIwoYarnLine(l)) return;
    kept++;
    const row = i + 1;
    const at = `Yarn line ${row}`;
    const say = (message: string, section: IwoYarnLineProblem["section"] = "yarnLines") =>
      out.push({ row, message: `${at}: ${message}`, section });

    if (!l.item_id) say("choose the yarn.");
    else {
      const first = firstRowOf.get(l.item_id);
      if (first) say(`this yarn is already on line ${first} — plan it once.`);
      else firstRowOf.set(l.item_id, row);
    }
    if (!l.buy_stage_id) {
      say("choose the Stage (GREY or DYED).");
      return;
    }
    const shades = keptIwoYarnShades(l.shades);
    const steps = l.steps ?? [];

    if (!ctx.isDyedStage(l.buy_stage_id)) {
      // GREY — one weight, no colour.
      if (l.planned_kgs == null) say("enter the Planned Weight (KGS).");
      else if (!(l.planned_kgs > 0)) say("Planned Weight must be a number more than 0.");
      if (shades.length) say("a GREY yarn has no shades — clear them, or set the Stage to DYED.");
      if (steps.some((s) => s.dyeing)) {
        say("dyeing makes this yarn DYED — set its Stage to DYED and add the shades.", "yarns");
      } else if (steps.some((s) => up(s.combo))) {
        say("a GREY yarn is one lot — clear the For colour on its Yarn Process step.", "yarns");
      }
      return;
    }

    // DYED — the shades, and how they are coloured.
    if (!l.colour_by) say("choose Colour by — Dyed Purchase or Yarn Dyeing.");
    if (!shades.length) {
      say("add the shades and the KGS of each ([Shades]).");
      return;
    }
    const seen = new Set<string>();
    shades.forEach((s, j) => {
      const name = up(s.color_name);
      const which = `shade ${j + 1}`;
      if (!name) say(`${which}: choose the colour.`);
      else if (!panel.has(name)) say(`${which}: ${name} is not on the Yarn Colour panel — add it there first.`);
      else if (seen.has(name)) say(`${which}: ${name} is listed twice — plan it once.`);
      if (name) seen.add(name);
      if (s.planned_kgs == null) say(`${which}: enter the KGS.`);
      else if (!(s.planned_kgs > 0)) say(`${which}: KGS must be a number more than 0.`);
    });

    for (const st of steps) {
      const c = up(st.combo);
      if (c && !seen.has(c)) say(`a Yarn Process step is For ${c}, which is not a shade of this yarn.`, "yarns");
    }
    if (l.colour_by === "dyed_purchase" && steps.some((s) => s.dyeing)) {
      say("it is bought already dyed — remove the dyeing step, or choose Colour by Yarn Dyeing.", "yarns");
    }
    if (l.colour_by === "yarn_dyeing") {
      if (steps.some((s) => s.dyeing && !up(s.combo))) {
        say("choose which shade each dyeing step is For — one dyeing step per shade.", "yarns");
      }
      for (const name of seen) {
        if (!steps.some((s) => s.dyeing && up(s.combo) === name)) {
          say(`add a Yarn Dyeing step For ${name} on Yarn Process.`, "yarns");
        }
      }
    }
  });
  if (!kept) out.push({ row: 0, message: "Add at least one yarn.", section: "yarnLines" });
  return out;
}

/** Σ a DYED line's shades — its Planned Weight, derived (0592). Null while any
 *  kept shade has no number, so a partial sum is never shown as the answer. */
export function iwoShadeTotal(shades: readonly IwoYarnShadeFacts[] | undefined): number | null {
  const kept = keptIwoYarnShades(shades);
  if (!kept.length || kept.some((s) => s.planned_kgs == null || !(s.planned_kgs > 0))) return null;
  return Number(kept.reduce((a, s) => a + (s.planned_kgs as number), 0).toFixed(4));
}
