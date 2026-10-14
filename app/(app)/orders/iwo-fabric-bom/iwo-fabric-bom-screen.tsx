"use client";

/**
 * Orders ▸ Order Execution ▸ IWO Fabric BOM — the order Fabric BOM screen,
 * DUPLICATED for an Internal Work Order For Yarn or Fabric (client 2026-09-18,
 * screenshots 2937 / 2938 / 2940; 0581).
 *
 * THE ORDER SCREEN IS NOT TOUCHED. `app/(app)/orders/fabric-bom/` is left
 * exactly as it is; this file copies its shape and its parts (the rail, the
 * header row, the four Color/Print panels — `PaletteTable` below is a copy)
 * and drops what only an order has: the garment-order picker, the production
 * strip, colourways, styles, garment components and the size-by-size Manual
 * grams. Req Wt (KGS) is typed instead (SRS §4).
 *
 * BUILT A TAB AT A TIME, and each tab's list is sent only once the tab exists:
 * the save leaves any child list the payload omits untouched (types.ts), so a
 * BOM saved from this step never wipes what a later step stored.
 *
 * Step 1: the list of IWOs, and the "Fabric BOM" section — header plus
 * Fabric Colour / Yarn Colour / Roll form prints / Dia panels.
 *
 * Step 2: Fabric Allocation (which cloth) and Fabric Consumption (stage, and
 * what the stage asks for — colour, print, finish dia — plus form, GSM and
 * the typed Req Wt) — ONE list
 * of fabric lines shown on two sections, as the order screen shows its lines
 * on Fabric Allocation and Manual.
 *
 * Step 3: Yarn Process and Fabric Process — the order screen's two fold
 * lists and its two shared grids (`YarnProcessGrid`, `FabricProcessGrid`),
 * and the ORDER ENGINE for every weight (`yarnPurchase`, `comboUplift`). The
 * only link replaced is where a fabric's gross comes from: the typed Req Wt,
 * through `lib/orders/iwo-fabric-bom/yarn.ts` — the same helpers the save
 * uses, so the preview and the stored figure are one computation.
 *
 * Step 4: For = Yarn (screenshot 2937) — the fabric sections are BYPASSED. The
 * planner picks each yarn on a Yarn Lines grid with the stage it is bought in
 * and a Planned Weight; Yarn Process then lists those picked yarns, and each
 * purchase is the Planned Weight through the yarn's own stages
 * (`iwoYarnModePurchase`, the same helper the save calls).
 *
 * 0592 (client audio 2026-09-19): a Yarn line's Stage decides its shape. GREY
 * is one Planned Weight; DYED takes "Colour by" (Dyed Purchase / Yarn Dyeing)
 * and its SHADES in a [Shades] popup (`yarn-shades-sheet.tsx`), and its
 * Planned Weight becomes Σ shades. Each shade is its own bucket in the engine,
 * so Yarn Process offers the shades in its For column with no new code there.
 *
 * Phase 2 (same audio): a fabric line's Stage decides its shape too. GREIGE
 * has no colour (the colourways consolidate into one line) and its route stops
 * at Greige; a coloured stage owes its Colour; one Stage per fabric; one line
 * per (fabric, colour, dia). Finish Dia picks from the Dia panel.
 *
 * 0599 (client ticket 2026-09-20): a dyed or printed line owes its Finish Dia;
 * a PRINT-stage line owes its Print (from the Roll form prints panel), so one
 * line is one (fabric, colour, dia, print). Fabric Allocation's [Detail] is
 * the order screen's, copied as it is (user 2026-09-20: "copy from fabric bom
 * fabric allocation details"): it opens Yarn Dyed Details for the line's
 * fabric, whose per-colour dyeing losses now gross the purchase
 * (`iwoYarnShades`, the same call the save makes).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ClipboardList, Layers, ListChecks, Scale, Shirt, Spool, Users, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowHoverRemove } from "@/components/ui/row-hover-remove";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, FieldRow, FIELD_WIDTH_CSS, RequiredScope } from "@/components/ui/field";
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { createdMeta, hasCreatedInfo, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import {
  createdByFacet,
  createdDateFacet,
  flagFacet,
  urgencyFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { raiseSampleGroupIw } from "@/lib/sales/sample-grouping/actions";
import type { SwoAwaitingIw } from "@/lib/sales/sample-grouping/service";
import { sectionValidity } from "@/lib/screens/validity";
import { IWO_FOR_LABELS, IWO_STATUSES, IWO_STATUS_LABELS } from "@/lib/orders/internal-work-orders/types";
import {
  KNIT_TYPE_OPTIONS,
  fabricPlanApprovalLabel,
  type FabricPlanApprovalStatus,
  type IwoFabricBom,
  type PaletteSection,
} from "@/lib/orders/iwo-fabric-bom/types";
import { deleteIwoFabricBom, saveIwoFabricBom } from "@/lib/orders/iwo-fabric-bom/actions";
import type { IwoFabricBomFormData, IwoFabricBomTask } from "@/lib/orders/iwo-fabric-bom/service";
import {
  iwoFabricLineProblems,
  iwoFabricStages,
  iwoGreigeRouteProblems,
  keptIwoFabricLines,
  type IwoFabricLineFacts,
} from "@/lib/orders/iwo-fabric-bom/lines";
import { FABRIC_FORM_OPTIONS } from "@/lib/orders/fabric-bom/component-map";
import { isPieceDyed, isYarnDyed } from "@/lib/orders/fabric-bom/fabric-line-rules";
import { ProcessFoldList, type FoldListColumn } from "@/components/orders/process-fold-list";
import { FabricProcessGrid } from "@/components/orders/fabric-process-grid";
import { YarnProcessGrid } from "@/components/orders/yarn-process-grid";
// The order screen's composition loader — keyed by FABRIC only (material_mixings),
// so it serves an IWO unchanged. Reused, not copied.
import { loadBomYarnComposition } from "@/lib/orders/fabric-bom/actions";
import {
  comboKey,
  comboUplift,
  conversionDetailsFromDraft,
  conversionDetailsToDraft,
  deriveYarnRows,
  isRefusal,
  yarnRowAnswered,
  type FabricComposition,
  type YarnRow,
  type YarnStageRow,
} from "@/lib/orders/fabric-bom/yarn-process";
import {
  claimedColoursOf,
  conversionDetailsOf,
  conversionStepLossesOf,
  conversionLinksOf,
  conversionStepProblems,
  linkedLooseFabricIds,
  planConversions,
  withoutConversionSteps,
  yarnPurchaseWithConversion,
} from "@/lib/orders/fabric-bom/loose-conversion";
import { blankFabricProcess, routeStepCount, type FabricProcessRow } from "@/lib/orders/fabric-bom/processes";
import { colorLossesFromDraft, colorLossesToDraft } from "@/lib/orders/fabric-bom/color-loss";
import { diaKey, diaKnitProblem, knitLabel } from "@/lib/orders/fabric-bom/dia-knit";
import { colouredStageIds, stageRank, stageRouteProblems } from "@/lib/orders/fabric-bom/stage-routes";
import { fabricFormLabel } from "@/lib/orders/fabric-bom/component-map";
import {
  IWO_COLOUR_BY_OPTIONS,
  iwoFabricGross,
  iwoRoutesByFabric,
  iwoYarnModePurchase,
  iwoYarnShades,
  type IwoColourBy,
} from "@/lib/orders/iwo-fabric-bom/yarn";
import {
  iwoShadeTotal,
  iwoYarnLineProblems,
  keptIwoYarnLines,
  keptIwoYarnShades,
} from "@/lib/orders/iwo-fabric-bom/lines";
import type { SheetOrigin } from "@/components/ui/sheet";
import { YarnShadesSheet, type ShadeRow } from "./yarn-shades-sheet";
import { SmpColourSheet } from "./smp-colour-sheet";
import { PlanRevisionSheet } from "@/components/sales/plan-revision-sheet";
import { PlanLockFence } from "@/components/sales/plan-lock-fence";
import { planReportHref } from "@/lib/sales/plan-reports/types";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import type { ApprovalRun, CanActVerdict } from "@/lib/approvals/types";
import {
  getFabricPlanApproval,
  submitSampleFabricPlan,
  type FabricPlanRevision,
} from "@/lib/orders/iwo-fabric-bom/approval-actions";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import {
  addPlanDia,
  addPlanRow,
  addSmpDia,
  addSmpGroup,
  grpOf,
  patchSmpDia,
  patchSmpGroup,
  removeSmpDia,
  removeSmpGroup,
  smpGroups,
  smpReqKgs,
  canAddDia,
  derivePlanRows,
  expandPlanCells,
  familyDias,
  foldPlanCells,
  isPlaceholderFacts,
  NO_CELLS,
  planCellsForStage,
  plannedColours,
  planReqKgs,
  removePlanRow,
  setPlanCell,
  stalePlanRows,
  type PlanAxes,
  type PlanCells,
  type PlanDisplayRow,
} from "@/lib/orders/iwo-fabric-bom/plan";
import { YarnDyedSheet, type YdCombinationRow } from "@/components/orders/yarn-dyed-panels";
import type { YdRepeatRow } from "@/lib/orders/fabric-bom/yarn-dyed";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// React keys from a module counter, as the order screen does — not a ref, which
// the React Compiler lint objects to reading during render.
let keySeq = 0;
const newKey = () => `k${keySeq++}`;

type PaletteRow = { key: string; value: string };
type DiaRow = { key: string; knit_type: string; dia: string };
type Palette = Record<PaletteSection, PaletteRow[]>;

// EVERY SEED IS BLANK — the save drops a blank row by testing what is typed.
const blankPaletteRow = (): PaletteRow => ({ key: newKey(), value: "" });
const blankDia = (): DiaRow => ({ key: newKey(), knit_type: "", dia: "" });
const blankPalette = (): Palette => ({
  fabric: [blankPaletteRow()],
  yarn: [blankPaletteRow()],
  print: [blankPaletteRow()],
});

type Form = { iwo_id: string | null; bom_date: string };

/**
 * One fabric line, as the two grids edit it. Numbers are held as the TEXT
 * typed, so a half-typed "12." is not rewritten under the caret; `expandLine`
 * turns them into numbers (NaN for a non-number, refused by name).
 */
type LineRow = {
  key: string;
  structure_id: string | null;
  item_id: string | null;
  fabric_form: string;
  mixing_uom_id: string | null;
  no_of_colors: string;
  gsm: string;
  stage_id: string | null;
  /**
   * ONE ROW PER FABRIC ON SCREEN, ONE STORED LINE PER (FABRIC, COLOUR, DIA,
   * PRINT). The consumption card's rows are DERIVED from the BOM's panels
   * (user 2026-09-22, screenshot 3000 — see plan.ts): the operator types only
   * a weight per derived row, and `cells` holds the weighted ones, keyed by
   * their axes. Stage, Form and GSM are the fabric's, said once in the card
   * header. `expandPlanCells` gives the payload, the rules and the yarn
   * engine 0592's grain unchanged; `foldPlanCells` folds it back on load.
   */
  cells: PlanCells;
};

const blankLine = (): LineRow => ({
  key: newKey(),
  structure_id: null,
  item_id: null,
  fabric_form: "",
  mixing_uom_id: null,
  no_of_colors: "",
  gsm: "",
  stage_id: null,
  cells: NO_CELLS,
});


/** Details ▸ Yarn Dyed Details rows (0599), addressed by the FABRIC — the
 *  panels' own row types plus the `item_id` they belong to. */
type YdRepeat = YdRepeatRow & { item_id: string };
type YdCombination = YdCombinationRow & { item_id: string };

/** A For = Yarn line (step 4): the yarn, its Stage, and either the Planned
 *  Weight typed (GREY) or Colour by + its shades (DYED, 0592). */
type YarnLineRow = {
  key: string;
  item_id: string | null;
  buy_stage_id: string | null;
  planned_kgs: string;
  colour_by: IwoColourBy | "";
  shades: ShadeRow[];
};
// EVERY SEED IS BLANK — the save drops an untouched yarn line (and an untouched
// shade) by testing what is typed. One blank shade stands ready, so the Shades
// popup never opens on a bare "+ Add" (AGENTS.md, default rows).
const blankShade = (): ShadeRow => ({ key: newKey(), color_name: "", planned_kgs: "" });
const blankYarnLine = (): YarnLineRow => ({
  key: newKey(),
  item_id: null,
  buy_stage_id: null,
  planned_kgs: "",
  colour_by: "",
  shades: [blankShade()],
});

/** "" → null; anything else → a number, or NaN for a non-number. */
const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const kg = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** ONE STORED LINE PER WEIGHTED CELL — the boundary between the screen's
 *  one-row-per-fabric and 0592's grain (`expandPlanCells`, plan.ts). Every
 *  rule, the engine and the payload read THIS, so a fabric weighed in three
 *  colours is three lines to all of them — and a fabric with NO weight is one
 *  placeholder line the rules refuse by name, never nothing. */
const expandLine = (l: LineRow): IwoFabricLineFacts[] =>
  expandPlanCells(l.cells).map((f) => ({
    structure_id: l.structure_id,
    item_id: l.item_id,
    fabric_form: l.fabric_form || null,
    mixing_uom_id: l.mixing_uom_id,
    no_of_colors: num(l.no_of_colors),
    gsm: num(l.gsm),
    stage_id: l.stage_id,
    // The SMP is each consumption ROW's (client 2026-10-12), carried in `f`.
    ...f,
  }));
/** The expanded lines with the SCREEN row each came from, so a rule's "Fabric
 *  line N" names the row the operator sees, not the stored line's ordinal. */
const expandLines = (lines: readonly LineRow[]): { facts: IwoFabricLineFacts; row: number }[] =>
  lines.flatMap((l, i) => expandLine(l).map((facts) => ({ facts, row: i + 1 })));

/** "No fabrics" is DERIVED, never stored — the order screen's `EMPTY_COMPOSITION`,
 *  a module constant so its identity is stable across renders. */
const EMPTY_COMPOSITION: {
  compositions: FabricComposition[];
  yarns: { id: string; name: string; inactive: boolean }[];
} = { compositions: [], yarns: [] };

/** One distinct value, else "(mixed)" — how the order screen's fold rows roll up
 *  a fact several lines of one fabric state. */
const rollUp = (values: readonly string[]) => {
  const distinct = [...new Set(values.filter(Boolean))];
  return distinct.length <= 1 ? (distinct[0] ?? "") : "(mixed)";
};

/** Upper-cased and trimmed for COMPARISON only — the order palette's rule. */
const normName = (v: string) => v.trim().toUpperCase();

/**
 * A HAND-ROLLED TABLE THAT IS STILL A GRID TO THE KEYBOARD — copied from the
 * order Fabric BOM (`fabric-bom-screen.tsx`, `PaletteTable`), where the four
 * Color/Print panels left `ChildGrid` because its table mode only switches in
 * above ~512px and four panels do not fit that side by side. It carries the
 * markers the keyboard contract steers by, so none of it is per-screen code:
 *
 *   `data-grid-body` + `gridKeyNav` — the row axis, and Ctrl+Del
 *   `data-grid-row`                  — what ↑/↓ step between
 *   `data-row-remove` + aria-label   — Ctrl+Del drives this by `.click()`
 *   `data-row-add`                   — what Enter off the last field lands on
 */
