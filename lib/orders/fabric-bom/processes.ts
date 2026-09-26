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
import { isRouteStart, narrowToStage } from "./stage-routes";
import type { FabricStageRole } from "./stage-routes";

/* THE STAGE ROUTE RULE LIVES NEXT DOOR (0563), AND IS RE-EXPORTED HERE so that
   a screen reads one import for the whole Fabric Process contract — the
   narrowing, its two inline twins and the two predicates they are built from
   arrive together, the way `printBlocked` and `dyeingBlocked` already sit
   beside `processesForFabric` below. EVERY public name in that file is
   re-exported here deliberately: a consumer reaching past this barrel for one
   sibling is how a module comes to have two import paths. It is a
   separate FILE because it is a separate rule with a long reasoning of its own
   (which stage a process may run in, and what an unclassified process is
   offered for); see `./stage-routes.ts`. The dependency runs one way only —
   that file imports nothing from here but types. */
export {
  baseProcessesForStage,
  baseProcessMissing,
  baseProcessRepeated,
  /* 0583 — a bought roll starts the route. */
  clothPurchaseNotFirst,
  /* 2026-09-19 — the three route rules: Step 1 for a purchase, no fabric
     dyeing on yarn-dyed cloth, and no process twice within one stage. */
  dyeingBlocked,
  processesUsedInStage,
  processRepeatedInStage,
  /* 2026-09-20 — a route START (purchase or Knitting) is Step 1 only, and a
     yarn-dyed fabric enters the DYED stage only as a dyed-roll purchase. */
  isRouteStart,
  routeStartAllowedAt,
  routeStartNotFirst,
  isDyedStage,
  dyedStageAllowedOnYarnDyed,
  yarnDyedStageBlocked,
  washStageBlocked,
  isWashStage,
  narrowToStage,
  stageAllowsProcess,
  stageMismatchBlocked,
  /* The forward-only half of the same rule (0570) — see that file's second
     block comment. `stageRouteProblems` is the one BOTH the screen's Save gate
     and the server action read, which is what stops "what the grid warns
     about" and "what Save refuses" from drifting apart. */
  stageRank,
  /* 2026-09-19 — which stages are coloured (a yarn step there is a dyeing step). */
  colouredStageIds,
  stageRegressionBlocked,
  stageRouteProblems,
  stagesForRow,
} from "./stage-routes";
export type { FabricStageGates, FabricStageLike, FabricStageRole } from "./stage-routes";
import { FABRIC_SOURCES, type FabricSource } from "./fabric-source";
/* ONE DEFINITION OF "NAMES A COLOURWAY", shared with `stageCoversCombo` — see
   `processRowInScope`'s header for the whitespace case that makes borrowing it
   different from writing `!!combo`. One-way import: `./yarn-process` reaches
   nothing here, directly or transitively. */
