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
  /** Is this process a PRINT step (AOP, rotary, bit printing, …)? (0528) —
   *  `processesForFabric` reads it to refuse "Print" until the order has
   *  declared a Roll form print / AOP. */
  is_print: boolean;
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
  /**
   * WHICH GROUP THIS STEP BELONGS TO, when the fabric's route is split (0528).
   * Both null is the unified route (0492's original shape); `combo` alone is
   * a colour-wise route; `component_id` alone is a component-wise route; both
   * set is the combined grain. See `FabricProcessGroup` and `processGroupsFor`
   * for how a fabric's toggles turn into the list of groups a screen renders.
   */
  combo: string | null;
  component_id: string | null;
  /** GREY / DYED — the state the fabric ENTERS this step in, not the step. */
  stage_id: string | null;
  process_id: string | null;
  /** How the loss below is measured — "Process wise" on the legacy screen. */
  loss_for_id: string | null;
  /* `description` WAS HERE AND THE CLIENT REMOVED IT (2026-09-04 recording:
     "this description column is not needed"). Column, row field, payload
     schema and DB column all went together (0528) — the same shape `rate`
     left in 0521. */
  /** Text for the same reason: bound to an `<Input>`, converted once, at save. */
  loss_pct: string;
  /* `rate` WAS HERE AND THE CLIENT REMOVED IT (2026-09-03, screenshot 2663).
     It held the fabric-wise processing rate this step costs, asked for in the
     spec of 2026-09-01 and never filled in — `order_fabric_bom_processes` held
     0 rows when the column was dropped (0521), so nothing was lost.

     THE ROUTE IS A QUANTITY DOCUMENT AGAIN, which is what it already claimed to
     be everywhere else: the Budget's own note says "the Yarn Process tab stores
     no rate — it is a quantity document, not a priced one — so the planner types
     it here". The fabric route was the one place that disagreed with that
     sentence, and now it does not. A price belongs on the Budget. */
  type_id: string | null;
};

