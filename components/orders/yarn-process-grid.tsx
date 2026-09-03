"use client";

/**
 * Fabric BOM ▸ Yarn Process — ONE YARN'S PROCESSES.
 *
 * Client screenshot 2587 and the spec of 2026-09-01: a yarn and, beneath it, the
 * steps it runs before knitting — GREY ▸ YARN DYEING ▸ For PURPLE ▸ 3%. The
 * rules and both formulas live in `lib/orders/fabric-bom/yarn-process.ts`;
 * storage is 0504.
 *
 * ## THE SIBLING OF `fabric-process-grid.tsx`, AND NOT A COPY OF IT
 *
 * That file's argument for existing applies here unchanged — no surface of its
 * own, columns and nothing else, the caller supplies the box — so this one does
 * not restate it. What differs is three things, and each is why a shared
 * component with a `variant` prop would have been the worse trade:
 *
 *  1. **A different Stage list** — `yarn_stage`, not `fabric_stage`: the fabric
 *     vocabulary also holds WASH and PRINT, which no yarn can be in (0504).
 *  2. **A different applicability flag** — `for_yarn`, not `for_fabric`.
 *  3. **A derived, un-addable outer row** — see below.
 *
 * `For` USED TO BE THE THIRD AND IS NOT ANY MORE (0520). It named a COLOURWAY
 * here and did arithmetic — a step marked PURPLE grossed up the purple share
 * alone — against the fabric route's `process_loss_for`, which describes how a
 * loss is measured. The client specified this column's values as "Process Wise,
 * Color Wise" on 2026-09-03 and confirmed it knowing that removes the split, so
 * the two columns are now ONE list read twice. They are still not worth merging
 * the components for: what is shared is a lookup kind, not a layout.
 *
 * ## THE OUTER ROW IS DERIVED, WHICH IS THE OTHER REAL DIFFERENCE
 *
 * `FabricProcessGrid`'s caller lists fabrics; this one lists YARNS, which the
 * planner cannot add or edit at all. Both are now `ProcessFoldList` rows, and
 * this grid is the panel one of them unfolds onto — legacy's `[+]`, and the tab
 * no longer draws eight routes at once (client 2026-09-03, screenshot 2652).
 *
 * IT USED TO SIT IN A `ChildGrid` CELL. That worked and the keyboard contract
 * covered it by name ("A ROW'S NESTED GRID IS PART OF THE ROW") — what it could
 * not do is fold, because a `<tr>` cannot carry a panel beneath its cells. The
 * panel is still inside `data-grid-row`, so the same sentence still applies.
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the screen's state, patched through `onChange` as they are typed,
 * like every other child grid in this module. The BOM's own footer Save is what
 * persists them, and the purchase weight above re-computes as they are typed.
 */

import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  blankYarnStage,
  processesForYarn,
  yarnStageStarted,
  type YarnProcessOption,
  type YarnStageRow,
} from "@/lib/orders/fabric-bom/yarn-process";