import { comboKey } from "./yarn-process";
import { colorLossKey, colorLossesInput, type ColorLossDraft } from "./color-loss";

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
  /** LOOSE FABRIC CONVERSION (0633) — `processes.is_unravelling`. Withheld
   *  from every route except a linked loose fabric's (`looseFabricRoute`).
   *  Optional so fixtures and IWO rows written before it read as "not". */
  is_unravelling?: boolean;
  /** Is this process a PRINT step (AOP, rotary, bit printing, …)? (0528) —
   *  `processesForFabric` reads it to refuse "Print" until the order has
   *  declared a Roll form print / AOP. */
  is_print: boolean;
  /** Is this a FABRIC-STAGE Dyeing step? (0557) — `processesForFabric` reads
   *  it to withhold Dyeing from a Yarn-Dyed fabric's offered route (doc/order/
   *  update.md §7.3: "skip the standard Fabric Dyeing stage logic"). */
  is_dyeing: boolean;
  /**
   * Is this the GREIGE KNITTING step? (0564.)
   *
   * READ BY THE DEMAND ENGINE, and since 2026-09-20 BY THE PICKER TOO. It
   * decides what a declared route COSTS — a fabric bought as greige rolls does
   * not pay for knitting, so the step leaves the ladder (`./fabric-source.ts`).
   * And it marks a ROUTE START (`isRouteStart` in `./stage-routes.ts`): the
   * client ruled that Knitting, like a cloth purchase, is Step 1 only ("fabric
   * cannot be purchased or re-knitted after knitting/processing has begun").
   * That REVERSES the 0564 reading that "a purchased cloth's route may still
   * record that it was knitted, by somebody else": with a purchase fixed at
   * Step 1 (2026-09-19), Knitting below it could only mean knitting bought
   * cloth, so it is withheld and refused rather than greyed.
   */
  is_knitting: boolean;
  /**
   * Does this step BUY the cloth rather than make it? (0583.) FABRIC PURCHASE
   * (base of Greige) and DYED FABRIC PURCHASE (base of Dyed).
   *
   * READ BY `sourceFromRoute` (`./fabric-source.ts`): a route whose branch
   * OPENS with one of these is a bought fabric, and the stage it opens in says
   * which purchase — the Rule 2 source the hidden Source ▾ was always meant to
   * carry. OPTIONAL so a fixture or caller written before 0583 reads as "not
   * a purchase", which is the answer every pre-0583 route had.
   */
  is_cloth_purchase?: boolean;
  /**
   * The master's sub-categories under this process — DYEING ▸ WITH BIOWASH,
   * WASHING ▸ BIOWASH / HOTWASH (0227's `process_sub_categories`). Empty when
   * the master's "Has Sub Categories" is off, whatever rows linger beneath it.
   *
   * THE RULES NEVER READ THIS. A sub-category runs in exactly the stages its
   * process runs in, is a base exactly when its process is, and prints when
   * its process prints — so every narrowing, twin and Save rule keeps working
   * on the process-level list, and only the PICKER expands it
   * (`processPickerItems`). Optional for the same pre-0583 reason as above.
   */
  sub_categories?: FabricProcessSubCategory[];
  /** Which fabric stages this process may run in, and where it is that stage's
   *  mandatory entry step (0563, `process_fabric_stages`). Empty =
   *  UNCLASSIFIED, which this module reads as "offered in every stage" — the
   *  call and its reasoning are in `./stage-routes.ts`'s header, and it is a
   *  deliberate choice rather than a fallback. */
  stage_roles: FabricStageRole[];
};

/** One of a process's sub-categories, as the picker lists it (0583).
 *  `hidden` = the master's "Has Sub Categories" is off: still resolvable for
 *  a route that holds it, never offered for a new pick. */
export type FabricProcessSubCategory = { id: string; name: string; hidden?: boolean };

/**
 * What a route step reads as — "DYEING [WITH BIOWASH]", the way legacy
 * screenshot 2588 writes it, or the plain process name when no sub-category is
 * named. ONE function behind the grid, the stage ledger and both reports, so
 * the same step never reads two ways in one document.
 *
 * A sub-category the master no longer lists falls back to the bare process
 * name rather than printing a uuid — the `creatorName()` rule, one column over.
 */
export function processLabel(
  option: Pick<FabricProcessOption, "name" | "sub_categories"> | null | undefined,
  subCategoryId: string | null | undefined,
): string {
  if (!option) return "";
  const sub = subCategoryId ? option.sub_categories?.find((s) => s.id === subCategoryId) : null;
  return sub ? `${option.name} [${sub.name}]` : option.name;
}

/**
 * THE PROCESS ▾'s ITEMS — each process, then one entry per sub-category
 * beneath it (client 2026-09-19: "sub-categories created under master
 * processes are not showing up in the process dropdown").
 *
 * The id of a sub-category entry is `processId|subId`, so one picker value
 * carries both halves; `splitProcessPick` is its inverse. A `|` cannot occur
 * inside a uuid, so the split cannot be spoofed by a value.
 *
 * THE INPUT IS THE ALREADY-NARROWED LIST (`processesForFabric`'s output), so a
 * sub-category is offered exactly where its process is and nowhere else — the
 * stage, print and yarn-dyed gates reach it without knowing it exists.
 *
 * THE HELD SUB-CATEGORY SURVIVES a master that has since removed it or turned
 * "Has Sub Categories" off: the row's own value is re-admitted, labelled with
 * whatever name is still known, the "Disabled rows" rule one level down.
 */
