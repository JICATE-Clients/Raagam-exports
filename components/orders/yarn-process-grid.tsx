"use client";

/**
 * Fabric BOM ▸ Yarn Process — ONE YARN'S PROCESSES.
 *
 * Client screenshot 2587 and the spec of 2026-09-01: a yarn and, beneath it, the
 * steps it runs before knitting — GREY ▸ YARN DYEING ▸ For PURPLE ▸ 3%. The
 * rules and both formulas live in `lib/orders/fabric-bom/yarn-process.ts`;
 * storage is 0504 · 0529.
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
 * `For` NAMES A COLOURWAY AND DOES ARITHMETIC AGAIN (0504, restored 0529 after
 * 0520 removed it). A step marked PURPLE grosses up the purple share alone. The
 * fabric route's identically-named `process_loss_for` column is unrelated
 * arithmetic — it describes how a loss is measured, never what it is measured
 * against — and this tab's `loss_for_id` cell keeps reading that same shared
 * list as its LABEL (PROCESS WISE / COLOR WISE), one column along from the new
 * `Colour` cell that does the dividing. COLOR WISE is what reveals `Colour` on
 * a caller without `colourLoss` (none today — see that prop); see `isColorWise`
 * below and `yarn-process.ts`'s file header for why the arithmetic itself never
 * branches on it.
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

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { DetailSection } from "@/components/masters/detail-section";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { ColorLossControl } from "@/components/orders/color-loss-control";
import { colorLossSeed, isColorWiseFor } from "@/lib/orders/fabric-bom/color-loss";
import {
  opensYarnStage,
  yarnBaseMissing,
  yarnBasesForStage,
  yarnStageMismatch,
} from "@/lib/orders/fabric-bom/yarn-stage-routes";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  blankYarnStage,
  processesForYarn,
  yarnStageStarted,
  type ConversionDetailDraft,
  type YarnProcessOption,
  type YarnStageRow,
} from "@/lib/orders/fabric-bom/yarn-process";

/**
 * Does this row's `For` LABEL say "Color Wise"? Purely a UI question — it
 * decides whether the `Colour` cell is shown, never whether the arithmetic
 * scopes by it (that reads `combo` alone; see `yarn-process.ts`'s header).
 *
 * BOTH SPELLINGS, because this business writes both (AGENTS.md, Near misses) —
 * a lookup renamed COLOUR WISE must not silently hide the field it names.
 */
function isColorWise(lossForId: string | null, lossFor: readonly ConfigLookup[]): boolean {
  const opt = lossFor.find((l) => l.id === lossForId);
  return !!opt && /colou?r/i.test(opt.name);
}