export function YarnProcessGrid({
  rows,
  onChange,
  processes,
  stages,
  lossFor,
  newKey,
  canCreate = false,
  canEdit = false,
  readOnly = false,
}: {
  /** THIS yarn's steps only — they live on the yarn row, so there is nothing to
   *  filter and no way for one to be orphaned. */
  rows: YarnStageRow[];
  onChange: (next: YarnStageRow[]) => void;
  /** The whole master list, unfiltered — the `for_yarn` narrowing is
   *  `processesForYarn`'s job, and it has to run per row so the value a row
   *  already holds survives a flag being unticked on the master. */
  processes: YarnProcessOption[];
  /** `config_lookups` kind `yarn_stage` — GREY, DYED. */
  stages: ConfigLookup[];
  /**
   * `config_lookups` kind `process_loss_for` — PROCESS WISE, COLOR WISE.
   *
   * THE FABRIC ROUTE'S OWN LIST, passed from the same `processLookups.lossFor`
   * that feeds `FabricProcessGrid`'s `Loss for`. One list behind both `For`
   * columns, so a value the operator adds through "+ Add" on either tab is on
   * both — the alternative was a second lookup kind that would drift the first
   * time someone extended one of them.
   */
  lossFor: ConfigLookup[];
  /**
   * The SCREEN's key generator, passed in rather than grown here — the argument
   * `FabricProcessGrid` and `StyleProcessGrid` both record: these rows are
   * re-keyed by the screen when a BOM is loaded, so a counter local to this file
   * would start at zero beside keys already issued and collide the moment a
   * saved treatment was reopened and added to.
   */
  newKey: () => string;
  canCreate?: boolean;
  canEdit?: boolean;
  readOnly?: boolean;
}) {
  const patch = (key: string, next: Partial<YarnStageRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /*
   * NO `usedIds` ON THE PROCESS PICKER, for `FabricProcessGrid`'s reason: a
   * route is ORDERED, not a set. A yarn legitimately runs the same process twice
   * — dyed, then re-dyed to correct a shade — and what makes two rows different
   * is their POSITION, which is why 0504's unique index is (yarn_id, sno) and
   * not (yarn_id, process_id).
   */

  const columns: ChildGridColumn<YarnStageRow>[] = [
    {
      /**
       * GREY / DYED — the state the yarn ENTERS this step in, not the step
       * itself. A GREY ▸ YARN DYEING row is undyed yarn going to the dyehouse; a
       * DYED ▸ WINDING row is what comes back.
       *
       * A LOOKUP, so the planner extends it. 0504 seeds only the two values on
       * the client's own screen; inventing MERCERISED or GASSED beside them is
       * the defaulted-vocabulary mistake AGENTS.md records under "Near misses".
       */
      header: "Stage",
      width: "7rem",
      required: rows.some(yarnStageStarted),
      cell: (r) => (
        <LookupDialogPicker
          kind="yarn_stage"
          label="Stage"
          compact
          options={stages}
          value={r.stage_id}
          onChange={(id) => patch(r.key, { stage_id: id || null })}
          required={yarnStageStarted(r)}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
      ),
    },
    {
      /**
       * SIZED, LIKE EVERY OTHER COLUMN — and that is what makes the grid hug.
       *
       * IT WAS THE ONE FLEXIBLE COLUMN, deliberately, and the reasoning expired
       * under it. The argument was that this grid "sits inside another grid's
       * row, where hugging would leave the outer row's slack empty to the right
       * of a cramped picker" — true while it was a `ChildGrid` CELL. It is now
       * the panel a `ProcessFoldList` row unfolds onto (2026-09-03), which
       * spans the whole section: the slack stopped being a cell's and became a
       * page's, and `hugsContent` being off meant all ~880px of it landed on one
       * picker. A Process box eight times the width of the Loss % beside it is
       * the "field size" complaint (client screenshot 2660), and it is a layout
       * fault rather than a preference — `child-grid.tsx` records the same
       * failure for a Size grid that rendered "S" in a 490px control.
       *
       * `width` HERE IS WHAT FLIPS THE WHOLE GRID: `hugsContent` is
       * `columns.every(c => c.width)`, all-or-nothing on purpose (see it), so
       * this declaration is not a local cap — it is the switch that makes the
       * card stop at the last column instead of trailing grey.
       *
       * 12rem HOLDS A PROCESS NAME (YARN DYEING, SOFT WINDING, MERCERISING) and
       * the picker truncates-and-reveals past that, which is the contract for
       * every stored value in this app.
       */
      header: "Process",
      width: "12rem",
      required: rows.some(yarnStageStarted),
      cell: (r) => (
        <RecordPicker
          label=""
          compact
          items={processesForYarn(processes, { currentValue: r.process_id })}
          value={r.process_id}
          onChange={(id) => patch(r.key, { process_id: id })}
          disabled={readOnly}
          required={yarnStageStarted(r)}
          /* Empty-and-explain. An empty list means the Process master has
             nothing flagged "Yarn", which is fixed on a DIFFERENT screen — a
             bare "— Select —" over nothing reads as a broken dropdown and
             teaches the planner nothing (AGENTS.md, nominated vendors). */
          emptyHint="No process is flagged for Yarn — tick it on Master Data ▸ Materials ▸ Processes"
        />
      ),
    },
    {
      /**
       * HOW THE LOSS % BESIDE IT IS MEASURED — PROCESS WISE or COLOR WISE.
       *
       * "for field is dropdown field values are Process Wise, Color Wise"
       * (client 2026-09-03). It is the fabric route's `Loss for` column, one
       * label along, reading the same `process_loss_for` lookup.
       *
       * ## IT NAMED A COLOURWAY UNTIL 2026-09-03, AND THAT WAS ARITHMETIC
       *
       * The cell was a `<Select>` over this yarn's own combos, and a step marked
       * PURPLE grossed up the purple share alone ("it only applies the dyeing
       * process to the exact weight percentage of yarn destined for that
       * specific colour combo" — client, 2026-09-01). Two fixed words cannot
       * name PURPLE, so choosing them removes that split; the client was shown
       * exactly that and chose them. The later instruction wins, and this is a
       * decision to re-open with them rather than a bug to quietly correct —
       * 0520's header carries the full account.
       *
       * A `LookupDialogPicker` AND NOT A `<Select>`, matching the fabric route:
       * the vocabulary is the operator's to extend, and "+ Add" is how they do
       * it. That is also what makes the two tabs share one list rather than one
       * shape.
       */
      header: "For",
      width: "8rem",
      cell: (r) => (
        <LookupDialogPicker
          kind="process_loss_for"
          label="For"
          compact
          options={lossFor}
          value={r.loss_for_id}
          onChange={(id) => patch(r.key, { loss_for_id: id || null })}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
      ),
    },
    {
      /* Legacy's greyed "Descriptions" cell, as free text — the same call the
         fabric route and the Garment Order's Style ▸ Process grid both made on
         the same evidence: the Process cell beside it carries the ⓘ glyph every
         master-backed field in this app carries, and this one carries none. Not
         `required`: a step with no note is a complete answer. */
      /* LEGACY'S OWN WORD, PLURAL (client 2026-09-03, who enumerated this
         tab's columns and wrote "Descriptions"). Same call `Dia / Size / Width`
         makes on the Fabric BOM section — a legacy header is copied, not
         improved, so an operator reading the two screens side by side is
         matching columns rather than translating them. */
      header: "Descriptions",
      width: "10rem",
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
       * THE FIGURE THAT BUYS THE YARN, and the cell a reader is most likely to
       * reach for the wrong change on.
       *
       * Unlike the fabric route's identically-named column, this one IS
       * arithmetic: it grosses up the purchase weight shown on the row above,
       * and it COMPOUNDS with the other stages treating the same colourway —
       * 3% then 2% is x 1.03 x 1.02, not x 1.05 (client, 2026-09-01).
       *
       * NOT `required`. A treatment whose loss is not yet measured is a
       * legitimate half-answer, and holding the cursor on a percentage nobody
       * knows yet would cage the planner on the one cell they came here to think
       * about.
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
  ];

  return (
    <ChildGrid<YarnStageRow>
      columns={columns}
      rows={rows}
      /* OPENS ON A ROW rather than on a bare button — the keyboard contract, not
         a preference: Tab lands on FIELDS, so a grid whose only affordance is
         "+ Add" has nothing to tab into and nothing to stand on and press Enter
         (AGENTS.md, `enterNestedGrid`). It matters more here than on the fabric
         route: this grid is NESTED inside a yarn row, and Tab walks the row's own
         cells and then this panel — an empty panel is a yarn the planner tabs
         straight past without seeing that it could be processed. */
      seedRow
      /* `keepOne={false}` — ZERO PROCESSES IS AN ANSWER, and the commonest one:
         "if the garment uses solid fabric, the raw yarn does not undergo
         yarn-stage dyeing" (client). The default would leave a blank step
         standing on every solid order's yarn with no way to clear it. */
      keepOne={false}
      /* @5xl (1024), AND THE GRID NOW FITS INSIDE IT WHOLE. Every column
         declares a width since 2026-09-03 — 7 + 12 + 8 + 10 + 4.5 = 41.5rem =
         664px — and `ChildGrid`'s own chrome is 88px exactly (`#` is `w-10` plus
         `px-2`, the remove column `w-8`), so the table measures ~752px against a
         1024px threshold. That margin is the point: the widths can be tuned
         without anyone having to re-derive whether the grid still renders as a
         table.

         THE THRESHOLD MATTERS MORE SINCE THIS GRID MOVED INTO A FOLD PANEL: the
         panel costs ~80px of container against the section it used to sit in,
         and below the threshold `ChildGrid` stacks into one labelled full-width
         box per column — five of them per process, which is the "field size"
         complaint rather than a graceful fallback. Below it the grid stacks; it
         never scrolls sideways (rule 4). */
      tableFrom="5xl"
      centerHeaders
      /* `renderMobileRow` STAYS. The DEFAULT stacked cell is a bare <div> around
         a RequiredScope with NO VISIBLE LABEL, so dropping this as redundant
         turns the sub-@5xl fallback into five unlabelled boxes — the mistake
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
      hideAdd={readOnly}
      onAdd={() => onChange([...rows, blankYarnStage(newKey())])}
      onRemove={(r) => onChange(rows.filter((x) => x.key !== r.key))}
      /* "+ Add process", NOT "+ Add treatment" (client 2026-09-03: "rename the
         label for both fabric and yarn process as add process"). The fabric
         route already said it, so this tab was the outlier — and a tab whose
         button, column header and fold summary each used a different word for
         one thing is the drift AGENTS.md keeps recording. The whole vocabulary
         moved with the button, not just the button. */
      addLabel="+ Add process"
    />
  );
}