export function processPickerItems(
  narrowed: readonly FabricProcessOption[],
  held?: { process_id?: string | null; sub_category_id?: string | null },
): { id: string; code: string | null; name: string; inactive: boolean }[] {
  const out: { id: string; code: string | null; name: string; inactive: boolean }[] = [];
  for (const p of narrowed) {
    out.push({ id: p.id, code: p.code, name: p.name, inactive: p.inactive });
    for (const s of p.sub_categories ?? []) {
      if (s.hidden) continue;
      out.push({ id: `${p.id}|${s.id}`, code: null, name: `${p.name} [${s.name}]`, inactive: p.inactive });
    }
  }
  const heldId = held?.process_id && held.sub_category_id ? `${held.process_id}|${held.sub_category_id}` : null;
  if (heldId && !out.some((o) => o.id === heldId)) {
    /* Held but not offered — hidden on the master, or deleted. `inactive` so
       the picker greys it and it cannot be re-picked, the "Disabled rows"
       shape; named from the master when the master still knows it. */
    const parent = narrowed.find((p) => p.id === held!.process_id);
    const label = processLabel(parent, held!.sub_category_id);
    out.push({
      id: heldId,
      code: null,
      name: parent && label !== parent.name ? label : `${parent?.name ?? "PROCESS"} [(sub-category removed)]`,
      inactive: true,
    });
  }
  return out;
}

/** The picker value for a row — the inverse of `splitProcessPick`. */
export function processPickValue(
  row: { process_id?: string | null; sub_category_id?: string | null },
): string | null {
  if (!row.process_id) return null;
  return row.sub_category_id ? `${row.process_id}|${row.sub_category_id}` : row.process_id;
}

