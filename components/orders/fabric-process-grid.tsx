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
 * section of `fabric-bom-screen.tsx`, which draws one bordered card per fabric.
 *
 * ## WHY A CARD PER FABRIC AND NOT A [Click] → SHEET
 *
 * The obvious model was the Garment Order's Style ▸ Process, which IS a button
 * opening a sheet, and it was the wrong one here for a structural reason rather
 * than a taste: there the outer row is EDITABLE, so the button is one cell of a
 * row full of fields. Here the outer row is the BOM's own fabric line, READ —
 * the description, the type and the colour are all already stated on the Fabric
 * Lines section and re-typing them would be the second copy 0490 refused for
 * the palette panels. A read-only outer row also rules out `ChildGrid`'s
 * `foldRows`, whose own note requires a folded row to keep at least one real
 * field or Tab cannot reach it.
 *
 * What is left is exactly the shape Fabric Plan ▸ Routes already uses one step
 * later on the identical data (a heading naming the fabric, a route grid under
 * it), which is the strongest argument of all: the two screens ask the same
 * question about the same fabrics and should not look like different features.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the screen's state, patched through `onChange` as they are
 * typed, like every other child grid in this module. The BOM's own footer Save
 * is what persists them.
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
  processesForFabric,
  type FabricProcessLookups,
  type FabricProcessOption,
  type FabricProcessRow,
} from "@/lib/orders/fabric-bom/processes";

export function FabricProcessGrid({
  itemId,
  rows,
  onChange,
  processes,
  lookups,
  newKey,
  canCreate = false,
  canEdit = false,
  readOnly = false,
}: {
  /** The fabric these steps belong to — stamped onto every row added. */
  itemId: string;
  /** THIS fabric's steps only. The screen filters; this grid never does. */
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
      width: "8rem",
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
      header: "Process",
      required: rows.some(fabricProcessRowStarted),
      cell: (r) => (
        <RecordPicker
          label=""
          compact
          items={processesForFabric(processes, { currentValue: r.process_id })}
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
      ),
    },
    {
      /** "Process wise" on the legacy screen — how the Loss % beside it is
       *  measured. The rest of the vocabulary is unknown, so it is a lookup the
       *  operator extends rather than a guess (0492). */
      header: "Loss for",
      width: "9rem",
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
      /* Legacy's [Click]-into-a-sub-list, as free text — the same call the
         Garment Order's Style ▸ Process grid made on the same evidence. Not
         `required`: a step with no note is a complete answer. */
      header: "Description",
      width: "12rem",
      cell: (r) => (
        <Input
          value={r.description}
          disabled={readOnly}
          className="h-8"
          onChange={(e) => patch(r.key, { description: e.target.value })}
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
      width: "5rem",
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
    {
      /**
       * THE FABRIC-WISE PROCESSING RATE (client spec 2026-09-01: "users must be
       * able to input rates based on the fabric structure — e.g. Knitting Rib =
       * ₹10, Single Jersey = ₹9").
       *
       * IT NEEDS NO SECOND KEY, because the route is already keyed to one
       * fabric (0492). "Fabric-wise" is what this cell IS, not a mode it has to
       * be put into — which is the whole payoff of grouping by `item_id`
       * rather than by BOM line.
       *
       * NOT `required`, like Loss % beside it: a route being planned before its
       * rates are negotiated is the ordinary case, and this document is not the
       * one that gets approved (the Budget is, 0428).
       *
       * COLOUR-WISE RATES ARE NOT HERE. The spec also asks for a rate that
       * differs by colour combo on finishing stages ("dark colours might
       * require a higher dyeing rate like ₹40"). That is a (stage x colour)
       * grain with its own child table, deliberately left out of 0492 rather
       * than guessed at — see that migration's header.
       */
      header: "Rate",
      align: "right",
      width: "6rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          value={r.rate}
          disabled={readOnly}
          onChange={(e) => patch(r.key, { rate: e.target.value })}
        />
      ),
    },
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
      width: "8rem",
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
      /* THE WIDTHS SUM TO ~848px INCLUDING THE `#`/remove chrome, so the table
         needs ~1050 before the flexible Process column is readable — hence @6xl
         (1152) and not the @5xl this took before the Rate column was added.
         A threshold is a function of the DECLARED widths; it moves when they do,
         and the symptom of forgetting is not an error but a table that overflows
         its card. `@lg` is 512px of CONTAINER, not 1024 — see `tableFrom`.
         Below the threshold the grid stacks; it never scrolls sideways. */
      tableFrom="6xl"
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
      onAdd={() => onChange([...rows, blankFabricProcess(newKey(), itemId)])}
      onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
      addLabel="+ Add process"
    />
  );
}
