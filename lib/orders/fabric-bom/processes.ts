/**
 * "Which processes may this fabric's route name, and what does each step cost?"
 * — the Fabric BOM ▸ Fabric Process tab (0492).
 *
 * Client screenshot 2588: the legacy "Prepare fabric BOM for Garment order"
 * screen's **FabricProcess** tab, a fabric-by-fabric route — GREY ▸ KNITTING,
 * DYED ▸ DYEING [WITH BIOWASH] — with a Loss % against each step.
 *
 * Client-safe on purpose (no `server-only`), exactly like
 * `lib/orders/amendments/style-processes.ts` which this file is modelled on and
 * `lib/masters/vendor-nominations.ts` which that one was: the narrowing runs in
 * the browser inside the picker, so nothing about it costs a round trip. The
 * server half is `getFabricProcessOptions()` in `service.ts`, which is where
 * the Supabase client is.
 *
 * ## THIS TAB DECLARES A ROUTE. IT DOES NOT RE-COST THE BOM.
 *
 * 0426 is explicit that `order_fabric_bom_lines.wastage_pct` is "the CUTTING
 * room's buffer. NOT process loss — that is step 4, and applying it here as
 * well charges the same loss twice", and that rule is untouched: nothing in
 * this file is read by `./requirement.ts`, and Calculated Quantities on the
 * Fabric BOM is the same figure before and after this tab exists.
 *
 * What `loss_pct` is for is step 4. `order_fabric_plan_stages` (0427) carries
 * the identical pair — a process and a loss — and solves
 * `input = output / (1 - loss/100)` backwards from this BOM's requirement,
 * with (as `copyRouteToRest` says in as many words) "deliberately no built-in
 * default route". So the route is stated once here, on the document that
 * already knows which fabrics exist, and the Fabric Plan seeds from it.
 *
 * **One number, one author, two readers.** A reader tempted to make this tab's
 * loss compound into the requirement is holding the double-count 0426 names.
 *
 * ## THE THREE ▾ COLUMNS ARE LOOKUPS, NOT `as const` VALUES
 *
 * Stage, Loss for and Type are `config_lookups` kinds (`fabric_stage`,
 * `process_loss_for`, `fabric_process_type`) reached through
 * `LookupDialogPicker`, so this file declares no vocabulary for them at all.
 * The legacy screen shows GREY and DYED under Stage, "Process wise" under
 * LossFor and NOTHING under Type — an open ▾ whose contents no screenshot
 * reveals, which is the precise case `vendor_item_form` / `vendor_supply_type`
 * (0369) set the precedent for. 0492 seeds only what the screenshot shows.
 *
 * Contrast `KNIT_TYPE_OPTIONS` in `./types.ts`, which IS an `as const`: three
 * fixed answers that are also `fabric_structure`'s own codes. The test is
 * whether the list is closed, not whether it is short.
 */

import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";
import type { ConfigLookup } from "@/lib/masters/extras-types";

/**
 * A process as the picker needs it: identity, the disable flag, and the one
 * applicability flag the narrowing reads.
 *
 * `for_fabric` comes down to the browser rather than being filtered in SQL, for
 * the reason AGENTS.md gives under "Disabled rows": a process whose flag is
 * unticked on the master AFTER this BOM named it must stay visible on the row
 * that holds it, or a filled field renders as empty and the next save blanks
 * the FK. `getProcessRows` in `lib/orders/fabric-plan/service.ts` reads the
 * same flag for the same tab one step later.
 */
export type FabricProcessOption = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  for_fabric: boolean;
};

/**
 * One row of the Fabric Process grid, in client state.
 *
 * `item_id` IS THE GROUP, AND IT IS A STABLE MASTER ID.
 *
 * A route belongs to the FABRIC, not to a BOM line (0492): a rib used for a
 * collar and the same rib used for a cuff are two lines and one route. Keying
 * on the item also sidesteps the trap the first cut walked into —
 * `order_fabric_bom_lines` ids are rewritten on every save (`writeLines`
 * deletes and re-inserts, matching back by `sno`), so nothing keyed to a line
 * survives one, and these rows had to travel nested inside their line to be
 * written at all. An `items` id survives everything.
 */