/** A picker value back to the two columns it stands for. */
export function splitProcessPick(value: string | null): {
  process_id: string | null;
  sub_category_id: string | null;
} {
  if (!value) return { process_id: null, sub_category_id: null };
  const [process_id, sub_category_id] = value.split("|");
  return { process_id: process_id || null, sub_category_id: sub_category_id || null };
}

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
  /** Which of `process_id`'s sub-categories this step runs — DYEING ▸ WITH
   *  BIOWASH (0583). Null = the process itself. OPTIONAL so a row built by a
   *  caller that predates 0583 (IWO Fabric BOM, whose own table has no such
   *  column) type-checks and simply names none. */
  sub_category_id?: string | null;
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
  /** ASSORT COLOR-WISE LOSS (0606) — this step loses a different % per
   *  colourway, held in `color_losses` (text, like `loss_pct`). OPTIONAL so a
   *  caller with no such column (IWO Fabric BOM) builds a well-formed row that
   *  simply is not colour-wise. See `./color-loss.ts`. */
  color_wise_loss?: boolean;
  color_losses?: ColorLossDraft;
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
  sub_category_id: null,
  loss_for_id: null,
  loss_pct: "",
  type_id: null,
  color_wise_loss: false,
  color_losses: {},
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
 *
 * `fabricIsYarnDyed` IS THE 0557 GATE (doc/order/update.md §7.3) — withhold a
 * `is_dyeing`-flagged process from a Yarn-Dyed fabric's route, since a
 * yarn-dyed fabric's dyeing loss is already carried on the YARN side
 * (`order_fabric_bom_yarn_stages`, 0493) and a Fabric Dyeing step here would
 * double it. Same idiom as `printDeclared` in every respect: withheld from the
 * OFFERED list rather than blocked after the fact, a row that already holds
 * one survives via `currentValue`, and it defaults `false` (never withhold)
 * for the same "most callers are not this screen" reason `printDeclared`
 * defaults `true` — an unfilled call site should see every process it always
 * has, not silently start hiding Dyeing.
 *
 * `stageId` / `isFirstOfStage` ARE THE 0563 GATE (doc/order/fabriprocess.md
 * §1, §3) — a process may only be offered in a stage `process_fabric_stages`
 * allows it in, and the step that OPENS a stage may only be that stage's
 * mandatory base process. This is the one narrowing here that is a stock-ledger
 * rule rather than a costing one: the stage decides which of the four fabric
 * stock ledgers a step's weight is logged against, so `Stage = Dyed,
 * Process = Knitting` files greige cloth as dyed. The rule, the stand-down when
 * a stage has no pickable base, and what an UNCLASSIFIED process is offered
 * for all live in `./stage-routes.ts`; only the delegation is here.
 *
 * Both default to NOT narrowing, for the third time in this function's history
 * and the same reason each time: an unfilled call site must see every process
 * it always has, rather than have a gate activate itself silently.
 *
 * THE HELD VALUE IS RE-ADMITTED ONCE, AFTER EVERY NARROWING, which is why the
 * stage rule is applied here rather than inside the filter above — a rule that
 * re-admitted `currentValue` itself would let the next rule withhold it again.
 */
export function processesForFabric(
  options: readonly FabricProcessOption[],
  opts: {
    currentValue?: string | null;
    printDeclared?: boolean;
    fabricIsYarnDyed?: boolean;
    /** 0563 — the stage this row enters the fabric in. `undefined`/`null` = no
     *  stage narrowing at all. */
    stageId?: string | null;
    /** 0563 — is this the FIRST step of its stage in this route? Then only that
     *  stage's mandatory BASE process(es) are offered — unless none of them is
     *  pickable, where the restriction stands down rather than offering an
     *  empty list. See `narrowToStage`. */
    isFirstOfStage?: boolean;
    /** May this row START the route — buy the cloth (2026-09-19) or knit it
     *  (2026-09-20)? False on any row with a step above it
     *  (`routeStartAllowedAt`): a route start is Step 1 or nothing. Applied
     *  with the flag gates, BEFORE the stage narrowing, so a Dyed stage
     *  opened on row 3 stands down to its other base rather than offering
     *  DYED FABRIC PURCHASE. Default true = withhold nothing. */
    routeStartAllowed?: boolean;
    /** 0633 — is this a linked LOOSE FABRIC's route? Only then is CONVERSION
     *  (unravelling) offered. Default false. Mirrors `gatedForStage`. */
    looseFabricRoute?: boolean;
    /* NO `usedInStage` HERE, deliberately. "A stage runs each process once"
       is enforced by the picker's own `usedIds` (`processesUsedInStage`),
       which keeps a taken process VISIBLE, greyed "(already added)", rather
       than removing it — `DataPicker`'s standing reason: a vanished process
       reads as missing from the master. This function decides what is LEGAL
       here; a sibling holding it is a different fact. */
  } = {},
): FabricProcessOption[] {
  const held = opts.currentValue ?? null;
  const printDeclared = opts.printDeclared ?? true;
  const fabricIsYarnDyed = opts.fabricIsYarnDyed ?? false;
  const routeStartAllowed = opts.routeStartAllowed ?? true;
  const flagged = narrowToStage(
    options.filter(
      (p) =>
        /* A LOOSE FABRIC'S CONVERSION STEP NEEDS NO "Fabric" TICK (2026-09-26): the
           spec requires it on that route and `conversionStepProblems` refuses the Save
           without it, so the master's KIND flag (`is_unravelling`) is enough there.
           Found live with the process renamed CONVERSION and For Fabric unticked —
           the injected route silently lost its third step and every Save refused. */
        /* CONVERSION IS NEVER OFFERED ON A FABRIC ROUTE (client spec
           2026-09-26, "Exclude CONVERSION Process from Fabric Process Tab"): it
           unravels loose fabric into yarn, so it is a Yarn Process step only.
           A route SAVED with it keeps it — the held value survives below, the
           "Disabled rows" rule — and its loss still counts where the yarn
           states none (`planConversions`). `looseFabricRoute` is kept for
           callers and no longer widens the list. */
        p.for_fabric &&
        !p.is_unravelling &&
        (printDeclared || !p.is_print) &&
        (!fabricIsYarnDyed || !p.is_dyeing) &&
        (routeStartAllowed || !isRouteStart(p)),
    ),
    { stageId: opts.stageId, isFirstOfStage: opts.isFirstOfStage },
  );
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

/* `MAX_ROUTE_STAGES = 4` WAS HERE AND THE CLIENT REMOVED IT (2026-09-19): the
   grid capped a route at four ROWS, which blocked value-addition steps
   (Knitting → Dyeing → Printing → Compacting → …) and made three of the five
   standard chains in `./standard-routes.ts` impossible to enter. A route's
   length is bounded by the stage rules in `./stage-routes.ts`, not a count. */

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

/* `dyeingBlocked` — the inline twin of `fabricIsYarnDyed` — MOVED to
   `./stage-routes.ts` on 2026-09-19 when it became a Save rule as well
   (`stageRouteProblems` reads it, and that file cannot import this one). It is
   re-exported from the barrel at the top of this file, so callers are
   unchanged. */

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
  /** WHERE THIS CLOTH COMES FROM (0564) — Default Rule 1 vs Rule 2. It sits
   *  on this row rather than on a table of its own because it is the third
   *  fact that reshapes ONE fabric's route, beside the two toggles above.
   *  The rule, and what each source suppresses, is `./fabric-source.ts`. */
  source: FabricSource;
};

export const blankFabricProcessScope = (itemId: string): FabricProcessScope => ({
  item_id: itemId,
  assort_color_wise: false,
  component_wise: false,
  /* RULE 1, which is what every fabric in this database was before 0564 —
     the same default the column, the Zod schema and `asFabricSource` each
     state, so a fabric with no scope row at all reads identically. */
  source: "yarn_knit",
});

/**
 * DOES THIS STEP BELONG TO THE FABRIC'S ROUTE AS THE TOGGLES NOW STAND?
 *
 * ONE FUNCTION, TWO READERS, and this file is where that pattern already lives
 * (`fabricProcessRowStarted` above is the same shape, for the same reason: the
 * save path drops what it calls false and the screen marks required what it
 * calls true). Here the readers are `normalizeProcesses` in `actions.ts`, which
 * decides which rows are WRITTEN, and `inScope` in the Fabric Process panel of
 * `fabric-bom-screen.tsx`, which decides which rows are SHOWN.
 *
 * ## THE TWO READERS DISAGREED, AND THAT IS WHY THIS FUNCTION EXISTS
 *
 * Until 2026-09-16 the save path tested `scope.assort_color_wise !== !!p.combo`
 * — the toggle and the value must agree in BOTH directions — while the screen
 * tested `scope.assort_color_wise || !p.combo`, which on a colour-wise route is
 * true before the value is even read. So a step with no colour was SHOWN and
 * then DELETED: the operator typed it, saw it, saved, and it was gone. Nothing
 * was empty, nothing errored, and the document looked right until the step's
 * loss failed to appear in the arithmetic. A rule stated twice is a rule that
 * drifts; this is the same conclusion `normalizeDias`' own note reaches about
 * two places deciding what counts as an empty row.
 *
 * ## A BLANK `combo` MEANS EVERY COLOURWAY
 *
 * That is not new — `stageCoversCombo` (`./yarn-process.ts`, 0504, restored
 * 0529) has read it that way since the colour axis existed, and says so: "A
 * BLANK `stageCombo` MEANS EVERY COLOURWAY — the ordinary case, and the only
 * thing a blank box can mean here." The save guard was the one place in the
 * module that disagreed with the arithmetic it feeds.
 *
 * It is also the case the feature is FOR. The client's description is that all
 * colours share one sequence and one dark shade needs an extra step; a route
 * that cannot carry an uncoloured step forces the shared sequence to be
 * re-typed per colourway, which on four colourways is thirteen rows for what
 * is four.
 *
 * ## THE COLOUR TEST IS ONE-WAY; THE COMPONENT TEST IS STILL TWO-WAY
 *
 * A step carrying a COLOUR while the toggle is off is still dropped — it names
 * a branch a unified route has nowhere to put, which is the orphan rule that
 * makes flipping the toggle off mean something. What went is only the
 * converse.
 *
 * The component axis keeps the two-way test deliberately (client decision,
 * 2026-09-16). It reads as the same asymmetry and is not being fixed with it:
 * the Component Wise toggle was removed from the screen the same day, so no NEW
 * route can be component-split, and relaxing this would only change how
 * already-split routes save. Widening it was offered and declined.
 *
 * ## "NAMES A COLOUR" IS `comboKey`'s DEFINITION, NOT A `!!`
 *
 * Three different things reach this function meaning "no colour": `null` from
 * the screen (`e.target.value || null`), `undefined` from the save path (Zod's
 * `.optional()` on `capsTextNullable`), and `""` — which `capsTextNullable`
 * produces from a whitespace-only import, because it `.trim()`s and does NOT
 * null an emptied string.
 *
 * All three must mean the same thing as they mean to the ARITHMETIC, and the
 * arithmetic's definition is `comboKey(c) === ""` (`./yarn-process.ts`), which
 * trims before it compares. A plain `!!row.combo` agrees with that on all
 * three — but only BY COINCIDENCE, because two separate transforms happen to
 * have trimmed first. `"  "` is falsy to `comboKey` and TRUTHY to `!!`, so a
 * whitespace combo arriving by any route that skips the Zod trim would be kept
 * here as a colour-scoped step and read by `stageCoversCombo` as an uncoloured
 * one — the row surviving under one meaning and computing under the other.
 *
 * That is the exact class of divergence this function was extracted to end, so
 * it borrows `comboKey` rather than restating the test. The import runs one way
 * (`./yarn-process` imports nothing from here, directly or transitively), which
 * is the same check `requirement.ts` records making before importing
 * `requiredKg`.
 */
export function processRowInScope(
  /* STRUCTURAL, NOT `Pick<FabricProcessRow, …>`, and the difference is load-
     bearing: the two readers hold the row in two shapes. The screen has a
     `FabricProcessRow` (`combo: string | null`); the save path has a
     `FabricBomProcessInput`, where Zod's `.default(null)` makes the field
     OPTIONAL on the input side (`combo?: string | null`). A `Pick` off either
     one rejects the other, and the point of this function is that neither
     reader gets its own copy of the rule. */
  row: { combo?: string | null; component_id?: string | null },
  scope: Pick<FabricProcessScope, "assort_color_wise" | "component_wise">,
): boolean {
  /* `comboKey` — the arithmetic's own test, see the header. NOT `!!row.combo`. */
  const namesAColour = comboKey(row.combo) !== "";
  if (!scope.assort_color_wise && namesAColour) return false;
  /* The component axis is an id, not free text: there is no whitespace form of
     a uuid, so `!!` is the whole question there and no shared key exists to
     borrow. */
  if (scope.component_wise !== !!row.component_id) return false;
  return true;
}

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
 * MULTI-SELECT COLOURS ON ONE ROW (client spec 2026-09-16 §2.2), WITHOUT A
 * SECOND WAY TO STORE A ROUTE.
 *
 * The spec's grid shows one row serving several colourways — `DYEING` at 5.00%
 * for `GREEN, RED` — while a third row gives `GREEN` alone an extra `BRUSHING`.
 * Storage does NOT change to match: `order_fabric_bom_processes.combo` stays one
 * colourway per row, because `stageCoversCombo` matches it exactly and every
 * ladder, both reports and the whole §8/§9 vector estate read it that way. A
 * comma-list in that column would make an exact match silently match nothing —
 * the failure AGENTS.md records for the supply-type enum compared with `===`.
 *
 * So the multi-select is a VIEW. `gatherByRoute` folds stored rows that agree on
 * everything except colour into one editable row; `expandByColour` unfolds them
 * again. Both are pure, both live here rather than in the grid, and they are
 * inverses — which is the property worth testing, since a gather that loses a
 * field would silently delete it on the next save.
 *
 * DELIBERATELY NOT IN THE SAVE PATH. The screen's state and the payload stay one
 * row per colour, so `normalizeProcesses`, the engine and the reports are
 * untouched by this feature and cannot drift from it. The fold lives entirely
 * inside `FabricProcessGrid`.
 */
export type GatheredProcessRow = FabricProcessRow & {
  /** Every colourway this displayed row serves. Empty = all colours (a blank
   *  `combo`), which is the 99% case and is NOT the same as "none". */
  combos: string[];
  /** The keys of the stored rows folded into this one, so an edit can rewrite
   *  exactly those and nothing else. */
  memberKeys: string[];
};

/** What makes two stored rows the same step but for their colour. `component_id`
 *  is IN the key: a component-wise split is a different branch, not a colour of
 *  one. `loss_pct` is compared as typed text, so "5" and "5.0" stay apart —
 *  folding them would rewrite one of them on the next save.
 *
 *  THE SEPARATOR IS WRITTEN AS THE ESCAPE (U+0000), NEVER AS A RAW BYTE (fixed
 *  2026-09-18). NUL is the right separator — no id, uuid or typed loss figure
 *  can contain one, so the join cannot be spoofed by a value — but this file
 *  carried two LITERAL 0x00 bytes from 5e3a6fc, and one byte is all it takes
 *  for every text tool to reclassify the file as binary: `grep -rn` reports
 *  "Binary file … matches" and searches NOTHING in it, and the audit scripts
 *  that read source the same way go quiet on it too. A rule can then be
 *  missing here and every sweep for it still reports clean — the failure
 *  [[raagam-audit-checks-can-be-blind]] is about, arriving through a file
 *  nobody suspects. The escape is the identical runtime string. */
const routeKeyOf = (r: FabricProcessRow) =>
  [r.item_id, r.component_id ?? "", r.stage_id ?? "", r.process_id ?? "", r.sub_category_id ?? "", r.loss_for_id ?? "", r.loss_pct.trim(), r.type_id ?? "", colorLossKey(r.color_wise_loss, r.color_losses)].join("\u0000");

export function gatherByRoute(rows: readonly FabricProcessRow[]): GatheredProcessRow[] {
  const out: GatheredProcessRow[] = [];
  const at = new Map<string, GatheredProcessRow>();
  for (const r of rows) {
    /* AN UNSTARTED ROW NEVER FOLDS. Two blank rows the operator has just added
       agree on every field, so folding them would silently merge one away as it
       was being typed into. */
    const key = fabricProcessRowStarted(r) ? routeKeyOf(r) : `\u0000unstarted:${r.key}`;
    const held = at.get(key);
    if (held) {
      if (r.combo && !held.combos.includes(r.combo)) held.combos.push(r.combo);
      held.memberKeys.push(r.key);
      continue;
    }
    const g: GatheredProcessRow = { ...r, combos: r.combo ? [r.combo] : [], memberKeys: [r.key] };
    at.set(key, g);
    out.push(g);
  }
  return out;
}

/** The inverse: one displayed row back to the stored rows it stands for. Reuses
 *  `memberKeys` in order so a re-render does not re-key rows the operator is
 *  typing in; only a colour ADDED beyond the members needs a fresh key. */
export function expandByColour(g: GatheredProcessRow, newKey: () => string): FabricProcessRow[] {
  const colours = g.combos.length ? g.combos : [null];
  const spare = [...g.memberKeys];
  return colours.map((combo) => {
    const { combos: _c, memberKeys: _m, ...row } = g;
    return { ...row, key: spare.shift() ?? newKey(), combo };
  });
}


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
  /* 0583 — which sub-category of `process_id`. That it BELONGS to that
     process is checked by the save action against the master, not here: the
     schema cannot see the master, and the payload must not be able to answer
     it. */
  sub_category_id: z.string().uuid().nullable().default(null),
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
  /* ASSORT COLOR-WISE LOSS (0606). `.default` so a payload written before the
     field existed lands on "flat loss". Off ⇒ the map is emptied at save
     (`colorLossesForStorage`) and by 0606's CHECK. */
  color_wise_loss: z.coerce.boolean().default(false),
  color_losses: colorLossesInput,
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
  /* WHERE THE CLOTH COMES FROM (0564). `.default` and not `.optional()`, so a
     payload written before this field existed — and a `lib/data-io` import —
     lands on Rule 1 rather than on `undefined`, which the suppression rule
     would then have to guess about. The CHECK on the column restates the same
     three values; this is the half a stale client cannot walk past. */
  source: z.enum(FABRIC_SOURCES).default("yarn_knit"),
});

export type FabricBomProcessScopeInput = z.infer<typeof fabricBomProcessScopeInput>;

/* THE NORMALIZER IS NOT HERE, DELIBERATELY — `normalizeProcesses` lives in
   actions.ts beside `normalizeLines` and `normalizeDias`, which answer the
   identical question for the two children written in the same pass and need the
   same list of lines. A second copy here would be a second answer to "which
   rows is this save keeping?", and the two would drift the first time the
   orphan rule changed on one side only. Same division `style-processes.ts`
   records. */
