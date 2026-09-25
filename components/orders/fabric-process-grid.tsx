"use client";

/**
 * Fabric BOM ▸ Fabric Process — ONE FABRIC'S ROUTE.
 *
 * Client screenshot 2588, the legacy screen's **FabricProcess** tab: a fabric
 * and, beneath it, the steps it runs — GREY ▸ KNITTING, DYED ▸ DYEING [WITH
 * BIOWASH] — each with a Loss %. The rules and the vocabulary live in
 * `lib/orders/fabric-bom/processes.ts`; storage is 0492.
 *
 * ## NO SURFACE OF ITS OWN, WHICH IS THE POINT OF THE SPLIT
 *
 * This decides COLUMNS and nothing about where it sits — the same shape
 * `style-process-grid.tsx` arrived at, and for a reason that file paid for
 * twice: it was a 430-line `Sheet` until the grid was lifted out of it, and
 * lifting it out is what made "put the button back" cost ~120 lines instead of
 * 430. The caller supplies the box. Today's caller is the Fabric Process
 * section of `fabric-bom-screen.tsx`, which unfolds one of these under the
 * fabric row that was clicked (`ProcessFoldList`).
 *
 * ## IT WAS A CARD PER FABRIC UNTIL 2026-09-03
 *
 * Every fabric drew its own heading and its own always-open route, which is six
 * grids stacked on an ordinary BOM. Legacy lists the fabrics and unfolds ONE
 * (client screenshot 2653), and the client asked for that.
 *
 * The reasoning the card rested on is unchanged and is what the fold works
 * around rather than waives. The obvious model was the Garment Order's Style ▸
 * Process, which IS a button opening a sheet, and it was wrong here for a
 * structural reason rather than a taste: there the outer row is EDITABLE, so the
 * button is one cell of a row full of fields. Here the outer row is the BOM's
 * own fabric, READ — description, both types, colourways and panels are all
 * already stated on Fabric Lines, and re-typing them would be the second copy
 * 0490 refused for the palette panels. `ChildGrid`'s `foldRows` needs a folded
 * row to keep at least one real field or Tab cannot reach it, and a row of plain
 * text has none. What `ProcessFoldList` adds is exactly that one field: a
 * `data-row-open` chevron, which `ROW_FIELDS` counts.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the screen's state, patched through `onChange` as they are
 * typed, like every other child grid in this module. The BOM's own footer Save
 * is what persists them.
 *
 * ## THE SPLIT IS TWO COLUMNS, NOT N GRIDS (2026-09-15)
 *
 * A fabric's route may be split "Assort Color Wise" and/or "Component Wise"
 * (0528) — legacy's `[Assort Color]` / `[Components]` on the outer row, read
 * as CONTROLS rather than a second copy of Fabric Lines. Between 2026-09-04
 * and 09-15 the caller answered a toggle by rendering ONE INSTANCE OF THIS
 * GRID PER GROUP `processGroupsFor` returned, each seeded with its own blank
 * row and its own "+ Add process": four colourways on one panel was four
 * stacked grids, and four colourways on three panels would have been twelve
 * (client screenshot 2876: "the ui for those filters needs a better fix").
 *
 * The client's own description of the legacy control is the shape instead:
 * "unlocks individual color selection ON THE PROCESS CONFIGURATION GRID" /
 * "unlocks component panel selection dropdowns ON THE PROCESS GRID". So a
 * toggle now ADDS A COLUMN to the one route grid — `colours` puts a Colour
 * ▾ before Stage, `components` a Component ▾ — and each step names which
 * branch it belongs to. One grid, one blank row, one "+ Add process", the
 * same rows and the same `combo` / `component_id` on every one of them; the
 * storage, the save normaliser, the engine and both reports are untouched.
 * `processGroupsFor` (`processes.ts`) still describes the grouping and is
 * what the per-branch cap below reads.
 */

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { ColorLossControl } from "@/components/orders/color-loss-control";
import { colorLossSeed, isColorWiseFor } from "@/lib/orders/fabric-bom/color-loss";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  baseProcessMissing,
  baseProcessRepeated,
  baseProcessesForStage,
  blankFabricProcess,
  routeStartAllowedAt,
  routeStartNotFirst,
  yarnDyedStageBlocked,
  washStageBlocked,
  processesUsedInStage,
  processRepeatedInStage,
  processPickValue,
  processPickerItems,
  splitProcessPick,
  dyeingBlocked,
  fabricProcessRowStarted,
  printBlocked,
  processesForFabric,
  stageMismatchBlocked,
  /* 0570 — the forward-only half of the stage rule. Both come from the same
     barrel as everything above, so this grid still reads ONE import for the
     whole Fabric Process contract. */
  stageRegressionBlocked,
  stagesForRow,
  type FabricProcessLookups,
  type FabricProcessOption,
  type FabricProcessRow,
} from "@/lib/orders/fabric-bom/processes";
/* THE SUPPRESSION TWIN (0564) — the rule AND its sentence, never a predicate or
   a line written here, so the step this grid greys and the step `routeForSource`
   drops from the arithmetic are decided by one function (both bottom out in
   `stepSuppressedBySource`, with vectors pinning the correspondence). */
import {
  sourceSuppressedReason,
  type FabricSource,
} from "@/lib/orders/fabric-bom/fabric-source";

/** The route's trailing "Type" cell — hidden for now (client 2026-09-20). */
const SHOW_TYPE_COLUMN = false;