export const blankFabricProcess = (
  key: string,
  itemId: string,
  group: { combo?: string | null; component_id?: string | null } = {},
): FabricProcessRow => ({
  key,
  item_id: itemId,
  combo: group.combo ?? null,
  component_id: group.component_id ?? null,
  stage_id: null,
  process_id: null,
  loss_for_id: null,
  loss_pct: "",
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
 *
 * `printDeclared` IS THE 0528 GATE — "block the dyer/planner from selecting
 * Print as a process sequence stage" until the order has an AOP / Roll form
 * print declared. Same shape as the `for_fabric` narrowing one line up: a
 * PRINT-flagged process is withheld from the OFFERED list, never blocked after
 * the fact with a toast, and a row that already holds one (declared before the
 * print was removed, say) survives via `currentValue` exactly as an
 * unflagged-for-fabric process would. Default `true` — most callers of this
 * function are not the Fabric Process screen (`processesForFabric.spec`-style
 * unit tests, storybook, …), and a gate that silently activates itself would
 * be a worse surprise than one a caller must opt into is safe.
 */
export function processesForFabric(
  options: readonly FabricProcessOption[],
  opts: { currentValue?: string | null; printDeclared?: boolean } = {},
): FabricProcessOption[] {
  const held = opts.currentValue ?? null;
  const printDeclared = opts.printDeclared ?? true;
  const flagged = options.filter((p) => p.for_fabric && (printDeclared || !p.is_print));
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
  r: Pick<FabricProcessRow, "stage_id" | "process_id" | "loss_for_id" | "loss_pct" | "type_id">,
): boolean {
  return !!r.stage_id || !!r.process_id || !!r.loss_for_id || !!r.type_id || !!r.loss_pct.trim();
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
 * Does this row hold a PRINT process while the order has none declared? The
 * inline twin of the picker narrowing in `processesForFabric` — that function
 * withholds Print from the OFFERED list; this one says why a row that already
 * holds one (saved before the print was removed, or before this gate existed)
 * is showing a process the operator could not pick again today. Same idiom as
 * the "no fabric line uses this any more" warning on the outer row: named on
 * screen rather than silently accepted.
 */
export function printBlocked(
  row: Pick<FabricProcessRow, "process_id">,
  options: readonly FabricProcessOption[],
  printDeclared: boolean,
): boolean {
  if (printDeclared || !row.process_id) return false;
  return !!options.find((p) => p.id === row.process_id)?.is_print;
}

/**
 * ONE FABRIC'S TWO TOGGLES (0528) — "[Assort Color]" / "[Components]" on
 * legacy's outer row, read as CONTROLS rather than as a second copy of what
 * Fabric Lines already states. Storage is `order_fabric_bom_process_scope`,
 * one row per (bom, fabric); a fabric with no row yet reads as both off,
 * which is 0492's original "one unified route" shape.
 */
export type FabricProcessScope = {
  item_id: string;
  assort_color_wise: boolean;
  component_wise: boolean;
};

export const blankFabricProcessScope = (itemId: string): FabricProcessScope => ({
  item_id: itemId,
  assort_color_wise: false,
  component_wise: false,
});

/** One GROUP a fabric's route is split into — the unit `FabricProcessGrid`
 *  renders one grid for. `combo`/`component_id` null mean that axis is not
 *  the grouping (the toggle is off, or the other axis alone is). */
export type FabricProcessGroup = {
  key: string;
  combo: string | null;
  component_id: string | null;
  /** What the panel over this group's grid is headed with. */
  label: string;
};

/**
 * The groups one fabric's route renders as, from its two toggles and the
 * colourways / panels that fabric actually serves (the same `combos` /
 * `panelIds` the outer row already lists — never a second, wider list).
 *
 * FOUR SHAPES, READ OFF THE CLIENT'S OWN THREE CASES PLUS THE ONE THEY DID NOT
 * NAME:
 *
 * - both off  → Case A, one group, the unified route.
 * - colour only → Case B, one group per colourway.
 * - component only → Case C, one group per component.
 * - both on → not named on the call. Taken as the two axes narrowing the same
 *   grouping AT ONCE — one group per (colourway, component) PAIR — since nothing
 *   in either Case says the two toggles answer different questions. If the
 *   client means something else (say, two independent single-axis splits
 *   shown side by side), this is the one function to change; nothing else in
 *   this file assumes the cross product.
 *
 * A colourway or panel with nothing to iterate (a fabric that serves no
 * colourway yet, say) still gets exactly the unified group back — an empty
 * axis cannot make a route disappear; it makes that axis inert, the same as
 * the toggle being off.
 */
export function processGroupsFor(
  scope: Pick<FabricProcessScope, "assort_color_wise" | "component_wise">,
  combos: readonly string[],
  components: readonly { id: string; name: string }[],
): FabricProcessGroup[] {
  const colours: (string | null)[] = scope.assort_color_wise && combos.length ? [...combos] : [null];
  const panels: { id: string | null; name: string }[] =
    scope.component_wise && components.length ? [...components] : [{ id: null, name: "" }];
  const groups: FabricProcessGroup[] = [];
  for (const combo of colours) {
    for (const panel of panels) {
      const label = [combo, panel.name || null].filter(Boolean).join(" · ") || "Route";
      groups.push({ key: `${combo ?? ""}::${panel.id ?? ""}`, combo, component_id: panel.id, label });
    }
  }
  return groups;
}

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
  /* WHICH GROUP, when the fabric's route is split (0528) — both null is the
     unified route. Same spelling and same nullability as the line's own
     `combo`; see `FabricProcessRow`. */
  combo: capsTextNullable(),
  component_id: z.string().uuid().nullable().default(null),
  sno: z.coerce.number().int().nonnegative().default(0),
  stage_id: z.string().uuid().nullable().default(null),
  process_id: z.string().uuid().nullable().default(null),
  loss_for_id: z.string().uuid().nullable().default(null),
  /* NO `description`. It was here from 0492 and the client removed the column
     on 2026-09-04 ("this description column is not needed"). Gone from the
     SCHEMA and not merely from the screen — the same reason `rate` left in
     0521: `lib/data-io` parses imports with this schema, so a field left
     standing here would be a door the grid has closed and an import could
     still walk through. */
  /* THE CEILING IS 100 EXCLUSIVE, borrowed from 0427's CHECK and stated at both
     ends deliberately. At exactly 100 step 4's backward solve divides by zero,
     which in JS is Infinity rather than an error — so a figure refused there
     must be refused where it is WRITTEN, or the BOM saves a route that cannot
     be planned and nothing says why. */
  loss_pct: z.coerce.number().min(0).lt(100).nullable().default(null),
  /* NO `rate`. It was here from the spec of 2026-09-01 and the client removed
     the column on 2026-09-03 — see `FabricProcessRow`. It is gone from the
     SCHEMA and not merely from the screen, deliberately: `lib/data-io` parses
     imports with these same schemas, so a field left standing here would be a
     door the grid has closed and an import can still walk through. */
  type_id: z.string().uuid().nullable().default(null),
});

export type FabricBomProcessInput = z.infer<typeof fabricBomProcessInput>;

/**
 * One fabric's two toggles, as the payload carries them (0528). A plain
 * top-level child like `fabricBomProcessInput` above and for the same reason
 * — `item_id` is a stable master id, so this needs no carrier and no
 * resolution step.
 */
export const fabricBomProcessScopeInput = z.object({
  item_id: z.string().uuid(),
  assort_color_wise: z.coerce.boolean().default(false),
  component_wise: z.coerce.boolean().default(false),
});

export type FabricBomProcessScopeInput = z.infer<typeof fabricBomProcessScopeInput>;

/* THE NORMALIZER IS NOT HERE, DELIBERATELY — `normalizeProcesses` lives in
   actions.ts beside `normalizeLines` and `normalizeDias`, which answer the
   identical question for the two children written in the same pass and need the
   same list of lines. A second copy here would be a second answer to "which
   rows is this save keeping?", and the two would drift the first time the
   orphan rule changed on one side only. Same division `style-processes.ts`
   records. */