export type FabricProcessRow = {
  key: string;
  /** The fabric this step belongs to — an `items` row of item class FABRIC. */
  item_id: string;
  /** GREY / DYED — the state the fabric ENTERS this step in, not the step. */
  stage_id: string | null;
  process_id: string | null;
  /** How the loss below is measured — "Process wise" on the legacy screen. */
  loss_for_id: string | null;
  /**
   * FREE TEXT, though legacy draws it as a [Click] opening a sub-list.
   *
   * Same call, same evidence and same words as the Garment Order's own
   * Style ▸ Process grid (`style-processes.ts`): the Process cell beside it
   * carries the ⓘ glyph every master-backed field in this app carries, and this
   * one carries none. A third nesting level — BOM ▸ fabric ▸ process ▸
   * descriptions — is scope nobody has asked for, and AGENTS.md bans the
   * card-opens-a-card shape one module over.
   *
   * `string`, not `string | null`, because it is bound to an `<Input>` whose
   * empty state is `""`. The null lives in the database and at the boundary.
   */
  description: string;
  /** Text for the same reason: bound to an `<Input>`, converted once, at save. */
  loss_pct: string;
  /** The fabric-wise rate this stage costs. Text, for `loss_pct`'s reason. */
  rate: string;
  type_id: string | null;
};

export const blankFabricProcess = (key: string, itemId: string): FabricProcessRow => ({
  key,
  item_id: itemId,
  stage_id: null,
  process_id: null,
  loss_for_id: null,
  description: "",
  loss_pct: "",
  rate: "",
  type_id: null,
});

/**
 * The processes offered on a fabric's route.
 *
 * `currentValue` is the id this row already holds; it is re-admitted AFTER the
 * filter, never before it, so it survives without widening the list for any
 * other row. That is the "Disabled rows" rule and it is the whole reason this
 * narrowing is not a `.eq("for_fabric", true)` in SQL.
 *
 * NO BLANK-PARENT BRANCH, and the difference from `processesForKind` is worth
 * stating because the two files otherwise read alike. There, Type DECIDES WHICH
 * LIST, so a blank Type offers nothing. Here there is no parent field: every
 * process flagged `for_fabric` is a legitimate answer on every fabric's route,
 * and Stage describes the fabric rather than choosing a vocabulary.
 */
export function processesForFabric(
  options: readonly FabricProcessOption[],
  opts: { currentValue?: string | null } = {},
): FabricProcessOption[] {
  const held = opts.currentValue ?? null;
  const flagged = options.filter((p) => p.for_fabric);
  if (!held || flagged.some((p) => p.id === held)) return flagged;
  const kept = options.find((p) => p.id === held);
  return kept ? [...flagged, kept] : flagged;
}

/**
 * Has the operator started this row?
 *
 * Two readers, as everywhere else in this repo: the save path drops a row this
 * calls false, and the screen marks a row's cells `required` only when it calls
 * true. One function, so they cannot disagree — a disagreement here is either
 * an operator caged on a row that is about to be discarded, or a half-filled
 * row vanishing on save.
 */
export function fabricProcessRowStarted(
  r: Pick<
    FabricProcessRow,
    | "stage_id"
    | "process_id"
    | "loss_for_id"
    | "description"
    | "loss_pct"
    | "rate"
    | "type_id"
  >,
): boolean {
  return (
    !!r.stage_id ||
    !!r.process_id ||
    !!r.loss_for_id ||
    !!r.type_id ||
    !!r.description.trim() ||
    !!r.loss_pct.trim() ||
    !!r.rate.trim()
  );
}

/**
 * What a route says about itself in one line — used for the `done` dot and the
 * per-fabric summary. Counts only rows that NAME A PROCESS: a row carrying just
 * a stage is started (so its cells hold the cursor) but is not yet a step step 4
 * could plan, and reporting it as one would overstate the document.
 */
export function routeStepCount(rows: readonly FabricProcessRow[]): number {
  return rows.filter((r) => !!r.process_id).length;
}