export function FabricProcessGrid({
  itemId,
  colours = null,
  components = null,
  rows,
  onChange,
  processes,
  lookups,
  newKey,
  printDeclared,
  printDeclaredFor,
  subCategories = false,
  fabricIsYarnDyed = false,
  looseFabricRoute = false,
  fabricIsPieceDyed = false,
  source = "yarn_knit",
  canCreate = false,
  canEdit = false,
  readOnly = false,
  hideHeader = false,
  lossColours = null,
}: {
  /** The fabric these steps belong to — stamped onto every row added. */
  itemId: string;
  /** THE FABRIC'S OWN COLOURWAYS when its route is split "Assort Color Wise"
   *  (0528) — a Colour ▾ column appears and every started step must name one.
   *  `null` (the toggle off) draws no column and rows keep `combo: null`.
   *  Never the order's whole list: the cascading-filter rule, same as
   *  `YarnProcessGrid`'s `combos`. */
  colours?: readonly string[] | null;
  /** THE FABRIC'S OWN PANELS when its route is split "Component Wise" — a
   *  Component ▾ column appears, same contract as `colours`.
   *
   *  THE TOGGLE THAT TURNS THIS ON IS GONE FROM THE SCREEN (2026-09-16,
   *  `doc/order/fabriprocess.md` §6: "remove the Component-Wise flag … to
   *  avoid unnecessary complexity"). **This prop, this column and everything
   *  under them are deliberately intact.** Component Wise was wired end to end
   *  on 2026-09-15 — `stagesForGroup`, `comboUplift`, `comboUpliftBreakdown`,
   *  both reports and ten vectors in `scripts/check-fabric-bom-reports.mts` —
   *  and that wiring is what fixed a silent yarn over-purchase (uplift 1.201
   *  where 1.107 was right). So a route SAVED component-split still renders
   *  its Component ▾ and still computes correctly; what went is only the
   *  operator's ability to split a NEW one. See the caller
   *  (`fabric-bom-screen.tsx`, the Fabric Process section) for the notice that
   *  keeps an already-split route from looking like a bug. */
  components?: readonly { id: string; name: string }[] | null;
  /** The whole fabric's steps, every branch together. */
  rows: FabricProcessRow[];
  onChange: (next: FabricProcessRow[]) => void;
  /** The whole master list, unfiltered — the `for_fabric` narrowing is
   *  `processesForFabric`'s job, and it has to run per row so the value a row
   *  already holds survives a flag being unticked on the master. */
  processes: FabricProcessOption[];
  lookups: FabricProcessLookups;
  /**
   * The SCREEN's key generator, passed in rather than grown here.
   *
   * These rows live in the screen's state and are re-keyed there when a BOM is
   * loaded from the database, so a counter local to this file would start at
   * zero beside keys the screen had already issued and collide the moment a
   * saved route was reopened and added to. Same argument, same words, as
   * `StyleProcessGrid`.
   */
  newKey: () => string;
  /** Has the order declared an AOP / Roll form print? (0528) — withheld from
   *  "Print" processes in the Process picker until it is. */
  printDeclared: boolean;
  /**
   * PER-BRANCH PRINT GATE (client 2026-09-19, checkpoint B): does THIS row's
   * (colourway, component) branch carry a print on the order? When given it
   * replaces `printDeclared` row by row, so a Printing step is offered only
   * where there is something to print — not on WHITE because NAVY is AOP.
   * `printedGroup` in `lib/orders/fabric-bom/print-route.ts` is the answer;
   * the Save gate reads the same one. Omitted (IWO Fabric BOM), the
   * fabric-wide `printDeclared` applies exactly as before.
   */
  printDeclaredFor?: (row: FabricProcessRow) => boolean;
  /**
   * OFFER THE MASTER'S SUB-CATEGORIES — "DYEING [WITH BIOWASH]" (0583). OPT-IN
   * because the value needs a column to land in: Fabric BOM's route table has
   * `sub_category_id`, IWO Fabric BOM's does not, and a picker offering a
   * choice the save then drops is the silent-loss shape AGENTS.md's "Disabled
   * rows" section is about.
   */
  subCategories?: boolean;
  /** Is THIS fabric Yarn-Dyed? (0557, doc/order/update.md §7.3) — withholds
   *  "Dyeing"-flagged processes from the Process picker, since a yarn-dyed
   *  fabric's dyeing loss is already carried on the Yarn Process tab and a
   *  Fabric Dyeing step here would double it. Defaults `false` (never
   *  withhold) so an unfilled call site sees every process it always has. */
  fabricIsYarnDyed?: boolean;
  /** LOOSE FABRIC CONVERSION (0633) — this route is a linked loose fabric's,
   *  the one place CONVERSION (unravelling) is offered. Default false. */
  looseFabricRoute?: boolean;
  /** Is THIS fabric piece-dyed (Solid / Printed)? Withholds the WASH stage
   *  (client 2026-09-23, `washStageBlocked`). Defaults `false` (never withhold). */
  fabricIsPieceDyed?: boolean;
  /**
   * WHERE THIS FABRIC COMES FROM (0564) — the Source ▾ on the panel above.
   *
   * IT DOES NOT NARROW THE PICKER, which is what makes it unlike the two gates
   * beside it. `printDeclared` and `fabricIsYarnDyed` decide what a route may
   * NAME; a source decides what a named route COSTS. A fabric bought as greige
   * rolls is still allowed to record that it was knitted — by somebody else —
   * so Knitting stays in the ▾ and stays on the row, and what changes is that
   * the demand engine stops charging for it (`routeForSource`).
   *
   * So the only thing this prop does here is SAY SO: `sourceSuppressedRow`
   * greys the step and `sourceSuppressedReason` supplies the line. A step the
   * engine silently drops while the screen draws it in full is what makes an
   * operator distrust the figure rather than the route.
   *
   * Defaults to Rule 1, so an unfilled call site greys nothing — the same
   * "never silently start hiding things" default `fabricIsYarnDyed` takes.
   */
  source?: FabricSource;
  canCreate?: boolean;
  canEdit?: boolean;
  readOnly?: boolean;
  /** Drop this instance's column header — the caller's job when a fabric's
   *  route is split into several of these grids stacked in a row; see
   *  `ChildGrid`'s own `hideHeader` note for why. */
  hideHeader?: boolean;
  /**
   * ASSORT COLOR-WISE LOSS (0606, client spec 2026-09-21) — the fabric's OWN
   * colourways. With it, a step whose Loss for = COLOR WISE shows a [Color
   * Loss] button (each colour + its loss) in place of the Loss % box. The For
   * field is the switch; there is no tick of its own. Independent of `colours`
   * above — that scopes a STEP to one colour; this gives one step a loss per
   * colour.
   *
   * OPT-IN like `subCategories`, and for the same reason: the value needs a
   * column to land in. Fabric BOM's route table has `color_losses`; IWO
   * Fabric BOM's does not, and a sheet whose figures the save then drops is
   * the silent-loss shape. `null` draws no column.
   */
  lossColours?: readonly string[] | null;
}) {
  const patch = (key: string, next: Partial<FabricProcessRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const colourWise = !!colours;
  const componentWise = !!components;

  /* NO CAP ON A ROUTE'S LENGTH (client review 2026-09-19: "more than four is
     not allowed" was the complaint). The 2026-09-01 spec asked for "up to 4
     distinct stages" and the grid capped ROWS at four, which is a different
     thing: a route has at most four STAGES (Greige · Dyed/Wash · Print) but
     each stage runs several processes, and three of the client's own five
     standard chains (`standard-routes.ts`) are five to eight steps long —
     none of them could be entered. The stage rules in `stage-routes.ts` are
     what bound a route now; nothing ever enforced the cap past this grid.

     A branch is still one (colourway, component) leaf, keyed here the way
     `stageRouteProblems` keys it, because the stage narrowing below reads a
     row's position within its own branch. */
  const branchKey = (r: Pick<FabricProcessRow, "combo" | "component_id">) =>
    `${colourWise ? (r.combo ?? "") : ""}::${componentWise ? (r.component_id ?? "") : ""}`;
  const stepsInBranch = new Map<string, number>();
  const positionInBranch = new Map<string, number>();
  for (const r of rows) {
    const k = branchKey(r);
    const n = (stepsInBranch.get(k) ?? 0) + 1;
    stepsInBranch.set(k, n);
    positionInBranch.set(r.key, n);
  }

  /* THE STAGE DECIDES THE PROCESS (0563, `doc/order/fabriprocess.md` §1 · §3).
     The supervisor's own reason for this is a STOCK LEDGER one, not a tidiness
     one: a step saved as Stage = DYED · Process = KNITTING books the roll's
     weight into the Dyed Stock ledger while the cloth is still greige, and the
     warehouse report, the valuation and the availability check all read it as
     dyed. So the Process ▾ narrows to the processes the row's Stage allows, and
     the FIRST step of a stage narrows further still — to that stage's mandatory
     base process (Greige ▸ Knitting, Dyed ▸ Dyeing, Washed ▸ Washing, Printed
     ▸ Printing), because that is the step that moves the cloth INTO the stage.

     BOTH NARROWINGS ARE READ OFF THE STEPS ALREADY IN THIS BRANCH, which is why
     they are computed here and not inside the cell: "is this the first step of
     its stage" is a question about the row's NEIGHBOURS, and a split route has
     one sequence per branch (see `branchKey` above — Bio-wash added to RED is
     the first step of RED's Washed stage and says nothing about WHITE's).

     WITHHELD FROM THE OFFERED LIST, NEVER BLOCKED AFTER THE FACT — the same
     shape as `printDeclared` / `fabricIsYarnDyed`, with `stageMismatchBlocked`
     and `baseProcessMissing` as the inline twins that name a held value the
     operator could not pick again today. A route typed before 0563 existed
     keeps every step it has. */
  const branchRows = new Map<string, FabricProcessRow[]>();
  for (const r of rows) {
    const k = branchKey(r);
    const xs = branchRows.get(k);
    if (xs) xs.push(r);
    else branchRows.set(k, [r]);
  }
  /** This row's own branch, in route order — what both stage helpers read. */
  const rowsInBranch = (r: FabricProcessRow) => branchRows.get(branchKey(r)) ?? [r];
  const indexInBranch = (r: FabricProcessRow) =>
    Math.max(0, (positionInBranch.get(r.key) ?? 1) - 1);
  /** Does this row OPEN its stage in this branch? A row with no Stage named
   *  yet opens nothing — `processesForFabric` then narrows by neither, which
   *  is the same list the grid offered before 0563. */
  const opensStage = (r: FabricProcessRow) => {
    if (!r.stage_id) return false;
    const mine = rowsInBranch(r);
    const at = indexInBranch(r);
    return !mine.slice(0, at).some((x) => x.stage_id === r.stage_id);
  };
  /** The Stage's own word, for the two messages below. Read off the SAME
   *  `lookups.stages` the Stage ▾ draws from — an operator who renamed GREY to
   *  "Greige" reads their own word back, and a stage that has since been
   *  removed from the lookup falls back rather than printing a uuid (the
   *  `creatorName()` rule, one column along). */
  const stageName = (id: string | null) =>
    (id ? lookups.stages.find((s) => s.id === id)?.name : null) || "this stage";
  /* THE LIST A BASE PROCESS IS NAMED FROM, gated exactly as the picker is — no
     stage narrowing, since that is what `baseProcessesForStage` then applies.
     Naming a base the operator could not pick (a Print base with no print
     declared, Dyeing on a yarn-dyed fabric) would send them looking for a value
     that is not in the ▾, which is the failure mode "empty-and-explain" exists
     to avoid one step earlier. `baseProcessMissing` stands down in exactly that
     case, so the two agree. */
  /** THE PRINT GATE FOR ONE ROW — per branch when the caller can answer it
   *  (`printDeclaredFor`), else the fabric-wide flag. Every narrowing and twin
   *  on the row reads this one value, so they cannot disagree. */
  const printOk = (r: FabricProcessRow) => (printDeclaredFor ? printDeclaredFor(r) : printDeclared);
  /** STEP 1 OR NOTHING — may this row still START the route: buy the cloth
   *  (client 2026-09-19) or knit it (2026-09-20)? Positional, so it is read off
   *  the branch like the stage helpers, and handed to the picker AND every twin
   *  below for the same reason `printOk` is: a twin given a different gate
   *  warns about a row the ▾ permitted. `stageRouteProblems` computes the
   *  identical answer per row. */
  const routeStartOk = (r: FabricProcessRow) => routeStartAllowedAt(rowsInBranch(r), indexInBranch(r));
  const gatesFor = (r: FabricProcessRow) => ({
    printDeclared: printOk(r),
    fabricIsYarnDyed,
    routeStartAllowed: routeStartOk(r),
    looseFabricRoute,
  });
  const baseCandidatesFor = (r: FabricProcessRow) => processesForFabric(processes, gatesFor(r));
  /**
   * Does this fabric's SOURCE stop the engine charging for this step? (0564.)
   *
   * T2's `sourceSuppressedRow`, NOT a predicate written here — and the first cut
   * of this grid did write one, which is the mistake worth recording. Both it
   * and `routeForSource` bottom out in `stepSuppressedBySource`, with vectors
   * asserting the correspondence, so **a row this greys and a step the ladder
   * drops cannot disagree.** A local copy would have been a second answer to
   * "is this step counted?", and the two would have parted the first time the
   * suppression rule gained a case.
   *
   * It takes its options STRUCTURALLY (`{ id } & SourceKindedStep`) rather than
   * as `FabricProcessOption`, so `processes` goes straight in: typing it
   * properly would close the `processes → yarn-process → fabric-source` chain
   * into a cycle.
   *
   * Three behaviours come free and all three matter: a row with no process yet
   * is NOT greyed (work in progress, not a suppressed step); a process the
   * master no longer lists is NOT greyed (the engine cannot tell its kind, so
   * the screen must not claim to); and the reason is `null`, never `""`, so a
   * counted step draws no empty line.
   */
  const suppressedReason = (r: FabricProcessRow) =>
    sourceSuppressedReason(r, processes, source);

  /*
   * A PROCESS IS PICKED ONCE PER STAGE — NOT ONCE PER ROUTE (client
   * 2026-09-19; the scope is the user's decision the same day).
   *
   * This grid carried no `usedIds` at all until then, on the reasoning that a
   * fabric may dye twice and compact before and after printing. The first half
   * was already overruled by 2026-09-18's "a stage is entered once"
   * (`baseProcessRepeated`); the second half is still true and is why the
   * dedupe is scoped to a STAGE: chains 2 and 4 in `standard-routes.ts` run
   * COMPACTING under DYED/WASH and again under PRINT, and a saved live route
   * does exactly that. So `processesUsedInStage` names what OTHER rows of the
   * same stage hold, and a later stage offers it again.
   *
   * GREYED, NOT REMOVED. It feeds the picker's own `usedIds`, so a taken
   * process stays in the ▾ tagged "(already added)" — `DataPicker`'s standing
   * reason: a process that vanished reads as missing from the master. The set
   * has a floor for a blank row whose every option is taken, so the ▾ can
   * never offer nothing to a `required` cell.
   */

  const columns: ChildGridColumn<FabricProcessRow>[] = [
    /* THE TWO SPLIT COLUMNS (2026-09-15) — present only while their toggle
       is on, so the unified route is exactly the grid it was. A `<Select>`
       over the FABRIC'S OWN values, with the held one surviving a list that
       no longer offers it: the "Disabled rows" rule, copied from
       `YarnProcessGrid`'s Colour cell. REQUIRED on a started row: a step in
       a colour-wise route that names no colour is a step `normalizeProcesses`
       drops on Save, and the hold says so before the save does. */
    ...(colourWise
      ? [
          {
            /* "ASSORT COLOR", NOT "COLOUR" (2026-09-16). One field was reading
               under three names on one screen: the fabric-line grid directly
               above this one heads it `ASSORT COLOR`, the toggle that reveals
               this column says `Assort Color`, and the column itself said
               `Colour`. The operator has to recognise them as the same thing to
               use the feature at all, and a route column named after a plain
               colour invites the reading that it means the FABRIC's colour
               rather than which of the order's assort colourways this step
               serves. Spelled the client's way (`doc/order/fabriprocess.md`
               §2.2), including their -or, so nothing on the screen has to be
               translated.

               RENAMED AGAIN TO "COMPO COLOR" (client, 2026-09-16, later the
               same day). That is the client's own word for this value on the
               Components tab, where they renamed the identical column from
               `Assort Color` earlier today — and it IS the identical value:
               `combo`, the order's assort colourway, on all three surfaces.
               So this is the third name this column has carried in one day and
               the first one the client chose for it. */
            /* SPELLED "COMBO" SINCE 2026-09-22 (client, screenshot 2997) — the
               09-16 rename above was transcribed as "Compo"; same fix on the
               Components tab column and the Manual tab toggle. */
            header: "Combo Color",
            width: "8rem",
            /* NOT `required`, AND IT WAS UNTIL 2026-09-16 — the whole
               declaration went, not just the hold. `ChildGridColumn.required`
               draws the header `*` and the cell's own `required` stamps
               `data-required-empty`, and AGENTS.md's "one declaration, four
               enforcers" rule is that those cannot come apart: leaving the
               star would ship a `*` with nothing behind it, which is the exact
               divergence the rule exists to make impossible.

               A BLANK COLOUR IS NOW AN ANSWER, not an omission. It means the
               step treats EVERY colourway — the client's 99% case, where all
               colours share one sequence and one dark shade needs an extra
               step. Holding the cursor on it would cage the operator on the
               most common value in the column. `normalizeProcesses` keeps it
               (one-way guard), `stageCoversCombo` has always read it that way,
               and the option below says so in words rather than leaving the
               operator to infer it from an empty box. */
            cell: (r: FabricProcessRow) => {
              const held = r.combo ?? "";
              const options = held && !colours!.includes(held) ? [...colours!, held] : [...colours!];
              return (
                <Select
                  compact
                  className="h-8"
                  aria-label="Combo Color"
                  value={held}
                  disabled={readOnly}
                  onChange={(e) => patch(r.key, { combo: e.target.value || null })}
                >
                  {/* NAMED, NOT EMPTY. A blank row in a ▾ reads as "not
                      answered yet"; this one is a choice, and it is the
                      choice most steps take. The de-clutter rule blanks
                      PLACEHOLDERS — text standing in for an unmade choice —
                      and this is the opposite: a value with a meaning. */}
                  <option value="">All colours</option>
                  {options.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              );
            },
          } satisfies ChildGridColumn<FabricProcessRow>,
        ]
      : []),
    ...(componentWise
      ? [
          {
            header: "Component",
            width: "8rem",
            required: rows.some(fabricProcessRowStarted),
            cell: (r: FabricProcessRow) => {
              const held = r.component_id ?? "";
              const options =
                held && !components!.some((c) => c.id === held)
                  ? [...components!, { id: held, name: "(component not on this fabric)" }]
                  : [...components!];
              return (
                <Select
                  compact
                  className="h-8"
                  aria-label="Component"
                  value={held}
                  disabled={readOnly}
                  required={fabricProcessRowStarted(r)}
                  onChange={(e) => patch(r.key, { component_id: e.target.value || null })}
                >
                  <option value="">{""}</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              );
            },
          } satisfies ChildGridColumn<FabricProcessRow>,
        ]
      : []),
    {
      /**
       * The fabric's STATE going into this step — GREY, DYED. Not the step
       * itself, which is the column beside it: legacy's row 2 reads
       * "DYED · DYEING [WITH BIOWASH]", i.e. cloth that is already dyed going
       * into a biowash.
       *
       * A LOOKUP, so the operator extends it. 0492 seeds only the two values on
       * the client's own screen; inventing FINISHED or BLEACHED beside them is
       * the defaulted-vocabulary mistake AGENTS.md records under "Near misses".
       */
      header: "Stage",
      width: "7rem",
      required: rows.some(fabricProcessRowStarted),
      cell: (r) => (
        <div
          className={cn(
            "min-w-0",
            (stageRegressionBlocked(rowsInBranch(r), indexInBranch(r), lookups.stages) ||
              yarnDyedStageBlocked(rowsInBranch(r), indexInBranch(r), processes, lookups.stages, fabricIsYarnDyed) ||
              washStageBlocked(r, lookups.stages, fabricIsPieceDyed)) &&
              "rounded-md ring-2 ring-danger",
          )}
        >
          <LookupDialogPicker
            kind="fabric_stage"
            label="Stage"
            compact
            /* 0570 — A ROUTE ONLY MOVES FORWARD. The list is narrowed to the
               stage this branch has already reached and anything after it, so
               a fabric cannot be sent back to Greige once it is dyed, washed
               or printed (client spec 2026-09-18 §2, "Irreversible State
               Transitions"). Withheld from the list rather than blocked after
               the fact — the same idiom as the Process narrowing below — and
               the value a row already HOLDS always survives, with the twin
               underneath naming it. An operator-invented stage is unranked and
               therefore never withheld; see `stageRank`. */
            /* 2026-09-20 — on a Yarn-Dyed fabric DYED is withheld unless the
               route starts with a dyed-roll purchase (`yarnDyedStageBlocked`
               below names a held one). */
            options={stagesForRow(lookups.stages, rowsInBranch(r), indexInBranch(r), {
              fabricIsYarnDyed,
              /* 2026-09-23 — WASH is withheld on Solid / Printed cloth. */
              fabricIsPieceDyed,
              options: processes,
            })}
            value={r.stage_id}
            onChange={(id) => patch(r.key, { stage_id: id || null })}
            required={fabricProcessRowStarted(r)}
            canCreate={canCreate && !readOnly}
            canEdit={canEdit && !readOnly}
          />
          {/* INLINE TWIN of that narrowing — a stored route that already goes
              backwards (one exists in production: DYEING, then HEAT SETTING
              tagged Greige, then DYEING again). It names the ledger
              consequence, because that is the reason the rule exists and the
              operator cannot see a ledger from here. */}
          {stageRegressionBlocked(rowsInBranch(r), indexInBranch(r), lookups.stages) && (
            <p className="mt-1 px-1 text-xs font-medium text-danger">
              This route has already reached a later stage — a fabric cannot go
              back to{" "}
              {lookups.stages.find((s) => s.id === r.stage_id)?.name ?? "an earlier stage"}.
            </p>
          )}
          {/* 2026-09-20 — the Save gate's sentence, shortened for the cell. */}
          {yarnDyedStageBlocked(rowsInBranch(r), indexInBranch(r), processes, lookups.stages, fabricIsYarnDyed) && (
            <p className="mt-1 px-1 text-xs font-medium text-danger">
              This fabric is Yarn-Dyed — {stageName(r.stage_id)} is only for a route that starts with a
              dyed-roll purchase. Use WASH for its washing and finishing.
            </p>
          )}
          {washStageBlocked(r, lookups.stages, fabricIsPieceDyed) && (
            <p className="mt-1 px-1 text-xs font-medium text-danger">
              This fabric is Solid / Printed — it never enters {stageName(r.stage_id)}. Its wet step is
              Dyeing under DYED; WASH is for yarn-dyed and melange fabrics.
            </p>
          )}
        </div>
      ),
    },
    {
      /**
       * THE ONE FLEXIBLE COLUMN, so the slack lands on the longest value rather
       * than on a percentage box — the same budget `stageColumns` takes on
       * Fabric Plan, which renders in an identical per-fabric card.
       *
       * `hugsContent` is `columns.every(c => c.width)`, so leaving this one
       * unsized is what flips the grid from hugging its declarations to filling
       * the card. That is the right shape HERE and the wrong one in a modal —
       * see the long note on `style-process-grid.tsx`'s Details column, which
       * records the round trip.
       */
      /**
       * SIZED SINCE 2026-09-03, and it is what makes this grid hug.
       *
       * Same change, same reasoning as `yarn-process-grid.tsx`: `hugsContent` is
       * `columns.every(c => c.width)`, so one unsized column handed this picker
       * every spare pixel of a fold panel that spans the whole section — a
       * Process box many times the width of the Loss % beside it (client
       * screenshot 2660, on the sibling tab; this one had the identical defect
       * from the identical commit).
       *
       * IT ONLY FITS BECAUSE `Rate` WENT. The declared widths now total
       * 7 + 12 + 7.5 + 10 + 4.5 + 7 = 48rem = 768px, plus `ChildGrid`'s 88px of
       * `#` and remove-column chrome, so the table measures ~856px against
       * `tableFrom`'s 1024px threshold. With Rate's 5rem still in it that was
       * ~936px — inside the threshold but with little room to tune. Add a
       * column here and check that sum again.
       */
      header: "Process",
      width: "12rem",
      required: rows.some(fabricProcessRowStarted),
      cell: (r) => (
        /* A SUPPRESSED STEP IS GREYED, NOT REMOVED (0564, user ruling
           2026-09-16). The source drops it from the ARITHMETIC; the route still
           declares it, because the cloth really was knitted — by the supplier.
           So it stays typed, stays editable and stays in the document, and the
           only thing that changes is that it reads as not counting and says
           why. Auto-deleting it would destroy a planner's route on a dropdown
           change, and refusing the source change would be the post-hoc block
           this module refuses everywhere else. */
        <div
          className={cn(
            "min-w-0",
            suppressedReason(r) && "opacity-60",
            /* HARD GATE, SHOWN AS ONE (client 2026-09-21): the cell a Save
               rule refuses wears a red outline. Every predicate here is one
               `stageRouteProblems` / `printRouteProblems` refuses on. */
            (printBlocked(r, processes, printOk(r)) ||
              dyeingBlocked(r, processes, fabricIsYarnDyed) ||
              stageMismatchBlocked(r, processes, gatesFor(r)) ||
              baseProcessRepeated(rowsInBranch(r), indexInBranch(r), processes) ||
              processRepeatedInStage(rowsInBranch(r), indexInBranch(r)) ||
              routeStartNotFirst(rowsInBranch(r), indexInBranch(r), processes) ||
              baseProcessMissing(rowsInBranch(r), indexInBranch(r), processes, gatesFor(r))) &&
              "rounded-md ring-2 ring-danger",
          )}
        >
          {(() => {
            const narrowed = processesForFabric(processes, {
              currentValue: r.process_id,
              ...gatesFor(r),
              /* 0563 — the two stage narrowings. Both are OPTIONAL opts that
                 default to no narrowing, so a row with no Stage named yet sees
                 exactly the list this grid offered before they existed. */
              stageId: r.stage_id,
              isFirstOfStage: opensStage(r),
            });
            /* 0583 — each process, then "PROCESS [SUB]" for each of its
               sub-categories. Expanded AFTER every narrowing, so a
               sub-category is offered exactly where its process is. */
            const items = subCategories ? processPickerItems(narrowed, r) : narrowed;
            /* ONCE PER STAGE (2026-09-19) — see the block above `columns`.
               Keyed by process, so every "PROCESS [SUB]" entry of a taken
               process greys with it. */
            const used = processesUsedInStage(rowsInBranch(r), indexInBranch(r), narrowed);
            const usedIds = used.size
              ? items.filter((i) => used.has(splitProcessPick(i.id).process_id ?? "")).map((i) => i.id)
              : null;
            return (
              <RecordPicker
                label=""
                compact
                items={items}
                usedIds={usedIds}
                value={subCategories ? processPickValue(r) : r.process_id}
                onChange={(id) =>
                  patch(
                    r.key,
                    subCategories
                      ? splitProcessPick(id)
                      : /* A caller without sub-categories still clears any it was
                           handed, so a process change never keeps the old one's. */
                        { process_id: id, sub_category_id: null },
                  )
                }
                disabled={readOnly}
                required={fabricProcessRowStarted(r)}
                /* Empty-and-explain. An empty list here means the Process master has
                   nothing flagged "Fabric", which is fixed on a DIFFERENT screen — a
                   bare "— Select —" over nothing reads as a broken dropdown and
                   teaches the operator nothing (AGENTS.md, nominated vendors). */
                emptyHint="No process is flagged for Fabric — tick it on Master Data ▸ Materials ▸ Processes"
              />
            );
          })()}
          {/* 0528 — "block the dyer/planner from selecting Print … Print
              details are not available for this style". `printDeclared`
              withholds every Print-flagged process from the list ABOVE, so
              this only fires on a row that already holds one from before the
              print was removed (or from before this gate existed) — the
              same "held value survives, tagged" idiom `printBlocked` shares
              with every disabled-row rule in this app. */}
          {printBlocked(r, processes, printOk(r)) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              {printDeclaredFor
                ? /* Per branch: the order may print another colour, just not
                     this one — say which fact is missing. */
                  "No print is declared for this fabric / colour in Order Entry — remove Printing, or add the print on the order."
                : "Print details are not available — add a Roll form print on Color/Print Details first."}
            </div>
          )}
          {/* 0557 — this fabric's Type was set to Yarn Dyed AFTER this row
              already named a Dyeing process (the dyeing loss for a yarn-dyed
              fabric belongs on the Yarn Process tab instead). Same "held
              value survives, tagged" idiom as `printBlocked` above — never
              silently dropped. */}
          {/* Since 2026-09-19 this also BLOCKS SAVE (`stageRouteProblems`),
              so it is worded as the client's refusal, not as advice. */}
          {dyeingBlocked(r, processes, fabricIsYarnDyed) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              This fabric is Yarn-Dyed. Fabric Dyeing steps cannot be added to a
              yarn-dyed fabric route — remove this step.
            </div>
          )}
          {/* 0563 — this row holds a process its own Stage does not allow: a
              route typed before `process_fabric_stages` existed, or a mapping
              changed on the Process master since. Same "held value survives,
              tagged" idiom as `printBlocked` and `dyeingBlocked` above — the
              step is NEVER dropped, because dropping it would take the route
              the planner typed away without telling them. What it costs is
              the stock ledger the spec's §1 is about, so the message names
              the ledger rather than saying "invalid". */}
          {/* SAME `gates` AS `baseProcessMissing` BELOW (T1, 2026-09-16). With
              the default gates the floor is tested against the plain
              `for_fabric` list rather than the one the ▾ actually offered,
              which differs when a stage's only allowed process is print-gated
              — so the twin could name a mismatch the narrowing had already
              permitted. */}
          {stageMismatchBlocked(r, processes, gatesFor(r)) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              {stageName(r.stage_id)} does not run {""}
              {processes.find((p) => p.id === r.process_id)?.name ?? "this process"} — the
              roll&apos;s weight would be booked to the {stageName(r.stage_id)} stock ledger in
              the wrong state. Change the Stage or pick another process.
            </div>
          )}
          {/* 0563 — this row OPENS its stage and does not hold that stage's
              base process. Named rather than refused: the operator may be
              part-way through typing the route, and a step that has not yet
              been corrected is still the step they meant. The base process is
              named on screen, so the message says what to pick rather than
              that something is wrong. */}
          {/* `gates` MUST BE THE ONES THE PICKER ABOVE WAS GIVEN — the twin
              mirrors `processesForFabric`'s flag test rather than importing
              it (`stage-routes.ts` would be a runtime cycle the other way),
              so a twin handed different gates warns about a row the
              narrowing itself permitted. */}
          {/* 0570, client rule 2 — the step that opened this stage, claimed a
              second time. NARROW ON PURPOSE: a process repeated in ANOTHER
              stage is fine (chains 2 and 4 compact after dyeing and again
              after printing), so only a stage's own entry step is refused. No
              gates: "is this process a base of this stage" is a question about
              the classification alone. */}
          {baseProcessRepeated(rowsInBranch(r), indexInBranch(r), processes) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              {processes.find((p) => p.id === r.process_id)?.name ?? "This step"} already
              moved this fabric into {stageName(r.stage_id)} — a stage is entered once.
            </div>
          )}
          {/* 2026-09-19 — any other process twice in one stage. The base case
              above has the sharper sentence, so this stands down for it: one
              cell, one message. */}
          {!baseProcessRepeated(rowsInBranch(r), indexInBranch(r), processes) &&
            processRepeatedInStage(rowsInBranch(r), indexInBranch(r)) && (
              <div className="mt-0.5 px-1 text-xs font-medium text-danger">
                {processes.find((p) => p.id === r.process_id)?.name ?? "This process"} is
                already in the {stageName(r.stage_id)} stage — a stage runs each process once.
              </div>
            )}
          {/* A ROUTE START (a purchase, 0583; Knitting, 2026-09-20) is Step 1
              only. Same rule the Save gate prints (`stageRouteProblems`),
              shortened for the cell. The ▾ no longer offers one below Step 1
              (`routeStartOk`), so this only fires on a row saved before that,
              or one whose rows above were filled in afterwards. */}
          {routeStartNotFirst(rowsInBranch(r), indexInBranch(r), processes) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              {processes.find((p) => p.id === r.process_id)?.name ?? "This step"} can only be the
              initial step (Step 1) — move it to the first row.
            </div>
          )}
          {baseProcessMissing(rowsInBranch(r), indexInBranch(r), processes, gatesFor(r)) && (
            <div className="mt-0.5 px-1 text-xs font-medium text-danger">
              A {stageName(r.stage_id)} route opens with{" "}
              {baseProcessesForStage(baseCandidatesFor(r), r.stage_id)
                .map((p) => p.name)
                .join(" or ") || "that stage's base process"}{" "}
              — that is the step that moves the cloth into {stageName(r.stage_id)} stock.
            </div>
          )}
          {/* 0564 — this step is declared but not costed, because the fabric
              is BOUGHT past it. The other twins on this cell say "you could
              not pick this today"; this one says "this is still yours, it
              just isn't in the number" — a different sentence for a different
              fact, and the reason the step is greyed rather than withheld.

              THE SENTENCE IS `sourceSuppressedReason`'s, not this file's. A
              hand-written line here could say a step is ignored for a reason
              the engine does not hold — and it very nearly did: the first cut
              read "this fabric is purchased past this step", which names
              neither the Source the operator set nor the fact that changing it
              brings the step back. */}
          {suppressedReason(r) && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {suppressedReason(r)}
            </div>
          )}
        </div>
      ),
    },
    {
      /** "Process wise" on the legacy screen — how the Loss % beside it is
       *  measured. The rest of the vocabulary is unknown, so it is a lookup the
       *  operator extends rather than a guess (0492). */
      header: "Loss for",
      width: "7.5rem",
      cell: (r) => (
        <LookupDialogPicker
          kind="process_loss_for"
          label="Loss for"
          compact
          options={lookups.lossFor}
          value={r.loss_for_id}
          onChange={(id) => {
            const next = id || null;
            /* THE Loss for FIELD IS THE SWITCH (client 2026-09-21): COLOR WISE
               turns the Loss % box into the [Color Loss] list, seeded with the
               step's current loss for every colour; PROCESS WISE empties it. */
            const wise = !!lossColours && isColorWiseFor(next, lookups.lossFor);
            patch(r.key, {
              loss_for_id: next,
              color_wise_loss: wise,
              color_losses: wise ? colorLossSeed(lossColours ?? [], r.color_losses, r.loss_pct) : {},
            });
          }}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
      ),
    },
    {
      /**
       * DECLARED HERE, PLANNED WITH IN STEP 4 — and this cell is where a reader
       * is most likely to reach for the wrong change.
       *
       * It does NOT enter this BOM's arithmetic. 0426 reserves process loss for
       * the Fabric Plan ("applying it here as well charges the same loss
       * twice"), and Calculated Quantities is identical with this tab filled in
       * and with it blank. What this figure is for is `order_fabric_plan_stages`
       * (0427), which solves `input = output / (1 - loss/100)` backwards and
       * today has no seed at all.
       *
       * NOT `required`. A route whose losses are not yet known is a legitimate
       * half-answer — the client's own screenshot shows 0.00 on both steps —
       * and holding the cursor on a percentage nobody has measured yet would
       * cage the operator on the one cell they came here to think about. Same
       * call `style-process-grid.tsx` makes for Component.
       */
      header: "Loss %",
      align: "right",
      /* 7rem where the cell may hold the [Color Loss] button (0606); the
         separate 8rem Color-wise Loss column it replaces is gone. */
      width: lossColours ? "7rem" : "4.5rem",
      cell: (r) =>
        /* Loss for = COLOR WISE → each colour's loss in the list; PROCESS WISE
           → the one box. A step whose Compo Color names ONE colour keeps the
           box: one colour has one loss. `isColorWiseFor` is the rule both
           process grids read. */
        lossColours && !r.combo && isColorWiseFor(r.loss_for_id, lookups.lossFor) ? (
          <ColorLossControl
            driven
            colours={lossColours}
            baseLoss={r.loss_pct}
            wise
            losses={r.color_losses ?? {}}
            stageLabel={(r.process_id ? processes.find((p) => p.id === r.process_id)?.name : null) || stageName(r.stage_id)}
            readOnly={readOnly}
            unavailable={lossColours.length === 0 ? "No colourway uses this fabric yet." : null}
            onChange={(next) => patch(r.key, next)}
          />
        ) : (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            value={r.loss_pct}
            disabled={readOnly}
            onChange={(e) => patch(r.key, { loss_pct: e.target.value })}
          />
        ),
    },
    /*
     * `Rate` WAS HERE AND THE CLIENT REMOVED IT (2026-09-03, screenshot 2663:
     * "remove the rate field from fabric process, that second row").
     *
     * It came from the spec of 2026-09-01 — "users must be able to input rates
     * based on the fabric structure, e.g. Knitting Rib = ₹10, Single Jersey =
     * ₹9" — and the COLOUR-WISE half of that spec was already deliberately not
     * built (a stage x colour grain with its own child table, left out of 0492
     * rather than guessed at). Both halves are now out, so the route carries no
     * price at all.
     *
     * THAT MAKES IT AGREE WITH WHAT THE REST OF THE MODULE ALREADY SAID. The
     * Budget's own note reads "the Yarn Process tab stores no rate — it is a
     * quantity document, not a priced one — so the planner types it here"; this
     * column was the single place that contradicted it. A price is entered
     * once, on the document that gets approved (0428).
     *
     * Column, row field, payload schema and DB column all went together (0521).
     * Leaving any one of them would be the "stated vs enforced" split — a field
     * the screen has closed that an import can still write.
     */
    /*
     * HIDDEN FOR NOW (client 2026-09-20: "the last type field hide it for
     * now"). Only the COLUMN goes — `type_id`, the payload, the DB column and
     * the `fabric_process_type` lookup all stay, so a row saved with a Type
     * keeps it and flipping `SHOW_TYPE_COLUMN` back restores the cell as it
     * was. Nothing reads the value, so hiding it changes no figure.
     */
    ...(SHOW_TYPE_COLUMN ? [{
      /**
       * The legacy tab's trailing ▾, BLANK on both rows of the screenshot with
       * no evidence anywhere of what it offers.
       *
       * Built as an EMPTY operator-filled lookup rather than left out (client
       * decision, 2026-09-01) — so 0492 seeds it with nothing and the first
       * value comes from whoever knows what the column means. That is the
       * honest state: an empty list the operator extends, not a vocabulary
       * invented to fill a column.
       */
      header: "Type",
      width: "7rem",
      /* Typed here: inside the `SHOW_TYPE_COLUMN ? [...] : []` spread the
         column array's element type no longer reaches this parameter. */
      cell: (r: FabricProcessRow) => (
        <LookupDialogPicker
          kind="fabric_process_type"
          label="Type"
          compact
          options={lookups.types}
          value={r.type_id}
          onChange={(id) => patch(r.key, { type_id: id || null })}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
      ),
    }] : []),
  ];

  return (
    <ChildGrid<FabricProcessRow>
      columns={columns}
      rows={rows}
      /* OPENS ON A ROW rather than on a bare button — the keyboard contract,
         not a preference: Tab lands on FIELDS, so a grid whose only affordance
         is "+ Add" has nothing to tab into and nothing to stand on and press
         Enter (AGENTS.md, `enterNestedGrid`). Every sibling grid on this screen
         and on Fabric Plan passes it for the same reason. */
      seedRow
      /* `keepOne={false}` — ZERO STEPS IS AN ANSWER HERE, which is the exact
         test the prop's own note sets for opting out. A fabric bought finished
         and cut runs no route at all, and the default (added app-wide on
         2026-08-31 to stop a MANDATORY grid being emptied to nothing) would
         leave a blank step standing on every such fabric with no way to clear
         it — and nothing on this screen requires a route. */
      keepOne={false}
      /* @5xl (1024). Declared widths (Stage 7 + Process 12 + Loss for 7.5 +
         Loss % 4.5 + Type 7 = 38rem = 608px; 31rem while Type is hidden,
         `SHOW_TYPE_COLUMN`) plus ~170px of `#`/remove/cell
         chrome leaves the flexible Process column comfortable room at 1024 —
         MORE than before Descriptions (10rem) went (0528, "this description
         column is not needed"). WITH BOTH SPLIT COLUMNS ON (2026-09-15) that
         is 54rem = 864px + chrome ≈ 1034px, i.e. the table just fills the
         fold panel's ~1344px at the threshold; add a column here and check
         that sum against `tableFrom` again.

         THE THRESHOLD IS NOT COSMETIC HERE — IT DECIDES WHETHER THIS IS A TABLE.
         Below it `ChildGrid` stacks into one labelled field per column, which on
         a seven-column route is seven full-width boxes per step: the "field
         size" complaint exactly. And this grid now renders inside a fold PANEL
         (`ProcessFoldList`), which costs ~80px of container against the section
         it used to fill — on a 1536px screen with the rail that left ~1216
         against a @6xl threshold of 1152, i.e. 64px of margin before a route
         turned into a wall of boxes. A threshold is a function of the DECLARED
         widths AND of the box the grid sits in; it moves when either does.
         `@lg` is 512px of CONTAINER, not 1024 — see `tableFrom`. */
      tableFrom="5xl"
      centerHeaders
      hideHeader={hideHeader}
      /* `renderMobileRow` STAYS. The DEFAULT stacked cell is a bare <div> around
         a RequiredScope with NO VISIBLE LABEL, so dropping this as redundant
         turns the sub-@5xl fallback into six unlabelled boxes — the mistake
         `fabric-bom-screen.tsx` records having made once already. */
      renderMobileRow={(row, i) => (
        <FieldGrid>
          {columns.map((c, ci) => (
            <Field key={ci} label={c.header} required={c.required} size="sm">
              {c.cell(row, i)}
            </Field>
          ))}
        </FieldGrid>
      )}
      /* THE 4-ROW CAP IS GONE (client 2026-09-19) — see `branchKey` above.
         Only a read-only grid hides "+ Add process" now. */
      hideAdd={readOnly}
      /* A NEW ROW NAMES NO BRANCH, and since 2026-09-16 that is a VALID
         ANSWER on the colour axis rather than a hold: a blank Colour means the
         step treats every colourway, which is what most steps do. The Component
         cell still holds (its axis is unchanged), so the sentence that used to
         cover both now covers only that one. Defaulting either to the first
         value would be the "helpful default" AGENTS.md warns turns a blank-row
         test into a constant — and on the colour axis it would now be worse
         than useless, since it would scope a shared step to one colour. */
      onAdd={() => onChange([...rows, blankFabricProcess(newKey(), itemId)])}
      onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
      addLabel="+ Add process"
    />
  );
}
