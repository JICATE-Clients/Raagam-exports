/**
 * Internal Work Order — the line rules, ONCE.
 *
 * Pure functions, no server imports: the screen reads them for its Save gate and
 * the action reads them again before it writes. Two copies of "what a yarn line
 * must carry" is how a Save button comes to allow what the server then refuses
 * (the `missingRequiredMaterialFields` shape, AGENTS.md "Mandatory fields").
 *
 * ## THE BLANK-ROW FILTERS TEST ONLY WHAT THE OPERATOR TYPES
 *
 * Every grid opens with one seeded row, and that row reaches the action. So a
 * row is dropped when nothing on it was filled — and every clause below reads a
 * field the operator has to enter. A default stamped into the seed (a stage, a
 * unit) would turn its clause into the constant `true` and save a phantom line;
 * that happened twice in Material BOM and is why this file's seeds are blank.
 * The ONE auto-filled value, an accessory's unit, is filled when an item is
 * PICKED, never at seed — so it can only ever sit beside an item.
 */

import type {
  IwoAccessoryLineInput,
  IwoAccessoryProcessInput,
  IwoFabricLineInput,
  IwoFabricProcessInput,
  IwoFor,
  IwoYarnLineInput,
  IwoYarnProcessInput,
} from "./types";
import { IWO_FOR_LABELS } from "./types";

const blankNum = (n: number | null | undefined) => n == null;

// ---------------------------------------------------------------------------
// Blank rows
// ---------------------------------------------------------------------------

export const isBlankYarnProcess = (p: IwoYarnProcessInput): boolean =>
  !p.process_id && !p.shade_id && blankNum(p.qty_kgs) && blankNum(p.rate_per_kg);

export const isBlankYarnLine = (l: IwoYarnLineInput): boolean =>
  !l.item_id && !l.stage_id && blankNum(l.planned_kgs) && l.processes.every(isBlankYarnProcess);

export const isBlankFabricProcess = (p: IwoFabricProcessInput): boolean =>
  !p.process_id && blankNum(p.loss_pct) && blankNum(p.rate_per_kg);

export const isBlankFabricLine = (l: IwoFabricLineInput): boolean =>
  !l.item_id &&
  !l.stage_id &&
  !l.color_id &&
  !l.print_id &&
  blankNum(l.gsm) &&
  !l.fabric_form &&
  !l.dia &&
  blankNum(l.planned_kgs) &&
  l.processes.every(isBlankFabricProcess);

export const isBlankAccessoryProcess = (p: IwoAccessoryProcessInput): boolean =>
  !p.process_id && !p.vendor_id && blankNum(p.rate_per_unit);

/** `uom_id` is NOT a clause: it is filled by picking an item, so a row holding
 *  a unit and nothing else cannot exist — and if it did, it is still blank.
 *  `is_advised` IS one: it starts false, so only the operator's own tick can
 *  make it true, which is exactly "something was entered". */
export const isBlankAccessoryLine = (l: IwoAccessoryLineInput): boolean =>
  !l.item_id &&
  !l.specs &&
  !l.color_id &&
  !l.size_id &&
  blankNum(l.planned_qty) &&
  !l.is_advised &&
  l.processes.every(isBlankAccessoryProcess);

/** The lines worth writing, each with only its non-blank process rows. */
export function keptYarnLines(lines: readonly IwoYarnLineInput[]): IwoYarnLineInput[] {
  return lines
    .filter((l) => !isBlankYarnLine(l))
    .map((l) => ({ ...l, processes: l.processes.filter((p) => !isBlankYarnProcess(p)) }));
}

export function keptFabricLines(lines: readonly IwoFabricLineInput[]): IwoFabricLineInput[] {
  return lines
    .filter((l) => !isBlankFabricLine(l))
    .map((l) => ({ ...l, processes: l.processes.filter((p) => !isBlankFabricProcess(p)) }));
}

export function keptAccessoryLines(
  lines: readonly IwoAccessoryLineInput[],
): IwoAccessoryLineInput[] {
  return lines
    .filter((l) => !isBlankAccessoryLine(l))
    .map((l) => ({ ...l, processes: l.processes.filter((p) => !isBlankAccessoryProcess(p)) }));
}

