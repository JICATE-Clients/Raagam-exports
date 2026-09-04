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
 * ## ONE GRID PER GROUP SINCE 2026-09-04 (0528)
 *
 * A fabric's route may now be split "Assort Color Wise" and/or
 * "Component Wise" — legacy's `[Assort Color]` / `[Components]` on the outer
 * row, read as CONTROLS rather than a second copy of Fabric Lines. This file
 * still renders exactly ONE route; the caller (`ProcessFoldList`'s panel in
 * `fabric-bom-screen.tsx`) is what now renders one instance of it per group
 * `processGroupsFor` returns, instead of always one. `combo` / `componentId`
 * are what stamp a group's identity onto every row this grid adds — see
 * `lib/orders/fabric-bom/processes.ts` for the grouping rule itself.
 */

import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  MAX_ROUTE_STAGES,
  blankFabricProcess,
  fabricProcessRowStarted,
  printBlocked,
  processesForFabric,
  type FabricProcessLookups,
  type FabricProcessOption,
  type FabricProcessRow,
} from "@/lib/orders/fabric-bom/processes";

export function FabricProcessGrid({
  itemId,
  combo = null,
  componentId = null,
  rows,
  onChange,
  processes,
  lookups,
  newKey,
  printDeclared,
  canCreate = false,
  canEdit = false,
  readOnly = false,
}: {
  /** The fabric these steps belong to — stamped onto every row added. */
  itemId: string;
  /** WHICH GROUP this grid is one fabric's route split into (0528) — both
   *  null is the unified route, the caller's own `processGroupsFor` decides.
   *  Stamped onto every row this grid adds, the same way `itemId` already is. */
  combo?: string | null;
  componentId?: string | null;
  /** THIS group's steps only. The screen filters; this grid never does. */
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
  canCreate?: boolean;
  canEdit?: boolean;
  readOnly?: boolean;
}) {
  const patch = (key: string, next: Partial<FabricProcessRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /*
   * NO `usedIds`, AND THE OMISSION IS THE RULE RATHER THAN AN OVERSIGHT.
   *
   * `StyleProcessGrid` scopes taken process ids by Type, because 0411's unique
   * key is (style, kind, process) — a style cannot name one process twice. A
   * ROUTE is the opposite: a fabric legitimately runs DYEING twice (a ground
   * shade, then a garment-wash correction), and compacting can appear before
   * and after printing. What makes two rows different here is their POSITION,
   * which is why 0492's unique index is (line_id, sno) and not (line_id,
   * process_id). Adding `usedIds` would withhold a correct second entry with no
   * explanation on screen.
   */

  const columns: ChildGridColumn<FabricProcessRow>[] = [
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
        <LookupDialogPicker
          kind="fabric_stage"
          label="Stage"
          compact
          options={lookups.stages}
          value={r.stage_id}
          onChange={(id) => patch(r.key, { stage_id: id || null })}
          required={fabricProcessRowStarted(r)}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
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
        <div className="min-w-0">
          <RecordPicker
            label=""
            compact
            items={processesForFabric(processes, { currentValue: r.process_id, printDeclared })}
            value={r.process_id}
            onChange={(id) => patch(r.key, { process_id: id })}
            disabled={readOnly}
            required={fabricProcessRowStarted(r)}
            /* Empty-and-explain. An empty list here means the Process master has
               nothing flagged "Fabric", which is fixed on a DIFFERENT screen — a
               bare "— Select —" over nothing reads as a broken dropdown and
               teaches the operator nothing (AGENTS.md, nominated vendors). */
            emptyHint="No process is flagged for Fabric — tick it on Master Data ▸ Materials ▸ Processes"
          />
          {/* 0528 — "block the dyer/planner from selecting Print … Print
              details are not available for this style". `printDeclared`
              withholds every Print-flagged process from the list ABOVE, so
              this only fires on a row that already holds one from before the
              print was removed (or from before this gate existed) — the
              same "held value survives, tagged" idiom `printBlocked` shares
              with every disabled-row rule in this app. */}
          {printBlocked(r, processes, printDeclared) && (
            <div className="mt-0.5 text-xs text-warning">
              Print details are not available — add a Roll form print on
              Color/Print Details first.
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
          onChange={(id) => patch(r.key, { loss_for_id: id || null })}
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
      width: "4.5rem",
      cell: (r) => (
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
    {
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
      cell: (r) => (
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
    },
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
         Loss % 4.5 + Type 7 = 38rem = 608px) plus ~170px of `#`/remove/cell
         chrome leaves the flexible Process column comfortable room at 1024 —
         MORE than before Descriptions (10rem) went (0528, "this description
         column is not needed"), so the threshold this comment used to defend
         is no longer close to the edge. Left at `5xl` rather than lowered:
         nothing asked for the route to switch into stacked-card mode any
         sooner, and this grid now also renders once PER GROUP when a fabric's
         route is split — dropping the threshold would flip a two-colourway
         fabric between table and card mode depending on how many groups fit
         beside it, which is a worse inconsistency than leaving headroom.

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
      /* FOUR STAGES, AND NO MORE (client spec 2026-09-01: "the system must
         support up to 4 distinct stages"). `hideAdd` rather than a check inside
         `onAdd` because it does two things at once — it removes the button AND
         makes Enter on the last field decline, so the keyboard cannot get past
         the cap either. That is the same reasoning the Garment Order's style
         cap records, and the same prop.

         THE ROWS ALREADY ENTERED ARE NEVER TRIMMED. A BOM loaded from a time
         when the cap was different keeps every stage it has; the cap refuses
         the NEXT one. Silently dropping a fifth stage because a rule changed is
         data loss dressed up as validation. */
      hideAdd={readOnly || rows.length >= MAX_ROUTE_STAGES}
      onAdd={() =>
        onChange([
          ...rows,
          blankFabricProcess(newKey(), itemId, { combo, component_id: componentId }),
        ])
      }
      onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
      addLabel="+ Add process"
    />
  );
}