export function YarnProcessGrid({
  rows,
  onChange,
  processes,
  stages,
  lossFor,
  combos,
  newKey,
  canCreate = false,
  canEdit = false,
  readOnly = false,
  colourLoss = false,
  looseFabrics = [],
  onLooseFabricPicked,
  orderCombos = [],
  stripeColours: stripeColoursProp,
  yarnName,
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
   * time someone extended one of them. Also what `isColorWise` reads.
   */
  lossFor: ConfigLookup[];
  /**
   * The colourways THIS YARN is actually needed in (0504, restored 0529).
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
  /** ASSORT COLOR-WISE LOSS (0606 · 0613) — For = COLOR WISE turns Loss %
   *  into a [Color Loss] list over `combos` (each colour + its loss) and the
   *  Colour dropdown is not drawn. BOTH callers pass it now: the Fabric BOM
   *  since 0606, the IWO Fabric BOM since 0613 gave its tables the columns
   *  (client screenshot 2979 — an IWO's COLOR WISE opened a shade ▾ instead of
   *  the list). Still opt-in rather than the default so a caller whose table
   *  cannot store the map never shows a control whose figures the save would
   *  drop on the floor. */
  colourLoss?: boolean;
  /**
   * LOOSE FABRIC CONVERSION (0633) — the fabrics a CONVERSION step may name as
   * its Source Loose Fabric: greige cloths (a yarn-dyed one cannot be
   * piece-dyed with the body). Empty on a caller that does not support the
   * conversion (IWO), where the step is simply never offered a source.
   */
  looseFabrics?: PickerItem[];
  /** The ORDER's colourways — the Conversion Details' rows when this yarn
   *  feeds no yarn-dyed colour yet (legacy lists the order's colours, RED ·
   *  GREEN, screenshot 3096; user 2026-09-26: the fields must not be missing). */
  orderCombos?: readonly string[];
  /**
   * THIS YARN'S STRIPE COLOURS — Yarn Dyed Details' Color 1, Color 2… with the
   * yarn colour each colourway puts there and the position's share of the yarn
   * (user 2026-09-26: the Details' Description lists these, not the garment
   * colourways). `value` is the position ("Color 1"), which is what the
   * conversion engine keys a Details row by; `label` is what the list shows.
   * Empty = the yarn has no stripes declared, and the list falls back to the
   * colourways as before.
   */
  stripeColours?: readonly { value: string; label: string; positions?: readonly string[] }[];
  /** The yarn's name, for the Details' one-line note when it has no stripes. */
  yarnName?: string;
  /** Called when a source is picked, so the screen can inject the loose
   *  fabric's KNITTING -> DYEING -> CONVERSION route on Fabric Process. */
  onLooseFabricPicked?: (fabricId: string) => void;
}) {
  /* The options as the stage rules read them — YARN processes only (a fabric
     process classified to GREIGE, KNITTING say, is not a base a yarn row can
     pick — client screenshot 2971), `stage_roles` defaulted since IWO's loader
     does not carry it. */
  const yarnOpts = processes.filter((p) => p.for_yarn).map((p) => ({ ...p, stage_roles: p.stage_roles ?? [] }));
  const stageNameOf = (id: string | null) => (id ? stages.find((s) => s.id === id)?.name : null) || "this stage";
  const patch = (key: string, next: Partial<YarnStageRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  /** Is this step a LOOSE FABRIC CONVERSION (0633)? Off the master's flag. */
  /* THE CONVERSION STEP'S [Click] POPUP — which row it is open for, and the
     button it grows out of. A view, never data: the loose fabric it picks is
     written to the row itself. */
  const [looseFor, setLooseFor] = useState<{ key: string; origin: DOMRect } | null>(null);

  const isConversion = (r: YarnStageRow) =>
    !!r.process_id && !!processes.find((p) => p.id === r.process_id)?.is_unravelling;

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
          onChange={(id) => {
            const stageId = id || null;
            /* RESTRICTED, NOT WARNED (client 2026-09-21, screenshot 2971): a
               held process the new Stage would not offer — or that is not the
               base the stage opens with — is CLEARED, so a Stage/Process pair
               the ▾ refuses cannot be assembled by changing the Stage after
               the Process. The Process cell then holds the cursor until a
               legal one is picked. Differs from the fabric route's "held value
               survives, tagged" on the client's word. */
            const at = rows.findIndex((x) => x.key === r.key);
            const offered = processesForYarn(processes, { currentValue: null, stageId, isFirstOfStage: opensYarnStage(rows.map((x, i) => (i === at ? { ...x, stage_id: stageId } : x)), at) });
            const keep = !r.process_id || offered.some((p) => p.id === r.process_id);
            patch(r.key, { stage_id: stageId, ...(keep ? {} : { process_id: null }) });
          }}
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
      cell: (r) => {
        const at = rows.findIndex((x) => x.key === r.key);
        /* HARD GATE, SHOWN AS ONE (client 2026-09-21): a row Save will refuse
           wears a red outline on the cell at fault and a red sentence under
           it — never amber, which reads as advice. */
        const refused = yarnStageMismatch(r, yarnOpts) || yarnBaseMissing(rows, at, yarnOpts);
        return (
          <div className={refused ? "min-w-0 rounded-md ring-2 ring-danger" : "min-w-0"}>
            <RecordPicker
              label=""
              compact
              /* THE STAGE DECIDES THE PROCESS (client 2026-09-21) — the yarn
                 side of 0563's rule: the ▾ narrows to the processes classified
                 for the row's Stage, and the FIRST step of a stage to its base
                 (YARN DYEING under DYED, YARN PURCHASE under GREIGE). Withheld
                 from the list, never blocked after the fact; the twins below
                 name a held value the list would not offer today. */
              items={processesForYarn(processes, {
                currentValue: r.process_id,
                stageId: r.stage_id,
                isFirstOfStage: opensYarnStage(rows, at),
              })}
              value={r.process_id}
              onChange={(id) => {
                const picked = processes.find((p) => p.id === id);
                if (picked?.is_unravelling) {
                  /* A CONVERSION STEP (0633): the Stage defaults to the one
                     it opens (DYED — off the master's classification, never a
                     code string), and it carries no colour or For of its own.
                     ITS LOSS IS ITS OWN NOW (2026-09-26): CONVERSION left the
                     loose fabric's route, so the unravelling loss is typed
                     here, opening at the spec's 2.00 % — a colour's Details
                     Loss % overrides it for that colour. */
                  patch(r.key, {
                    process_id: id,
                    stage_id: r.stage_id ?? picked.stage_roles?.find((x) => x.is_base)?.stage_id ?? null,
                    loss_for_id: null,
                    combo: "",
                    loss_pct: r.loss_pct.trim() || "2",
                    color_wise_loss: false,
                    color_losses: {},
                  });
                  return;
                }
                patch(r.key, { process_id: id, source_loose_fabric_id: null, conversion_details: [] });
              }}
              disabled={readOnly}
              required={yarnStageStarted(r)}
              /* Empty-and-explain. An empty list means the Process master has
                 nothing flagged "Yarn", which is fixed on a DIFFERENT screen — a
                 bare "— Select —" over nothing reads as a broken dropdown and
                 teaches the planner nothing (AGENTS.md, nominated vendors). */
              emptyHint="No process is flagged for Yarn — tick it on Master Data ▸ Materials ▸ Processes"
            />
            {yarnStageMismatch(r, yarnOpts) && (
              <p className="mt-0.5 px-1 text-xs font-medium text-danger">
                {stageNameOf(r.stage_id)} does not run {processes.find((p) => p.id === r.process_id)?.name ?? "this process"}
                {" "}— change the Stage or pick another process.
              </p>
            )}
            {yarnBaseMissing(rows, at, yarnOpts) && (
              <p className="mt-0.5 px-1 text-xs font-medium text-danger">
                The first step under {stageNameOf(r.stage_id)} must be{" "}
                {yarnBasesForStage(yarnOpts, r.stage_id).map((b) => b.name).join(" or ")}.
              </p>
            )}
          </div>
        );
      },
    },

    {
      /**
       * HOW THE LOSS % BESIDE IT IS MEASURED — PROCESS WISE or COLOR WISE.
       *
       * "for field is dropdown field values are Process Wise, Color Wise"
       * (client 2026-09-03). It is the fabric route's `Loss for` column, one
       * label along, reading the same `process_loss_for` lookup.
       *
       * THIS CELL IS A LABEL, NOT ARITHMETIC (0520 · 0529). It used to BE the
       * colourway and divide the weight; the client replaced its values with two
       * fixed words on 2026-09-03, which cannot name PURPLE, and confirmed that
       * knowing it removed the split. 0529 restores the split as its own cell
       * — `Colour`, next — rather than reversing this one back into double duty:
       * the client's later instruction about THIS column stands, and what
       * changed is that the arithmetic gained a place to live beside it.
       *
       * PICKING COLOR WISE HERE REVEALS `Colour`. Switching away clears it
       * (`isColorWise` below), so the two cells cannot disagree — a row reading
       * "Process Wise" with a colourway still attached underneath would gross up
       * a lot the label denies scoping to.
       */
      header: "For",
      width: "8rem",
      cell: (r) =>
        isConversion(r) ? (
          /* A CONVERSION STEP'S [Click] (user 2026-09-25, legacy screenshots
             3093 · 3094: the legacy row carries a "Click" that opens its
             Details). Opens the Source Loose Fabric popup; the button reads the
             fabric once one is picked, and wears the required ring until then.
             `data-row-open` puts it on the Tab / arrow path (child-grid.tsx). */
          (() => {
            const perColour = (r.conversion_details ?? []).filter((d) => d.source_loose_fabric_id).length;
            const name =
              looseFabrics.find((f) => f.id === r.source_loose_fabric_id)?.name ??
              (perColour > 0 ? `${perColour} colour${perColour === 1 ? "" : "s"} set` : null);
            return (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-row-open
                aria-expanded={looseFor?.key === r.key}
                aria-label={name ? `Loose fabric: ${name}` : "Choose the source loose fabric"}
                className={
                  name
                    ? "h-8 w-full justify-start px-2"
                    : "h-8 w-full justify-start px-2 ring-2 ring-danger"
                }
                onClick={(e) => setLooseFor({ key: r.key, origin: e.currentTarget.getBoundingClientRect() })}
              >
                <Truncated className="text-sm">{name ?? "Click"}</Truncated>
              </Button>
            );
          })()
        ) : (
        <LookupDialogPicker
          kind="process_loss_for"
          label="For"
          compact
          options={lossFor}
          value={r.loss_for_id}
          onChange={(id) => {
            const next = id || null;
            if (colourLoss) {
              /* FABRIC BOM (client 2026-09-21): For IS THE SWITCH. COLOR WISE
                 turns the Loss % box into the [Color Loss] list, seeded with
                 the step's current loss for every colour so nothing changes
                 until a figure is edited; PROCESS WISE empties it. No colour
                 dropdown either way — the colours live in the list. */
              const wise = isColorWiseFor(next, lossFor);
              patch(r.key, {
                loss_for_id: next,
                combo: "",
                color_wise_loss: wise,
                color_losses: wise ? colorLossSeed(lossColours, r.color_losses, r.loss_pct) : {},
              });
              return;
            }
            patch(r.key, {
              loss_for_id: next,
              /* Cleared when the label stops scoping by colour. */
              combo: isColorWise(next, lossFor) ? r.combo : "",
            });
          }}
          canCreate={canCreate && !readOnly}
          canEdit={canEdit && !readOnly}
        />
        ),
    },
    ...(colourLoss
      ? []
      : [
    {
      /**
       * NOT DRAWN UNDER `colourLoss` — which is now every caller (Fabric BOM
       * since 0606, IWO since 0613): COLOR WISE lists every colour with its own
       * loss behind the [Color Loss] button instead (the Loss % column below).
       * The cell stays for a caller whose table cannot hold the map; the
       * `combo` column it writes is still honoured by the engine
       * (`stageCoversCombo`), so a row stored with one keeps grossing its one
       * colour.
       *
       * WHICH COLOURWAY THIS TREATMENT IS FOR — and it divides the weight
       * (0504, restored 0529).
       *
       * "It only applies the dyeing process to the exact weight percentage of
       * yarn destined for that specific colour combo" (client, confirmed as
       * arithmetic rather than a label, 2026-09-01). So a stage marked PURPLE
       * grosses up the purple share alone and leaves green at its net weight.
       *
       * SHOWN WHEN `For` IS COLOR WISE. Process Wise treats the whole
       * yarn — the ordinary case since 0520 — so a colourway box beside it would
       * offer a choice the arithmetic would ignore, which is worse than not
       * offering one. A row not yet answering `For` at all shows the dash too:
       * "empty and explain", not a control the planner cannot yet use.
       *
       * BLANK MEANS EVERY COLOURWAY once shown, which is the ordinary case even
       * under Color Wise — a yarn dyed for the whole order still names no combo.
       * The option is labelled rather than left as a bare empty row, because ""
       * and "all" look identical in a `<select>` and only one of them is what
       * this means.
       *
       * A `<Select>` over the yarn's OWN colourways, not a free text box and not
       * the order's whole list: see the `combos` prop.
       */
      header: "Colour",
      width: "8rem",
      cell: (r) => {
        if (!isColorWise(r.loss_for_id, lossFor)) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
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
                  treatment was recorded would otherwise render as blank, which
                  reads as "applies to everything" and silently widens the loss to
                  every colourway. */}
              {(combos.includes(r.combo) || !r.combo ? combos : [...combos, r.combo]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </Select>
        );
      },
    } satisfies ChildGridColumn<YarnStageRow>,
        ]),
    /* NO "Descriptions" COLUMN. Removed from the Fabric BOM on 2026-09-21
       (client: "that description field also no need here, remove it") — the
       same call the fabric route made on 2026-09-04 — and from the IWO the same
       day (client screenshot 2982: "Description field need to remove it from
       here"), so no caller draws it. The `description` column stays in both
       yarn-stage tables and both payloads send `description: null`, so no note
       lingers unseen on a row whose column is gone. */
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
      /* 7rem on Fabric BOM, where the cell may hold the [Color Loss] button;
         the Colour column (8rem) and the old Color-wise Loss column (8rem) both
         left, so the table is narrower than before. */
      width: colourLoss ? "7rem" : "4.5rem",
      cell: (r) =>
        /* A CONVERSION STEP'S LOSS IS THE UNRAVELLING LOSS (2026-09-26) — one
           plain box, never Color-Wise: a colour's own figure is its Details
           row's Loss %. It no longer lives on the loose fabric's route. */
        isConversion(r) ? (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="Unravelling loss %"
            value={r.loss_pct}
            disabled={readOnly}
            onChange={(e) => patch(r.key, { loss_pct: e.target.value })}
          />
        ) : /* For = COLOR WISE → each colour's loss in the list; PROCESS WISE → the
           one box. `isColorWiseFor` is the rule both process grids read. */
        colourLoss && isColorWiseFor(r.loss_for_id, lossFor) ? (
          <ColorLossControl
            driven
            /* THE YARN'S STRIPE COLOURS (client spec 2026-09-26) — a yarn is
               dyed per yarn colour, so its Color-Wise popup lists BLUE, GREEN
               off Yarn Dyed Details, one editable row each (`pickRows`), like
               the Conversion Details. A yarn with no stripes lists its
               colourways, as before. `yarnPurchase` applies each colour's
               loss to that colour's share (`stripeWiseOwnSteps`). */
            colours={lossColours}
            pickRows
            baseLoss={r.loss_pct}
            wise
            losses={r.color_losses ?? {}}
            stageLabel={(r.process_id ? processes.find((p) => p.id === r.process_id)?.name : null) || "this step"}
            readOnly={readOnly}
            unavailable={lossColours.length === 0 ? "No colourway uses this yarn yet." : null}
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
  ];

  const looseRow = looseFor ? rows.find((x) => x.key === looseFor.key) ?? null : null;

  /** A colour's row of the Details grid — its draft, and whether the colour
   *  is still one this yarn feeds (a held one stays, tagged: "Disabled rows"). */
  type DetailGridRow = { key: string; draft: ConversionDetailDraft };
  const blankDetail = (combo: string): ConversionDetailDraft => ({
    combo,
    loss_pct: "",
    source_loose_fabric_id: null,
    gsm: "",
    dia: "",
  });
  const sameCombo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  /** The colours a Details row may name — this yarn's own, else the order's. */
  /* THE STRIPE COLOURS FIRST (2026-09-26); a yarn with none declared on Yarn
     Dyed Details lists its colourways, else the order's, as before. */
  const stripeColours = stripeColoursProp ?? [];
  const detailChoices: readonly { value: string; label: string }[] =
    stripeColours.length > 0
      ? stripeColours
      : (combos.length > 0 ? combos : [...orderCombos]).map((c) => ({ value: c, label: c }));
  const detailColours = detailChoices.map((c) => c.value);
  /** The Color-Wise popup's colours — the yarn's stripe colours, else its colourways (2026-09-26). */
  const lossColours = stripeColours.length > 0 ? stripeColours.map((c) => c.value) : [...combos];

  /**
   * THE ROWS AS SHOWN. What the step holds once anything is typed; before
   * that, one row per colour, pre-filled — legacy opens with its colours
   * listed (screenshot 3096). Rows are the operator's to change since
   * 2026-09-26 ("make it user updating type"): pick a colour, add, remove.
   *
   * A STEP SAVED BEFORE THE PER-COLOUR GRID holds its loose fabric on the step
   * (0633), not on a row — shown in every row that names none, so the fabric
   * never looks missing, and it IS the one the engine uses for that colour.
   */
  const detailRowsOf = (r: YarnStageRow): DetailGridRow[] => {
    const stored = r.conversion_details ?? [];
    const inherit = (d: ConversionDetailDraft): ConversionDetailDraft =>
      d.source_loose_fabric_id || !r.source_loose_fabric_id ? d : { ...d, source_loose_fabric_id: r.source_loose_fabric_id };
    /* A STALE COLOURWAY ROW GIVES WAY TO THE STRIPES (user 2026-09-26: "need to
       show the component colour, not combo name again"). Rows stored while the
       list still offered colourways (WHITE, RED — before Yarn Dyed Details had
       colours) kept those names forever, because stored rows are shown as they
       are. Once this yarn has stripe colours, a row naming something that is
       NOT a stripe and holding nothing typed is dropped; if nothing is left,
       the stripes seed the rows. A colourway row with a loss or fabric typed
       stays — it is still honoured for that colourway (`planConversions`). */
    const isStripe = (c: string) => stripeColours.some((x) => sameCombo(x.value, c));
    const typed = (d: ConversionDetailDraft) =>
      !!(d.source_loose_fabric_id || String(d.loss_pct ?? "").trim() || String(d.gsm ?? "").trim() || String(d.dia ?? "").trim());
    // A row with no colour picked yet is one the operator just added ("+ Add
    // colour") — kept, or the button would appear to do nothing.
    /* A ROW SAVED PER STRIPE ("Color 1", while rows were one per stripe)
       OPENS AS ONE ROW PER COLOUR AT THAT STRIPE, each keeping the row's loose
       fabric, loss, GSM and Dia (user 2026-09-26: "one by one one color").
       Its colours not already listed on their own row are the ones added. */
    const coloursAt = (position: string) =>
      stripeColours.filter((x) => (x.positions ?? []).some((p) => sameCombo(p, position))).map((x) => x.value);
    const expanded: ConversionDetailDraft[] = [];
    for (const d of stored) {
      const at = stripeColours.length > 0 && !isStripe(d.combo) ? coloursAt(d.combo) : [];
      if (at.length === 0) {
        expanded.push(d);
        continue;
      }
      for (const colour of at) {
        if (!stored.some((x) => sameCombo(x.combo, colour)) && !expanded.some((x) => sameCombo(x.combo, colour))) {
          expanded.push({ ...d, combo: colour });
        }
      }
    }
    const live =
      stripeColours.length > 0 ? expanded.filter((d) => !d.combo.trim() || isStripe(d.combo) || typed(d)) : expanded;
    const drafts = live.length > 0 ? live : detailColours.map(blankDetail);
    return drafts.map((d, i) => ({ key: `d:${i}`, draft: inherit(d) }));
  };
  /**
   * A change to the rows. The rows AS SHOWN are written back — each colour's
   * fabric on its own row — and the step's own fabric is cleared, so from the
   * first edit on the grid is the only place a loose fabric lives and what a
   * row shows is exactly what it holds (clearing a row really clears it).
   */
  const writeDetails = (r: YarnStageRow, edit: (rows: ConversionDetailDraft[]) => ConversionDetailDraft[]) =>
    patch(r.key, {
      source_loose_fabric_id: null,
      conversion_details: edit(detailRowsOf(r).map((g) => g.draft)),
    });
  const setDetail = (r: YarnStageRow, at: number, next: Partial<ConversionDetailDraft>) =>
    writeDetails(r, (rows) => rows.map((d, k) => (k === at ? { ...d, ...next } : d)));

  // 13 + 6 + 16 + 7 = 42rem = 672px + 88px ChildGrid chrome = 760px, under
  // the md sheet's ~1,100px content, which clears `5xl` (1,024px) — a table.
  const conversionDetailColumns = (r: YarnStageRow): ChildGridColumn<DetailGridRow>[] => [
    {
      header: "Description",
      // 13rem: a stripe may read "GREEN / WHITE" when colourways differ (2026-09-26).
      width: "13rem",
      cell: (g, i) => {
        /* THE ORDER'S COLOURS, less those another row already names — one row
           per colour. The row's own value always stays listed (a colour since
           dropped from the order included: the "Disabled rows" rule). */
        const taken = detailRowsOf(r)
          .filter((_, k) => k !== i)
          .map((x) => x.draft.combo);
        const options = [...new Set([...detailColours, ...(g.draft.combo ? [g.draft.combo] : [])])].filter(
          (c) => sameCombo(c, g.draft.combo) || !taken.some((t) => sameCombo(t, c)),
        );
        /* The stripe's label — "Color 1 — GREEN / WHITE (62.5%)"; a held value
           no longer listed shows as itself. */
        const labelOf = (c: string) => detailChoices.find((x) => sameCombo(x.value, c))?.label ?? c;
        return (
          <Select
            compact
            className="h-8"
            aria-label="Description (colour)"
            value={g.draft.combo}
            disabled={readOnly}
            onChange={(e) => setDetail(r, i, { combo: e.target.value })}
          >
            <option value="" />
            {options.map((c) => (
              <option key={c} value={c}>
                {labelOf(c)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Loss %",
      width: "6rem",
      align: "right",
      cell: (g, i) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label={`Loss % — ${g.draft.combo}`}
          value={g.draft.loss_pct}
          disabled={readOnly}
          onChange={(e) => setDetail(r, i, { loss_pct: e.target.value })}
        />
      ),
    },
    {
      header: "Loose Fabric",
      width: "16rem",
      cell: (g, i) => (
        <RecordPicker
          label=""
          compact
          items={looseFabrics}
          value={g.draft.source_loose_fabric_id}
          onChange={(id) => {
            setDetail(r, i, { source_loose_fabric_id: id });
            if (id) onLooseFabricPicked?.(id);
          }}
          disabled={readOnly}
          /* Mandatory until SOME colour names one — the step's Save rule
             (`conversionStepProblems`) in the grid. */
          required={!detailRowsOf(r).some((x) => x.draft.source_loose_fabric_id)}
          emptyHint="No greige fabric on the material master — create the loose fabric on Master Data ▸ Materials"
        />
      ),
    },
    /* NO GSM COLUMN (client spec 2026-09-26, "Remove GSM Field from Conversion
       Details Popup": the GSM is the fabric item's own). The stored `gsm` on a
       saved row is left as it is — it was recorded, never multiplied, so
       nothing reads it. */
    {
      header: "Dia",
      width: "7rem",
      cell: (g, i) => (
        <Input
          className="h-8"
          aria-label={`Dia — ${g.draft.combo}`}
          value={g.draft.dia}
          disabled={readOnly}
          onChange={(e) => setDetail(r, i, { dia: e.target.value })}
        />
      ),
    },
  ];

  return (
    <>
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
         declares a width — 7 + 12 + 8 + 7 = 34rem = 544px under `colourLoss`
         (every caller today); the older shape with `Colour` and `Descriptions`
         was 49.5rem = 792px — and `ChildGrid`'s own chrome is 88px
         exactly (`#` is `w-10` plus `px-2`, the remove column `w-8`), so the
         table measures at most ~880px against a 1024px threshold. That margin
         is the point: the widths can be tuned without anyone having to
         re-derive whether the grid still renders as a table.

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
    {/* THE CONVERSION DETAILS POPUP — legacy's [Click] ▸ Details (user
        2026-09-25, screenshots 3093–3096): one row per colour, Loss % · Loose
        Fabric · GSM · Dia (0645). A `[Click]`-opened sub-detail with no Save of
        its own, so AGENTS.md "A sub-detail Sheet's size" — and `md`, not `sm`,
        because it carries a `ChildGrid`, which drops to header-less cards
        inside `sm`. Centred on the pane, grown out of the button,
        `SubSheetFooter`. */}
    {looseRow && (
      <Sheet
        open
        onClose={() => setLooseFor(null)}
        size="md"
        alignToPane
        origin={looseFor?.origin}
        zIndexBase={120}
        title="Conversion — Details"
        footer={<SubSheetFooter onDone={() => setLooseFor(null)} parent="fabric BOM" />}
      >
        {/* NO "Loose fabric for every colour" (user 2026-09-26: "this is extra
            field, remove it") — legacy picks the loose fabric per colour, in the
            grid below, and nowhere else. */}
        {/* NO EXPLANATORY TEXT (user 2026-09-26: "delete the message") — the
            grid is the answer; the rule it follows is in `planConversions`.
            ONE EXCEPTION, asked for later the same day ("add"): a yarn with no
            stripe colours on Yarn Dyed Details lists the colourways instead,
            and without a word that fallback read as the old behaviour. Shown
            only then; a yarn with Color 1 / Color 2 shows nothing. */}
        {/* Only where the caller lists stripes at all (Fabric BOM); IWO passes none. */}
        {stripeColoursProp !== undefined && stripeColours.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {yarnName || "This yarn"} has no Yarn Dyed stripes — listing the colourways.
          </p>
        )}
        {(
          <DetailSection label="Description Details" frameless>
            {/* Opens with a row per colour (`detailRowsOf`), never empty — the
                "open with a row" rule met by the colours themselves. */}
            <ChildGrid<DetailGridRow>
              columns={conversionDetailColumns(looseRow)}
              rows={detailRowsOf(looseRow)}
              tableFrom="5xl"
              flatRows
              hideAdd={readOnly}
              hideRemove={readOnly}
              addLabel="+ Add colour"
              onAdd={() => writeDetails(looseRow, (rows) => [...rows, blankDetail("")])}
              onRemove={(g) => {
                const at = detailRowsOf(looseRow).findIndex((x) => x.key === g.key);
                writeDetails(looseRow, (rows) => rows.filter((_, k) => k !== at));
              }}
              renderMobileRow={(row, i) => (
                <FieldGrid>
                  {conversionDetailColumns(looseRow).map((c, ci) => (
                    <Field key={ci} label={c.header} size="sm">
                      {c.cell(row, i)}
                    </Field>
                  ))}
                </FieldGrid>
              )}
            />
          </DetailSection>
        )}
      </Sheet>
    )}
    </>
  );
}