// ---------------------------------------------------------------------------
// Process loss — the fabric's Required Yarn
// ---------------------------------------------------------------------------

/**
 * The yarn a planned fabric weight needs, through its process losses.
 *
 * DIVISIVE AND COMPOUNDED: `input = output / (1 - loss/100)` per step, one step
 * after another — 1000 KG through a 10% step needs 1111.11, not 1100. This is
 * doc/order/update.md §1.3's formula for the IWO by name, and the same one
 * `comboUplift` (lib/orders/fabric-bom/yarn-process.ts) applies to an order's
 * fabric — mirrored rather than called, because that function walks colourways
 * and garment components an IWO does not have. Keep the two in step: a loss is a
 * fraction of the step's OWN OUTPUT, which is why it divides.
 *
 * Returns null while there is nothing to gross (no planned weight yet) or a loss
 * is out of range; the Save gate reports the range, so the cell stays quiet.
 */
export function grossUpKgs(
  plannedKgs: number | null,
  losses: readonly (number | null)[],
): number | null {
  if (plannedKgs == null || !(plannedKgs > 0)) return null;
  let factor = 1;
  for (const loss of losses) {
    const l = loss ?? 0;
    // Written as a positive test so a NaN (a typed non-number) fails it too.
    if (!(l >= 0 && l < 100)) return null;
    factor *= 1 / (1 - l / 100);
  }
  return plannedKgs * factor;
}

// ---------------------------------------------------------------------------
// What a kept row must carry
// ---------------------------------------------------------------------------

/**
 * THE SHADE RULE — does a yarn line's shade breakup make sense?
 *
 * A yarn line carries a Planned Weight (say 1000 KG) and, on Yarn Process, zero
 * or more shade rows each with its own KGS (600 NAVY, 400 BLACK) — grey yarn
 * bought and then sent for dyeing. How those two are allowed to relate is a
 * business decision, not a coding one:
 *
 *   - May a line be split into shades for only PART of its weight (the rest
 *     stays grey, or its shade is decided later — the IWO is raised before the
 *     buyer order, after all)?
 *   - Must the shade KGS add up to the planned weight EXACTLY, be allowed to
 *     fall short (the rest stays undecided), or also be allowed to exceed it?
 *
 * Return one message per problem ("NAVY + BLACK come to 1100 KG against 1000
 * KG planned"), or [] when the line is fine. Every message blocks Save and is
 * shown to the operator, so word it as an instruction. `processes` holds only
 * the line's non-blank process rows.
 */
export function yarnShadeProblems(
  line: IwoYarnLineInput,
  processes: readonly IwoYarnProcessInput[],
): string[] {
  void line;
  void processes;
  // TODO: your rule — see the doc comment above.
  return [];
}

export type LineProblem = {
  /** Which section of the screen owns it: the main grid, or its process grid. */
  where: "lines" | "process";
  message: string;
};

/**
 * Everything stopping a save, in screen order.
 *
 * Positions are the grid's own S No — counted over the rows AS SENT, blank ones
 * included, because that is the number the operator sees beside the row.
 *
 * NO STAGE RULE ON YARN PROCESS ROWS. Stage is the state the yarn is BOUGHT in;
 * dyeing is what is done to it afterwards — the SRS's own example is a GREY
 * elastane carrying "Yarn Dyeing (Navy Blue @ Rs. 85/KG)" (doc/order/internlwork
 * order.md §3). A first cut refused process rows under a GREY line, which is
 * exactly backwards.
 */