function PaletteTable<T extends { key: string }>({
  label,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel,
  width,
}: {
  label: string;
  columns: ChildGridColumn<T>[];
  rows: readonly T[];
  onAdd: () => void;
  onRemove: (row: T) => void;
  addLabel: string;
  /** A STATIC literal per call site — Tailwind scans source text. */
  width: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1", width)}>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {/* A SPREADSHEET GRID (user 2026-10-03, `erp-sheet-grid`) — the same
          change as the order Fabric BOM's `PaletteTable`, kept in step: the
          marker draws the gridlines, header band and borderless cells, so the
          cells carry no padding or border classes and the ✕ column is
          headed "Actions" (56px). */}
      <div data-grid-style="sheet">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-9" />
            {columns.map((c) => (
              <col key={c.header} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="text-center text-[12.5px] font-semibold text-foreground">#</th>
              {columns.map((c) => (
                <th key={c.header} className="text-left text-[12.5px] font-semibold text-foreground">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
            {rows.map((row, i) => (
              <tr key={row.key} data-grid-row>
                <td className="text-center text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                {/* NO ACTIONS COLUMN (user 2026-10-12, `erp-row-hover-remove`): the
                    row's ✕ rides in its LAST cell and shows only on row hover. */}
                {columns.map((c, ci) =>
                  ci === columns.length - 1 ? (
                    <td key={c.header}>
                      <div className="flex items-center gap-1 pr-1">
                        <div className="min-w-0 flex-1">{c.cell(row, ci)}</div>
                        <RowHoverRemove label={`Remove ${label.toLowerCase()} row ${i + 1}`} onClick={() => onRemove(row)} />
                      </div>
                    </td>
                  ) : (
                    <td key={c.header}>{c.cell(row, ci)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" data-row-add className="mt-2" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
}

/**
 * THE PENDING / UPDATED / DRAFT BOX (user, 2026-09-23: "in budget we have
 * pending, update, draft button need to implement same order module fully").
 * The three words are read over this list's own "Not started / Draft / Saved"
 * — the Fabric BOM column's words — as the question the box asks on the order
 * BOM queues and Budgeting: is the work still to do, or done.
 *   Pending = Not started — a work order with no Fabric BOM yet: the work
 *                           waiting on whoever opens this list
 *   Updated = Saved       — the Fabric BOM is written and final
 *   Draft   = Draft       — saved as draft, not finished
 * Every row is one of the three. The drawer's Fabric BOM facet asks the same
 * question, so the box stands down while it is set (the Budget Approval rule,
 * `useQuickStatus`'s `standDown`).
 */
const bomWord = (t: IwoFabricBomTask): QuickWord => (!t.bom ? "pending" : t.bom.is_draft ? "draft" : "updated");

/**
 * THE LIST'S FILTERS — the grouped drawer (user, 2026-09-23: "implement the
 * Material BOM filter in every Orders child"). The list had no filter bar at
 * all. Every facet is read off the `IwoFabricBomTask` the table already shows,
 * so none costs a query.
 */
const IWO_FABRIC_BOM_FACETS: FacetGroup<IwoFabricBomTask>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "bom",
        label: "Fabric Plan",
        all: "All",
        wide: true,
        counted: true,
        options: [
          { value: "none", label: "Not started" },
          { value: "draft", label: "Draft" },
          { value: "saved", label: "Saved" },
        ],
        match: (t, v) => (!t.bom ? "none" : t.bom.is_draft ? "draft" : "saved") === v,
      },
      { key: "iwoDate", label: "Date", all: "Any date", date: (t) => t.iwo_date },
      { key: "deliDate", label: "Deli Dt", all: "Any date", date: (t) => t.deli_date },
    ],
  },
  {
    title: "Work order",
    icon: <ClipboardList />,
    facets: [
      {
        key: "for",
        label: "For",
        all: "Yarn & Fabric",
        wide: true,
        counted: true,
        options: [
          { value: "yarn", label: IWO_FOR_LABELS.yarn },
          { value: "fabric", label: IWO_FOR_LABELS.fabric },
        ],
        match: (t, v) => t.iwo_for === v,
      },
      {
        key: "iwoStatus",
        label: "Work Order Status",
        all: "All",
        counted: true,
        options: IWO_STATUSES.map((s) => ({ value: s, label: IWO_STATUS_LABELS[s] })),
        match: (t, v) => t.status === v,
      },
      flagFacet<IwoFabricBomTask>(
        "lines",
        "Fabric Lines",
        (t) => (t.bom?.iwo_fabric_bom_lines.length ?? 0) > 0,
        "Has lines",
        "No lines yet",
      ),
    ],
  },
  {
    title: "Delivery & created",
    icon: <Users />,
    facets: [
      { ...urgencyFacet<IwoFabricBomTask>((t) => t.deli_date), wide: true },
      createdDateFacet(),
      createdByFacet(),
    ],
  },
];

export function IwoFabricBomScreen({
  tasks,
  data,
  perms,
  sample = false,
  swos,
}: {
  tasks: IwoFabricBomTask[];
  data: IwoFabricBomFormData;
  perms: Perms;
  /** Sample ▸ Fabric Plan (0704): the same screen over the SAMPLE work orders
   *  only. Closing stays on this list, and a new work order is raised in place. */
  sample?: boolean;
  /** Sample ▸ Fabric Plan (0707): the approved SWOs with no work order yet —
   *  what the in-place "new work order" box raises against. */
  swos?: SwoAwaitingIw[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  /** Raising an SWO's work order from the SWO No picker (sample plan). */
  const [swoRaising, startSwo] = useTransition();


  /** Leaving the editor goes back to the WORK ORDER (2026-09-20): this

   *  screen has no entry of its own on Order Execution any more — it is

   *  opened from the work order, so that is where closing it returns. */

  function leaveEditor() {
    setNeedsAsked(false);
    setMode("list");

    // Sample ▸ Fabric Plan is its own sidebar row, so closing returns to its list.
    if (!sample) router.push("/orders/internal-work-orders");

  }
  const [editId, setEditId] = useState<string | null>(null);
  /** SAMPLE PLAN APPROVAL (0718): the open plan's run, whether this user may
   *  decide it, and its revision log — keyed `forId` so a late answer never
   *  paints the previous plan's approval under this one. */
  const [approval, setApproval] = useState<{
    forId: string;
    run: ApprovalRun | null;
    verdict: CanActVerdict | null;
    revisions: FabricPlanRevision[];
    /** This user sent the live run — the editor then offers no decision. */
    mine: boolean;
  } | null>(null);
  const [revisionOrigin, setRevisionOrigin] = useState<SheetOrigin | null | undefined>(undefined);
  const [form, setForm] = useState<Form>({ iwo_id: null, bom_date: today() });
  const [palette, setPalette] = useState<Palette>(blankPalette);
  const [dias, setDias] = useState<DiaRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  /** Fabric Process (step 3): every fabric's route in one list, keyed by
   *  `item_id` — the order screen's `procs`. */
  const [procs, setProcs] = useState<FabricProcessRow[]>([]);
  /** Yarn Process (step 3): each yarn's OWN stages, keyed by yarn id so
   *  re-deriving the yarn list can never move a stage to another yarn. */
  const [yarnAnswers, setYarnAnswers] = useState<Record<string, { stages: YarnStageRow[] }>>({});
  /** `undefined` = not touched yet, so the FIRST row opens by itself (the
   *  operator reported the process tabs as "blank, no fields" when every row
   *  started shut); `null` = closed by the operator; a key = that row open. */
  const [openYarnId, setOpenYarnId] = useState<string | null | undefined>(undefined);
  /** For = Yarn (step 4): the picked yarns and their Planned Weight. */
  const [yarnLines, setYarnLines] = useState<YarnLineRow[]>([]);
  /** The yarn line whose [Shades] popup is open, and the button it grew from. */
  const [shadesFor, setShadesFor] = useState<string | null>(null);
  const [shadesOrigin, setShadesOrigin] = useState<SheetOrigin | null>(null);
  const [openFabricId, setOpenFabricId] = useState<string | null | undefined>(undefined);
  /** Fabric Allocation ▸ [Detail] (0599): the FABRIC whose Yarn Dyed Details
   *  is open (or null), and the button it grew from. */
  const [ydFor, setYdFor] = useState<string | null>(null);
  const [ydOrigin, setYdOrigin] = useState<SheetOrigin | null>(null);
  /** Sample plan, Fabric Consumption sample by sample (2026-10-12): the SMP
   *  open on the right, each sample's fabric rows not yet given a fabric, and
   *  the fabric row whose Dia & weight popup is open (+ the button it grew from). */
  const [smpOpen, setSmpOpen] = useState<string | null>(null);
  const [smpPending, setSmpPending] = useState<Record<string, string[]>>({});
  /** Which sample's fabric has its Colours & Dias popup open, and the button
   *  it grew out of. */
  const [colourFor, setColourFor] = useState<{ lineKey: string; smp: string } | null>(null);
  const [colourOrigin, setColourOrigin] = useState<SheetOrigin | null>(null);
  /** Sample plan: has the operator pressed Save with something still owed?
   *  Until then the "Still needed before Save" list stays hidden (user
   *  2026-10-12: "why is this showing always — just trigger it when needed").
   *  The red rings on the owed boxes still show from the start. */
  const [needsAsked, setNeedsAsked] = useState(false);
  /** Every fabric's Yarn Dyed rows in two lists, keyed by `item_id` — the
   *  order screen's shape, so the payload sends them all with no popup open. */
  const [ydRepeats, setYdRepeats] = useState<YdRepeat[]>([]);
  const [ydCombinations, setYdCombinations] = useState<YdCombination[]>([]);
  /** The compositions behind the lines' fabrics, keyed with the question it
   *  answers so a late reply is never shown against changed fabrics. */
  const [compState, setCompState] = useState<{
    forFabrics: string;
    compositions: FabricComposition[];
    yarns: { id: string; name: string; inactive: boolean }[];
  } | null>(null);

  /** Real edits only — see the order screen's note; an overlay's own guard is
   *  not read by `confirmDiscard()`, so this is what protects the typing. */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // THE LIST'S FILTERS — hooks here, near the top: this component has no early
  // return today, and a hook down by the list would be the first to break if
  // one is added (AGENTS.md, hooks above every early return).
  const [listQuery, setListQuery] = useState("");
  const listFacets = useFacetFilter(tasks, IWO_FABRIC_BOM_FACETS);
  const facetMatches = listFacets.matches;
  /* THE SET THE FIGURES ARE COUNTED OVER — the list with the search and the
     Filters panel applied and this box's own word left off, so a figure is
     exactly what clicking that word would show. */
  const base = useMemo(() => {
    const needle = listQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!facetMatches(t)) return false;
      if (!needle) return true;
      return [t.code, t.reference_no, t.swo?.code, t.remarks].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [tasks, listQuery, facetMatches]);
  const quick = useQuickStatus(bomWord, {
    standDown: !!listFacets.values.bom,
    onPick: () => listFacets.set("bom", ""),
    countRows: base,
  });
  const qm = quick.matches;
  const listed = useMemo(() => base.filter(qm), [base, qm]);
  const picked = form.iwo_id ? (taskById.get(form.iwo_id) ?? null) : null;
  /** THE SWO THIS WORK ORDER WAS RAISED FOR (0707; client spec "Grouping &
   *  SWO", 2026-10-12) — null on a production IWO. Its number stands where
   *  the RE No stands, and every Fabric Consumption row then names one of its
   *  samples (SMP No), so the release on receipt is per sample. */
  const swo = picked?.swo ?? null;
  const swoStyleIds = swo ? new Set(swo.samples.map((x) => x.style_id)) : null;
  const swoSampleLabel = (id: string) => {
    const x = swo?.samples.find((y) => y.style_id === id);
    return x ? [x.smp_no, x.style_name].filter(Boolean).join(" · ") || "Sample" : "";
  };

  /** The IWO picker offers work orders WITHOUT a BOM — one BOM per IWO (0581);
   *  the one this BOM already names always survives. */
  const iwoItems: PickerItem[] = tasks
    .filter((t) => !t.bom || t.id === form.iwo_id)
    .map((t) => ({ id: t.id, code: t.code, name: t.code ?? "(unnumbered)", inactive: false }));
  /** SAMPLE: the plan picks its SWO (user 2026-10-12). Two kinds of row, one
   *  list — an SWO whose work order exists and has no plan yet (its id IS the
   *  work order's), and an approved SWO with no work order (`swo:` + group
   *  id), which `pickSwo` raises first. */
  const swoItems: PickerItem[] = [
    ...iwoItems.map((it) => {
      const t = taskById.get(it.id);
      return { ...it, code: null, name: t?.swo?.code ?? it.name };
    }),
    ...(swos ?? []).map((g) => ({ id: `swo:${g.id}`, code: null, name: g.code, inactive: false })),
  ];
  const pickSwo = (id: string | null) => {
    if (!id || !id.startsWith("swo:")) {
      set({ iwo_id: id });
      return;
    }
    startSwo(async () => {
      const res = await raiseSampleGroupIw(id.slice(4), { iwo_for: "fabric" });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      set({ iwo_id: res.iwoId });
      router.refresh();
    });
  };

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutPalette = (section: PaletteSection, fn: (xs: PaletteRow[]) => PaletteRow[]) => {
    setPalette((p) => ({ ...p, [section]: fn(p[section]) }));
    setDirty(true);
  };
  const mutDias = (fn: (xs: DiaRow[]) => DiaRow[]) => {
    setDias(fn);
    setDirty(true);
  };
  const patchLine = (key: string, patch: Partial<LineRow>) => {
    setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  const fabricById = useMemo(() => new Map(data.fabrics.map((f) => [f.id, f])), [data.fabrics]);
  const fabricTypeOf = (itemId: string | null) => (itemId ? (fabricById.get(itemId)?.fabric_type ?? null) : null);

  // ---- open ------------------------------------------------------------------

  /** Seeds every grid BEFORE `setDirty(false)` — never through `onAdd`, which
   *  would open every record reading "Unsaved changes". */
  function openNew(iwoId: string | null) {
    setEditId(null);
    setForm({ iwo_id: iwoId, bom_date: today() });
    setPalette(blankPalette());
    setDias([blankDia()]);
    setLines([blankLine()]);
    setProcs([]);
    setYarnAnswers({});
    setYarnLines([blankYarnLine()]);
    setYdRepeats([]);
    setYdCombinations([]);
    setYdFor(null);
    setOpenYarnId(undefined);
    setOpenFabricId(undefined);
    setDirty(false);
    setMode("edit");
  }

  function loadApproval(bomId: string) {
    getFabricPlanApproval(bomId).then(
      (p) => setApproval({ forId: bomId, run: p.run, verdict: p.verdict, revisions: p.revisions, mine: p.mine }),
      () => setApproval(null),
    );
  }

  function openTask(t: IwoFabricBomTask) {
    setNeedsAsked(false);
    const b = t.bom;
    if (!b) return openNew(t.id);
    setEditId(b.id);
    setApproval(null);
    if (sample) loadApproval(b.id);
    setForm({ iwo_id: t.id, bom_date: b.bom_date });
    const of = (section: PaletteSection) => {
      const rows = b.iwo_fabric_bom_palette
        .filter((r) => r.section === section)
        .map((r) => ({ key: newKey(), value: r.name }));
      return rows.length ? rows : [blankPaletteRow()];
    };
    setPalette({ fabric: of("fabric"), yarn: of("yarn"), print: of("print") });
    const d = b.iwo_fabric_bom_dias.map((r) => ({
      key: newKey(),
      knit_type: r.knit_type ?? "",
      dia: r.dia ?? "",
    }));
    setDias(d.length ? d : [blankDia()]);
    // ONE ROW PER FABRIC: its stored lines (one per colour / dia / print)
    // fold into the row's `cells` (`foldPlanCells`, plan.ts). Grouped by the
    // FABRIC alone — Stage, Form and GSM are the fabric's, said once on its
    // card, so the first line's answer stands for all and the next Save
    // writes it on every line (a BOM saved before 2026-09-22 could hold two
    // GSMs on one fabric; it cannot after).
    const ls: LineRow[] = [];
    const groups = new Map<string, IwoFabricBom["iwo_fabric_bom_lines"]>();
    for (const r of b.iwo_fabric_bom_lines ?? []) {
      // ONE ROW PER FABRIC on an SWO's plan too (client 2026-10-12): the SMP
      // is each consumption row's, so two samples on one cloth are two rows
      // of ONE card, never two allocation rows.
      const held = groups.get(r.item_id);
      if (held) held.push(r);
      else groups.set(r.item_id, [r]);
    }
    for (const rs of groups.values()) {
      const r = rs[0];
      ls.push({
        key: newKey(),
        structure_id: r.structure_id,
        item_id: r.item_id,
        fabric_form: r.fabric_form ?? "",
        mixing_uom_id: r.mixing_uom_id,
        no_of_colors: str(r.no_of_colors),
        gsm: str(r.gsm),
        stage_id: r.stage_id,
        cells: foldPlanCells(rs),
      });
    }
    setLines(ls.length ? ls : [blankLine()]);
    // Every value re-sent as stored — the save is delete-then-insert, so a
    // column left off these rows would be reset to its default (the panels'
    // own `dyeing_loss_pct` note).
    setYdRepeats(
      (b.iwo_fabric_bom_yd_repeats ?? []).map((r) => ({
        key: newKey(),
        item_id: r.item_id,
        sno: r.sno,
        yarn_item_id: r.yarn_item_id,
        dye_type: r.dye_type,
        color_name: r.color_name ?? "",
        uom_id: r.uom_id,
        value: r.value,
        twisted_yarn: r.twisted_yarn ?? "",
      })),
    );
    setYdCombinations(
      (b.iwo_fabric_bom_yd_combinations ?? []).map((c) => ({
        key: newKey(),
        item_id: c.item_id,
        combo: c.combo ?? "",
        yd_combo_name: c.yd_combo_name ?? "",
        colors: c.iwo_fabric_bom_yd_combination_colors.map((x) => ({
          key: newKey(),
          yarn_color: x.yarn_color ?? "",
          dyeing_loss_pct: x.dyeing_loss_pct,
        })),
      })),
    );
    setYdFor(null);
    setProcs(
      (b.iwo_fabric_bom_processes ?? []).map((r) => ({
        key: newKey(),
        item_id: r.item_id,
        combo: null,
        component_id: null,
        stage_id: r.stage_id,
        process_id: r.process_id,
        loss_for_id: r.loss_for_id,
        loss_pct: str(r.loss_pct),
        type_id: r.type_id,
        /* 0613 — the stored map, as the form holds it (text). */
        color_wise_loss: !!r.color_wise_loss,
        color_losses: colorLossesToDraft(r.color_losses),
      })),
    );
    setYarnAnswers(
      Object.fromEntries(
        (b.iwo_fabric_bom_yarns ?? []).map((y) => [
          y.item_id,
          {
            stages: y.iwo_fabric_bom_yarn_stages.map((st) => ({
              key: newKey(),
              stage_id: st.stage_id,
              process_id: st.process_id,
              loss_for_id: st.loss_for_id,
              combo: st.combo ?? "",
              description: st.description ?? "",
              loss_pct: str(st.loss_pct),
              color_wise_loss: !!st.color_wise_loss,
              color_losses: colorLossesToDraft(st.color_losses),
              /* 0636 — LOOSE FABRIC CONVERSION's source. */
              source_loose_fabric_id: st.source_loose_fabric_id ?? null,
              /* 0645 — its per-colour Details. */
              conversion_details: conversionDetailsToDraft(st.conversion_details),
            })),
          },
        ]),
      ),
    );
    // On a For = Yarn BOM the stored yarns ARE the typed lines; on a For =
    // Fabric one they are derived, and the Yarn Lines grid is not shown.
    const yl =
      t.iwo_for === "yarn"
        ? (b.iwo_fabric_bom_yarns ?? []).map((y) => {
            const shades = (y.iwo_fabric_bom_yarn_shades ?? []).map((sh) => ({
              key: newKey(),
              color_name: sh.color_name,
              planned_kgs: str(sh.planned_kgs),
            }));
            return {
              key: newKey(),
              item_id: y.item_id,
              buy_stage_id: y.buy_stage_id,
              planned_kgs: str(y.planned_kgs),
              colour_by: y.colour_by ?? ("" as const),
              shades: shades.length ? shades : [blankShade()],
            };
          })
        : [];
    setYarnLines(yl.length ? yl : [blankYarnLine()]);
    setOpenYarnId(undefined);
    setOpenFabricId(undefined);
    setDirty(false);
    setMode("edit");
  }

  /** `?open=<iwoId>` — the IWO screen's "Open Fabric BOM" lands here, IN that work
   *  order's BOM (a new one when it has none). Declared after `openTask`, above
   *  any branch; an id this unit cannot see opens nothing. */
  useOpenIntent((id) => {
    // A work order id (Grouping's links) or a PLAN id (the approvals inbox,
    // WORKFLOWS.sample_fabric_plan — its subject is the plan).
    const t = taskById.get(id) ?? tasks.find((x) => x.bom?.id === id);
    if (t && (t.bom ? true : perms.canCreate)) openTask(t);
  });

  // ---- Yarn Process + Fabric Process (step 3) -------------------------------

  /** The fabrics the lines name, as one key — what the composition load answers. */
  /* LOOSE FABRIC CONVERSION (0636) — a CONVERSION step is the master's
     `is_unravelling` flag. The loose fabrics the ANSWERS name join the
     composition load (the order screen's `answerLooseKey`, for its reason:
     a loose fabric is on no line, and its greige yarn needs a row). */
  const isUnravelling = (processId: string) =>
    !!data.yarnProcesses.find((p) => p.id === processId)?.is_unravelling;
  const answerLooseIds = linkedLooseFabricIds(
    conversionLinksOf(
      Object.entries(yarnAnswers).map(([item_id, a]) => ({ item_id, stages: a.stages })),
      isUnravelling,
    ),
    conversionDetailsOf(
      Object.entries(yarnAnswers).map(([item_id, a]) => ({ item_id, stages: a.stages })),
      isUnravelling,
    ),
  );
  const fabricIdKey = [...new Set([...lines.map((l) => l.item_id).filter(Boolean), ...answerLooseIds])].sort().join(",");

  useEffect(() => {
    // No round trip for no fabrics — that case is DERIVED below (`comp`), never
    // stored from the effect body (react-hooks/set-state-in-effect).
    if (!fabricIdKey) return;
    let cancelled = false;
    loadBomYarnComposition(fabricIdKey.split(",")).then((res) => {
      if (cancelled || !res.ok) return;
      setCompState({ forFabrics: fabricIdKey, ...res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [fabricIdKey]);

  const comp = !fabricIdKey
    ? EMPTY_COMPOSITION
    : compState && compState.forFabrics === fabricIdKey
      ? compState
      : null;

  /** FOR = YARN (step 4) — read off the IWO, never a toggle on this screen. */
  const yarnMode = picked?.iwo_for === "yarn";
  const yarnById = new Map(data.yarns.map((y) => [y.id, y]));

  /** THE YARN ROWS. On a For = Fabric BOM, derived from what the cloths are
   *  made of (`deriveYarnRows`, the order screen's own call). On a For = Yarn
   *  BOM, the yarns the planner PICKED on Yarn Lines, once each. */
  const yarnRows: YarnRow[] = yarnMode
    ? [...new Set(yarnLines.map((l) => l.item_id).filter((x): x is string => !!x))].map((id) => ({
        key: id,
        item_id: id,
        name: yarnById.get(id)?.name ?? "",
        inactive: yarnById.get(id)?.inactive ?? false,
        fabrics: [],
        stages: yarnAnswers[id]?.stages ?? [],
      }))
    : comp
      ? deriveYarnRows(
          comp.compositions,
          new Map(comp.yarns.map((y) => [y.id, { name: y.name, inactive: y.inactive }])),
          new Map(Object.entries(yarnAnswers)),
        )
      : [];

  const compositionById = new Map((comp?.compositions ?? []).map((c) => [c.fabric_id, c]));

  /** The gross KGS per fabric — the typed Req Wt, through the SAME helper the
   *  save calls (`iwoFabricGross`). */
  const fabricGross = iwoFabricGross(
    // Each colour its own bucket (0599) — what the Yarn Dyed shades key on.
    // One entry per DIA (`expandLine`): a fabric's dias of one colour sum
    // into that colour's bucket, as they always did as separate lines.
    expandLines(lines).map(({ facts }) => ({ item_id: facts.item_id, req_kgs: facts.req_kgs, color_name: facts.color_name })),
    data.kgUom?.id ?? null,
    (id) => fabricById.get(id)?.name ?? "this fabric",
  );

  /** Each fabric's route with the process master's Knitting/Dyeing kinds — the
   *  same helper the save calls (`iwoRoutesByFabric`). */
  const processKinds = new Map(
    data.processes.map((o) => [o.id, { is_knitting: o.is_knitting ?? false, is_dyeing: o.is_dyeing ?? false }]),
  );
  const routesByFabric = iwoRoutesByFabric(
    procs.map((r) => ({
      item_id: r.item_id,
      stage_id: r.stage_id,
      process_id: r.process_id,
      loss_pct: num(r.loss_pct),
      /* 0613 — gated exactly as the action stores it (an IWO step names no
         colourway, so COLOR WISE alone keeps the map). */
      color_losses: colorLossesFromDraft(r.color_wise_loss, r.color_losses),
    })),
    processKinds,
  );

  /** THE COLOURS OF ONE FABRIC'S LINES — what a COLOR WISE step on its route,
   *  or on a yarn it is made of, lists in [Color Loss]. An IWO has no
   *  colourways; a line's own Colour is its bucket (`iwoFabricGross`), so these
   *  are the keys the engine will look the losses up by. Known from the lines,
   *  before any weight is. */
  const lineColoursOf = (fabricId: string): string[] =>
    [...new Set(lines.filter((l) => l.item_id === fabricId).flatMap((l) => plannedColours(l.cells)))];

  /** GREY or DYED (0592) — `stageRank` via `colouredStageIds`, the Fabric BOM's
   *  own test and the one the save runs; never the word DYED compared here. */
  const dyedStageIds = colouredStageIds(data.yarnStages);

  /** The Yarn Dyed shades (0599) — `iwoYarnShades`, the call the save makes,
   *  over the rows the form holds for fabrics still on a line. */
  const lineFabricIds = new Set(lines.map((l) => l.item_id).filter(Boolean));
  const yarnShades = yarnMode
    ? []
    : iwoYarnShades(
        ydRepeats.filter((r) => lineFabricIds.has(r.item_id)),
        ydCombinations
          .filter((c) => lineFabricIds.has(c.item_id))
          .map((c) => ({
            item_id: c.item_id,
            combo: c.combo,
            yd_combo_name: c.yd_combo_name,
            colors: c.colors.map((x, i) => ({ sno: i + 1, dyeing_loss_pct: x.dyeing_loss_pct })),
          })),
        compositionById,
      );
  const isDyedLine = (l: YarnLineRow) => !!l.buy_stage_id && dyedStageIds.has(l.buy_stage_id);
  const shadeFacts = (l: YarnLineRow) =>
    l.shades.map((sh) => ({ color_name: normName(sh.color_name) || null, planned_kgs: num(sh.planned_kgs) }));
  /** The Yarn Colour panel's names — what a shade may be. */
  const yarnColourNames = [...new Set(palette.yarn.map((r) => normName(r.value)).filter(Boolean))];

  /* LOOSE FABRIC CONVERSION (0636) — the order screen's plan, on this BOM's
     buckets and the derived rows the payload sends; `writeYarns` runs the
     same `planConversions`. A For = Yarn BOM has no cloth, so no plan. */
  const conversionLinks = yarnMode ? new Map<string, string | null>() : conversionLinksOf(yarnRows, isUnravelling);
  /* 0645 — each colour's own loose fabric and loss (the [Click] Details). */
  const conversionDetails = yarnMode ? new Map() : conversionDetailsOf(yarnRows, isUnravelling);
  const looseFabricIds = new Set(linkedLooseFabricIds(conversionLinks, conversionDetails));
  const conversionPlan = planConversions({
    links: conversionLinks,
    details: conversionDetails,
    stepLosses: yarnMode ? new Map() : conversionStepLossesOf(yarnRows, isUnravelling),
    // Colours the yarn's other steps take (2026-09-29) — `writeYarns` passes the same.
    claimed: yarnMode ? new Map() : claimedColoursOf(yarnRows, isUnravelling),
    isUnravelling,
    fabrics: fabricGross,
    compositions: compositionById,
    routesByFabric,
    decimals: data.kgUom?.decimals ?? null,
    nameOf: (id) => fabricById.get(id)?.name,
  });
  /** A loose fabric is GREIGE cloth — a yarn-dyed one cannot be dyed with the body. */
  const looseFabricOptions = data.fabrics.filter((f) => !isYarnDyed(f.fabric_type));
  /** The order screen's `injectLooseRoute`: [GREIGE] KNITTING → [DYED] DYEING
   *  → [DYED] CONVERSION, once, by the master's kind flags and base stages. */
  const injectLooseRoute = (fabricId: string) => {
    if (procs.some((p) => p.item_id === fabricId)) return;
    /* KNITTING and DYEING only — CONVERSION is a yarn step (2026-09-26), so it
       is never placed on the loose fabric's route; see `processesForFabric`. */
    const live = data.processes.filter((p) => p.for_fabric && !p.is_unravelling && !p.inactive);
    const steps = [
      { p: live.find((x) => x.is_knitting), loss: "" },
      { p: live.find((x) => x.is_dyeing), loss: "" },
      /* NO CONVERSION STEP (2026-09-26): CONVERSION is a yarn step only — its
         loss is the yarn CONVERSION step's Loss % (2.00 by default there). */
    ].filter((x): x is { p: (typeof live)[number]; loss: string } => !!x.p);
    if (!steps.length) return;
    setProcs((prev) => [
      ...prev,
      ...steps.map(({ p, loss }) => ({
        ...blankFabricProcess(newKey(), fabricId),
        stage_id: p.stage_roles.find((r) => r.is_base)?.stage_id ?? null,
        process_id: p.id,
        loss_pct: loss,
      })),
    ]);
    setDirty(true);
  };

  /** One yarn's purchase weight, or the refusal standing in for it — the order
   *  engine, with the arguments the save passes (no source; shades on a DYED
   *  Yarn IWO line, 0592). */
  const weightFor = (r: YarnRow) => {
    if (yarnMode) {
      const l = yarnLines.find((x) => x.item_id === r.item_id);
      const dyed = !!l && isDyedLine(l);
      return iwoYarnModePurchase(
        dyed ? null : num(l?.planned_kgs ?? ""),
        r.stages.map((st) => ({
          combo: st.combo || null,
          loss_pct: num(st.loss_pct),
          // 0613 — the same gate the action's `build` stores through.
          color_losses: colorLossesFromDraft(st.color_wise_loss && !st.combo, st.color_losses),
        })),
        data.kgUom?.id ?? null,
        data.kgUom?.decimals ?? null,
        r.name || "this yarn",
        dyed && l
          ? {
              colourBy: l.colour_by || null,
              shades: keptIwoYarnShades(shadeFacts(l)).map((sh) => ({
                color_name: sh.color_name ?? "",
                planned_kgs: sh.planned_kgs,
              })),
            }
          : null,
      );
    }
    return yarnPurchaseWithConversion(r.item_id, conversionPlan, {
      fabrics: fabricGross,
      compositions: compositionById,
      routesByFabric,
      // `dyed` marks a yarn step in a coloured stage — a shade's own dye loss
      // replaces it rather than stacking ("ONE DYEING LOSS"); the save passes
      // the same flag. Less any CONVERSION step (0636) — its loss is the
      // loose fabric's.
      ownStages: withoutConversionSteps(r.stages, isUnravelling).map((st) => ({
        combo: st.combo || null,
        loss_pct: num(st.loss_pct),
        dyed: !!st.stage_id && dyedStageIds.has(st.stage_id),
        // 0613 — the same gate the action's `build` stores through.
        color_losses: colorLossesFromDraft(st.color_wise_loss && !st.combo, st.color_losses),
      })),
      decimals: data.kgUom?.decimals ?? null,
      sourceByFabric: new Map(),
      shades: yarnShades,
    });
  };

  /** Gross Yarn for one card row: its weight through its fabric's route losses
   *  (`comboUplift`, divide by 1 — L, compounded), PER COLOUR — a route step
   *  marked COLOR WISE (0613) charges each colour its own loss, and
   *  `comboUplift(route, colour)` is where that is resolved. Null while the
   *  row has no weight; the card's totals band sums the rows. */
  const grossOf = (itemId: string | null, kgs: number | null, colour: string | null): number | null => {
    if (!itemId || kgs == null || !(kgs > 0)) return null;
    const factor = comboUplift(routesByFabric.get(itemId) ?? [], colour ?? "", []);
    return isRefusal(factor) ? null : kgs * factor;
  };

  const setYarnStages = (yarnId: string, next: YarnStageRow[]) => {
    setYarnAnswers((prev) => ({ ...prev, [yarnId]: { stages: next } }));
    setDirty(true);
  };
  const setFabricProcs = (itemId: string, next: FabricProcessRow[]) => {
    setProcs((prev) => [...prev.filter((p) => p.item_id !== itemId), ...next]);
    setDirty(true);
  };
  /** A declared Roll form print is what lets a route name a Print step (0528) —
   *  on an IWO the prints are this BOM's own panel. */
  const printDeclared = palette.print.some((r) => r.value.trim());

  // ---- validity ----------------------------------------------------------------

  /** A name typed twice in one panel — the unique index would refuse it; say
   *  so here, naming the panel, before Save is pressed. */
  const PANEL_LABEL: Record<PaletteSection, string> = {
    fabric: "Fabric Colour",
    yarn: "Yarn Colour",
    print: "Roll form prints",
  };
  const duplicateNames = (["fabric", "yarn", "print"] as const).flatMap((section) => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of palette[section]) {
      const n = normName(r.value);
      if (!n) continue;
      if (seen.has(n)) dup.add(n);
      seen.add(n);
    }
    return [...dup].map((n) => `${PANEL_LABEL[section]}: ${n} is listed twice.`);
  });

  /** GREIGE (0) / coloured (≥1) per `fabric_stage` id — `stageRank`, the
   *  Fabric BOM's own test and the one the save runs (Phase 2). */
  const fabricStageById = new Map(
    [...data.processLookups.stages, ...data.fabricStages].map((st) => [st.id, st]),
  );
  const fabricStageRank = (id: string | null) => {
    const st = id ? fabricStageById.get(id) : undefined;
    return st ? stageRank(st) : null;
  };

  /** The Fabric Colour panel's names — a coloured card's first axis. */
  const fabricColourNames = [...new Set(palette.fabric.map((r) => normName(r.value)).filter(Boolean))];

  /** The Roll form prints panel's names — a PRINT-stage card's third axis. */
  const printNames = [...new Set(palette.print.map((r) => normName(r.value)).filter(Boolean))];


  /** The line rules (`lines.ts`) — the same function the action runs. */
  /* Run over the EXPANDED lines (one per weighted cell), the rows re-labelled
     to the screen row each came from. */
  const expanded = expandLines(lines);
  const lineProblems = iwoFabricLineProblems(
    expanded.map((x) => x.facts),
    (id) => fabricTypeOf(id),
    fabricStageRank,
    swoStyleIds,
  )
    .flatMap((p) => {
      const at = expanded[p.row - 1];
      const row = at?.row ?? p.row;
      // The sentence carries the ordinal too ("Fabric line 3: …") — re-labelled
      // to the screen row, so a fabric with three colours is not "lines 3, 4, 5".
      let message = p.message.replace(/^Fabric line \d+:/, `Fabric line ${row}:`);
      /* A FABRIC WITH NO WEIGHT EXPANDS TO ONE PLACEHOLDER LINE (plan.ts), so
         the existing "enter the Req Wt" is what refuses it — reworded here to
         the card's own truth (a weight on at least one of its rows), and the
         placeholder's colour / dia / print problems dropped: they are about
         a stored line that does not exist yet, and the card offers no box to
         answer them in. The action refuses with the same first sentence. */
      if (at && isPlaceholderFacts(at.facts)) {
        if (p.field !== "req_kgs") return [];
        const l = lines[row - 1];
        const rank = l ? fabricStageRank(l.stage_id) : null;
        const noPrints = rank === 2 && !printDeclared;
        message = `Fabric line ${row}: ${
          noPrints
            ? "declare a print on the Roll form prints panel (Fabric Plan section), then enter a weight on at least one row."
            : "enter a weight on at least one row."
        }`;
      }
      /* A SAMPLE PLAN NAMES THE SAMPLE AND THE FABRIC (2026-10-12): its
         Consumption is entered sample by sample, so "Fabric line 2" points at
         nothing on screen. A fabric no sample uses is said as that. */
      if (sample) {
        const l = lines[row - 1];
        const fabricName = (l?.item_id ? fabricById.get(l.item_id)?.name : null) ?? `Fabric line ${row}`;
        if (at && isPlaceholderFacts(at.facts)) {
          message = `${fabricName}: no sample uses this fabric yet — add it to a sample under Fabric Consumption, or remove it from Fabric Allocation.`;
        } else {
          const smp = at?.facts.sample_style_id;
          const who = smp ? `${swoSampleLabel(smp) || "A sample not in this SWO"} · ${fabricName}` : fabricName;
          message = message.replace(/^Fabric line \d+:/, `${who}:`);
        }
      }
      return [{ ...p, row, message }];
    })
    // Two cells of one row failing the same test are ONE thing to fix.
    .filter((p, i, all) => all.findIndex((q) => q.row === p.row && q.field === p.field && q.message === p.message) === i);

  /** The Dia panel's values, as `dia-knit.ts` and `familyDias` read them. */
  const diaDeclarations = dias.map((d) => ({ knit_type: d.knit_type || null, dia: d.dia }));
  /** A line's fabric family — its Structure's code (`circular` / `flat_knit` /
   *  `woven`), the same code a Dia panel row stores. Null = no family set, so
   *  nothing to scope by. */
  const lineKnitCode = (l: { structure_id: string | null }): string | null =>
    l.structure_id ? (data.structures.find((x) => x.id === l.structure_id)?.knit_code ?? null) : null;
  /** A line holding a dia of the WRONG family — refused at Save, here and in
   *  the action (`diaKnitProblem`, the sentence the server returns too). */
  const diaKnitBlockers = lines.flatMap((l, i) =>
    [...new Set(expandPlanCells(l.cells).map((f) => f.finish_dia ?? ""))].flatMap((dia) => {
      const p = l.item_id && dia ? diaKnitProblem(dia, lineKnitCode(l), diaDeclarations, fabricById.get(l.item_id)?.name ?? "This fabric") : null;
      return p ? [{ row: i + 1, message: p }] : [];
    }),
  );
  /** What the panels declare for one fabric — the axes its card derives from. */
  const planAxesFor = (l: LineRow): PlanAxes => ({
    rank: fabricStageRank(l.stage_id),
    colours: fabricColourNames,
    dias: familyDias(diaDeclarations, lineKnitCode(l)),
    prints: printNames,
    samples: swo ? swo.samples.map((x) => x.style_id) : undefined,
  });
  /** The rows the panels no longer name — kept, tagged, refused (plan.ts). */
  const staleBlockers = lines.flatMap((l, i) =>
    stalePlanRows(l.cells, planAxesFor(l)).map((r) => {
      const what =
        [r.sample_style_id ? swoSampleLabel(r.sample_style_id) || "a sample not in this SWO" : "", r.color_name, r.finish_dia, r.print_name]
          .filter(Boolean)
          .join(" · ") || "a row with no colour or dia";
      const kgs = r.req_kgs.trim();
      return {
        row: i + 1,
        message:
          `Fabric line ${i + 1}: ${what}${kgs ? ` (${kgs} KGS)` : ""} is no longer declared — pick a declared value on that row, remove the row, ` +
          (fabricStageRank(l.stage_id) === 0
            ? "or change the Stage back."
            : "or declare it again on the Fabric Plan section's panels."),
      };
    }),
  );

  /** Each fabric's line Stage — what decides whether its route stops at Greige. */
  const fabricStageOf = iwoFabricStages(expanded.map((x) => x.facts));
  const isGreigeFabric = (itemId: string) => fabricStageRank(fabricStageOf.get(itemId) ?? null) === 0;

  /** The Fabric Process stage rules (0570) — the order screen's `routeBlockers`,
   *  with this BOM's own prints as the Print gate. */
  const routeBlockers = [
    ...stageRouteProblems(procs, data.processes, data.processLookups.stages, {
      gatesFor: (itemId) => ({
        printDeclared,
        fabricIsYarnDyed: isYarnDyed(fabricTypeOf(itemId)),
        fabricIsPieceDyed: isPieceDyed(fabricTypeOf(itemId)),
        /* 0636 — CONVERSION runs on a linked loose fabric's route only. */
        looseFabricRoute: looseFabricIds.has(itemId),
      }),
      fabricName: (itemId) => fabricById.get(itemId)?.name ?? "This fabric",
    }),
    /* LOOSE FABRIC CONVERSION (0636) — the order screen's Save rules; the
       action's `conversionProblem` refuses the same sentences. */
    ...(yarnMode
      ? []
      : conversionStepProblems({
          yarns: yarnRows.map((y) => ({ name: y.name, stages: y.stages })),
          links: conversionLinks,
          details: conversionDetails,
          routeSteps: procs,
          isUnravelling,
          fabricName: (itemId) => fabricById.get(itemId)?.name ?? "This fabric",
        }).map((message) => ({ item_id: "", row_key: "", message }))),
    // Phase 2 — a GREIGE fabric's route stops at Greige (the save's rule too).
    ...iwoGreigeRouteProblems(procs, fabricStageOf, (id) => fabricStageRank(id), {
      fabric: (itemId) => fabricById.get(itemId)?.name ?? "This fabric",
      stage: (id) => fabricStageById.get(id)?.name ?? "coloured",
    }),
  ];

  /** "Yarn compositions still loading" — the order screen's guard. Saving now
   *  would send an empty yarn list and the server would refuse it; saying so
   *  here is the kinder half. */
  const yarnsLoading = !yarnMode && !!fabricIdKey && !comp;

  /** For = Yarn: the Yarn Lines rules (`lines.ts`) — the same function the
   *  action runs. A yarn line with stages typed counts as started. */
  const yarnLineFacts = yarnLines.map((l) => {
    const stages = l.item_id ? (yarnAnswers[l.item_id]?.stages ?? []) : [];
    return {
      item_id: l.item_id,
      buy_stage_id: l.buy_stage_id,
      planned_kgs: num(l.planned_kgs),
      hasStages: stages.some((st) => !!(st.stage_id || st.process_id)),
      colour_by: l.colour_by || null,
      shades: shadeFacts(l),
      // "Is this a dyeing step" is the process master's `is_dyeing` — the
      // flag the save reads too (0592 set it on YARN DYEING).
      steps: stages
        .filter((st) => st.process_id)
        .map((st) => ({
          combo: st.combo || null,
          dyeing: !!processKinds.get(st.process_id as string)?.is_dyeing,
        })),
    };
  });
  const yarnLineIssues = yarnMode
    ? iwoYarnLineProblems(yarnLineFacts, {
        isDyedStage: (id) => dyedStageIds.has(id),
        yarnColours: yarnColourNames,
      })
    : [];

  const validity = sectionValidity({
    sections: [
      { key: "bom" },
      { key: "yarnLines", when: () => yarnMode },
      { key: "lines", when: () => !yarnMode },
      { key: "consumption", when: () => !yarnMode },
      { key: "yarns" },
      { key: "process", when: () => !yarnMode },
    ],
    values: form,
    fields: [
      { section: "bom", id: "ifb-iwo", label: "I.WO No", required: true, empty: (f) => !f.iwo_id },
      { section: "bom", id: "ifb-date", label: "Date", required: true, empty: (f) => !f.bom_date },
    ],
    extra: [
      ...(form.bom_date && form.bom_date > today()
        ? [{ section: "bom", label: "Date", message: "The BOM date cannot be in the future.", kind: "custom" as const }]
        : []),
      ...duplicateNames.map((message) => ({ section: "bom", label: "Color/Print", message, kind: "custom" as const })),
      ...lineProblems.map((p) => ({
        section: p.section,
        label: `Fabric line ${p.row}`,
        message: p.message,
        kind: "custom" as const,
      })),
      ...diaKnitBlockers.map((b) => ({ section: "consumption", label: `Fabric line ${b.row}`, message: b.message, kind: "custom" as const })),
      ...staleBlockers.map((b) => ({ section: "consumption", label: `Fabric line ${b.row}`, message: b.message, kind: "custom" as const })),
      ...routeBlockers.map((b) => ({ section: "process", label: "Fabric Process", message: b.message, kind: "custom" as const })),
      ...yarnLineIssues.map((y) => ({
        section: y.section ?? "yarnLines",
        label: y.section === "yarns" ? "Yarn Process" : "Yarn Lines",
        message: y.message,
        kind: "custom" as const,
      })),
      ...(yarnsLoading
        ? [{ section: "yarns", label: "Yarn Process", message: "Yarn Process is still reading the fabrics' compositions " + "—" + " save again in a moment.", kind: "custom" as const }]
        : []),
    ],
  });

  const revealFirstProblem = () => {
    setNeedsAsked(true);
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- save ------------------------------------------------------------------

  /**
   * A SAMPLE PLAN STAYS OPEN AFTER SAVE (user 2026-10-14: "after saving, the
   * save button will hide and the submit button will be visible — no more
   * navigation"). It is re-opened from the refreshed list once that list holds
   * the saved plan, so the rows on screen carry their stored ids and Submit
   * reads the plan the server has. Orders ▸ IWO keeps returning to its list.
   */
  const reopenBom = useRef<string | null>(null);
  useEffect(() => {
    const id = reopenBom.current;
    if (!id) return;
    const t = tasks.find((x) => x.bom?.id === id);
    if (!t) return;
    reopenBom.current = null;
    openTask(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the refreshed list arrives
  }, [tasks]);

  function submit(asDraft: boolean) {
    setNeedsAsked(true);
    if (!form.iwo_id) return;
    // A Yarn work order has only the Yarn Colour panel on screen (2026-09-20).
    const paletteSections = yarnMode ? (["yarn"] as const) : (["fabric", "yarn", "print"] as const);
    const paletteRows = paletteSections.flatMap((section) =>
      palette[section]
        .filter((r) => r.value.trim())
        .map((r) => ({ section, name: r.value })),
    );
    const yarnLinePayload = keptIwoYarnLines(yarnLineFacts)
      .filter((l) => !!l.item_id)
      .map((l, i) => ({
        sno: i + 1,
        item_id: l.item_id as string,
        planned_kgs: l.planned_kgs,
        buy_stage_id: l.buy_stage_id,
        // Sent as typed; the SERVER decides GREY/DYED off the stage master and
        // drops both on a GREY line (0592).
        colour_by: l.colour_by,
        shades: keptIwoYarnShades(l.shades),
        stages: (yarnAnswers[l.item_id as string]?.stages ?? []).map((st, j) => ({
          sno: j + 1,
          stage_id: st.stage_id,
          process_id: st.process_id,
          loss_for_id: st.loss_for_id,
          combo: st.combo || null,
          // No Descriptions column (screenshot 2982) — null, as the Fabric BOM sends.
          description: null,
          loss_pct: num(st.loss_pct),
          // 0613 — the order screen's gate: only a step For every colour.
          color_wise_loss: !!st.color_wise_loss && !st.combo,
          color_losses: colorLossesFromDraft(st.color_wise_loss && !st.combo, st.color_losses) ?? {},
        })),
      }));
    const payload = {
      iwo_id: form.iwo_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      palette: paletteRows,
      dias: (yarnMode ? [] : dias).map((d) => ({
        knit_type: (d.knit_type || null) as "circular" | "flat_knit" | "woven" | null,
        dia: d.dia.trim() || null,
      })),
      // Blank rows are dropped HERE as well as in the action: the schema
      // requires a fabric on every line it is sent.
      // One stored line per dia (`expandLine`).
      lines: yarnMode ? [] : keptIwoFabricLines(expandLines(lines).map((x) => x.facts)).map((l) => ({
        ...l,
        item_id: l.item_id ?? "",
        fabric_form: l.fabric_form as "open" | "tubular" | null,
      })),
      // Details ▸ Yarn Dyed Details (0599), for fabrics still on a line; the
      // action drops blank rows and renumbers. Colours go by POSITION, so
      // their `sno` is the index.
      yd_repeats: yarnMode
        ? []
        : ydRepeats
            .filter((r) => lineFabricIds.has(r.item_id))
            .map((r) => ({
              structure_id: lines.find((l) => l.item_id === r.item_id)?.structure_id ?? null,
              item_id: r.item_id,
              sno: r.sno,
              yarn_item_id: r.yarn_item_id,
              dye_type: r.dye_type,
              color_name: r.color_name.trim() || null,
              uom_id: r.uom_id,
              value: r.value,
              twisted_yarn: r.twisted_yarn.trim() || null,
            })),
      yd_combinations: yarnMode
        ? []
        : ydCombinations
            .filter((c) => lineFabricIds.has(c.item_id))
            .map((c) => ({
              structure_id: lines.find((l) => l.item_id === c.item_id)?.structure_id ?? null,
              item_id: c.item_id,
              combo: c.combo.trim() || null,
              yd_combo_name: c.yd_combo_name.trim() || null,
              colors: c.colors.map((x, i) => ({
                sno: i + 1,
                yarn_color: x.yarn_color.trim() || null,
                dyeing_loss_pct: x.dyeing_loss_pct,
              })),
            })),
      // Step 3. Routes as typed (the action keeps only steps naming a process,
      // for fabrics still on a line); yarns as DERIVED, each with its own
      // stages. No weight is sent — the server computes every one.
      processes: yarnMode ? [] : procs.map((r) => ({
        item_id: r.item_id,
        combo: null,
        component_id: null,
        sno: 0,
        stage_id: r.stage_id,
        process_id: r.process_id,
        loss_for_id: r.loss_for_id,
        loss_pct: num(r.loss_pct),
        type_id: r.type_id,
        // 0613 — an IWO step names no colourway, so COLOR WISE alone keeps the map.
        color_wise_loss: !!r.color_wise_loss,
        color_losses: colorLossesFromDraft(r.color_wise_loss, r.color_losses) ?? {},
      })),
      yarns: yarnMode ? yarnLinePayload : yarnRows.map((y, i) => ({
        sno: i + 1,
        item_id: y.item_id,
        stages: y.stages.map((st, j) => ({
          sno: j + 1,
          stage_id: st.stage_id,
          process_id: st.process_id,
          loss_for_id: st.loss_for_id,
          combo: st.combo || null,
          description: null,
          loss_pct: num(st.loss_pct),
          color_wise_loss: !!st.color_wise_loss && !st.combo,
          color_losses: colorLossesFromDraft(st.color_wise_loss && !st.combo, st.color_losses) ?? {},
          /* 0636 — the conversion link; the action nulls it on any step the
             master does not flag as unravelling. */
          source_loose_fabric_id: st.source_loose_fabric_id ?? null,
          /* 0645 — its per-colour Details. */
          conversion_details: conversionDetailsFromDraft(st.conversion_details),
        })),
      })),
    };
    start(async () => {
      const res = await saveIwoFabricBom(editId, payload);
      if (res.ok) {
        success(editId ? "Fabric Plan updated" : "Fabric Plan created");
        setDirty(false);
        if (sample) reopenBom.current = res.bomId;
        else leaveEditor();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(t: IwoFabricBomTask) {
    if (!t.bom) return;
    const bomId = t.bom.id;
    start(async () => {
      const res = await deleteIwoFabricBom(bomId);
      if (res.ok) {
        success("Fabric Plan deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- sample plan approval (0718) ----------------------------------------------
  //
  // CLIENT BRIEF 2026-10-13 §2: a sample plan is approved before its yarn is
  // bought or its fabric processed, and an approved plan changes only through
  // a Fabric Plan Revision. The DATABASE is the lock (0718's triggers) and the
  // purchase gate (`planApprovalRefusal`); this is what says so on screen.
  // Orders ▸ IWO Fabric Plan never shows any of it — `sample` gates it all.
  // THE LOCK FOLLOWS THE PLAN, NOT THE ROUTE (user 2026-10-13: "without
  // raising revision I can edit"): Orders ▸ IWO Fabric Plan lists sample plans
  // too, and a submitted/approved one must be as locked there as here. Only
  // the Submit button is the Sample route's.
  const planBom = editId ? (picked?.bom ?? null) : null;
  const planStatus: FabricPlanApprovalStatus | null = planBom?.approval_status ?? null;
  const planRev = planBom?.revision_no ?? 0;
  const planLocked = planStatus === "submitted" || planStatus === "approved";
  const planLabel = picked?.swo?.code ?? picked?.code ?? "This plan";
  const panel = approval && approval.forId === editId ? approval : null;
  /** The approver's Approve / Request Rework, when this user may decide it. */
  const decide =
    panel?.run && panel.verdict && panel.run.status === "in_progress" && panel.verdict.can_act && !panel.mine ? (
      <ApprovalActionBar
        run={panel.run}
        verdict={panel.verdict}
        subjectPath="/sales/sample-fabric-plan"
        rework
        compact
        onDone={() => {
          if (editId) loadApproval(editId);
          router.refresh();
        }}
      />
    ) : null;
  /** Send a saved plan for approval FROM THE LIST (user 2026-10-14) — the
   *  editor no longer carries Submit, so the list is where a plan is sent. A
   *  draft or a plan already with the approver / approved offers nothing. */
  const canSendPlan = (t: { bom: { is_draft: boolean; approval_status: string } | null }) =>
    sample && perms.canEdit && !!t.bom && !t.bom.is_draft && t.bom.approval_status !== "submitted" && t.bom.approval_status !== "approved";
  function sendPlan(t: { code: string | null; swo?: { code: string } | null; bom: { id: string } | null }, after?: () => void) {
    const bomId = t.bom?.id;
    if (!bomId) return;
    start(async () => {
      const res = await submitSampleFabricPlan(bomId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(`${t.swo?.code ?? t.code ?? "Plan"} sent for approval`);
      after?.();
      router.refresh();
    });
  }
  /** The same Submit inside the editor — the saved plan on screen; hidden
   *  while there are unsaved changes, so only what is stored is sent. */
  const canSubmitPlan = !!editId && !!picked && !dirty && canSendPlan(picked);
  function submitPlan() {
    if (!editId || !picked) return;
    const id = editId;
    sendPlan(picked, () => loadApproval(id));
  }
  const openRevision =
    planStatus === "open" && planRev > 0 ? panel?.revisions.find((r) => r.revision_no === planRev) : undefined;
  const planLockMessage =
    planStatus === "submitted"
      ? `${planRev ? `Revision ${planRev} is` : "This Fabric Plan is"} with the approver — nothing in it can change until it is approved or sent back, and no yarn can be bought yet.`
      : planStatus === "approved"
        ? `Approved${planRev ? ` (Revision ${planRev})` : ""} and locked — yarn can be bought up to its purchase weights and its fabric processed. To change weights or processes, Raise Revision.`
        : null;
  const planTone = (st: FabricPlanApprovalStatus, rev: number) =>
    st === "approved" ? "success" : st === "submitted" ? "info" : st === "returned" || rev > 0 ? "warning" : "neutral";

  // ---- the list ----------------------------------------------------------------

  const columns: Column<IwoFabricBomTask>[] = [
    {
      // A sample plan is known by its SWO (user 2026-10-12) — the I.WO number
      // stays underneath and is not shown.
      header: sample ? "SWO No" : "I.WO No",
      cell: (t) => (
        <button
          type="button"
          onClick={() => (t.bom ? perms.canEdit : perms.canCreate) && openTask(t)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {(sample ? (t.swo?.code ?? t.code) : t.code) ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.iwo_date)}</span> },
    ...(sample
      ? []
      : [
          { header: "For", cell: (t: IwoFabricBomTask) => <span className="text-sm">{IWO_FOR_LABELS[t.iwo_for] ?? "—"}</span> },
          {
            header: "RE No",
            cell: (t: IwoFabricBomTask) => <span className="font-mono text-xs">{t.swo?.code ?? t.reference_no ?? "—"}</span>,
          },
        ]),
    { header: "Deli Dt", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.deli_date)}</span> },
    {
      header: "Fabric Plan",
      cell: (t) =>
        !t.bom ? (
          <StatusPill tone="neutral">Not started</StatusPill>
        ) : t.bom.is_draft ? (
          <StatusPill tone="info">Draft</StatusPill>
        ) : sample ? (
          // A sample plan's state is its APPROVAL (0718): Saved alone says
          // nothing about whether its yarn may be bought.
          <StatusPill tone={planTone(t.bom.approval_status, t.bom.revision_no)}>
            {fabricPlanApprovalLabel(t.bom.approval_status, t.bom.revision_no)}
          </StatusPill>
        ) : (
          <StatusPill tone="success">Saved</StatusPill>
        ),
    },
    rowActionsColumn((t) => (
      <RowActions
        label={t.code}
        onEdit={() => openTask(t)}
        canEdit={t.bom ? perms.canEdit : perms.canCreate}
        onDelete={t.bom ? () => del(t) : undefined}
        canDelete={!!t.bom && perms.canDelete}
        deleteDisabledReason={
          t.bom?.approval_status === "approved"
            ? "An approved Fabric Plan cannot be deleted"
            : t.bom?.approval_status === "submitted"
              ? "This Fabric Plan is with the approver"
              : null
        }
        deleteLabel="Delete BOM"
        isPending={isPending}
      />
    )),
  ];

  // ---- Color/Print Details panels ---------------------------------------------

  /** One text column, as on the order screen. CAPS from the primitive and again
   *  in the schema. No `required`: a blank row stores nothing. */
  const nameColumns = (header: string, section: PaletteSection): ChildGridColumn<PaletteRow>[] => [
    {
      header,
      width: "15rem",
      cell: (r) => (
        <Input
          /* Fills its sheet cell — the cell is the box (2026-10-03). */
          value={r.value}
          aria-label={header}
          onChange={(e) => mutPalette(section, (xs) => xs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
        />
      ),
    },
  ];

  const diaColumns: ChildGridColumn<DiaRow>[] = [
    {
      header: "Type",
      width: "8.125rem",
      cell: (r) => (
        <Select
          compact
          aria-label="Knit type"
          value={r.knit_type}
          onChange={(e) => mutDias((xs) => xs.map((x) => (x.key === r.key ? { ...x, knit_type: e.target.value } : x)))}
        >
          <option value="" />
          {KNIT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Dia / Size / Width",
      width: "6.875rem",
      cell: (r) => (
        <Input
          aria-label="Dia / size / width"
          value={r.dia}
          onChange={(e) => mutDias((xs) => xs.map((x) => (x.key === r.key ? { ...x, dia: e.target.value } : x)))}
        />
      ),
    },
  ];

  /** The last row comes back blank — a panel never shows as a bare button. */
  const removeName = (section: PaletteSection) => (r: PaletteRow) =>
    mutPalette(section, (xs) => {
      const left = xs.filter((x) => x.key !== r.key);
      return left.length ? left : [blankPaletteRow()];
    });

  // ---- Fabric Allocation + Fabric Consumption --------------------------------

  /** A Mixing Uom is owed only on a yarn-dyed CLOTH (the order screen's rule,
   *  `missingFabricLineFields`); the header star shows while any line owes it. */
  const owesMixing = (r: LineRow) => !!r.item_id && isYarnDyed(fabricTypeOf(r.item_id));

  /** [Detail] → Yarn Dyed Details for the line's fabric — the order screen's
   *  `openDetail`, copied: seeded HERE, in the open handler, and never through
   *  `onAdd` (which marks the form dirty) — No Of Colors repeats named
   *  Color 1…n, or one blank row, and one blank combination. A fabric already
   *  holding rows keeps them. */
  const openYarnDyed = (line: LineRow, origin: SheetOrigin) => {
    if (!line.item_id) return;
    const itemId = line.item_id;
    const count = Number(line.no_of_colors) > 0 ? Number(line.no_of_colors) : 0;
    if (!ydRepeats.some((r) => r.item_id === itemId)) {
      const seeded = Array.from({ length: Math.max(count, 1) }, (_, i) => ({
        key: newKey(),
        item_id: itemId,
        sno: count ? i + 1 : 0,
        yarn_item_id: null,
        dye_type: "dyed" as const,
        color_name: count ? `Color ${i + 1}` : "",
        uom_id: null,
        value: null,
        twisted_yarn: "",
      }));
      setYdRepeats((xs) => [...xs, ...seeded]);
    }
    if (!ydCombinations.some((c) => c.item_id === itemId)) {
      setYdCombinations((xs) => [...xs, { key: newKey(), item_id: itemId, combo: "", yd_combo_name: "", colors: [] }]);
    }
    setYdOrigin(origin);
    setYdFor(itemId);
  };
  const mutYdRepeats = (fn: (xs: YdRepeat[]) => YdRepeat[]) => {
    setYdRepeats(fn);
    setDirty(true);
  };
  const mutYdCombinations = (fn: (xs: YdCombination[]) => YdCombination[]) => {
    setYdCombinations(fn);
    setDirty(true);
  };
  const ydYarnOptions = (comp?.yarns ?? []).map((y) => ({ id: y.id, code: null, name: y.name, inactive: y.inactive }));
  const ydYarnName = (id: string | null) => (id ? ((comp?.yarns ?? []).find((y) => y.id === id)?.name ?? "") : "");


  /** What Fabric Consumption's own cells still owe — `lineProblems`, the rules
   *  Save runs, narrowed to the fields the cards show. */
  const CONSUMPTION_FIELDS = new Set(["stage_id", "sample_style_id", "print_name", "color_name", "finish_dia", "req_kgs", "gsm"]);
  const consumptionNeeds = lineProblems.filter((p) => CONSUMPTION_FIELDS.has(p.field));

  /** ONE STAGE PER FABRIC (Phase 2's rule): choosing it on one line sets it on
   *  every line of that fabric. A line with no fabric changes alone. */
  const setFabricStage = (r: LineRow, stageId: string | null) => {
    /* THE STAGE DECIDES THE ROWS — RESTRICTED, NOT WARNED (the yarn grid's
       2026-09-21 rule, applied here on the client's word, screenshot 2987:
       "stage is greige means the colour field must hide"). The card derives
       its rows from the Stage, so GREIGE draws no Colour column the moment it
       is picked. And the weights FOLLOW the Stage (`planCellsForStage`,
       plan.ts): to GREIGE the cells sharing a dia merge, summing — greige is
       one lot, and a weight typed under a colour is not thrown away when the
       colour goes; off a Print stage the prints merge the same way. */
    const rank = fabricStageRank(stageId);
    setLines((xs) =>
      xs.map((x) =>
        x.key === r.key || (r.item_id && x.item_id === r.item_id) ? { ...x, stage_id: stageId, cells: planCellsForStage(x.cells, rank) } : x,
      ),
    );
    setDirty(true);
  };

  /**
   * FABRIC ALLOCATION — the order screen's legacy row minus what only an order
   * has (the style columns, and [Detail], which maps garment components).
   *
   * NO COLOUR, NO PRINT HERE (user 2026-09-21, screenshot 2972: "fabric
   * consumption tab inside Colour * Print remove this two field"). Both used
   * to stand on this grid AND on Fabric Consumption — one line, two boxes —
   * but they are what the STAGE asks for, and the Stage lives on Consumption
   * ("stage first, then what the stage asks for"). Here the operator could
   * fill a Colour before any stage existed to owe or refuse it, and a GREIGE
   * line then greeted them with "clear it" on the next tab. Allocation now
   * names the cloth; Consumption plans it — and since 2026-09-22 it does not
   * ask for a colour or a dia at all: its rows are derived from the panels.
   *
   * NO SMP NO HERE EITHER (client 2026-10-12, reversing the same morning's
   * a4ecda7): Allocation is the SWO's consolidated cloth — structure, fabric,
   * blend — bought and dyed as one batch for the whole group. Which sample
   * each kilo is for is Fabric Consumption's, one SMP per row.
   *
   * WIDTHS (check:grid-budget): term 176 + name 288 + hug 88 (Type) + hug 88
   * (Mixing Uom) + hug 88 (No Of Colors) + num 72 (Detail) = 800 + 72 chrome =
   * 872 <= 1155.
   */
  const allocationColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Structure",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          items={data.structures}
          value={r.structure_id}
          onChange={(id) => {
            // The cascading-picker rule: a structure the held fabric is not
            // filed under clears it; one it is under keeps it.
            const held = r.item_id ? fabricById.get(r.item_id) : undefined;
            patchLine(r.key, {
              structure_id: id,
              item_id: held && id && held.category_id !== id ? null : r.item_id,
            });
          }}
        />
      ),
    },
    {
      header: "Fabric",
      required: true,
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          items={data.fabrics.filter(
            (f) => !r.structure_id || f.category_id === r.structure_id || f.id === r.item_id,
          )}
          emptyHint={r.structure_id ? "No fabric is filed under this structure yet." : null}
          value={r.item_id}
          onChange={(id) =>
            patchLine(r.key, {
              item_id: id,
              structure_id: (id ? fabricById.get(id)?.category_id : null) ?? r.structure_id,
            })
          }
        />
      ),
    },
    {
      // Read off the fabric the planner picked — never typed, so it can never
      // contradict the cloth's own name. Blank until a fabric is chosen.
      header: "Type",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => <span className="text-sm">{fabricTypeOf(r.item_id) ?? ""}</span>,
    },
    {
      header: "Mixing Uom",
      width: FIELD_WIDTH_CSS.hug,
      required: lines.some(owesMixing),
      // A PER-ROW HOLD UNDER A PER-COLUMN STAR: the column's scope is an OR, so
      // this row re-declares its own (the order screen's Mixing Uom note).
      cell: (r) => (
        <RequiredScope required={owesMixing(r)} label="Mixing Uom">
          <RecordPicker
            label="Mixing Uom"
            compact
            required={owesMixing(r)}
            items={data.uoms}
            value={r.mixing_uom_id}
            onChange={(id) => patchLine(r.key, { mixing_uom_id: id })}
          />
        </RequiredScope>
      ),
    },
    {
      header: "No Of Colors",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          type="number"
          min={1}
          max={99}
          aria-label="No Of Colors"
          value={r.no_of_colors}
          onChange={(e) => patchLine(r.key, { no_of_colors: e.target.value })}
        />
      ),
    },
    {
      /* [Detail] — THE ORDER SCREEN'S COLUMN, COPIED (screenshot 2967; user
         2026-09-20: "copy from fabric bom fabric allocation details"): 4.5rem,
         a "Detail" button that opens Yarn Dyed Details for the line's fabric.
         Headed "Detail" where the order's is blank — `audit_layout.py
         --check row-actions` reads a blank-headed column holding a button as
         a hand-rolled View/Edit/Delete column, and this is not one. Gated on a fabric only, with the reason on the WRAPPER —
         a disabled button fires no hover, so a `title` on it is never seen
         (the order screen's own note). `data-row-open` puts it on the row's
         axis for Tab, Enter and ← →. */
      header: "Detail",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => {
        const reason = r.item_id ? null : "Choose the fabric first";
        return (
          <span title={reason ?? undefined} className="inline-block">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-row-open
              disabled={!!reason}
              aria-label={reason ? `Detail — ${reason}` : "Detail"}
              onClick={(ev) => openYarnDyed(r, ev.currentTarget.getBoundingClientRect())}
            >
              Detail
            </Button>
          </span>
        );
      },
    },
  ];

  /**
   * FABRIC CONSUMPTION — screenshot 2940 / SRS §4: the garment breakdown is
   * bypassed, so the weight is TYPED. ONE CARD PER FABRIC: the card header
   * carries what the fabric says once — Stage, Form, GSM — and the grid
   * beneath holds the rows the OPERATOR ADDS (user, 2026-09-23: "in fabric
   * consumption there is one error, the dia auto derivation"; plan.ts). Each
   * row's Colour, Print and Finish Dia are PICKED — from the Fabric Colour
   * panel, the Prints panel and the dias of the fabric's knit family only —
   * and nothing is pre-filled. Until then (09-22) the rows were derived, one
   * per colour × EVERY family dia, which put dias nobody chose on the card.
   *
   * WIDTHS (check:grid-budget): term 176 (Colour) + code 144 (Print) + hug 88
   * (Finish Dia) + range 112 (Req Wt) + range 112 (Gross Yarn) = 632 + 72
   * chrome (`#` + ✕) = 704 <= 1155. A SAMPLE plan adds term 176 (SMP No)
   * first and num 72 (Add Dia) last = 880 + 72 = 952 <= 1155. Colour and
   * Print are drawn only on the stages that ask for them, so a GREIGE card is
   * dia · weight · gross.
   *
   * SMP NO IS EACH ROW'S (client 2026-10-12): the planner picks the sample
   * first, then its Colour, Dia and weight — so on receipt stores release
   * each sample's own kilos to its cutting table (Grouping's cutting basis
   * reads Σ Req Wt per SMP). A colour cut at two dias is ONE head row and
   * a dia SUB-ROW under it ("+ Add Dia"), never the colour picked twice:
   * the sub-row shows the head's SMP / Colour / Print and takes only its
   * Finish Dia and weight (plan.ts `addPlanDia`).
   *
   * REQUIRED EXACTLY WHERE `lines.ts` REFUSES WITHOUT IT — Colour and Finish
   * Dia from a dyed stage up, Print on a PRINT stage — so the star, the cursor
   * hold and Save state one rule. A GREIGE line may go without a dia.
   */
  const cardRowsFor = (l: LineRow) => derivePlanRows(l.cells, planAxesFor(l));
  const setCell = (l: LineRow, row: PlanDisplayRow, patch: Partial<PlanDisplayRow>) =>
    patchLine(l.key, { cells: setPlanCell(l.cells, row, patch) });
  /**
   * ONE AXIS PICKER — a native `<Select>` over what the panel declares. A value
   * the row holds that the panel no longer names stays selectable ONLY as
   * itself, tagged "(not declared)", so the field never reads blank while the
   * row still stores it (AGENTS.md "Disabled rows": the held value survives).
   */
  const axisPicker = (
    r: PlanDisplayRow,
    label: string,
    value: string,
    options: readonly string[],
    keyOf: (v: string) => string,
    onPick: (v: string) => void,
  ) => {
    const held = value.trim() && !options.some((o) => keyOf(o) === keyOf(value)) ? value : "";
    return (
      <Select
        compact
        aria-label={label}
        value={held || options.find((o) => keyOf(o) === keyOf(value)) || ""}
        onChange={(e) => onPick(e.target.value)}
        className={cn(!r.declared && held && "text-danger")}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {held && <option value={held}>{held} (not declared)</option>}
      </Select>
    );
  };
  /** THE SMP NO PICKER (0707; client 2026-10-12) — on each Fabric Consumption
   *  row, offering ONLY the samples of the SWO picked on the Fabric Plan tab,
   *  each with the kilos the SWO batched for it. Picking one fills the
   *  fabric's empty Structure with the one structure that sample was costed
   *  in. A held sample the SWO no longer batches stays selectable as itself,
   *  tagged — never shown blank ("Disabled rows"). */
  const smpPicker = (l: LineRow, r: PlanDisplayRow) => {
    const value = r.sample_style_id ?? "";
    const held = value && !swoStyleIds?.has(value) ? value : "";
    return (
      <Select
        compact
        required={!!swo}
        // Before an SWO is picked the box is SHOWN, greyed, saying why (user
        // 2026-10-12: "the field is not on screen before Structure, why") —
        // a column that only appears later reads as a column that is missing.
        disabled={!swo}
        aria-label="SMP No"
        title={swo ? undefined : "Pick the SWO on the Fabric Plan tab first — its samples are listed here."}
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const own = swo?.samples.find((x) => x.style_id === id)?.structure_ids ?? [];
          const fill = !l.structure_id && own.length === 1 && data.structures.some((st) => st.id === own[0]) ? own[0] : null;
          const cells = setPlanCell(l.cells, r, { sample_style_id: id });
          patchLine(l.key, fill ? { cells, structure_id: fill } : { cells });
        }}
        className={cn(held && "text-danger")}
      >
        <option value="">{swo ? "" : "Pick the SWO first"}</option>
        {(swo?.samples ?? []).map((x) => (
          <option key={x.style_id} value={x.style_id}>
            {`${[x.smp_no, x.style_name].filter(Boolean).join(" · ")} (${kg(x.kg)} kg)`}
          </option>
        ))}
        {held && <option value={held}>(not in this SWO)</option>}
      </Select>
    );
  };
  /** A dia sub-row (sample plan only) — its SMP / Colour / Print are the head
   *  row's, so the cell holds no box: nothing to re-pick, nothing to hold. */
  const isSub = (r: PlanDisplayRow) => sample && r.follows;
  const subCell = <span aria-hidden className="pl-2 text-muted-foreground">↳</span>;
  /** "+ Add Dia" — on the LAST row of a colour's run, so the new dia lands
   *  under the ones it joins. `data-row-open` puts it on the row's axis for
   *  Tab, Enter and ← → (the Detail button's marker), so it is reachable
   *  without the mouse. */
  const addDiaButton = (l: LineRow, r: PlanDisplayRow) => {
    if (!r.runEnd) return null;
    const reason = canAddDia(r) ? null : "Pick the SMP No or Colour first";
    const what = [r.sample_style_id ? swoSampleLabel(r.sample_style_id) : "", r.color_name, r.print_name].filter(Boolean).join(" · ");
    return (
      <span title={reason ?? undefined} className="inline-block">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-open
          disabled={!!reason}
          aria-label={reason ? `Add Dia — ${reason}` : `Add another Finish Dia under ${what}`}
          onClick={() => patchLine(l.key, { cells: addPlanDia(l.cells, r.key) })}
        >
          + Dia
        </Button>
      </span>
    );
  };
  const consumptionColumns = (l: LineRow, rank: number | null, axes: PlanAxes): ChildGridColumn<PlanDisplayRow>[] => [
    // ALWAYS on a sample plan (greyed until the SWO is picked); never on Orders.
    ...(sample
      ? [
          {
            header: "SMP No",
            width: FIELD_WIDTH_CSS.term,
            required: !!swo,
            cell: (r: PlanDisplayRow) => (isSub(r) ? subCell : smpPicker(l, r)),
          },
        ]
      : []),
    ...(rank !== 0
      ? [
          {
            header: "Colour",
            width: FIELD_WIDTH_CSS.term,
            required: rank != null,
            cell: (r: PlanDisplayRow) =>
              isSub(r)
                ? subCell
                : axisPicker(r, "Colour", r.color_name, axes.colours, comboKey, (v) => setCell(l, r, { color_name: v })),
          },
        ]
      : []),
    ...(rank === 2
      ? [
          {
            header: "Print",
            width: FIELD_WIDTH_CSS.code,
            required: true,
            cell: (r: PlanDisplayRow) =>
              isSub(r)
                ? subCell
                : axisPicker(r, "Print", r.print_name, axes.prints, comboKey, (v) => setCell(l, r, { print_name: v })),
          },
        ]
      : []),
    {
      header: "Finish Dia",
      width: FIELD_WIDTH_CSS.hug,
      required: rank != null && rank >= 1,
      cell: (r) => axisPicker(r, "Finish Dia", r.finish_dia, axes.dias, diaKey, (v) => setCell(l, r, { finish_dia: v })),
    },
    {
      // NOT STARRED: the rule is per fabric — one weighted row at least — and
      // a row with a dia and no weight is refused by name under the card.
      header: "Req Wt (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.req_kgs) || 0, format: kg },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label={`Req Wt (KGS) — ${[r.sample_style_id ? swoSampleLabel(r.sample_style_id) : "", r.color_name, r.finish_dia, r.print_name].filter(Boolean).join(" · ") || "this fabric"}`}
          value={r.req_kgs}
          onChange={(e) => setCell(l, r, { req_kgs: e.target.value })}
        />
      ),
    },
    {
      // SRS §4's "Gross Yarn Reqd" — this row's weight through the fabric's
      // Fabric Process losses (divide by 1 — L, compounded, per colour: the
      // order engine's `comboUplift`). Derived, never typed.
      header: "Gross Yarn (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => grossOf(l.item_id, num(r.req_kgs), r.color_name || null) ?? 0, format: kg },
      cell: (r) => {
        const g = grossOf(l.item_id, num(r.req_kgs), r.color_name || null);
        return <span className="text-sm tabular-nums">{g == null ? <span className="text-muted-foreground">—</span> : kg(g)}</span>;
      },
    },
    ...(sample
      ? [
          {
            header: "Add Dia",
            width: FIELD_WIDTH_CSS.num,
            cell: (r: PlanDisplayRow) => addDiaButton(l, r),
          },
        ]
      : []),
  ];
  /** The card's rows below the table breakpoint — the same cells, stacked.
   *  `required` is declared on each `Field` as well: a grid that renders its
   *  own row never routes the column's `required` into it (AGENTS.md, "A grid
   *  that renders its own row must declare required twice"). */
  const cardRowMobile = (l: LineRow, r: PlanDisplayRow, rank: number | null, axes: PlanAxes) => (
    <FieldGrid>
      {isSub(r) && (
        <p className="text-xs text-muted-foreground">
          ↳ another dia of {[r.sample_style_id ? swoSampleLabel(r.sample_style_id) : "", r.color_name, r.print_name].filter(Boolean).join(" · ")}
        </p>
      )}
      {sample && !isSub(r) && (
        <Field label="SMP No" size="sm" required={!!swo}>
          {smpPicker(l, r)}
        </Field>
      )}
      {rank !== 0 && !isSub(r) && (
        <Field label="Colour" size="sm" required={rank != null}>
          {axisPicker(r, "Colour", r.color_name, axes.colours, comboKey, (v) => setCell(l, r, { color_name: v }))}
        </Field>
      )}
      {rank === 2 && !isSub(r) && (
        <Field label="Print" size="sm" required>
          {axisPicker(r, "Print", r.print_name, axes.prints, comboKey, (v) => setCell(l, r, { print_name: v }))}
        </Field>
      )}
      <Field label="Finish Dia" size="sm" required={rank != null && rank >= 1}>
        {axisPicker(r, "Finish Dia", r.finish_dia, axes.dias, diaKey, (v) => setCell(l, r, { finish_dia: v }))}
      </Field>
      <Field label="Req Wt (KGS)" size="sm">
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label="Req Wt (KGS)"
          value={r.req_kgs}
          onChange={(e) => setCell(l, r, { req_kgs: e.target.value })}
        />
      </Field>
      {sample && addDiaButton(l, r)}
    </FieldGrid>
  );

  // ---- Fabric Consumption, sample by sample (a sample plan only) -------------
  /*
   * THE SAMPLE FIRST, ITS FABRICS BESIDE IT (user 2026-10-12, plan "SMP-wise
   * Fabric Consumption" v3). The per-fabric cards asked for the SMP on every
   * row; a planner thinks the other way round — pick a sample, then say what
   * it takes. So a sample plan lists the SWO's samples on the left (planned
   * kg against the costing's) and the open sample's fabric rows on the right:
   * Fabric · Stage · Form · GSM · [Colours & Dias] · Req Wt · Gross Yarn.
   *
   * COLOURS AND DIAS ARE IN A POPUP, AND THERE IS NO PART (client spec
   * 2026-10-12 §6 + the approved "Colours & Dias Popup" mock-up): one row per
   * fabric; its colours, each picked once, and the dias each is cut at, in
   * `SmpColourSheet`. 0714's `part` column stays, NULL on every new line.
   *
   * NOTHING BELOW THE VIEW MOVED. The per-fabric `cells` stay the model (one
   * cell per dia, one stored line per cell); `smpGroups` and friends (plan.ts)
   * read and edit one sample's slice of them. Save, the rules, the yarn
   * engine, the budget and Grouping's cutting basis read what they always did.
   *
   * A row starts with no fabric (a pending row, client state only) and the
   * Fabric box offers what Fabric Allocation lists — Allocation stays the list
   * of what is bought. Choosing one makes the row real, with one blank dia.
   */
  /** One row of a sample's grid: ONE FABRIC the sample takes (`lineKey`), or a
   *  pending row with no fabric picked yet. Its colours and dias live in the
   *  Colours & Dias popup (`SmpColourSheet`). */
  type SmpRow = { key: string; lineKey: string | null };
  const allocatedLines = lines.filter((l) => !!l.item_id);
  const smpIds = swo ? swo.samples.map((x) => x.style_id) : [];
  const smpCur = smpOpen && smpIds.includes(smpOpen) ? smpOpen : (smpIds[0] ?? null);
  const fabricNameOf = (l: LineRow) => (l.item_id ? (fabricById.get(l.item_id)?.name ?? "") : "");
  /** Every dia cell this sample has on this fabric, across its colours. */
  const smpKeysOf = (l: LineRow, smp: string) => smpGroups(l.cells, smp).flatMap((g) => g.keys);
  const smpRowsFor = (smp: string): SmpRow[] => {
    const real: SmpRow[] = allocatedLines
      .filter((l) => smpGroups(l.cells, smp).length > 0)
      .map((l) => ({ key: `${l.key}|${smp}`, lineKey: l.key }));
    const pending: SmpRow[] = (smpPending[smp] ?? []).map((k) => ({ key: k, lineKey: null }));
    const rows = [...real, ...pending];
    // Editable sub-tables open with a row (AGENTS.md): a sample with nothing
    // planned shows one row standing ready, its Fabric box first.
    return rows.length ? rows : [{ key: `seed:${smp}`, lineKey: null }];
  };
  const smpHit = (r: SmpRow) => {
    if (!r.lineKey || !smpCur) return null;
    const l = lines.find((x) => x.key === r.lineKey);
    return l ? { l, keys: smpKeysOf(l, smpCur) } : null;
  };
  const groupKgOf = (l: LineRow, keys: readonly string[]) =>
    keys.reduce((a, k) => a + (num(l.cells[k]?.req_kgs ?? "") || 0), 0);
  const groupGrossOf = (l: LineRow, keys: readonly string[]) =>
    keys.reduce((a, k) => {
      const c = l.cells[k];
      return a + (c ? (grossOf(l.item_id, num(c.req_kgs), c.color_name || null) ?? 0) : 0);
    }, 0);
  /** The one dia a fabric's knit family lists, if just one — filled in on a new
   *  dia so the planner is not asked to pick from a list of one (the Order
   *  module's `diaOptionsFor` rule). */
  const onlyDiaOf = (l: LineRow) => {
    const fam = familyDias(diaDeclarations, lineKnitCode(l));
    return fam.length === 1 ? fam[0] : "";
  };
  const withOnlyDia = (l: LineRow, before: PlanCells, after: PlanCells) => {
    const dia = onlyDiaOf(l);
    if (!dia) return after;
    let next = after;
    for (const k of Object.keys(after)) {
      if (k in before) continue;
      // Not when the colour already has that dia: a second line of it is the
      // duplicate Save refuses, so leave the box for the planner to answer.
      const grp = grpOf(after[k]);
      const taken = Object.entries(after).some(([o, c]) => o !== k && grpOf(c) === grp && diaKey(c.finish_dia) === diaKey(dia));
      if (!taken) next = patchSmpDia(next, k, { finish_dia: dia });
    }
    return next;
  };
  const pickSmpFabric = (smp: string, r: SmpRow, lineKey: string) => {
    const l = lines.find((x) => x.key === lineKey);
    if (!l) return;
    const { cells } = addSmpGroup(l.cells, smp);
    patchLine(l.key, { cells: withOnlyDia(l, l.cells, cells) });
    setSmpPending((prev) => ({ ...prev, [smp]: (prev[smp] ?? []).filter((k) => k !== r.key) }));
  };
  /** ✕ on a sample's fabric row — every colour and dia of it goes. */
  const removeSmpFabric = (l: LineRow, smp: string) => {
    let cells = l.cells;
    for (const g of smpGroups(l.cells, smp)) cells = removeSmpGroup(cells, g.grp);
    patchLine(l.key, { cells });
  };
  /** A dia on this sample's fabric with no weight (or 0) — the button goes red. */
  const owesWeight = (l: LineRow, keys: readonly string[]) => keys.some((k) => !((num(l.cells[k]?.req_kgs ?? "") ?? 0) > 0));
  /**
   * LEVEL 1 OF THE CLIENT'S TREE ON THE SCREEN, LEVELS 2-3 IN A POPUP (user
   * 2026-10-12, approved mock-up "Colours & Dias Popup"; the shape is Order
   * Entry ▸ Combos ▸ [Detail] "Structure Details"). A row is the SAMPLE (the
   * list on the left) + its FABRIC + Stage / Form / GSM; its colours, and the
   * dias each colour is cut at, open from [Colours & Dias]. It replaces the
   * same day's "+ Dia" sub-rows, where a second colour was a second row
   * repeating the fabric.
   *
   * STAGE / FORM / GSM are still the FABRIC's — one Stage per fabric is a rule
   * (its route and yarn are shared) — so a change here is set on every row of
   * that fabric, in every sample (`setFabricStage`, `patchLine`).
   *
   * WIDTHS (check:grid-budget): code 144 (Fabric) + hug 88 (Stage) + hug 88
   * (Form) + num 72 (GSM) + term 176 (Colours & Dias) + range 112 (Req Wt) +
   * range 112 (Gross Yarn) = 792, + 72 chrome = 864 <= 1155.
   */
  const smpColumns = (smp: string): ChildGridColumn<SmpRow>[] => [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => {
        const hit = smpHit(r);
        if (hit) return <Truncated className="block text-sm font-medium">{fabricNameOf(hit.l)}</Truncated>;
        // One row per fabric per sample: a fabric this sample already has is not offered twice.
        const free = allocatedLines.filter((l) => smpGroups(l.cells, smp).length === 0);
        return (
          <Select compact aria-label="Fabric" value="" onChange={(e) => e.target.value && pickSmpFabric(smp, r, e.target.value)}>
            <option value="">{allocatedLines.length ? "" : "Add a fabric on Fabric Allocation first"}</option>
            {free.map((l) => (
              <option key={l.key} value={l.key}>
                {fabricNameOf(l)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Stage",
      required: true,
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const hit = smpHit(r);
        if (!hit) return null;
        return (
          <LookupDialogPicker
            kind="fabric_stage"
            label="Stage"
            compact
            required
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            options={data.fabricStages}
            value={hit.l.stage_id}
            onChange={(id) => setFabricStage(hit.l, id)}
          />
        );
      },
    },
    {
      header: "Form",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const hit = smpHit(r);
        if (!hit) return null;
        return (
          <Select compact aria-label="Form" value={hit.l.fabric_form} onChange={(e) => patchLine(hit.l.key, { fabric_form: e.target.value })}>
            <option value="" />
            {FABRIC_FORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "GSM",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => {
        const hit = smpHit(r);
        if (!hit) return null;
        return (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            aria-label="GSM"
            value={hit.l.gsm}
            onChange={(e) => patchLine(hit.l.key, { gsm: e.target.value })}
          />
        );
      },
    },
    {
      /* THE [Detail] OF THIS ROW — what the order screen's Combos ▸ [Detail]
         is to a combo. Says what is inside ("2 colours · 3 dias"), and turns
         red while a dia still has no weight. `data-row-open` puts it on the
         row's axis for Tab, Enter and the arrows. */
      header: "Colours & Dias",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => {
        const hit = smpHit(r);
        if (!hit) return null;
        const rank = fabricStageRank(hit.l.stage_id);
        if (rank == null) return <span className="text-xs text-muted-foreground">Pick the Stage first</span>;
        const groups = smpGroups(hit.l.cells, smp);
        const nDia = hit.keys.length;
        const label =
          rank === 0
            ? `${nDia} dia${nDia === 1 ? "" : "s"} ▸`
            : `${groups.length} colour${groups.length === 1 ? "" : "s"} · ${nDia} dia${nDia === 1 ? "" : "s"} ▸`;
        const owes = owesWeight(hit.l, hit.keys);
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-row-open
            className={cn(owes && "border-danger text-danger")}
            aria-label={`Colours & Dias — ${fabricNameOf(hit.l)}`}
            onClick={(ev) => {
              setColourOrigin(ev.currentTarget.getBoundingClientRect());
              setColourFor({ lineKey: hit.l.key, smp });
            }}
          >
            {label}
          </Button>
        );
      },
    },
    {
      // Read-only: the popup's weights, summed over every colour and dia.
      header: "Req Wt (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => { const hit = smpHit(r); return hit ? groupKgOf(hit.l, hit.keys) : 0; }, format: kg },
      cell: (r) => {
        const hit = smpHit(r);
        return hit ? <span className="text-sm tabular-nums">{kg(groupKgOf(hit.l, hit.keys))}</span> : null;
      },
    },
    {
      header: "Gross Yarn (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => { const hit = smpHit(r); return hit ? groupGrossOf(hit.l, hit.keys) : 0; }, format: kg },
      cell: (r) => {
        const hit = smpHit(r);
        if (!hit) return null;
        const g = groupGrossOf(hit.l, hit.keys);
        return <span className="text-sm tabular-nums">{g > 0 ? kg(g) : <span className="text-muted-foreground">—</span>}</span>;
      },
    },
  ];
  /** The fabric whose Colours & Dias popup is open — read fresh every render. */
  const colourLine = colourFor ? (lines.find((l) => l.key === colourFor.lineKey) ?? null) : null;
  const smpConsumption = () => {
    if (!swo) {
      return (
        <p className="text-sm text-muted-foreground">Pick the SWO on the Fabric Plan section first — its samples are listed here.</p>
      );
    }
    const cur = swo.samples.find((x) => x.style_id === smpCur) ?? null;
    return (
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* THE SAMPLES — every SMP in the SWO from the start, planned kg
            against its costing kg: green once met, amber while short. */}
        <nav aria-label="Samples" className="space-y-1 md:w-56 md:shrink-0">
          {swo.samples.map((x) => {
            const planned = smpReqKgs(lines.map((l) => l.cells), x.style_id);
            const met = x.kg > 0 && planned >= x.kg - 0.0005;
            const on = x.style_id === smpCur;
            return (
              <button
                key={x.style_id}
                type="button"
                aria-current={on ? "true" : undefined}
                // Switching which sample is SHOWN is not an edit — it stays
                // live on a locked plan (PlanLockFence).
                data-lock-allow
                onClick={() => setSmpOpen(x.style_id)}
                className={cn(
                  "block w-full rounded-control border px-3 py-2 text-left",
                  on ? "border-primary bg-surface" : "border-transparent hover:bg-surface-muted",
                )}
              >
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", met ? "bg-success" : "bg-warning")} />
                  {x.smp_no ?? x.sample_no ?? "—"}
                </span>
                <Truncated className="block text-xs">{x.style_name}</Truncated>
                <span className="block text-[11px] text-muted-foreground">{`${kg(planned)} of ${kg(x.kg)} kg`}</span>
              </button>
            );
          })}
        </nav>
        {cur && (
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-2 text-sm">
              <span className="font-mono font-semibold">{cur.smp_no ?? cur.sample_no ?? "—"}</span>
              <span className="font-semibold">{cur.style_name}</span>
              <span className="text-muted-foreground">{`Costing ${kg(cur.kg)} kg`}</span>
            </div>
            {!allocatedLines.length ? (
              <div>
                <p className="text-sm text-muted-foreground">Name a fabric on Fabric Allocation first — a sample&apos;s rows pick from those fabrics.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                  Go to Fabric Allocation
                </Button>
              </div>
            ) : (
              <ChildGrid<SmpRow>
                key={cur.style_id}
                columns={smpColumns(cur.style_id)}
                rows={smpRowsFor(cur.style_id)}
                flatRows
                addLabel="+ Add fabric"
                onAdd={() => setSmpPending((prev) => ({ ...prev, [cur.style_id]: [...(prev[cur.style_id] ?? []), `p${newKey()}`] }))}
                onRemove={(r) => {
                  const hit = smpHit(r);
                  if (hit) removeSmpFabric(hit.l, cur.style_id);
                  else setSmpPending((prev) => ({ ...prev, [cur.style_id]: (prev[cur.style_id] ?? []).filter((k) => k !== r.key) }));
                }}
                totalsLabel="Sample total"
              />
            )}
          </div>
        )}
      </div>
    );
  };

  // ---- Yarn Lines (For = Yarn, step 4) -----------------------------------------

  const patchYarnLine = (key: string, patch: Partial<YarnLineRow>) => {
    setYarnLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  /** The engine's whole answer for a line — the Shades popup reads its
   *  per-shade purchases (Dyed Purchase) from it. The Yarn Lines grid itself
   *  no longer shows the purchase weight (below). */
  const answerFor = (l: YarnLineRow) => {
    if (!l.item_id) return null;
    const r = yarnRows.find((y) => y.item_id === l.item_id);
    return r ? weightFor(r) : null;
  };

  const openShades = (l: YarnLineRow, origin: SheetOrigin) => {
    setShadesOrigin(origin);
    setShadesFor(l.key);
  };
  const shadeLine = shadesFor ? (yarnLines.find((l) => l.key === shadesFor) ?? null) : null;
  const shadeAnswer = shadeLine ? answerFor(shadeLine) : null;
  const shadeQty = shadeAnswer && !isRefusal(shadeAnswer) && "shadeQty" in shadeAnswer ? shadeAnswer.shadeQty : undefined;

  /**
   * YARN LINES — screenshot 2937's main grid: Yarn Description, Stage, Planned
   * Weight (KGS).
   *
   * NO PURCHASE WT COLUMN (user 2026-09-21, screenshot 2980: "Purchase Wt
   * (KGS) field need to remove from yarn lines in IWO for yarn"). It used to
   * stand last, read-only — the Planned Weight through the line's Yarn Process
   * stages — so the answer sat on the line that asks the question. The
   * operator entering a yarn line states what is PLANNED; what is BOUGHT is
   * Yarn Process's answer and is read there (and per shade in [Shades]),
   * where the stages that gross it are on screen beside it. `answerFor` is
   * still the engine call the Shades popup reads.
   *
   * 0592: Colour by and [Shades] belong to a DYED line only. On a GREY line
   * they stand empty and out of the way (the button is disabled, so Tab never
   * lands on a door that opens nothing), and a DYED line's Planned Weight is
   * Σ shades, read-only.
   *
   * WIDTHS (check:grid-budget): name 288 + code 144 + code 144 + hug 88 +
   * range 112 = 776 + 72 chrome = 848 <= 1155.
   */
  const yarnLineColumns: ChildGridColumn<YarnLineRow>[] = [
    {
      header: "Yarn",
      required: true,
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <RecordPicker
          label="Yarn"
          compact
          required
          items={data.yarns}
          // Pick-once: a yarn is planned on one line, its stages on Yarn Process.
          usedIds={yarnLines.filter((x) => x.key !== r.key && x.item_id).map((x) => x.item_id as string)}
          value={r.item_id}
          onChange={(id) => patchYarnLine(r.key, { item_id: id })}
        />
      ),
    },
    {
      header: "Stage",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <LookupDialogPicker
          kind="yarn_stage"
          label="Stage"
          compact
          required
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          options={data.yarnStages}
          value={r.buy_stage_id}
          onChange={(id) => patchYarnLine(r.key, { buy_stage_id: id })}
        />
      ),
    },
    {
      header: "Colour by",
      width: FIELD_WIDTH_CSS.code,
      // Owed on a DYED line only, so the hold is per ROW (the Mixing Uom
      // shape) — a column star would cage a GREY line on a field it never owes.
      cell: (r) =>
        isDyedLine(r) ? (
          <RequiredScope required label="Colour by">
            <Select
              compact
              required
              aria-label="Colour by"
              value={r.colour_by}
              onChange={(e) => patchYarnLine(r.key, { colour_by: e.target.value as IwoColourBy | "" })}
            >
              <option value="" />
              {IWO_COLOUR_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </RequiredScope>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: "Shades",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const n = keptIwoYarnShades(shadeFacts(r)).length;
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            /* Disabled on a GREY line with no shades, which `ROW_FIELDS`
               excludes, so no Tab stop opens nothing. BUT LIVE ON A GREY LINE
               THAT STILL HOLDS SHADES: the rules refuse that line until they
               are cleared ("a GREY yarn has no shades"), and a disabled door to
               the only fix would make the refusal unsatisfiable. */
            disabled={!isDyedLine(r) && n === 0}
            /* A MARKER, NEVER A HANDLER — `data-row-open` puts the button on
               the row's axis for Tab, Enter and ← → at once (the order
               screen's [Detail] shape), since a DYED line's shades are
               otherwise reachable only with the mouse. */
            data-row-open
            aria-label={n ? `Shades — ${n} entered` : "Shades — none entered"}
            onClick={(ev) => openShades(r, ev.currentTarget.getBoundingClientRect())}
          >
            {n ? String(n) : "Shades"}
          </Button>
        );
      },
    },
    {
      header: "Planned Weight (KGS)",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: {
        kind: "sum",
        of: (r) => (isDyedLine(r) ? (iwoShadeTotal(shadeFacts(r)) ?? 0) : num(r.planned_kgs) || 0),
        format: kg,
      },
      cell: (r) =>
        isDyedLine(r) ? (
          // Σ shades — the server writes the same sum (0592).
          <Input
            className="h-8 text-right"
            readOnly
            aria-label="Planned Weight (KGS), the sum of the shades"
            value={(() => {
              const t = iwoShadeTotal(shadeFacts(r));
              return t == null ? "" : kg(t);
            })()}
          />
        ) : (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            required
            aria-label="Planned Weight (KGS)"
            value={r.planned_kgs}
            onChange={(e) => patchYarnLine(r.key, { planned_kgs: e.target.value })}
          />
        ),
    },
  ];

  // ---- Yarn Process list ------------------------------------------------------

  /** The order screen's one-column yarn list: the yarn, and the fabrics that
   *  declare it (one yarn is legitimately in several). Plain text, never a
   *  disabled picker — nothing here is editable. */
  const yarnColumns: FoldListColumn<YarnRow>[] = [
    {
      header: "Yarn",
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            <Truncated>{r.name}</Truncated>
            {r.inactive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            <Truncated>{r.fabrics.join(" · ") || "—"}</Truncated>
          </div>
        </div>
      ),
    },
  ];

  /** One yarn's panel: WHY it has no weight (only when refused — the engine's
   *  own sentence), then its stages in the order screen's shared grid. */
  const yarnPanel = (r: YarnRow) => {
    const w = weightFor(r);
    const line = yarnMode ? (yarnLines.find((x) => x.item_id === r.item_id) ?? null) : null;
    /**
     * The colours this yarn's steps may be For.
     *
     * ON A FOR = YARN BOM THEY ARE THE LINE'S OWN SHADES, read straight off
     * [Shades] rather than out of the computed weight. `byCombo` says the same
     * thing while the weight can be stated — and says NOTHING the moment it
     * refuses, which is exactly when the planner is filling the screen in: a
     * shade whose KGS is not typed yet refuses (`iwoYarnModePurchase`), the
     * list emptied, and the Colour box the save demands an answer in had no
     * options to offer (client 2026-09-20). The shade NAMES are known long
     * before the arithmetic is.
     */
    const combos = line
      ? [...new Set(keptIwoYarnShades(shadeFacts(line)).map((sh) => sh.color_name ?? "").filter(Boolean))]
      : /* On a For = Fabric BOM: the Colours of every line whose fabric is made
           of this yarn — the buckets `iwoFabricGross` makes, read off the lines
           for the same reason as the shades above (known before the weight). */
        [...new Set(
          [...compositionById.values()]
            .filter((c) => c.components.some((x) => x.yarn_id === r.item_id))
            .flatMap((c) => lineColoursOf(c.fabric_id)),
        )];
    return (
      <>
        {isRefusal(w) && <p className="mb-1.5 text-xs text-danger">{w.refused}</p>}
        {/* WHAT THE CONVERSION COMES TO (0636) — the order screen's line. */}
        {(() => {
          const conv = conversionPlan.converted.get(r.item_id);
          if (!conv || isRefusal(conv)) return null;
          const feeds = conv.fabricIds.map((id) => fabricById.get(id)?.name ?? "").filter(Boolean);
          return (
            <p className="mb-1.5 text-xs text-muted-foreground">
              Unravelled from{" "}
              <span className="font-medium text-foreground">
                {fabricById.get(conv.loose_fabric_id)?.name ?? "the loose fabric"}
              </span>
              : {fmtNumber(conv.qty)} KGS dyed yarn
              {feeds.length ? ` for ${feeds.join(", ")}` : ""}
              {conv.looseKnitQty != null ? ` · knit ${fmtNumber(conv.looseKnitQty)} KGS of loose fabric` : ""}
              . Its greige yarn is bought on that yarn&apos;s own row.
            </p>
          );
        })()}
        <YarnProcessGrid
          rows={r.stages}
          onChange={(next) => setYarnStages(r.item_id, next)}
          /* 0636 — a For = Yarn BOM has no cloth to knit a loose fabric into,
             so CONVERSION is not offered there (a step already holding it
             survives, and the Save refuses it by name). */
          processes={
            yarnMode
              ? data.yarnProcesses.filter((p) => !p.is_unravelling || r.stages.some((st) => st.process_id === p.id))
              : data.yarnProcesses
          }
          stages={data.yarnStages}
          lossFor={data.processLookups.lossFor}
          combos={combos}
          /* 0613 — THE FABRIC BOM'S SHAPE (client screenshot 2979): For =
             COLOR WISE turns Loss % into a [Color Loss] list over the shades
             (Yarn IWO) or the lines' Colours (Fabric IWO); no Colour ▾. This
             BOM's yarn-stage table holds the map since 0613. No Descriptions
             column either (client screenshot 2982). */
          colourLoss
          /* 0636 — LOOSE FABRIC CONVERSION: greige cloths a CONVERSION step
             may name, and the route injected when one is picked. */
          looseFabrics={yarnMode ? [] : looseFabricOptions}
          onLooseFabricPicked={injectLooseRoute}
          newKey={newKey}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          readOnly={!perms.canEdit && !perms.canCreate}
        />
      </>
    );
  };

  // ---- Fabric Process list ----------------------------------------------------

  /** One row per fabric named on the lines — the order screen's "Fabric Detail"
   *  row, minus its Assort Color and Components (an IWO has neither); the
   *  line's Colour stands where Assort Color stood. */
  const fabricRouteRows = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))].map((itemId) => {
    const ls = lines.filter((l) => l.item_id === itemId);
    return {
      key: itemId,
      item_id: itemId,
      name: fabricById.get(itemId)?.name ?? "",
      structureType: rollUp(
        ls.map((l) => (l.structure_id ? (data.structures.find((x) => x.id === l.structure_id)?.knit ?? "") : "")),
      ),
      form: rollUp(ls.map((l) => fabricFormLabel(l.fabric_form))),
      colours: [...new Set(ls.flatMap((l) => plannedColours(l.cells)))],
      loose: false,
    };
  });
  /* THE LINKED LOOSE FABRICS (0636) — on no line, so the list above cannot
     name them; their route is real and is what grosses their greige yarn. */
  for (const itemId of looseFabricIds) {
    if (fabricRouteRows.some((r) => r.item_id === itemId)) continue;
    fabricRouteRows.push({
      key: itemId,
      item_id: itemId,
      name: fabricById.get(itemId)?.name ?? "",
      structureType: "",
      form: "",
      colours: [],
      loose: true,
    });
  }
  type FabricRouteRow = (typeof fabricRouteRows)[number];

  const fabricRouteColumns: FoldListColumn<FabricRouteRow>[] = [
    {
      header: "Fabric Description",
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0 text-sm text-foreground">
          <Truncated>{r.name || "(fabric not in the master)"}</Truncated>
          {/* 0636 — a loose fabric is on no line by design. */}
          {r.loose && (
            <div className="text-xs text-muted-foreground">
              Loose fabric — unravelled into{" "}
              {yarnRows.filter((y) => conversionLinks.get(y.item_id) === r.item_id).map((y) => y.name).join(", ") || "yarn"}
            </div>
          )}
        </div>
      ),
    },
    { header: "Type", cardLabel: "Knit type", width: "6rem", cell: (r) => <Truncated className="text-sm">{r.structureType}</Truncated> },
    { header: "Type", cardLabel: "Roll form", width: "5.5rem", cell: (r) => <Truncated className="text-sm">{r.form}</Truncated> },
    { header: "Colour", width: "9rem", cell: (r) => <Truncated className="text-sm">{r.colours.join(", ")}</Truncated> },
  ];

  /** Stacked cards below the table width — every label and `required` read
   *  off the column list, so the card and the header cannot disagree. */
  // grid-required-mobile: exempt -- the Allocation grid renders cards through lineCard(), which declares `required` on each Field from the column (and per row for Mixing Uom), so the star and the hold come from one declaration; the Consumption cards' one typed cell is not required (plan.ts)
  const lineCard = (columns: ChildGridColumn<LineRow>[], row: LineRow, i: number) => (
    <FieldGrid>
      {columns.map((c, ci) => (
        <Field key={ci} label={c.header} required={c.header === "Mixing Uom" ? owesMixing(row) : c.required} size="sm">
          {c.cell(row, i)}
        </Field>
      ))}
    </FieldGrid>
  );

  // ---- sections ------------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Fabric Plan",
      icon: Layers,
      done: !!form.iwo_id,
      content: (
        <SectionBody title="Fabric Plan">
          {/* The order screen's header row, with the IWO standing where the
              Garment order stood. Everything but the IWO and the Date is READ
              from the IWO — a readOnly field never holds the cursor. */}
          <FieldRow className="[&_input]:h-9">
            {sample ? (
              /* THE SAMPLE PLAN NAMES ITS SWO, NOT AN I.WO (user 2026-10-12,
                 screenshot 3435: "no more IWO number, which is SWO number,
                 auto fetch from grouping"). The SWOs offered are the ones
                 Grouping approved; picking one with no work order yet raises
                 it here (`raiseSampleGroupIw`, For Fabric), so the SIW number
                 stays underneath and never has to be read or typed. */
              <Field label="SWO No" required className="w-full max-w-[240px]" htmlFor="ifb-iwo">
                <RecordPicker
                  id="ifb-iwo"
                  label="SWO No"
                  compact
                  required
                  items={swoItems}
                  value={form.iwo_id}
                  emptyHint="No approved SWO is waiting — approve one on Sample ▸ Grouping."
                  disabled={!!form.iwo_id || swoRaising || !perms.canCreate}
                  onChange={pickSwo}
                />
              </Field>
            ) : (
              <Field label="I.WO No" required className="w-full max-w-[240px]" htmlFor="ifb-iwo">
                <RecordPicker
                  id="ifb-iwo"
                  label="I.WO No"
                  compact
                  items={iwoItems}
                  value={form.iwo_id}
                  // LOCKED ONCE NAMED, as the order picker is: lines typed against
                  // one work order must never be re-pointed at another.
                  disabled={!!form.iwo_id}
                  onChange={(id) => set({ iwo_id: id })}
                />
              </Field>
            )}
            <Field label="Date" required className="w-[145px]" htmlFor="ifb-date">
              <Input
                id="ifb-date"
                type="date"
                max={today()}
                disabled={!!editId}
                value={form.bom_date}
                onChange={(e) => set({ bom_date: e.target.value })}
              />
            </Field>
            {/* NOT ON A SAMPLE PLAN (client audio 2026-10-12: "remove For and RE
                No; keep the SWO / IW number and the Delivery Date") — a sample
                work order is always For Fabric, raised against its SWO. */}
            {!sample && (
              <Field label="For" className="w-[110px]" htmlFor="ifb-for">
                <Input id="ifb-for" readOnly value={picked ? IWO_FOR_LABELS[picked.iwo_for] : ""} />
              </Field>
            )}
            {/* A SAMPLE WORK ORDER'S HEADER IS ITS SWO (client spec, 2026-10-12):
                the RE No / FAR No of a bulk order mean nothing here. */}
            {!sample && (
              <Field label={swo ? "SWO No" : "RE No"} className="w-[170px]" htmlFor="ifb-re">
                <Input id="ifb-re" readOnly value={swo?.code ?? picked?.reference_no ?? ""} />
              </Field>
            )}
            <Field label="Deli Dt" className="w-[130px]" htmlFor="ifb-deli">
              <Input id="ifb-deli" readOnly value={picked?.deli_date ? fmtDate(picked.deli_date) : ""} />
            </Field>
          </FieldRow>

          {/* NOTHING TO PICK — a state of the data, said with the way out. With
              no Internal Work Order For Yarn or Fabric waiting, the I.WO No list
              is empty and every section below has nothing to build on; the
              button opens a new work order on its own screen (`?new=1`). */}
          {/* SAMPLE: the work order is raised right here (0704), so the plan
              never sends the operator out of the Sample module. */}
          {!sample && !form.iwo_id && iwoItems.length === 0 && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">
                No Internal Work Order For Yarn or Fabric is waiting for a BOM.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => router.push("/orders/internal-work-orders?new=1")}
              >
                New work order
              </Button>
            </div>
          )}

          {/* NO DYEING WORK ORDER BOX (user 2026-10-12: "no need this one").
              a4ecda7 put one here — Issue = greige, Return = finished, raised
              as a Stores process order — and the client dropped it the same
              day. The calculation (`lib/orders/iwo-fabric-bom/dyeing.ts`, its
              §20 vectors), `raiseIwoDyeingOrder` and 0708's columns are left
              in place, unused, so it can come back without re-deriving it. */}

          {/* ONE ROW OF FOUR, as on the order screen. A flex row, not
              grid-cols-4, so this file declares no grid of its own. On the
              order screen three of these write the ORDER's palette; here there
              is no order, so all four belong to this BOM (0581).
              A YARN WORK ORDER SHOWS YARN COLOUR ONLY (user 2026-09-20): it has
              no cloth, so Fabric Colour, Roll form prints and Dia / Size Width
              are fabric facts with nothing to describe — hidden, and not sent
              on save (`submit`). */}
          <div className="mt-4 flex w-full flex-row flex-nowrap items-start gap-3 [&_input]:text-xs [&_select]:text-xs">
            {!yarnMode && (
            <PaletteTable<PaletteRow>
              label="Fabric Colour"
              columns={nameColumns("Fabric Colour", "fabric")}
              rows={palette.fabric}
              width="max-w-[240px]"
              onAdd={() => mutPalette("fabric", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("fabric")}
              addLabel="+ Add fabric colour"
            />
            )}
            <PaletteTable<PaletteRow>
              label="Yarn Colour"
              columns={nameColumns("Yarn colour", "yarn")}
              rows={palette.yarn}
              width="max-w-[240px]"
              onAdd={() => mutPalette("yarn", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("yarn")}
              addLabel="+ Add yarn colour"
            />
            {!yarnMode && (
            <>
            <PaletteTable<PaletteRow>
              label="Roll form prints"
              columns={nameColumns("Roll form print", "print")}
              rows={palette.print}
              width="max-w-[240px]"
              onAdd={() => mutPalette("print", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("print")}
              addLabel="+ Add print"
            />
            <PaletteTable<DiaRow>
              label="Dia / Size Width Details"
              columns={diaColumns}
              rows={dias}
              width="max-w-[320px]"
              onAdd={() => mutDias((xs) => [...xs, blankDia()])}
              onRemove={(r) =>
                mutDias((xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [blankDia()];
                })
              }
              addLabel="+ Add dia"
            />
            </>
            )}
          </div>
        </SectionBody>
      ),
    },
    {
      key: "yarnLines",
      label: "Yarn Lines",
      icon: ListChecks,
      done: yarnLines.some((l) => !!l.item_id),
      content: (
        <SectionBody title="Yarn Lines">
          <ChildGrid<YarnLineRow>
            columns={yarnLineColumns}
            rows={yarnLines}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {yarnLineColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => {
              setYarnLines((xs) => [...xs, blankYarnLine()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setYarnLines((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add yarn"
          />
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Fabric Allocation",
      icon: Shirt,
      done: lines.some((l) => !!l.item_id),
      content: (
        <SectionBody title="Fabric Allocation">
          <ChildGrid<LineRow>
            columns={allocationColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => lineCard(allocationColumns, row, i)}
            onAdd={() => {
              setLines((xs) => [...xs, blankLine()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setLines((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add fabric"
          />
        </SectionBody>
      ),
    },
    {
      key: "consumption",
      label: "Fabric Consumption",
      icon: Scale,
      done: lines.some((l) => (planReqKgs(l.cells) ?? 0) > 0),
      content: (
        <SectionBody title="Fabric Consumption">
          {sample ? (
            <div className="[&_[data-required-empty]]:ring-1 [&_[data-required-empty]]:ring-danger">{smpConsumption()}</div>
          ) : (
            <>
          {!lines.some((l) => l.item_id) && (
            <div>
              <p className="text-sm text-muted-foreground">
                Name a fabric on Fabric Allocation first — each one gets its own card here.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                Go to Fabric Allocation
              </Button>
            </div>
          )}
          {/* WHERE IT ASKS, MADE VISIBLE (user 2026-09-20, screenshot 2969:
              "where it will ask, I couldn't find it"). A box the card owes and
              the operator has not filled carries `data-required-empty` — the
              marker the cursor hold already reads — but nothing drew it, so
              the only signs were a header star and a grey Save. Each such box
              gets a red ring (a ring, not a border: the grid clears input
              borders at rest), and the list under the cards names each line
              and what it lacks, from the same rules Save runs. */}
          <div className="space-y-4 [&_[data-required-empty]]:ring-1 [&_[data-required-empty]]:ring-danger">
            {lines.map((l) => {
              if (!l.item_id) return null;
              const rank = fabricStageRank(l.stage_id);
              const axes = planAxesFor(l);
              const rows = cardRowsFor(l);
              const fabric = fabricById.get(l.item_id);
              const family = knitLabel(lineKnitCode(l));
              /* NOTHING TO DERIVE — SAY WHICH PANEL, never a blank grid. The
                 Stage comes first (its own star and hold ask for it); after
                 that each empty axis names the panel that fills it. Rows the
                 panels no longer name still draw beneath, so a weight can be
                 cleared or re-declared. */
              const empty =
                rank == null
                  ? null
                  : rank === 2 && axes.prints.length === 0
                    ? "Declare the prints on the Roll form prints panel — a PRINT row picks its Print from there."
                    : rank !== 0 && axes.colours.length === 0
                      ? "Declare the colours on the Fabric Colour panel — each row picks its Colour from there."
                      : rank !== 0 && axes.dias.length === 0
                        ? `Declare a ${family ? `${family} ` : ""}dia on the Dia panel — each row picks its Finish Dia from there.`
                        : null;
              return (
                /* ONE CARD PER FABRIC. Capped so the table hugs its columns
                   (632px + 40px `#` chrome = 672px, + 2 × 12px card padding =
                   696px <= 44rem = 704px) rather than a grid stretched across the
                   pane with a blank half — the sub-sheet lesson of 2026-09-03.
                   The grid keeps `ChildGrid`'s default @lg switch, since a
                   `tableFrom` tier (1024px up) would force the card wider than
                   its own table for no gain. */
                /* A SAMPLE card adds SMP No (176) and Add Dia (72): 880 + 40
                   + 24 = 944px <= 59rem = 944px. */
                <div key={l.key} className={cn(sample ? "max-w-[59rem]" : "max-w-[44rem]", "rounded-md border")}>
                  <div className="border-b px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <Truncated className="text-sm font-semibold">{fabric?.name ?? ""}</Truncated>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {[family, fabricTypeOf(l.item_id)].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    {/* WHAT THE FABRIC SAYS ONCE — Stage decides the rows; Form
                        and GSM are the fabric's (user 2026-09-22: once per
                        fabric, not per row), stored on every one of its lines. */}
                    <FieldRow className="mt-2">
                      <Field label="Stage" w="code" required>
                        <LookupDialogPicker
                          kind="fabric_stage"
                          label="Stage"
                          compact
                          required
                          canCreate={perms.canCreate}
                          canEdit={perms.canEdit}
                          options={data.fabricStages}
                          value={l.stage_id}
                          onChange={(id) => setFabricStage(l, id)}
                        />
                      </Field>
                      <Field label="Form" w="hug">
                        <Select compact aria-label="Form" value={l.fabric_form} onChange={(e) => patchLine(l.key, { fabric_form: e.target.value })}>
                          <option value="" />
                          {FABRIC_FORM_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="GSM" w="num">
                        <Input className="text-right" inputMode="decimal" aria-label="GSM" value={l.gsm} onChange={(e) => patchLine(l.key, { gsm: e.target.value })} />
                      </Field>
                    </FieldRow>
                  </div>
                  {/* SHOWN WHENEVER A PICKER WOULD BE EMPTY — the rows are
                      added now, so "no rows yet" is no longer the signal. */}
                  {empty && (
                    <div className="px-3 py-2">
                      <p className="text-sm text-muted-foreground">{empty}</p>
                      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("bom")}>
                        Go to Fabric Plan
                      </Button>
                    </div>
                  )}
                  {rows.length > 0 && (
                    /* Opens on ONE blank row (`derivePlanRows`' seed) and grows by
                       "+ Add"; removing the last row leaves the blank one. */
                    <ChildGrid<PlanDisplayRow>
                      columns={consumptionColumns(l, rank, axes)}
                      rows={rows}
                      startIndex={0}
                      flatRows
                      frameless
                      addLabel="+ Add row"
                      onAdd={() => patchLine(l.key, { cells: addPlanRow(l.cells) })}
                      onRemove={(r) => patchLine(l.key, { cells: removePlanRow(l.cells, r.key) })}
                      totalsLabel="Fabric subtotal"
                      renderMobileRow={(r) => cardRowMobile(l, r, rank, axes)}
                    />
                  )}
                </div>
              );
            })}
          </div>
            </>
          )}
          {/* A sample plan lists what is owed only once Save was pressed with
              something missing; a production plan keeps it on screen (its
              2026-09-20 "where will it ask" note above). */}
          {consumptionNeeds.length > 0 && (!sample || needsAsked) && (
            <div className="mt-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
              <div className="font-semibold">Still needed before Save</div>
              <ul className="mt-0.5 space-y-0.5">
                {[...consumptionNeeds.map((p) => p.message), ...staleBlockers.map((b) => b.message)].map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "yarns",
      label: "Yarn Process",
      icon: Spool,
      done: yarnRows.some(yarnRowAnswered),
      content: (
        <SectionBody title="Yarn Process">
          {/* Three empty states, each fixed on a different screen — the order
              screen's own wording, with the door named. */}
          {yarnMode ? (
            yarnRows.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">Pick a yarn on Yarn Lines first.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("yarnLines")}>
                Go to Yarn Lines
              </Button>
              </div>
            ) : (
              <ProcessFoldList<YarnRow>
                columns={yarnColumns}
                rows={yarnRows}
                openKey={openYarnId === undefined ? (yarnRows[0]?.key ?? null) : openYarnId}
                onToggle={setOpenYarnId}
                renderPanel={yarnPanel}
              />
            )
          ) : !fabricIdKey ? (
            <div>
              <p className="text-sm text-muted-foreground">
                Name a fabric on Fabric Allocation first — the yarns come from what each fabric is made of.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                Go to Fabric Allocation
              </Button>
            </div>
          ) : !comp ? (
            <p className="text-sm text-muted-foreground">Reading the compositions…</p>
          ) : yarnRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None of these fabrics declares a composition, so there are no yarns to plan. Add the Mixing rows on
              Master Data ▸ Materials.
            </p>
          ) : (
            <ProcessFoldList<YarnRow>
              columns={yarnColumns}
              rows={yarnRows}
              openKey={openYarnId === undefined ? (yarnRows[0]?.key ?? null) : openYarnId}
              onToggle={setOpenYarnId}
              renderPanel={yarnPanel}
            />
          )}
        </SectionBody>
      ),
    },
    {
      key: "process",
      label: "Fabric Process",
      icon: Waypoints,
      done: procs.some((p) => !!p.process_id),
      content: (
        <SectionBody title="Fabric Process">
          {fabricRouteRows.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                Name a fabric on Fabric Allocation first — each one gets its own route here.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                Go to Fabric Allocation
              </Button>
            </div>
          ) : (
            <ProcessFoldList<FabricRouteRow>
              columns={fabricRouteColumns}
              rows={fabricRouteRows}
              openKey={openFabricId === undefined ? (fabricRouteRows[0]?.key ?? null) : openFabricId}
              onToggle={setOpenFabricId}
              foldHeader="Process"
              foldSummary={(r) => {
                const steps = routeStepCount(procs.filter((p) => p.item_id === r.item_id));
                return steps ? `${steps} step${steps === 1 ? "" : "s"}` : "No route yet";
              }}
              renderPanel={(r) => (
                // ONE GRID PER FABRIC, no Route-per toggle and no Source strip:
                // an IWO has no colourways or components to split by, and the
                // order screen's Source control is hidden (its default,
                // yarn_knit, is the only answer there too).
                <FabricProcessGrid
                  itemId={r.item_id}
                  colours={null}
                  components={null}
                  rows={procs.filter((p) => p.item_id === r.item_id)}
                  onChange={(next) => setFabricProcs(r.item_id, next)}
                  processes={data.processes}
                  // A GREIGE fabric is offered the Greige stage only (Phase 2),
                  // so its processes narrow to greige ones (Knitting) through
                  // the grid's own stage → process rule. A stage a step already
                  // holds survives ("Disabled rows"), and the rule above says
                  // why it has to go.
                  lookups={
                    isGreigeFabric(r.item_id)
                      ? {
                          ...data.processLookups,
                          stages: data.processLookups.stages.filter(
                            (st) =>
                              stageRank(st) === 0 ||
                              procs.some((p) => p.item_id === r.item_id && p.stage_id === st.id),
                          ),
                        }
                      : data.processLookups
                  }
                  printDeclared={printDeclared}
                  fabricIsYarnDyed={isYarnDyed(fabricTypeOf(r.item_id))}
                  fabricIsPieceDyed={isPieceDyed(fabricTypeOf(r.item_id))}
                  /* 0636 — only a linked loose fabric's route may run CONVERSION. */
                  looseFabricRoute={looseFabricIds.has(r.item_id)}
                  source="yarn_knit"
                  /* 0613 — COLOR WISE lists this fabric's line Colours, each
                     with its own loss (the order screen passes `r.combos`; an
                     IWO's buckets are its lines' Colours). A GREIGE fabric has
                     no Colour by rule, so the control says so rather than
                     listing nothing. */
                  lossColours={lineColoursOf(r.item_id)}
                  newKey={newKey}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  readOnly={!perms.canEdit && !perms.canCreate}
                />
              )}
            />
          )}
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={sample ? "Fabric Plan" : "IWO Fabric Plan"}
          description={
            sample
              ? "The yarn and fabric plan for a sample work order — the same plan the Orders module opens as the IWO Fabric Plan, listing the work orders raised from Sample."
              : "The Fabric Plan for an Internal Work Order For Yarn or Fabric — no garment breakdown; the weight is typed."
          }
          actions={perms.canCreate ? <Button onClick={() => openNew(null)}>+ New Fabric Plan</Button> : undefined}
        />
        <FilterBar
          leading={quick.segment}
          search={listQuery}
          onSearch={setListQuery}
          searchPlaceholder={sample ? "Search SWO No…" : "Search I.WO No, RE No or remarks…"}
          activeCount={listFacets.activeCount}
          onReset={listFacets.activeCount ? listFacets.reset : undefined}
          panel={listFacets.panel}
          right={`${listed.length} of ${tasks.length}`}
        />
        {sample ? (
          /* SAMPLE ▸ FABRIC PLAN AS CARDS (user 2026-10-12; plan "Sample card
             queues") — one card per SWO, its SMP numbers under the number, as
             Orders ▸ Fabric Plan lists garment orders. Fabric kg is the plan's
             Req Wt once it has one, else the kilos the SWO batched. */
          <SampleCards<IwoFabricBomTask>
            rows={listed}
            getKey={(t) => t.id}
            title={(t) => <span className="font-mono">{t.swo?.code ?? t.code ?? "—"}</span>}
            subtitle={(t) => (
              <span className="font-mono">{t.swo?.samples.map((x) => x.smp_no ?? x.sample_no).filter(Boolean).join(" · ") || "—"}</span>
            )}
            // A SAVED SAMPLE PLAN IS COLOURED BY ITS APPROVAL (2026-10-13): the
            // box's word put every saved plan in green — "Not submitted",
            // "Revision 1 open" and "Sent back" read as done. Green is approved,
            // red is sent back (the planner owes the next step), the rest neutral.
            state={(t): SampleCardState => {
              const word = bomWord(t);
              if (word !== "updated" || !t.bom) return ({ pending: "pending", draft: "draft", updated: "updated" } as const)[word];
              if (t.bom.approval_status === "approved") return "updated";
              if (t.bom.approval_status === "returned") return "pending";
              return "neutral";
            }}
            // A saved sample plan's word is its APPROVAL (0718) — "Saved" alone
            // says nothing about whether its yarn may be bought.
            pillText={(t) =>
              !t.bom ? "Not started" : t.bom.is_draft ? "Draft" : fabricPlanApprovalLabel(t.bom.approval_status, t.bom.revision_no)
            }
            stats={(t) => {
              const planned = (t.bom?.iwo_fabric_bom_lines ?? []).reduce((a, l) => a + (Number(l.req_kgs) || 0), 0);
              const batched = (t.swo?.samples ?? []).reduce((a, x) => a + x.kg, 0);
              return [
                { label: "Samples", value: String(t.swo?.samples.length ?? 0) },
                { label: "Fabric kg", value: (planned > 0 ? planned : batched).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), lead: true },
                { label: "Deli Dt", value: t.deli_date ? fmtDate(t.deli_date) : "—" },
              ];
            }}
            // A saved plan opens for anyone who can see it — the lock and
            // `viewOnly` decide what they may change.
            onOpen={(t) => (t.bom ? true : perms.canCreate) && openTask(t)}
            footerNote={hasCreatedInfo(tasks) ? (t) => `Created ${createdMeta(t)}` : undefined}
            canDelete={perms.canDelete}
            canDeleteRow={(t) => !!t.bom && t.bom.approval_status !== "submitted" && t.bom.approval_status !== "approved"}
            onDelete={del}
            onReports={(t) => t.bom && router.push(planReportHref("fabric", t.bom.id))}
            canReportsRow={(t) => !!t.bom && !t.bom.is_draft}
            onSend={sendPlan}
            canSendRow={canSendPlan}
            isPending={isPending}
            // Updated is done work — a table, as Orders draws it; Pending and
            // Draft stay cards (user 2026-10-13).
            table={quick.value === "updated" ? { title: "SWO No", subtitle: "SMP No" } : undefined}
            empty={
              !tasks.length
                ? "No sample work orders For Yarn or Fabric at this unit yet — + New Fabric Plan raises one."
                : quick.value
                  ? `No ${quick.value} work orders${listFacets.activeCount || listQuery ? " match these filters" : ""}.`
                  : "No work orders match these filters."
            }
          />
        ) : (
        <DataTable
          columns={withCreatedColumns(columns, tasks)}
          rows={listed}
          getKey={(t) => t.id}
          empty={
            !tasks.length
              ? sample
                ? "No sample work orders For Yarn or Fabric at this unit yet — + New Fabric Plan raises one."
                : "No Internal Work Orders For Yarn or Fabric at this unit yet."
              : quick.value
                ? `No ${quick.value} work orders${listFacets.activeCount || listQuery ? " match these filters" : ""}.`
                : "No work orders match these filters."
          }
        />
        )}
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => leaveEditor()}
        modeLabel={
          <>
            {editId ? "Editing" : "New"} <span className="font-semibold text-foreground">IWO fabric BOM</span>
          </>
        }
        header={{
          initials: "FB",
          title: (sample ? (picked?.swo?.code ?? picked?.code) : picked?.code) ?? "New Fabric Plan",
          badges: (
            <>
              {/* A production plan never has an approval to show; a sample one
                  shows it on either route. */}
              {planStatus && planBom && !planBom.is_draft && (sample || planStatus !== "open") ? (
                <StatusPill tone={planTone(planStatus, planRev)}>{fabricPlanApprovalLabel(planStatus, planRev)}</StatusPill>
              ) : null}
              {dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null}
            </>
          ),
          meta: (
            <>
              <span>
                {sample
                  ? picked
                    ? `${swo?.samples.length ?? 0} sample${swo?.samples.length === 1 ? "" : "s"}`
                    : "No SWO chosen"
                  : picked
                    ? `For ${IWO_FOR_LABELS[picked.iwo_for]}`
                    : "No work order chosen"}
              </span>
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
              {/* Why it is open again, or what the approver said — the two
                  things the planner needs before touching a reopened plan. */}
              {openRevision ? <span>· Revision {planRev}: {openRevision.reason}</span> : null}
              {planStatus === "returned" && planBom?.decision_remark ? (
                <span className="text-warning">· Sent back: {planBom.decision_remark}</span>
              ) : null}
            </>
          ),
          // REPORT LIVES ON THE LIST (user 2026-10-14: "no need inside"); SUBMIT
          // IS ON BOTH — the footer, in Save's place once saved, and the card's
          // Send icon, so a saved plan never has to be reopened to go.
        }}
        // A SUBMITTED OR APPROVED SAMPLE PLAN IS LOCKED (0718): read-only, one
        // Close, the reason at the top — and the way on at its right: the
        // approver's decision, or Raise Revision once approved.
        locked={
          planLockMessage
            ? {
                message: planLockMessage,
                action:
                  decide ??
                  (planStatus === "approved" && perms.canEdit ? (
                    <Button
                      variant="outline"
                      onClick={(e) => setRevisionOrigin(e.currentTarget.getBoundingClientRect())}
                    >
                      Raise Revision
                    </Button>
                  ) : undefined),
              }
            : false
        }
        viewOnly={!!editId && !perms.canEdit}
        // A Yarn IWO BYPASSES the fabric sections (screenshot 2937); a Fabric one
        // has no Yarn Lines grid — its yarns are derived from the cloths.
        sections={sections
          .filter((sec) =>
            yarnMode ? !["lines", "consumption", "process"].includes(sec.key) : sec.key !== "yarnLines",
          )
          // NOTHING IN A LOCKED PLAN TAKES INPUT — see PlanLockFence.
          .map((sec) => ({ ...sec, content: <PlanLockFence locked={planLocked}>{sec.content}</PlanLockFence> }))}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New Fabric Plan",
          onCancel: () => leaveEditor(),
          onSave: () => submit(false),
          // ONE "Save" on a sample plan (client spec 2026-10-12 §7: "Costing,
          // Grouping and Fabric Plan … a simple Save button"), no Save as Draft.
          // Orders ▸ IWO Fabric Plan keeps both.
          onSaveDraft: perms.canCreate && !sample ? () => submit(true) : undefined,
          saveLabel: sample ? "Save" : "Save Fabric Plan",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          // Saved and untouched: Submit stands where Save stood (user 2026-10-14).
          submit: canSubmitPlan ? { label: "Submit for Approval", onClick: submitPlan } : null,
          isPending,
        }}
      />

      {sample && editId && revisionOrigin !== undefined && (
        <PlanRevisionSheet
          kind="fabric"
          bomId={editId}
          planLabel={planLabel}
          nextRevision={planRev + 1}
          origin={revisionOrigin}
          onClose={() => setRevisionOrigin(undefined)}
          onRaised={() => {
            setRevisionOrigin(undefined);
            loadApproval(editId);
            router.refresh();
          }}
        />
      )}

      {sample && colourLine && colourFor && (
        <SmpColourSheet
          open
          onClose={() => setColourFor(null)}
          origin={colourOrigin}
          subtitle={[swoSampleLabel(colourFor.smp), fabricNameOf(colourLine), colourLine.gsm ? `GSM ${colourLine.gsm}` : ""].filter(Boolean).join(" · ")}
          blocks={smpGroups(colourLine.cells, colourFor.smp).map((g) => ({
            grp: g.grp,
            color_name: g.color_name,
            print_name: g.print_name,
            dias: g.keys.map((k) => ({ key: k, finish_dia: colourLine.cells[k]?.finish_dia ?? "", req_kgs: colourLine.cells[k]?.req_kgs ?? "" })),
          }))}
          greige={fabricStageRank(colourLine.stage_id) === 0}
          withPrint={fabricStageRank(colourLine.stage_id) === 2}
          colours={fabricColourNames}
          prints={printNames}
          dias={familyDias(diaDeclarations, lineKnitCode(colourLine))}
          diaHint={`No ${knitLabel(lineKnitCode(colourLine)) ? `${knitLabel(lineKnitCode(colourLine))} ` : ""}dia is declared for this fabric — add one on the Fabric Plan section's Dia / Size Width panel.`}
          grossOf={(w, colour) => grossOf(colourLine.item_id, w, colour || null)}
          onColour={(grp, v) => patchLine(colourLine.key, { cells: patchSmpGroup(colourLine.cells, grp, { color_name: v }) })}
          onPrint={(grp, v) => patchLine(colourLine.key, { cells: patchSmpGroup(colourLine.cells, grp, { print_name: v }) })}
          onDia={(k, patch) => patchLine(colourLine.key, { cells: patchSmpDia(colourLine.cells, k, patch) })}
          onAddDia={(grp) => patchLine(colourLine.key, { cells: withOnlyDia(colourLine, colourLine.cells, addSmpDia(colourLine.cells, grp)) })}
          onRemoveDia={(k) => patchLine(colourLine.key, { cells: removeSmpDia(colourLine.cells, k) })}
          onAddColour={() => {
            const { cells } = addSmpGroup(colourLine.cells, colourFor.smp);
            patchLine(colourLine.key, { cells: withOnlyDia(colourLine, colourLine.cells, cells) });
          }}
          onRemoveColour={(grp) => patchLine(colourLine.key, { cells: removeSmpGroup(colourLine.cells, grp) })}
        />
      )}
      <YarnShadesSheet
        open={!!shadeLine}
        onClose={() => setShadesFor(null)}
        origin={shadesOrigin}
        yarnName={shadeLine?.item_id ? (yarnById.get(shadeLine.item_id)?.name ?? "") : ""}
        colourBy={shadeLine?.colour_by || null}
        rows={shadeLine?.shades ?? []}
        onChange={(next) => shadeLine && patchYarnLine(shadeLine.key, { shades: next })}
        colours={yarnColourNames}
        purchaseOf={
          shadeLine?.colour_by === "dyed_purchase" ? (c) => shadeQty?.[normName(c)] ?? null : null
        }
        newKey={newKey}
        readOnly={!perms.canEdit && !perms.canCreate}
      />

      <YarnDyedSheet
        open={!!ydFor}
        onClose={() => setYdFor(null)}
        origin={ydOrigin}
        title={`Yarn Dyed Details${ydFor ? ` — ${fabricById.get(ydFor)?.name ?? "(no fabric)"}` : ""}`}
        ydRepeats={ydFor ? ydRepeats.filter((r) => r.item_id === ydFor) : []}
        ydCombinations={ydFor ? ydCombinations.filter((c) => c.item_id === ydFor) : []}
        yarnOptions={ydYarnOptions}
        // An IWO has no colourway: a combination is keyed by the fabric line's
        // COLOUR, the bucket `iwoFabricGross` makes — so the Fabric Colour panel.
        comboOptions={fabricColourNames}
        yarnColourOptions={yarnColourNames}
        composition={ydFor ? (compositionById.get(ydFor) ?? null) : null}
        yarnName={ydYarnName}
        onPatchYdRepeat={(key, patch) => mutYdRepeats((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))}
        // Declines with nothing open — the order screen's note: the panel is
        // mounted while closed, and answering its seed would dirty the form.
        onAddYdRepeat={() => {
          if (!ydFor) return;
          const itemId = ydFor;
          mutYdRepeats((xs) => [
            ...xs,
            {
              key: newKey(),
              item_id: itemId,
              sno: 0,
              yarn_item_id: null,
              dye_type: "dyed",
              color_name: "",
              uom_id: null,
              value: null,
              twisted_yarn: "",
            },
          ]);
        }}
        onRemoveYdRepeat={(row) => mutYdRepeats((xs) => xs.filter((x) => x.key !== row.key))}
        onPatchYdCombination={(key, patch) =>
          mutYdCombinations((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
        }
        onAddYdCombination={() => {
          if (!ydFor) return;
          const itemId = ydFor;
          mutYdCombinations((xs) => [...xs, { key: newKey(), item_id: itemId, combo: "", yd_combo_name: "", colors: [] }]);
        }}
        onRemoveYdCombination={(row) => mutYdCombinations((xs) => xs.filter((x) => x.key !== row.key))}
        onPatchYdCombinationColorAt={(comboKey, index, yarn_color) =>
          mutYdCombinations((xs) =>
            xs.map((x) => {
              if (x.key !== comboKey) return x;
              const colors = [...x.colors];
              while (colors.length <= index) colors.push({ key: newKey(), yarn_color: "", dyeing_loss_pct: null });
              colors[index] = { ...colors[index], yarn_color };
              return { ...x, colors };
            }),
          )
        }
      />
    </>
  );
}
