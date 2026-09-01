"use client";

/**
 * Fabric BOM ▸ Yarn Process — ONE YARN'S TREATMENTS.
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
 *  1. **`For` is a COLOURWAY here, and it does arithmetic.** On the fabric route
 *     the same-named column is `process_loss_for` — how a loss is measured. Here
 *     it names the combo the treatment applies to, and a stage marked PURPLE
 *     grosses up the purple share alone. Two columns, one label, no relation.
 *  2. **A different Stage list** — `yarn_stage`, not `fabric_stage`: the fabric
 *     vocabulary also holds WASH and PRINT, which no yarn can be in (0504).
 *  3. **A different applicability flag** — `for_yarn`, not `for_fabric`.
 *
 * ## THE OUTER ROW IS DERIVED, WHICH IS THE OTHER REAL DIFFERENCE
 *
 * `FabricProcessGrid`'s caller draws a read-only heading per fabric because the
 * fabric is already stated on Fabric Lines. Here the outer row is a YARN the
 * planner cannot add or edit at all — so the whole thing is a `ChildGrid` inside
 * a `ChildGrid` cell, the shape Order Entry ▸ Pack type(s) uses and the one the
 * keyboard contract covers by name ("A ROW'S NESTED GRID IS PART OF THE ROW").
 *
 * ## Edits apply live; there is no Apply button
 *
 * The rows are the screen's state, patched through `onChange` as they are typed,
 * like every other child grid in this module. The BOM's own footer Save is what
 * persists them, and the purchase weight above re-computes as they are typed.
 */

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  combos,
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
   * The colourways THIS YARN is actually needed in.
   *
   * NOT the order's whole combo list, which is the cascading-filter rule
   * (AGENTS.md) applied to a facet that would otherwise offer answers that
   * cannot be right: a stage marked For = a colourway this yarn does not appear
   * in treats nothing, and `stageProblem` would then have to explain a choice
   * the box should never have offered. The caller derives it from the same
   * `byCombo` breakdown the weight came out of.
   */
  combos: string[];
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
      width: "8rem",
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
       * THE ONE FLEXIBLE COLUMN, so the slack lands on the longest value rather
       * than on a percentage box. `hugsContent` is `columns.every(c => c.width)`,
       * so leaving this one unsized is what flips the grid from hugging its
       * declarations to filling the cell it sits in — and this one sits inside
       * another grid's row, where hugging would leave the outer row's slack
       * empty to the right of a cramped picker.
       */
      header: "Process",
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
       * WHICH COLOURWAY THIS TREATMENT IS FOR — and it divides the weight.
       *
       * "It only applies the dyeing process to the exact weight percentage of
       * yarn destined for that specific colour combo" (client, confirmed as
       * arithmetic rather than a label, 2026-09-01). So a stage marked PURPLE
       * grosses up the purple share alone and leaves green at its net weight.
       *
       * BLANK MEANS EVERY COLOURWAY, which is the ordinary case — a yarn dyed
       * for the whole order names no combo. The option is labelled rather than
       * left as a bare empty row, because "" and "all" look identical in a
       * `<select>` and only one of them is what this means.
       *
       * A `<Select>` over the yarn's OWN colourways, not a free text box and not
       * the order's whole list: see the `combos` prop.
       */
      header: "For",
      width: "10rem",
      cell: (r) => (
        <Select
          compact
          className="h-8"
          aria-label="For colourway"
          value={r.combo}
          disabled={readOnly}
          onChange={(e) => patch(r.key, { combo: e.target.value })}
        >
          <option value="">All colourways</option>
          {/* THE HELD VALUE SURVIVES A LIST THAT NO LONGER OFFERS IT — the
              "Disabled rows" rule. A combo removed from the order after the
              treatment was recorded would otherwise render as blank, which reads
              as "applies to everything" and silently widens the loss to every
              colourway. `stageProblem` is what says so out loud. */}
          {(combos.includes(r.combo) || !r.combo ? combos : [...combos, r.combo]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      ),
    },
    {
      /* Legacy's greyed "Descriptions" cell, as free text — the same call the
         fabric route and the Garment Order's Style ▸ Process grid both made on
         the same evidence: the Process cell beside it carries the ⓘ glyph every
         master-backed field in this app carries, and this one carries none. Not
         `required`: a step with no note is a complete answer. */
      header: "Description",
      width: "11rem",
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
         straight past without seeing that it could be treated. */
      seedRow
      /* `keepOne={false}` — ZERO TREATMENTS IS AN ANSWER, and the commonest one:
         "if the garment uses solid fabric, the raw yarn does not undergo
         yarn-stage dyeing" (client). The default would leave a blank step
         standing on every solid order's yarn with no way to clear it. */
      keepOne={false}
      /* The declared widths sum to ~544px plus ~80 of `#`/remove chrome, leaving
         the flexible Process column room at 1024 — so the table may appear from
         @5xl. Below it the grid stacks; it never scrolls sideways (rule 4). */
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
      addLabel="+ Add treatment"
    />
  );
}