export function lineProblems(
  input: {
    iwo_for: IwoFor;
    yarn: readonly IwoYarnLineInput[];
    fabric: readonly IwoFabricLineInput[];
    accessories: readonly IwoAccessoryLineInput[];
  },
): LineProblem[] {
  const out: LineProblem[] = [];
  const need = (where: LineProblem["where"], message: string) => out.push({ where, message });

  // Lines of a kind the header no longer says. Saving would silently discard
  // them, so it is refused instead — switch `For` back, or clear them.
  (["yarn", "fabric", "accessories"] as const).forEach((kind) => {
    if (kind === input.iwo_for) return;
    const filled =
      kind === "yarn"
        ? keptYarnLines(input.yarn).length
        : kind === "fabric"
          ? keptFabricLines(input.fabric).length
          : keptAccessoryLines(input.accessories).length;
    if (filled) {
      need(
        "lines",
        `${IWO_FOR_LABELS[kind]} lines are still filled in. Switch For back to ` +
          `${IWO_FOR_LABELS[kind]}, or clear them before saving as ${IWO_FOR_LABELS[input.iwo_for]}.`,
      );
    }
  });

  if (input.iwo_for === "yarn") {
    let kept = 0;
    input.yarn.forEach((l, i) => {
      if (isBlankYarnLine(l)) return;
      kept++;
      const at = `Yarn line ${i + 1}`;
      if (!l.item_id) need("lines", `${at}: choose the yarn.`);
      if (!l.stage_id) need("lines", `${at}: choose the stage.`);
      if (!(l.planned_kgs != null && l.planned_kgs > 0))
        need("lines", `${at}: enter the Planned Weight in KGS.`);
      const procs = l.processes.filter((p) => !isBlankYarnProcess(p));
      procs.forEach((p, j) => {
        const pat = `${at}, process row ${j + 1}`;
        if (!p.process_id) need("process", `${pat}: choose the process.`);
        if (!p.shade_id) need("process", `${pat}: choose the shade.`);
        if (!(p.qty_kgs != null && p.qty_kgs > 0)) need("process", `${pat}: enter the KGS.`);
        if (p.rate_per_kg != null && !(p.rate_per_kg >= 0))
          need("process", `${pat}: the rate must be a number, 0 or more.`);
      });
      yarnShadeProblems(l, procs).forEach((m) => need("process", `${at}: ${m}`));
    });
    if (!kept) need("lines", "Add at least one yarn.");
  }

  if (input.iwo_for === "fabric") {
    let kept = 0;
    input.fabric.forEach((l, i) => {
      if (isBlankFabricLine(l)) return;
      kept++;
      const at = `Fabric line ${i + 1}`;
      if (!l.item_id) need("lines", `${at}: choose the fabric.`);
      if (!l.stage_id) need("lines", `${at}: choose the stage.`);
      if (!(l.planned_kgs != null && l.planned_kgs > 0))
        need("lines", `${at}: enter the Planned Weight in KGS.`);
      if (l.gsm != null && !(l.gsm > 0)) need("lines", `${at}: GSM must be a number more than 0.`);
      l.processes
        .filter((p) => !isBlankFabricProcess(p))
        .forEach((p, j) => {
          const pat = `${at}, process row ${j + 1}`;
          if (!p.process_id) need("process", `${pat}: choose the process.`);
          const loss = p.loss_pct ?? 0;
          if (!(loss >= 0 && loss < 100))
            need("process", `${pat}: Loss % must be 0 or more and below 100.`);
          if (p.rate_per_kg != null && !(p.rate_per_kg >= 0))
            need("process", `${pat}: the rate must be a number, 0 or more.`);
        });
    });
    if (!kept) need("lines", "Add at least one fabric.");
  }

  if (input.iwo_for === "accessories") {
    let kept = 0;
    input.accessories.forEach((l, i) => {
      if (isBlankAccessoryLine(l)) return;
      kept++;
      const at = `Accessory line ${i + 1}`;
      if (!l.item_id) need("lines", `${at}: choose the item.`);
      if (!l.uom_id) need("lines", `${at}: choose the unit.`);
      if (!(l.planned_qty != null && l.planned_qty > 0))
        need("lines", `${at}: enter the Planned Quantity.`);
      l.processes
        .filter((p) => !isBlankAccessoryProcess(p))
        .forEach((p, j) => {
          const pat = `${at}, process row ${j + 1}`;
          if (!p.process_id) need("process", `${pat}: choose the process.`);
          if (p.rate_per_unit != null && !(p.rate_per_unit >= 0))
            need("process", `${pat}: the rate must be a number, 0 or more.`);
        });
    });
    if (!kept) need("lines", "Add at least one accessory.");
  }

  return out;
}