/** How many stages one fabric's route may chain (client spec 2026-09-01: "the
 *  system must support up to 4 distinct stages"). The grid stops offering
 *  "+ Add process" here; nothing in the database refuses a fifth, which 0492's
 *  header states rather than leaves to be discovered. */
export const MAX_ROUTE_STAGES = 4;

/**
 * The three operator-filled ▾ lists behind Stage, Loss for and Type (0492).
 *
 * DECLARED HERE, WHICH IS THE ONLY PLACE BOTH SIDES CAN SEE. The grid is a
 * client component and `service.ts` is `server-only`, so a shape named in
 * either one has to be restated in the other — and two structurally identical
 * types with different names is how a third reader comes to add a fourth list
 * to one of them. This file is already the client-safe home for the rule and
 * the schema; the lists belong beside them.
 *
 * `ConfigLookup` rather than a narrowed row type: `LookupDialogPicker` takes the
 * lookup whole (it hides an inactive one itself, and keeps the one a record
 * holds), so narrowing here would only cost the picker information it uses.
 */
export type FabricProcessLookups = {
  stages: ConfigLookup[];
  lossFor: ConfigLookup[];
  types: ConfigLookup[];
};

/**
 * One route row as the payload carries it.
 *
 * A PLAIN TOP-LEVEL CHILD, LIKE `dias`, AND IT TOOK TWO WRONG SHAPES TO GET HERE.
 *
 * Keyed on a line, these rows could not be sent at all: line ids do not exist
 * until `writeLines` has re-inserted them. The first cut sent a `line_sno` for
 * the action to resolve, which quietly required the SCREEN to know which lines
 * `normalizeLines` was about to drop — two places deciding what counts as an
 * empty row, the split `normalizeDias`' own note warns against. The second cut
 * nested them inside their line, like 0491's `sizes`, which fixed that.
 *
 * Re-keying to `item_id` (0492) dissolves the problem rather than working
 * around it: an `items` id is stable, so the rows need neither a resolution
 * step nor a carrier. Both earlier shapes are recorded because each was the
 * right answer to the constraint it was written under.
 */
export const fabricBomProcessInput = z.object({
  item_id: z.string().uuid(),
  sno: z.coerce.number().int().nonnegative().default(0),
  stage_id: z.string().uuid().nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  loss_for_id: z.string().uuid().nullable().default(null),
  /* CAPSED IN THE SCHEMA, like `notes` and `color_name` on the line beside it.
     AGENTS.md's CAPITALS section puts the transform here rather than in the
     action, and withdrew the free-text exemption on 2026-08-18 — a reader who
     finds the older "not capsed: a free-text remark" note on `styleProcessInput`
     is holding what that supersedes. */
  description: capsTextNullable(),
  /* THE CEILING IS 100 EXCLUSIVE, borrowed from 0427's CHECK and stated at both
     ends deliberately. At exactly 100 step 4's backward solve divides by zero,
     which in JS is Infinity rather than an error — so a figure refused there
     must be refused where it is WRITTEN, or the BOM saves a route that cannot
     be planned and nothing says why. */
  loss_pct: z.coerce.number().min(0).lt(100).nullable().default(null),
  /* THE FABRIC-WISE PROCESSING RATE (client spec 2026-09-01). Non-negative for
     `order_budget_lines.rate`'s reason (0428): zero is a real line, negative
     would subtract from the cost total a purchase ceiling is checked against. */
  rate: z.coerce.number().min(0).nullable().default(null),
  type_id: z.string().uuid().nullable().default(null),
});

export type FabricBomProcessInput = z.infer<typeof fabricBomProcessInput>;

/* THE NORMALIZER IS NOT HERE, DELIBERATELY — `normalizeProcesses` lives in
   actions.ts beside `normalizeLines` and `normalizeDias`, which answer the
   identical question for the two children written in the same pass and need the
   same list of lines. A second copy here would be a second answer to "which
   rows is this save keeping?", and the two would drift the first time the
   orphan rule changed on one side only. Same division `style-processes.ts`
   records. */
