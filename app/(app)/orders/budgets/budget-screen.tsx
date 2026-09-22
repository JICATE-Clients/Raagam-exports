"use client";

/**
 * Orders ▸ Budgeting — step 5 of the client's order flow (0428).
 *
 * A budget covers a GROUP of garment orders, costs them from their Fabric and
 * Material BOMs, and is submitted for approval (step 6, `/orders/budget-approval`).
 *
 * ## THE RAIL IS THE LEGACY BUDGET'S TAB STRIP (2026-09-18)
 *
 * Budget · Orders · Purchase Rates · Process Rates · CMTs · Other Expenses ·
 * Other Incomes — the client's blueprint, with the rail standing in for its top
 * tabs (`raagam-screen-layout`, rule 1). Every section after Orders is drawn
 * from `BUDGET_SECTIONS`, which is also the engine's partition of the sources,
 * so a line can never be costed into the total from a section nobody can open.
 * Purchase Rates carries the blueprint's child tabs (Yarn / Fabric /
 * Accessories) as a `Tabs` strip, one grid per source.
 *
 * The old Summary section is gone: its figures are the pinned bottom bar
 * (`BudgetSummaryBar`, `MasterFullScreen`'s `summary`), visible from every
 * section — which is where a margin has to be to watch it move as a rate is
 * typed. `doc/order/budget-purchase-rates.md` has the plan.
 *
 * ## SUBMIT IS IN THE HEADER, NEVER THE FOOTER
 *
 * `submitTargetOf` takes the footer's LAST non-disabled button, so a workflow
 * button placed after Save means Enter off the last field submits the document
 * for approval instead of saving it. doc/orders-six-step.md records this about
 * the Approve bar and it is the same hazard one step earlier. Copy From sits
 * beside it for the same reason.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Coins,
  Copy,
  Factory,
  PieChart,
  HandCoins,
  Receipt,
  RotateCcw,
  Scissors,
  Send,
  ShoppingCart,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Tabs } from "@/components/ui/tabs";
import {
  Field,
  FieldGrid,
  FieldRow,
  FieldError,
  FIELD_WIDTH_CSS,
  RequiredScope,
} from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { isInactive } from "@/lib/masters/inactive";
import { ProcessFoldList, type FoldListColumn } from "@/components/orders/process-fold-list";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  BUDGET_SECTIONS,
  BUDGET_SOURCES,
  carryRate,
  CMT_OPERATIONS,
  cmtBreakupTotal,
  isRefusal,
  lineAmount,
  lineInrRate,
  lineProblem,
  lineReqd,
  PROCESS_TABS,
  PULLED_SOURCES,
  PURCHASE_TABS,
  salesBaseOf,
  splitFabricProcess,
  type BudgetLineInput,
  type BudgetSectionKey,
  type BudgetSource,
  type CmtOperationKey,
  type FabricProcessRow,
  type LineField,
  type ProcessBasis,
} from "@/lib/orders/budget/totals";
import { copyRatesFrom } from "@/lib/orders/budget/copy-from";
import {
  mergeKey,
  mergePulled,
  pullMergeIsEmpty,
  pullMergeSize,
} from "@/lib/orders/budget/pull-merge";
import {
  BUDGET_LINE_BASES,
  budgetStatusText,
  budgetStatusTone,
  canDeleteBudget,
  canReopen,
  canTransition,
  type BudgetLineBasis,
  type BudgetRateType,
  type BudgetableOrder,
  type BudgetStatus,
  type OrderBudget,
} from "@/lib/orders/budget/types";
import type { BudgetFormData } from "@/lib/orders/budget/service";
import {
  createOrderBudget,
  deleteOrderBudget,
  loadBudgetLinesForCopy,
  loadCostLines,
  loadFabricProcessBreakdown,
  reopenBudget,
  submitBudget,
  updateOrderBudget,
} from "@/lib/orders/budget/actions";
import {
  AMENDMENT_SOURCES,
  AMENDMENT_TYPES,
  compareToBaseline,
  type BudgetBaseline,
} from "@/lib/orders/budget/amendment";
import { ReopenBudgetSheet, type ReopenAnswers } from "./reopen-budget-sheet";
import { BudgetSummaryBar } from "./budget-summary-bar";
import { BudgetGeneral } from "./budget-general";
import {
  budgetFigures,
  groupSqQtyOf,
  lineInputOf,
  orderInputsOf,
} from "@/lib/orders/budget/figures";
import { CopyFromSheet } from "./copy-from-sheet";
import { BudgetQueue } from "./budget-queue";
import { breakupOf, CmtBreakupSheet, type CmtBreakupValues } from "./cmt-breakup-sheet";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean };

type OrderRow = { key: string; garment_order_id: string | null };

type CostRow = {
  key: string;
  source: string;
  garment_order_id: string | null;
  item_id: string | null;
  description: string;
  qty: string;
  uom_id: string | null;
  /** In the LINE's currency (0572) — `currency_code` blank means INR. */
  rate: string;
  specification: string;
  /** "" = INR, which is what every line saved before 0572 was. */
  currency_code: string;
  ex_rate: string;
  is_foc: boolean;
  is_import: boolean;
  /* 0573 — Process Rates. */
  process_id: string | null;
  /** The line's grain: `process` / `fabric` / `color` / `part`. */
  basis: BudgetLineBasis | null;
  combo: string | null;
  rate_type: RateType;
  /** Garment Processes only — blank means 1 (`lineReqd`). */
  no_of_pcs: string;
  no_of_units: string;
  /** Garment Processes: which style and which component the step is for.
   *  Not on screen — carried so a pulled line saves as it was pulled. */
  style_ref_no: string | null;
  component_id: string | null;
  /** Other Expenses / Other Incomes' head — a `config_lookups` row (0575). */
  cost_head_id: string | null;
  /** Yarn / Fabric Purchases' Stage — a `yarn_stage` / `fabric_stage` lookup
   *  row (0590). NOT read by `isBlankLine`: a stage alone is not a typed line. */
  stage_id: string | null;
  /** Pulled from a BOM (0591). Its item, description, qty, unit, stage and
   *  colour are the BOM's and read-only here (`bomLocked`); only the rate and
   *  its terms are typed. False on every line typed by hand. */
  from_bom: boolean;
  /**
   * Other Expenses' Type — SCREEN STATE, NEVER SENT. The scope is what is
   * stored (doc "Phase 4"): no order = SQ Wise, an order = Order Wise, an
   * order and a style = Style Wise. It is held here as well only so a Type
   * chosen before its Order is picked stays chosen — derived alone, Order Wise
   * with no order yet would read straight back as SQ Wise under the cursor.
   */
  scope: Scope;
} & CmtBreakupValues;

type Scope = "sq" | "order" | "style";
const scopeOfLine = (l: { garment_order_id: string | null; style_ref_no?: string | null }): Scope =>
  !l.garment_order_id ? "sq" : l.style_ref_no ? "style" : "order";

type RateType = BudgetRateType;

/** One (order, process) group of `loadFabricProcessBreakdown`'s answer. */
type FabricBreakdownGroup = {
  garment_order_id: string;
  process_id: string;
  process_name: string;
  uom_id: string | null;
  rows: FabricProcessRow[];
};

type Form = {
  budget_date: string;
  description: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({
  budget_date: today(),
  description: "",
});

const blankCost = (key: string, source: BudgetSource): CostRow => ({
  key,
  source,
  garment_order_id: null,
  item_id: null,
  description: "",
  // 1 IS PRE-FILLED, VISIBLY, for a typed line. `lineAmount` refuses a blank
  // quantity and says "use 1 for a lump sum"; putting the 1 in the box is that
  // sentence made unnecessary rather than a silent default the operator cannot
  // see. A pulled line overwrites it with the BOM's real figure.
  //
  // IT IS THE ONE TRUTHY KEY THIS FACTORY STAMPS, and that is safe only because
  // `isBlankLine` never reads `qty` (AGENTS.md "THE SEEDED ROW IS SAVED UNLESS
  // THE SAVE SIDE DROPS IT"). Add qty to that test and every untouched seeded
  // row is saved as a phantom line.
  qty: "1",
  uom_id: null,
  rate: "",
  specification: "",
  currency_code: "",
  ex_rate: "",
  is_foc: false,
  is_import: false,
  process_id: null,
  basis: null,
  combo: null,
  // THE SECOND TRUTHY KEY, and safe for the same reason as `qty`: it is the
  // column's own default (0573), and `isBlankLine` never reads it.
  // AN INCOME DEFAULTS TO A PERCENTAGE — drawback and RoDTEP are percentages
  // of the sale (doc "Phase 4"). Safe for the same reason, never read by
  // `isBlankLine`.
  rate_type: source === "income" ? "percent" : "per_unit",
  no_of_pcs: "",
  no_of_units: "",
  style_ref_no: null,
  component_id: null,
  cost_head_id: null,
  stage_id: null,
  from_bom: false,
  scope: "sq",
  cutting_rate: "",
  making_rate: "",
  checking_rate: "",
  ironing_rate: "",
  packing_rate: "",
});

/**
 * "Did anybody enter this line?" — the save-side blank-row filter.
 *
 * Every table opens with a seeded blank row (AGENTS.md "Editable sub-tables
 * open with a row"; `SEEDED_SOURCES`), so an untouched one must be DROPPED rather than
 * saved, priced or counted. It tests only what an operator has to type — the
 * item or process, its description or specification, the rate. Never `qty`
 * (the factory stamps 1), never `rate_type` (it stamps per_unit), never
 * `source` or `basis` (every row has one), never a toggle.
 *
 * The same test keeps the seeded row out of `budgetTotals`, or every budget
 * would open with nine "unpriced" lines nobody wrote and a Save that refused.
 */
const isBlankLine = (c: CostRow) =>
  !c.item_id &&
  !c.process_id &&
  !c.cost_head_id &&
  !c.description.trim() &&
  !c.specification.trim() &&
  !c.rate.trim();

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * A stored or pulled line, as the screen's row. ONE mapping for the three doors
 * a line comes in by — opening a budget, pulling from the BOMs, re-splitting a
 * fabric process — so a column added to the line cannot reach one of them and
 * silently not the others. Every 0572/0573 field is optional here: a pulled line
 * that has no opinion on a field gets the same value a blank row does.
 */
type LineLike = {
  source: string;
  garment_order_id: string | null;
  item_id: string | null;
  description: string | null;
  qty: number | null;
  uom_id: string | null;
  rate: number | null;
  specification?: string | null;
  currency_code?: string | null;
  ex_rate?: number | null;
  is_foc?: boolean | null;
  is_import?: boolean | null;
  process_id?: string | null;
  basis?: string | null;
  combo?: string | null;
  rate_type?: string | null;
  no_of_pcs?: number | null;
  no_of_units?: number | null;
  style_ref_no?: string | null;
  component_id?: string | null;
  cost_head_id?: string | null;
  stage_id?: string | null;
  from_bom?: boolean | null;
} & Partial<Record<CmtOperationKey, number | null>>;

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

/**
 * SOURCES PRICED IN RUPEES ONLY — CMT and garment processes, both labour on
 * the garments, quoted by job workers in INR (the client's CMT and Garment
 * Processes blueprints carry no currency column). Their grids draw no Curr /
 * Ex Rate, so a line of these sources is held at INR everywhere a currency
 * could otherwise creep in: on load, on save and on Copy From.
 */
const INR_ONLY_SOURCES: ReadonlySet<string> = new Set(["cmt", "garment_process"]);

const rowOf = (key: string, l: LineLike): CostRow => ({
  key,
  source: l.source,
  garment_order_id: l.garment_order_id,
  item_id: l.item_id,
  description: l.description ?? "",
  qty: str(l.qty),
  uom_id: l.uom_id,
  rate: str(l.rate),
  specification: l.specification ?? "",
  // An INR-only source opens in rupees even if an older save said otherwise.
  currency_code: INR_ONLY_SOURCES.has(l.source) ? "" : (l.currency_code ?? ""),
  ex_rate: INR_ONLY_SOURCES.has(l.source) ? "" : str(l.ex_rate),
  is_foc: !!l.is_foc,
  is_import: !!l.is_import,
  process_id: l.process_id ?? null,
  basis: (BUDGET_LINE_BASES as readonly string[]).includes(l.basis ?? "")
    ? (l.basis as BudgetLineBasis)
    : null,
  combo: l.combo ?? null,
  rate_type: l.rate_type === "flat" || l.rate_type === "percent" ? l.rate_type : "per_unit",
  no_of_pcs: str(l.no_of_pcs),
  no_of_units: str(l.no_of_units),
  style_ref_no: l.style_ref_no ?? null,
  component_id: l.component_id ?? null,
  cost_head_id: l.cost_head_id ?? null,
  stage_id: l.stage_id ?? null,
  from_bom: !!l.from_bom,
  scope: scopeOfLine(l),
  cutting_rate: str(l.cutting_rate),
  making_rate: str(l.making_rate),
  checking_rate: str(l.checking_rate),
  ironing_rate: str(l.ironing_rate),
  packing_rate: str(l.packing_rate),
});

/** A Fabric Processes group — every line of one process on one order. The
 *  legacy `+` row is this GROUP, not a stored row (doc: "Phase 2"). */
const fabricGroupKey = (l: { garment_order_id: string | null; process_id?: string | null }) =>
  `${l.garment_order_id ?? ""}|${l.process_id ?? ""}`;

/** One row as the engine reads it — `figures.ts`'s mapping, the same one the
 *  submitted summary and the approved baseline are built with. */
const lineInput = (c: CostRow): BudgetLineInput => lineInputOf(c);

/** Which rail section shows a line of this source. */
const sectionOfSource = (source: string): BudgetSectionKey =>
  BUDGET_SECTIONS.find((s) => (s.sources as readonly string[]).includes(source))?.key ?? "expense";

/**
 * EVERY TABLE OPENS WITH A ROW — one per SOURCE, because every source is its own
 * grid (a Purchase Rates or Process Rates tab, CMTs, Other Expenses / Incomes).
 *
 * It used to be one per SECTION, and only for a section holding a TYPED source,
 * so Purchase Rates, Process Rates and CMTs — all pulled from the BOMs — opened
 * as a bare header and "+ Add line" (user 2026-09-19, screenshot 2949: "every
 * table first row in closed state make it open"). Pulled describes where a line
 * USUALLY comes from, not a ban on typing one: each of those grids takes a
 * hand-added line, so each is a typing surface and AGENTS.md's default row
 * applies to it.
 *
 * `fabric_process` is the one exemption, and it is structural: its tab is a
 * fold list whose lines come only from the Fabric BOM's split (`hideAdd`,
 * `onAdd={() => false}`), so there is nothing a typed row could be.
 * default-row: exempt -- Fabric Processes cannot grow; its lines are the BOM split
 */
// Other Incomes is not a table on this screen any more (client, 2026-09-19).
const SEEDED_SOURCES: readonly BudgetSource[] = BUDGET_SOURCES.filter(
  (s) => s !== "fabric_process" && s !== "income",
);
const isSeeded = (source: string) => (SEEDED_SOURCES as readonly string[]).includes(source);

/** A new row of this source — the ONE factory the seed, "+ Add line" and the
 *  last-row refill all use. A garment step typed by hand is priced once per
 *  process (`basis` 'process', the Processwise grain); safe on a seeded row
 *  because `isBlankLine` never reads `basis`. */
const blankFor = (key: string, source: BudgetSource): CostRow => ({
  ...blankCost(key, source),
  ...(source === "garment_process" ? { basis: "process" as const } : {}),
});

/** A line's grain, in the legacy For column's words. `part` is a garment step
 *  done to a component (0573). */
const BASIS_LABELS: Record<BudgetLineBasis, string> = {
  process: "Processwise",
  fabric: "Fabricwise",
  color: "Colorwise",
  part: "Partwise",
};

type FabricGroup = {
  key: string;
  garment_order_id: string | null;
  process_id: string | null;
  lines: CostRow[];
};

const BLANK_BREAKUP: CmtBreakupValues = {
  cutting_rate: "",
  making_rate: "",
  checking_rate: "",
  ironing_rate: "",
  packing_rate: "",
};

const SECTION_ICONS: Record<BudgetSectionKey, LucideIcon> = {
  purchase: ShoppingCart,
  process: Factory,
  cmt: Scissors,
  expense: Receipt,
  income: HandCoins,
};

/**
 * A column plus WHEN its cell is mandatory, per row. `ChildGridColumn.required`
 * is one answer for the whole column, and two of these cells are mandatory only
 * for some rows: Rate is not on a free-of-cost line, and Ex Rate only once a
 * foreign currency is chosen. Read in ONE place — the row renderer below — which
 * draws the star and hands the same answer to the control's own `required`.
 */
type CostCol = ChildGridColumn<CostRow> & {
  requiredFor?: (r: CostRow) => boolean;
  /**
   * A cell that exists for SOME rows only. CMTs is the case: a pulled line is
   * bound to a style, and its Style / Article / SC No / Coordinate / Order Qty
   * cells describe that style; a hand-added line has no style and shows none
   * of them — rather than five dashes the operator would read as missing data.
   */
  showFor?: (r: CostRow) => boolean;
  /** The label for this row, where the column's header does not fit it — the
   *  hand-added CMT line's first cell is its Description, not a Style Ref No. */
  labelFor?: (r: CostRow) => string;
};

/**
 * A cost grid's per-ROW rules, applied once to its column list.
 *
 * `requiredFor` — a cell mandatory for SOME rows (Rate, not on a FOC line;
 * Ex Rate, only in a foreign currency). The column declares `required` so the
 * TABLE header draws its star, and the cell restates the ROW's answer in its
 * own `RequiredScope`, which overrides the column's — context resolves to the
 * nearest provider. Without the inner scope the column's `required` would hold
 * the cursor on every seeded blank row.
 *
 * `showFor` — a cell that exists for some rows only renders nothing on the
 * others, so a table column stays aligned with an empty cell.
 *
 * Every cost grid's `…Columns` array is `withRowRules([...])`, so the list
 * `check:grid-budget` measures is the list the grid renders.
 */
function withRowRules(columns: CostCol[]): CostCol[] {
  return columns.map((c) => {
    const requiredFor = c.requiredFor;
    const showFor = c.showFor;
    if (!requiredFor && !showFor) return c;
    return {
      ...c,
      required: requiredFor ? true : c.required,
      cell: (r: CostRow, i: number) =>
        showFor && !showFor(r) ? null : requiredFor ? (
          <RequiredScope required={requiredFor(r)} label={c.header}>
            {c.cell(r, i)}
          </RequiredScope>
        ) : (
          c.cell(r, i)
        ),
    };
  });
}

/**
 * EVERY cost grid's stacked row, below its `tableFrom` — the labels and cells
 * read off the SAME columns the table draws, never retyped beside them.
 *
 * `required` IS DECLARED TWICE, as AGENTS.md requires of a grid that renders
 * its own row: the `Field` draws the star from `requiredFor(row)`, and the cell
 * carries its own `RequiredScope` from `withRowRules`, so the hold is on the
 * control. This one function is every cost grid's `renderMobileRow`, which is
 * why the `grid-required-mobile` exemption below names it.
 */
// grid-required-mobile: exempt -- every cost grid's renderMobileRow is costCard(), which declares `required` on each Field from requiredFor(row), and withRowRules() gives each such cell its own RequiredScope, so the star and the hold come from one declaration
function costCard(columns: CostCol[], row: CostRow, i: number) {
  return (
    <FieldGrid>
      {columns.map((c, ci) =>
        c.showFor && !c.showFor(row) ? null : (
          <Field
            key={ci}
            label={c.labelFor ? c.labelFor(row) : c.header}
            required={c.requiredFor ? c.requiredFor(row) : c.required}
            size="sm"
          >
            {c.cell(row, i)}
          </Field>
        ),
      )}
    </FieldGrid>
  );
}

/**
 * A SEEDED ROW HOLDS NOTHING until something is typed on it. The Rate and Qty
 * holds exist to finish a line the operator STARTED; on an untouched blank row
 * in Other Incomes they would cage the operator in a section they had no reason
 * to fill (AGENTS.md: "a seeded row's cells are marked `required` only where the
 * record truly needs a line").
 *
 * A FLAT line needs no quantity: its rate IS the charge (0573), so a blank Reqd
 * there is not an unfinished line.
 */
const qtyRequired = (r: CostRow) => r.rate_type === "per_unit" && !isBlankLine(r);
const rateRequired = (r: CostRow) => !r.is_foc && !isBlankLine(r);
const exRateRequired = (r: CostRow) => !!r.currency_code && !isBlankLine(r);

export function BudgetScreen({
  budgets,
  data,
  perms,
  masterPerms,
  openId = null,
}: {
  budgets: OrderBudget[];
  data: BudgetFormData;
  perms: Perms;
  /** The head pickers add and rename `config_lookups` rows — MASTER data. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
  /** A budget to open in the editor on arrival (`/orders/budgets?budget=<id>`,
   *  from the Approval queue's Edit icon). Read once, on mount. */
  openId?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError, toast } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [status, setStatus] = useState<BudgetStatus>("draft");
  const [form, setForm] = useState<Form>(BLANK);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [purchaseTab, setPurchaseTab] = useState<string>(PURCHASE_TABS[0].source);
  const [processTab, setProcessTab] = useState<string>(PROCESS_TABS[0].source);
  /** Which Fabric Processes group is unfolded — `ProcessFoldList`'s `openKey`,
   *  owned here. `null` on every open: sections start closed (client
   *  2026-08-19). */
  const [fabricOpenKey, setFabricOpenKey] = useState<string | null>(null);
  /**
   * The fabric-process breakdown, fetched the first time a group's For is
   * changed and kept for the rest of the session on THESE orders. Keyed by the
   * order ids it was asked for, so a budget whose order list changed asks again
   * rather than splitting from another group's fabrics.
   */
  const [fabricBreakdown, setFabricBreakdown] = useState<{
    orderKey: string;
    groups: FabricBreakdownGroup[];
    refusals: string[];
  } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyOrigin, setCopyOrigin] = useState<DOMRect | null>(null);
  /** The CMT line whose [Breakup] sheet is open, and the button it grew from. */
  const [breakupKey, setBreakupKey] = useState<string | null>(null);
  const [breakupOrigin, setBreakupOrigin] = useState<DOMRect | null>(null);
  /** The Amendment Protocol's sheet, and the button it grew from. */
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenOrigin, setReopenOrigin] = useState<DOMRect | null>(null);
  /**
   * WHEN A ROW'S WARNINGS SHOW (Phase 7): once THAT row has been edited in this
   * session, or once a Save / Submit has been attempted. A freshly pulled budget
   * is full of lines nobody has priced yet, and opening it as a wall of red
   * would say "wrong" about work that has not been started. Screen state only.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [saveAttempted, setSaveAttempted] = useState(false);
  /** A per-row sentence with no engine behind it — the scope's refused SQ Qty
   *  after a Type is picked (`rescope`) — shown under that row's Qty. */
  const [rowNotes, setRowNotes] = useState<Readonly<Record<string, string>>>({});
  /** A Fabric Processes group's note from its last re-split — shown under
   *  that group's For select, the field that asked for it. */
  const [foldNotes, setFoldNotes] = useState<Readonly<Record<string, string>>>({});
  /** Pulled lines the BOM no longer has, found by the last refresh (0591).
   *  Kept on screen with a note under Reqd and the only pulled rows that may
   *  be removed. Submit waits until none are left. */
  const [staleKeys, setStaleKeys] = useState<ReadonlySet<string>>(() => new Set());
  /** How many lines a refresh would change, found in the background when a
   *  saved draft is opened. Null = in step, or not checked. */
  const [bomDrift, setBomDrift] = useState<number | null>(null);
  /** Which open the background check belongs to. A late answer about the
   *  budget opened before this one is dropped, not shown on this one. */
  const driftSeq = useRef(0);

  useUnsavedGuard(dirty || isPending);

  /* OPEN-ON-ARRIVAL. A one-shot on mount: the id comes from the URL,
     `openExisting` is the SAME handler a click runs, and the param is then
     dropped from the address so a reload lands on the list, not back in the
     editor the operator just closed. An unknown id opens nothing. */
  useEffect(() => {
    if (!openId) return;
    openExisting(openId);
    router.replace("/orders/budgets");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutOrders = (fn: (xs: OrderRow[]) => OrderRow[]) => {
    setOrders(fn);
    setDirty(true);
  };
  const mutCosts = (fn: (xs: CostRow[]) => CostRow[]) => {
    setCosts(fn);
    setDirty(true);
  };
  /** Every cell edit comes through here, so this is where a row becomes
   *  "edited" (see `touched`) — and where a typed Qty retires the row's note. */
  const touch = (key: string) =>
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  const setCost = (key: string, patch: Partial<CostRow>) => {
    touch(key);
    if ("qty" in patch) {
      setRowNotes((n) => {
        if (!(key in n)) return n;
        const next = { ...n };
        delete next[key];
        return next;
      });
    }
    mutCosts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };

  /** A budget stops being the operator's once it is submitted. Mirrors
   *  `assertEditable` in the actions — the screen closes the door and the server
   *  is what actually holds it. */
  const editable = status === "draft" || status === "rejected";
  /**
   * THE BOM'S CELLS ON A PULLED LINE ARE READ-ONLY (user 2026-09-19: "the
   * merchandiser's role is strictly to input the unit rates"). Item,
   * description, Reqd, unit, stage, colour and process are the BOM's answer;
   * re-typing one would be a second answer the next refresh overwrites. Rate,
   * currency, exchange rate, rate type, Brand / Spec and the CMT breakup stay
   * the operator's. A line typed by hand is never locked. A read-only box also
   * leaves the Tab path and never holds the cursor (AGENTS.md).
   */
  const bomLocked = (r: CostRow) => !editable || r.from_bom;

  const pickedOrders = orders.filter((o) => o.garment_order_id);

  const orderById = useMemo(
    () => new Map(data.orders.map((o) => [o.id, o] as const)),
    [data.orders],
  );

  /** One past the highest serial Entry No on the list (0593) — see the
   *  Entry No field for why it is only a prediction. */
  const nextEntryNo = String(
    budgets.reduce((m, b) => (b.code && /^\d+$/.test(b.code) ? Math.max(m, Number(b.code)) : m), 0) + 1,
  );

  /** Orders this budget holds that the gate refuses — said under the grid. */
  const heldUnready = pickedOrders
    .map((o) => orderById.get(o.garment_order_id as string))
    .filter((o): o is BudgetableOrder => !!o && !!o.bom_refusal);

  const pickedFacts = pickedOrders
    .map((o) => orderById.get(o.garment_order_id as string))
    .filter(Boolean) as BudgetableOrder[];

  /**
   * THE ENGINE'S INPUTS, ASSEMBLED BY `figures.ts` — the one place they are
   * built. `submitBudget` stores the KPIs the approver approves against and the
   * Amendment Protocol freezes the approved baseline from that same file, so the
   * screen reading it too is what keeps "the figures the merchandiser saw" and
   * "the figures the MD approved" one set of numbers.
   */
  const orderInputs = orderInputsOf(pickedFacts);
  /** INR gross sales of a line's scope — what a percent line is a percentage
   *  of. No per-style sales exist, so a Style Wise percentage refuses (the
   *  engine's sentence), never a guessed share. */
  const salesBase = salesBaseOf(orderInputs);
  /** One line's amount — the ONE call every cell, band and group sum makes. */
  const amountOf = (r: CostRow) => lineAmount(lineInput(r), salesBase);

  // ---- a warning sits under ITS field (Phase 7) ---------------------------
  //
  // The engine names the field a refusal is about (`lineProblem`), so each
  // message renders under that field's control — never in the Amount column,
  // a toast or a `title`. `components/ui/field.tsx` ▸ `FieldError` has the rule.

  /** Whether this row's warnings are on screen — see `touched`. A seeded blank
   *  row never is. */
  const shown = (r: CostRow) => !isBlankLine(r) && (saveAttempted || touched.has(r.key));
  /** The id a row's control for `field` carries — what a blocked Save lands on. */
  const cellId = (r: Pick<CostRow, "key">, field: string) => `bl-${r.key}-${field}`;
  /** The row's message for one field, or null. */
  const fieldProblem = (r: CostRow, field: LineField): string | null => {
    if (field === "qty" && rowNotes[r.key]) return rowNotes[r.key];
    if (!shown(r)) return null;
    const p = lineProblem(lineInput(r), salesBase);
    return p && p.field === field ? p.message : null;
  };
  /** The control's half: its id, and `aria-invalid` / `aria-describedby` while
   *  its field has a message. */
  const errProps = (r: CostRow, field: LineField) =>
    fieldProblem(r, field)
      ? { id: cellId(r, field), "aria-invalid": true, "aria-describedby": `${cellId(r, field)}-error` }
      : { id: cellId(r, field) };
  /** The message's half, directly under the control. */
  const errNode = (r: CostRow, field: LineField) => (
    <FieldError id={`${cellId(r, field)}-error`}>{fieldProblem(r, field)}</FieldError>
  );
  /** Σ the orders' SQ Qty, or the first refusal — never a part-sum. */
  const groupSqQty = groupSqQtyOf(pickedFacts);

  // ---- opening -------------------------------------------------------------

  /**
   * One blank row for each TABLE that has no line yet (`SEEDED_SOURCES`) —
   * seeded into STATE here, never by `ChildGrid`'s `seedRow`. That prop seeds by
   * calling `onAdd`, and `onAdd` here sets `dirty`: every budget would open
   * reading "Unsaved changes" and hold off the silent auto-reload on work nobody
   * touched. Run on EVERY open, because this editor does not remount between
   * records and a `useState` initialiser would seed only the first.
   */
  function withSeededRows(lines: CostRow[]): CostRow[] {
    const seeded = [...lines];
    for (const src of SEEDED_SOURCES) {
      if (!lines.some((l) => l.source === src)) seeded.push(blankFor(newKey(), src));
    }
    return seeded;
  }

  function openNew() {
    setEditId(null);
    setEditCode(null);
    setStatus("draft");
    setForm(BLANK());
    setOrders([{ key: newKey(), garment_order_id: null }]);
    setCosts(withSeededRows([]));
    setPurchaseTab(PURCHASE_TABS[0].source);
    setProcessTab(PROCESS_TABS[0].source);
    setFabricOpenKey(null);
    setBreakupKey(null);
    setTouched(new Set());
    setSaveAttempted(false);
    setRowNotes({});
    setFoldNotes({});
    setStaleKeys(new Set());
    setBomDrift(null);
    driftSeq.current++;
    setDirty(false);
    setMode("edit");
  }

  function openExisting(id: string) {
    const b = budgets.find((x) => x.id === id);
    if (!b) return;
    setEditId(b.id);
    setEditCode(b.code);
    setStatus(b.status);
    setForm({
      budget_date: b.budget_date,
      description: b.description ?? "",
    });
    setOrders(
      (b.orders ?? []).map((o) => ({ key: newKey(), garment_order_id: o.garment_order_id })),
    );
    const rows = withSeededRows((b.lines ?? []).map((l) => rowOf(newKey(), l)));
    setCosts(rows);
    setPurchaseTab(PURCHASE_TABS[0].source);
    setProcessTab(PROCESS_TABS[0].source);
    setFabricOpenKey(null);
    setBreakupKey(null);
    setTouched(new Set());
    setSaveAttempted(false);
    setRowNotes({});
    setFoldNotes({});
    setStaleKeys(new Set());
    setBomDrift(null);
    driftSeq.current++;
    setDirty(false);
    // A saved DRAFT is asked whether the BOMs moved since; an approved or
    // submitted one is frozen (0576), so nothing it says could be acted on.
    if (b.status === "draft" || b.status === "rejected") {
      checkBomDrift((b.orders ?? []).map((o) => o.garment_order_id), rows);
    }
    setMode("edit");
  }

  /**
   * A QUEUE CARD WAS OPENED. An order already in a budget opens THAT budget; one
   * that is not starts a new budget with the order picked and its lines pulled,
   * exactly as picking it in the Orders grid would (`pickOrder`).
   */
  function openForOrder(o: BudgetableOrder) {
    if (o.in_budget && budgets.some((b) => b.id === o.in_budget?.id)) {
      openExisting(o.in_budget.id);
      return;
    }
    if (!perms.canCreate) {
      toastError("You do not have permission to create a budget");
      return;
    }
    openNew();
    setOrders([{ key: newKey(), garment_order_id: o.id }]);
    refreshFromBoms([o.id], "pick", []);
  }


  // ---- pulling the BOM costs ----------------------------------------------

  /** A row as `mergePulled` reads it — the screen's strings as numbers. */
  const heldOf = (c: CostRow) => ({ ...c, qty: numOrNull(c.qty) });

  /** The operator's half of a line — what a refresh never touches. Everything
   *  else on a pulled line is the BOM's (`bomLocked`). */
  const operatorFacts = (c: CostRow): Partial<CostRow> => ({
    rate: c.rate,
    specification: c.specification,
    currency_code: c.currency_code,
    ex_rate: c.ex_rate,
    rate_type: c.rate_type,
    no_of_pcs: c.no_of_pcs,
    no_of_units: c.no_of_units,
    scope: c.scope,
    cutting_rate: c.cutting_rate,
    making_rate: c.making_rate,
    checking_rate: c.checking_rate,
    ironing_rate: c.ironing_rate,
    packing_rate: c.packing_rate,
    is_foc: c.is_foc,
    is_import: c.is_import,
  });

  /** Every table keeps a row (AGENTS.md default rows) — after lines leave. */
  const reseeded = (xs: CostRow[]) => {
    const out = [...xs];
    for (const src of SEEDED_SOURCES) {
      if (!out.some((x) => x.source === src)) out.push(blankFor(newKey(), src));
    }
    return out;
  };

  /**
   * FILL AND REFRESH FROM THE BOMs — one path for picking an order and for the
   * header's "Refresh from BOMs" (0591).
   *
   * It used to only ADD lines not already here. That was right while a pulled
   * quantity could be retyped; now it is read-only (`bomLocked`), so a refresh
   * that could not UPDATE would leave the operator holding a stale quantity with
   * no way to fix it. `mergePulled` (lib/orders/budget/pull-merge.ts) is the
   * rule, and `submitBudget` runs the same rule against the stored lines:
   *
   * - a matched line takes the BOM's facts and keeps its rate and terms;
   * - a new BOM line is added, and a seeded blank row in that table makes way;
   * - a pulled line the BOM no longer has is FLAGGED (a note under Reqd, its ✕
   *   back), never silently dropped;
   * - a Fabric Processes group whose kilograms moved is re-fitted AT THE GRAIN IT
   *   HOLDS — a colour-wise split stays colour-wise. Its rates carry by line
   *   where the line still exists, else only when the group had one rate.
   *
   * `ids` scopes it: picking one order refreshes that order's lines only.
   *
   * `base` is the rows to merge against when they are not yet in state. A new
   * budget opened from a queue card passes `[]`, because `costs` in this
   * closure is still the PREVIOUS budget's. Merged against those, its lines for
   * the same order would read as "already here" and never be added.
   */
  function refreshFromBoms(ids: readonly string[], why: "pick" | "refresh", base?: readonly CostRow[]) {
    if (ids.length === 0) return;
    const pool = base ?? costs;
    start(async () => {
      const res = await loadCostLines([...ids]);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const scope = new Set(ids);
      const held = pool.filter(
        (c) =>
          c.garment_order_id &&
          scope.has(c.garment_order_id) &&
          PULLED_SOURCES.has(c.source as BudgetSource),
      );
      const plan = mergePulled(held.map(heldOf), res.lines);

      /* A RE-FIT AT A GRAIN OTHER THAN FABRIC needs the breakdown, fetched
         FRESH: the cached one (`fabricBreakdown`) predates the BOM change this
         refresh is answering. */
      const needsBreakdown = plan.refit.some((g) => g.basis && g.basis !== "fabric");
      let breakdown: FabricBreakdownGroup[] = [];
      if (needsBreakdown) {
        const bd = await loadFabricProcessBreakdown([...ids]);
        if (!bd.ok) {
          toastError(bd.error);
          return;
        }
        breakdown = bd.groups;
      }
      // Whatever was cached is older than this answer.
      setFabricBreakdown(null);

      const groupRows = (groupKey: string) =>
        pool.filter((c) => c.source === "fabric_process" && fabricGroupKey(c) === groupKey);
      const refits = new Map<string, CostRow[]>();
      let refitNotes = 0;
      for (const g of plan.refit) {
        const mine = groupRows(g.groupKey);
        const carried = carryRate(mine.map(lineInput));
        const allFoc = mine.length > 0 && mine.every((l) => l.is_foc);
        /* A rate carries BY LINE where the same line is still there (a
           fabric-wise group), else only when the whole group had one. */
        const priced = (l: Parameters<typeof rowOf>[1]): CostRow => {
          const same = mine.find((m) => mergeKey(heldOf(m)) === mergeKey(l));
          const row = rowOf(newKey(), { ...l, source: "fabric_process", from_bom: true });
          if (same) return { ...row, ...operatorFacts(same) };
          return {
            ...row,
            rate: carried ? String(carried.rate) : "",
            currency_code: carried?.currency_code ?? "",
            ex_rate: carried?.ex_rate == null ? "" : String(carried.ex_rate),
            rate_type: carried?.rate_type ?? row.rate_type,
            is_foc: allFoc,
          };
        };
        if (!g.basis || g.basis === "fabric") {
          refits.set(g.groupKey, g.lines.map(priced));
          continue;
        }
        const src = breakdown.find((b) => fabricGroupKey(b) === g.groupKey);
        const split = src ? splitFabricProcess(src.rows, g.basis as ProcessBasis) : [];
        if (!src || split.length === 0) {
          // No split at the held grain: fall back to the BOM's fabric-wise
          // lines rather than keep kilograms the BOM no longer says.
          refits.set(g.groupKey, g.lines.map(priced));
          refitNotes++;
          continue;
        }
        refits.set(
          g.groupKey,
          split.map((sp) =>
            priced({
              source: "fabric_process",
              garment_order_id: src.garment_order_id,
              process_id: src.process_id,
              uom_id: src.uom_id,
              item_id: sp.item_id,
              combo: sp.combo,
              basis: sp.basis,
              description: sp.description,
              qty: sp.qty,
              rate: null,
            }),
          ),
        );
      }

      const updates = new Map(plan.update.map((u) => [u.key, u.line] as const));
      const drops = new Set(plan.stale.filter((x) => x.disposition === "drop").map((x) => x.key));
      const flags = plan.stale.filter((x) => x.disposition === "flag").map((x) => x.key);
      const added = plan.add.map((l) => rowOf(newKey(), l));
      const filled = new Set<string>([
        ...added.map((l) => l.source),
        ...(refits.size ? ["fabric_process"] : []),
      ]);

      if (updates.size || drops.size || added.length || refits.size) {
        mutCosts((xs) => {
          const out: CostRow[] = [];
          const placed = new Set<string>();
          for (const x of xs) {
            if (drops.has(x.key)) continue;
            if (filled.has(x.source) && isBlankLine(x)) continue; // the seed makes way
            if (x.source === "fabric_process" && refits.has(fabricGroupKey(x))) {
              // IN PLACE — the group keeps its position among the others.
              const k = fabricGroupKey(x);
              if (!placed.has(k)) out.push(...(refits.get(k) ?? []));
              placed.add(k);
              continue;
            }
            const u = updates.get(x.key);
            out.push(u ? { ...rowOf(x.key, u), ...operatorFacts(x), from_bom: true } : x);
          }
          for (const [k, rows] of refits) if (!placed.has(k)) out.push(...rows);
          return reseeded([...out, ...added]);
        });
      }
      if (flags.length) {
        setStaleKeys((s0) => new Set([...s0, ...flags]));
        setRowNotes((n) => {
          const next = { ...n };
          for (const k of flags) next[k] = "No longer on the BOM — remove this line";
          return next;
        });
      }
      if (why === "refresh") setBomDrift(null);

      if (pullMergeIsEmpty(plan)) {
        if (why === "refresh") success("The budget already matches the BOMs");
        return;
      }
      const parts: string[] = [];
      if (added.length) parts.push(`${added.length} added`);
      if (updates.size) parts.push(`${updates.size} updated`);
      if (refits.size) parts.push(`${refits.size} fabric process${refits.size === 1 ? "" : "es"} re-fitted`);
      if (flags.length) parts.push(`${flags.length} no longer on the BOM`);
      if (drops.size) parts.push(`${drops.size} removed`);
      // THE SKIPPED COUNT IS SAID OUT LOUD. A refused BOM figure dropped in
      // silence makes a budget look complete while a real cost is missing from
      // it — and this document gets approved.
      if (res.skipped > 0) parts.push(`${res.skipped} BOM figures skipped as unanswered`);
      if (refitNotes > 0) parts.push(`${refitNotes} split reset to fabric-wise`);
      success(`From the BOMs: ${parts.join(" · ")}`);
    });
  }

  /**
   * IS THIS SAVED DRAFT STILL THE BOMs' ANSWER? Asked in the background when it
   * is opened, so a budget left for a week says so before anyone prices it. It
   * changes nothing — the header offers the refresh — and it is not a
   * transition, so the editor is not held busy while the Fabric BOM report runs.
   */
  function checkBomDrift(ids: readonly string[], rows: readonly CostRow[]) {
    const seq = ++driftSeq.current;
    setBomDrift(null);
    if (ids.length === 0) return;
    void loadCostLines([...ids]).then((res) => {
      if (seq !== driftSeq.current || !res.ok) return;
      const held = rows.filter((c) => PULLED_SOURCES.has(c.source as BudgetSource) && c.garment_order_id);
      const plan = mergePulled(held.map(heldOf), res.lines);
      setBomDrift(pullMergeIsEmpty(plan) ? null : pullMergeSize(plan));
    });
  }

  /** An order leaves the budget, and the lines the BOM gave it go with it. A
   *  line TYPED against that order stays, noted — the save refuses it until it
   *  is removed or the order comes back. */
  function dropOrderLines(orderId: string) {
    const typed = costs.filter((c) => c.garment_order_id === orderId && !c.from_bom).map((c) => c.key);
    mutCosts((xs) => reseeded(xs.filter((x) => !(x.from_bom && x.garment_order_id === orderId))));
    if (typed.length) {
      setRowNotes((n) => {
        const next = { ...n };
        for (const k of typed) next[k] = "This line's order is no longer on the budget";
        return next;
      });
    }
  }

  /** Picking (or changing) an order fills its lines from its BOMs — no button
   *  (user 2026-09-19: "selecting the RE Number automatically fetches"). */
  function pickOrder(row: OrderRow, id: string | null) {
    const old = row.garment_order_id;
    mutOrders((xs) => xs.map((x) => (x.key === row.key ? { ...x, garment_order_id: id } : x)));
    if (old === id) return;
    if (old) dropOrderLines(old);
    if (id) refreshFromBoms([id], "pick");
  }

  // ---- copying rates from an earlier budget -------------------------------

  /**
   * Rates only, onto the lines ALREADY HERE — never new lines. Which line
   * matches which is `copyRatesFrom`'s rule; this reports what it did. A copy
   * that matched nothing says so, rather than closing as if it had worked.
   */
  function copyFrom(budgetId: string) {
    start(async () => {
      const res = await loadBudgetLinesForCopy(budgetId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const target = costs.map((c) => ({
        key: c.key,
        source: c.source,
        item_id: c.item_id,
        description: c.description || null,
        specification: c.specification || null,
        currency_code: c.currency_code || null,
        ex_rate: numOrNull(c.ex_rate),
        rate: numOrNull(c.rate),
        is_foc: c.is_foc,
        is_import: c.is_import,
        // THE REST OF THE LINE'S IDENTITY. Without these every process on one
        // yarn — or every head on Other Expenses — is one key, and one rate is
        // copied onto all of them.
        process_id: c.process_id,
        cost_head_id: c.cost_head_id,
        combo: c.combo,
        style_ref_no: c.style_ref_no,
        component_id: c.component_id,
        rate_type: c.rate_type,
      }));
      // A FOREIGN RATE IS NEVER A CANDIDATE FOR A RUPEES-ONLY LINE. Its currency
      // would be dropped on save (`INR_ONLY_SOURCES`), leaving a dollar figure
      // read as rupees. Filtered BEFORE matching — source is part of the match,
      // so these can only ever have matched a line of their own source — which
      // keeps `matched` and `ambiguous` true: skipping after the match counted
      // lines as "copied" that were then left blank.
      const usable = res.lines.filter(
        (l) =>
          !(
            INR_ONLY_SOURCES.has(l.source) &&
            !!(l.currency_code ?? "").trim() &&
            (l.currency_code ?? "").trim().toUpperCase() !== "INR"
          ),
      );
      const { lines, matched, ambiguous } = copyRatesFrom(target, usable);
      setCopyOpen(false);
      // TWO RATES FOR ONE LINE IS SAID, NOT SETTLED. The earlier budget priced
      // the same thing twice, differently; picking either would be a number
      // nobody chose for this budget, so those lines are left blank and counted.
      const unsettled =
        ambiguous > 0
          ? `${ambiguous} left blank — the earlier budget had two different rates for ${ambiguous === 1 ? "it" : "them"}`
          : "";
      if (matched === 0) {
        toast(
          unsettled || "No blank rate on this budget matched a line on that one — nothing was copied",
          "info",
        );
        return;
      }
      const byKey = new Map(lines.map((l) => [l.key, l] as const));
      mutCosts((xs) =>
        xs.map((c) => {
          const l = byKey.get(c.key);
          // RATE FACTS ONLY. A flat or percent rate travels WITH its type — a
          // flat 4,000 written onto a per-unit line would multiply — but FOC
          // and Import are this budget's own answers and are never copied. (A
          // foreign rate never reaches a rupees-only line — see `usable` above.)
          return l
            ? {
                ...c,
                rate: l.rate == null ? "" : String(l.rate),
                specification: l.specification ?? "",
                currency_code: l.currency_code ?? "",
                ex_rate: l.ex_rate == null ? "" : String(l.ex_rate),
                rate_type: (l.rate_type as RateType | null | undefined) ?? c.rate_type,
              }
            : c;
        }),
      );
      success(
        `${matched} ${matched === 1 ? "rate" : "rates"} copied${unsettled ? ` · ${unsettled}` : ""}`,
      );
    });
  }

  // ---- the grids -----------------------------------------------------------

  /**
   * THE RE NO IS THE ORDER PICKER (client 2026-09-19: the Orders grid "remove
   * this totally"). A budget is one order's budget, opened from its card in the
   * queue or by picking its RE No here — the note's "SQ No / RE No: the
   * selection input that loads all BOM data". Picking it pulls the order's
   * lines (`pickOrder`); changing it takes the old order's pulled lines away.
   *
   * THE PREREQUISITE GATE: only an order whose Fabric BOM AND Material BOM are
   * both saved is offered. The order this budget already holds survives the
   * filter (AGENTS.md "Disabled rows") and says why under the field; the save
   * action refuses it until it is fixed.
   */
  const heldOrder = orders[0] ?? null;
  const reOptions = data.orders
    .filter((o) => !o.bom_refusal || o.id === heldOrder?.garment_order_id)
    .map((o) => ({
      id: o.id,
      code: o.re_no ?? o.order_code,
      name: [o.re_no ?? o.order_code, o.po_no, o.customer_name].filter(Boolean).join(" · "),
      inactive: false,
    }));
  function pickReNo(id: string | null) {
    if (heldOrder) {
      pickOrder(heldOrder, id);
      return;
    }
    if (!id) return;
    mutOrders(() => [{ key: newKey(), garment_order_id: id }]);
    refreshFromBoms([id], "pick");
  }
  /** Under the RE No: a Save tried with none, why a held order is not ready,
   *  or which OTHER budget already covers it (advisory; only approval is
   *  refused, by the server, with that budget named). */
  const reMessage = (() => {
    if (saveAttempted && pickedOrders.length === 0) return "Pick the RE No";
    if (heldUnready.length > 0) return heldUnready.map((o) => o.bom_refusal).join(" · ");
    const other = pickedFacts.map((o) => o.in_budget).find((b) => b && b.id !== editId);
    return other ? `Already in budget ${other.code ?? ""} (${budgetStatusText(other.status)})`.replace("  ", " ") : null;
  })();

  // ---- cost-line cells, one definition each ---------------------------------
  //
  // Each grid below is a LIST of these, in the blueprint's order for its tab.
  // One definition per cell is what keeps "Rate" meaning the same thing on the
  // yarn grid and on CMTs — and the INR Rate and Amount beside it computed by
  // the same engine call.

  const itemCol = (header: string): CostCol => ({
    header,
    cell: (r) => (
      <RecordPicker
        label={header}
        compact
        disabled={bomLocked(r)}
        items={data.items}
        value={r.item_id}
        onChange={(id) => setCost(r.key, { item_id: id })}
      />
    ),
  });

  const descCol = (header: string): CostCol => ({
    header,
    cell: (r) => (
      <Input
        className="h-8"
        readOnly={bomLocked(r)}
        value={r.description}
        onChange={(e) => setCost(r.key, { description: e.target.value })}
      />
    ),
  });

  const qtyCol = (header: string): CostCol => ({
    header,
    requiredFor: qtyRequired,
    cell: (r) => (
      <>
        <Input
          {...errProps(r, "qty")}
          className="h-8 text-right"
          required={qtyRequired(r)}
          readOnly={bomLocked(r)}
          inputMode="decimal"
          value={r.qty}
          onChange={(e) => setCost(r.key, { qty: e.target.value })}
        />
        {errNode(r, "qty")}
      </>
    ),
  });

  const unitCol: CostCol = {
    header: "Unit",
    cell: (r) => (
      <RecordPicker
        label="Unit"
        compact
        disabled={bomLocked(r)}
        items={data.uoms}
        value={r.uom_id}
        onChange={(id) => setCost(r.key, { uom_id: id })}
      />
    ),
  };

  /* FOC AND IMPORT ARE THE MERCHANDISER'S, ON EVERY LINE (user 2026-09-19:
     "now it don't allow to enable, make it enable"). A pulled accessory line
     STARTS from the Material BOM line's own FOC / supply type (0474), but it is
     a sourcing call the budget may change — so they are never locked with the
     BOM's facts, and a refresh keeps what was set (`operatorFacts`,
     pull-merge.ts). */
  const flagToggle = (r: CostRow, key: "is_foc" | "is_import", aria: string, className?: string) => (
    <Toggle
      checked={r[key]}
      ariaLabel={aria}
      disabled={!editable}
      onChange={(v) => setCost(r.key, { [key]: v })}
      className={className}
    />
  );
  const toggleCol = (header: string, key: "is_foc" | "is_import", aria: string): CostCol => ({
    header,
    cell: (r) => flagToggle(r, key, aria),
  });
  const focCol = toggleCol("FOC", "is_foc", "Free of cost");
  const importCol = toggleCol("Import", "is_import", "Imported");

  /**
   * THE CURRENCY'S BLANK IS INR, AND SAYS SO. `currency_code` NULL is INR by
   * 0572's definition, so the empty option is labelled with the currency it
   * stands for rather than left blank — and picking INR from the list stores
   * the same NULL, so there is exactly one way to say "rupees".
   *
   * Clearing the currency clears the exchange rate with it (0572's check:
   * the two are null together). Choosing one fills the rate only from the
   * ORDERS' rate for that same currency (the header's Exchange rate, read off
   * Order Entry since 2026-09-19); otherwise it stays blank for the operator,
   * and `lineInrRate` refuses with a sentence until it is.
   */
  const pickCurrency = (r: CostRow, raw: string) => {
    const code = raw === "INR" ? "" : raw;
    const ex_rate = !code
      ? ""
      : code === r.currency_code
        ? r.ex_rate
        : code === orderCurrency && orderRate != null
          ? String(orderRate)
          : "";
    setCost(r.key, { currency_code: code, ex_rate });
  };

  const currencyCol: CostCol = {
    header: "Curr",
    cell: (r) => (
      <>
        <Select
          {...errProps(r, "currency")}
          compact
          className="h-8"
          disabled={!editable}
          value={r.currency_code}
          onChange={(e) => pickCurrency(r, e.target.value)}
        >
          <option value="">INR</option>
          {data.currencies
            .filter((c) => c.code !== "INR")
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
        </Select>
        {errNode(r, "currency")}
      </>
    ),
  };

  const exRateCol: CostCol = {
    header: "Ex Rate",
    requiredFor: exRateRequired,
    cell: (r) => (
      <>
        <Input
          {...errProps(r, "ex_rate")}
          className="h-8 text-right"
          required={exRateRequired(r)}
          // An INR line has no exchange rate to type — read-only, so Tab steps
          // over it rather than stopping on a box that must stay empty.
          readOnly={!editable || !r.currency_code}
          inputMode="decimal"
          value={r.ex_rate}
          onChange={(e) => setCost(r.key, { ex_rate: e.target.value })}
        />
        {errNode(r, "ex_rate")}
      </>
    ),
  };

  /** The rate cell. Its header is the tab's own word — "Rate" on a purchase,
   *  "Charges" / "Charge" on a process — and its value is the same field. */
  const rateCol = (header: string): CostCol => ({
    header,
    requiredFor: rateRequired,
    cell: (r) => (
      <>
        <Input
          {...errProps(r, "rate")}
          className="h-8 text-right"
          required={rateRequired(r)}
          readOnly={!editable}
          inputMode="decimal"
          value={r.rate}
          onChange={(e) => setCost(r.key, { rate: e.target.value })}
        />
        {errNode(r, "rate")}
      </>
    ),
  });

  /**
   * A derived figure — or NOTHING when it cannot be computed. The sentence for
   * why belongs under the field that is missing (Phase 7), not here: this cell
   * used to print "Enter a rate" two columns from the Rate box it was about.
   */
  const figure = (v: number | { refused: string }) =>
    isRefusal(v) ? null : <span className="tabular-nums text-sm">{fmtNumber(v)}</span>;

  const inrRateCol: CostCol = {
    header: "INR Rate",
    cell: (r) => figure(lineInrRate(lineInput(r))),
  };

  const amountCol: CostCol = {
    header: "Amount",
    total: {
      kind: "sum",
      of: (r) => {
        const a = amountOf(r);
        // A REFUSED LINE CONTRIBUTES 0 TO THE BAND AND IS COUNTED ELSEWHERE.
        // The band is a running total of what is on screen; the authoritative
        // count of unanswered lines is the bottom bar's, where it can carry a
        // sentence.
        return isRefusal(a) ? 0 : a;
      },
    },
    cell: (r) => {
      const a = amountOf(r);
      if (!isRefusal(a)) return figure(a);
      // THE ONE REFUSAL THAT BELONGS HERE: `base` — a percentage of a sales
      // value the order does not have yet. No field on the line can fix it,
      // so it sits on the amount it is keeping blank. Every other refusal is
      // under its own field.
      return a.field === "base" && shown(r) ? (
        <FieldError id={`${cellId(r, "base")}-error`}>{a.refused}</FieldError>
      ) : null;
    },
  };

  // ---- Process Rates' cells --------------------------------------------------

  const processName = (id: string | null) =>
    (id && data.processes.find((p) => p.id === id)?.name) || "";

  /**
   * The Process picker, narrowed to the processes the process master says apply
   * to this tab (`for_yarn` on Yarn, `for_garments` / `for_components` on
   * Garment Processes). The
   * held value survives the narrowing: `RecordPicker` keeps a row the record
   * already holds, the same rule as a disabled master row.
   */
  const processCol = (
    applies: (p: BudgetFormData["processes"][number]) => boolean = () => true,
  ): CostCol => ({
    header: "Process",
    cell: (r) => (
      <RecordPicker
        label="Process"
        compact
        disabled={bomLocked(r)}
        items={data.processes.filter((p) => applies(p) || p.id === r.process_id)}
        value={r.process_id}
        onChange={(id) => setCost(r.key, { process_id: id })}
      />
    ),
  });

  const uomCode = (id: string | null) =>
    (id && data.uoms.find((u) => u.id === id)?.code) || "";

  /**
   * "PER KGS", NOT "PER UNIT". 0573 stores `per_unit | flat` and nothing more:
   * which unit the charge is per is the line's own Unit, so the option is
   * labelled from it rather than stored beside it — two facts about one would
   * disagree the first time the Unit is changed.
   */
  const rateTypeLabel = (t: RateType, uomId: string | null) =>
    t === "flat" ? "Flat" : `Per ${uomCode(uomId) || "unit"}`;

  const rateTypeCol: CostCol = {
    header: "Rate Type",
    cell: (r) => (
      <Select
        compact
        className="h-8"
        disabled={!editable}
        value={r.rate_type}
        onChange={(e) => setCost(r.key, { rate_type: e.target.value as RateType })}
      >
        <option value="per_unit">{rateTypeLabel("per_unit", r.uom_id)}</option>
        <option value="flat">Flat</option>
      </Select>
    ),
  };

  const countCol = (header: string, key: "no_of_pcs" | "no_of_units"): CostCol => ({
    header,
    cell: (r) => (
      <>
        <Input
          {...errProps(r, key)}
          className="h-8 text-right"
          readOnly={!editable}
          inputMode="decimal"
          value={r[key]}
          onChange={(e) => setCost(r.key, { [key]: e.target.value })}
        />
        {errNode(r, key)}
      </>
    ),
  });

  /** Garment Reqd is DERIVED — target x pieces x units (`lineReqd`) — so it is
   *  printed, never typed. A typed Reqd beside the two counts it comes from
   *  would be three numbers stating two facts. */
  const derivedReqdCol: CostCol = {
    header: "Reqd",
    // THE PULLED QTY HAS NO BOX ON THIS GRID — Reqd is where it shows, so a
    // refused quantity is said here. Pcs and Units carry their own.
    cell: (r) => (
      <>
        {figure(lineReqd(lineInput(r)))}
        {errNode(r, "qty")}
      </>
    ),
  };

  const garmentTypeCol: CostCol = {
    header: "Type",
    cell: (r) => <Truncated className="text-sm">{BASIS_LABELS[r.basis ?? "process"]}</Truncated>,
  };

  /**
   * STAGE and COLOUR of a yarn purchase, READ-ONLY and in one 88px cell (user
   * 2026-09-19, screenshot 2952: "Stage, color field is missing in yarn
   * purchase"; chose "show them, read-only").
   *
   * THEY SAY WHAT THE FABRIC BOM DECIDED, AND TODAY THAT IS ALWAYS GREY. Its
   * `yarnPurchase` (lib/orders/fabric-bom) grosses every dyed shade back to the
   * GREY yarn it needs and buys that yarn in one lot (a26732c, "grey yarn one
   * lot"); the colour is priced one step later, as dyeing per yarn x shade on
   * Process Rates > Yarn Processes (c9c0dd8). `order_fabric_bom_yarns` stores
   * no stage because there is only ever one — so this names the rule rather
   * than reading a column. If the BOM ever buys DYED yarn per colour, that is a
   * stored stage and this constant is what must go.
   *
   * A HAND-ADDED LINE SHOWS NO STAGE: nothing behind it decided one, and
   * printing GREY there would claim what nobody said. Colour is the line's own
   * `combo`, on every line — blank today, since no yarn line carries one.
   *
   * Their own columns, straight after Yarn — the legacy line's Yarn / Stage /
   * Color order (screenshot 2954).
   *
   * DUPLICATED FROM THE FABRIC BOM'S YARN PROCESS (user 2026-09-19: "see the
   * stage is from yarn process of fabric bom ... just duplicate it there").
   * Stage is the same `LookupDialogPicker` over the same `yarn_stage` rows
   * (GREY / DYED) that `components/orders/yarn-process-grid.tsx` uses, and
   * Colour the same `<Select>` over the order's own colourways. A pulled line
   * arrives with both set from that yarn's first Yarn Process step (0590 —
   * `firstStep` in the budget service); the planner can change either.
   *
   * HISTORY, so nobody redoes it: a merged "Stage · Colour" cell, then a
   * two-row re-layout (reverted — "i just told to add new color and stage
   * field only"), then read-only text under the Yarn picker that a new
   * budget's blank row left empty. Every other column stays exactly where and
   * as wide as it was.
   */
  /** ONE STAGE COLUMN, TWO LISTS: `yarn_stage` on Yarn Purchases (the Fabric
   *  BOM's Yarn Process list), `fabric_stage` on Fabric Purchases (its Fabric
   *  Process list — GREIGE / DYED / WASH / PRINT). */
  type StageKind = "yarn_stage" | "fabric_stage";
  const stageOptions = (kind: StageKind, held: string | null) =>
    data.lookups.filter((l) => l.kind === kind && (!isInactive(l) || l.id === held));
  const stageCol = (kind: StageKind): CostCol => ({
    header: "Stage",
    cell: (r) =>
      // THE PICKER HAS NO READ-ONLY STATE — the Head column's own answer. A
      // pulled line's stage is the BOM's, so it shows as text too.
      !bomLocked(r) ? (
        <LookupDialogPicker
          kind={kind}
          label="Stage"
          compact
          options={stageOptions(kind, r.stage_id)}
          value={r.stage_id}
          onChange={(id) => setCost(r.key, { stage_id: id || null })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ) : (
        <Input
          className="h-8"
          readOnly
          value={data.lookups.find((l) => l.id === r.stage_id)?.name ?? ""}
        />
      ),
  });
  /** A line's colourways: its own order's, or every picked order's for a
   *  hand-added line that names none. The value it holds always survives the
   *  list (AGENTS.md "Disabled rows"), as on the Fabric BOM. */
  const colourOptions = (r: CostRow) => {
    const list = r.garment_order_id
      ? (orderById.get(r.garment_order_id)?.combos ?? [])
      : [...new Set(pickedFacts.flatMap((o) => o.combos))];
    return r.combo && !list.includes(r.combo) ? [...list, r.combo] : list;
  };
  const colourCol: CostCol = {
    header: "Colour",
    cell: (r) => (
      <Select
        compact
        className="h-8"
        aria-label="Colour"
        value={r.combo ?? ""}
        disabled={bomLocked(r)}
        onChange={(e) => setCost(r.key, { combo: e.target.value || null })}
      >
        <option value=""></option>
        {colourOptions(r).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    ),
  };

  /*
   * THE COLUMN WIDTHS — Phase 6, the house convention: every column takes one
   * of the seven `FIELD_WIDTH_CSS` steps, written as the step itself
   * (`FIELD_WIDTH_CSS.hug`) so `npm run check:grid-budget` can read and add
   * them. Every column declaring a width makes `ChildGrid` hug.
   *
   * THE BUDGET IS THE SMALLEST SUPPORTED PANE, not the client's: a 1366x768
   * laptop at 100% gives the editor 1155 CSS px (`check:grid-budget`). Row
   * chrome is # 40 + ✕ 32 = 72, so a table's columns may sum to at most
   * 1155 - 72 = 1083. Every grid takes `tableFrom="5xl"` (1024): `6xl` (1152)
   * clears that pane by 3px, and a scrollbar or one notch of zoom flips it to
   * cards. Each list states its sum against 1083.
   */

  /* Yarn Purchases — 144 + 88 + 112 + 88 + 72 + 88 + 72 + 88 + 72 + 88 + 112
     = 1024, + 72 = 1096 <= 1155 -> 5xl. Re-cut from 1,312: FOC + Import merged
     (-56), Yarn party -> code, Description term -> hug (the Yarn picker names
     the yarn; the text is the pulled line's note), Curr and Rate -> num.
     2026-09-19: + Stage (hug 88, a picker) and Colour (hug 88, a select) after
     Yarn, and NOTHING else moved or narrowed — the user's rule for this change.
     That is 1200, + 72 = 1272: past the 1155px laptop pane, so this grid
     switches to a table from `7xl` (1280) instead of `5xl`. At or above 1280
     the 1272px table always fits (the client's screen gives ~1312); below it,
     one-frame cards — never a sideways scroll. 8px of headroom under 1280: the
     next column here needs a re-cut, not a wider threshold.
     2026-09-19 (client, shot 2957): Brand / Specifications REMOVED (-112) —
     the brand is already on the BOM line this row was pulled from. 1088, + 72
     = 1160: still 5px past the 1155 laptop pane, so `7xl` stays.
     Same day (user): FOC and Import split back into two `num` columns (72 +
     72 = 144 for the merged 88, +56) — 1144, + 72 = 1216, under the 1280 of
     `7xl`, so still one table there and one-frame cards below it. */
  const yarnPurchaseColumns: CostCol[] = withRowRules([
    // grid-budget: exempt -- Stage + Colour were added without moving or narrowing any existing column (user 2026-09-19); the grid switches to cards below 7xl (1280px), wider than its 1272px table, so it never scrolls sideways
    { ...itemCol("Yarn"), width: FIELD_WIDTH_CSS.code },
    { ...stageCol("yarn_stage"), width: FIELD_WIDTH_CSS.hug },
    { ...colourCol, width: FIELD_WIDTH_CSS.hug },
    { ...descCol("Description"), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    // FOC and Import in their OWN columns again (user 2026-09-19: "foc and
    // imports toggle in separate field and cell") — see the width note above.
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    { ...importCol, width: FIELD_WIDTH_CSS.num },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Fabric Purchases — 176 + 200 + 88 + 72 + 72 + 72 + 88 + 88 + 112 = 968,
     + 72 = 1040 <= 1155 -> 5xl.
     2026-09-19: + Stage (hug 88, a `fabric_stage` picker) and Colour (hug 88,
     the order's colourways) after Fabric — Yarn Purchases' change, the same
     way ("now fabric ... is also missing stage and color ... this also same").
     NOTHING else moved or narrowed: 1144, + 72 = 1216, so this grid too is a
     table from `7xl` (1280) and one-frame cards below it — never a sideways
     scroll. A pulled line arrives with GREIGE / DYED from its cloth source on
     the Fabric BOM and the colourway lot it is (the budget service's
     `fabricStageOf`). */
  const fabricPurchaseColumns: CostCol[] = withRowRules([
    // grid-budget: exempt -- Stage + Colour were added without moving or narrowing any existing column (user 2026-09-19); the grid switches to cards below 7xl (1280px), wider than its 1216px table, so it never scrolls sideways
    { ...itemCol("Fabric"), width: FIELD_WIDTH_CSS.term },
    { ...stageCol("fabric_stage"), width: FIELD_WIDTH_CSS.hug },
    { ...colourCol, width: FIELD_WIDTH_CSS.hug },
    { ...descCol("Fabric & Colour"), width: FIELD_WIDTH_CSS.party },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Accessories Purchases — 144 + 112 + 72 + 88 + 88 + 72 + 88 + 72 + 88
     + 112 = 936, + 72 = 1008 <= 1155 -> 5xl. Brand / Specifications (88)
     REMOVED 2026-09-19 (client, shot 2957), as on Yarn Purchases.
     Same day (user): FOC and Import split back into two `num` columns (144
     for the merged 88, +56) — 992, + 72 = 1064 <= 1155, still 5xl. The merged
     "FOC · Import" cell was a Phase 6 re-cut to buy width; with Brand /
     Specifications gone, both grids can afford the two columns again.
     Colour / Description keeps `range`, because on a trim the colour is the
     fact that varies. */
  const accessoryPurchaseColumns: CostCol[] = withRowRules([
    { ...itemCol("Item"), width: FIELD_WIDTH_CSS.code },
    { ...descCol("Colour / Description"), width: FIELD_WIDTH_CSS.range },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    // FOC and Import in their own columns, as on Yarn Purchases (user
    // 2026-09-19) — see the width note above.
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    { ...importCol, width: FIELD_WIDTH_CSS.num },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Yarn Processes — 112 + 112 + 88 + 72 + 88 + 72 + 88 + 72 + 88 + 88 + 88
     + 112 = 1080, + 72 = 1152 <= 1155 -> 5xl. Re-cut 2026-09-19 for the
     client's Rule 3 ("Yarn Description · Process · Shade · Dyed Weight ·
     Rate"): a YARN column joins, and the free-text column narrows to `hug`
     because on a pulled dyeing line it now carries just the shade. 3px of
     headroom — add a column here and something else must give. Rate Type
     `hug`: "Per KGS" is seven characters and the header two words. */
  const yarnProcessColumns: CostCol[] = withRowRules([
    { ...itemCol("Yarn"), width: FIELD_WIDTH_CSS.range },
    { ...processCol((p) => p.for_yarn), width: FIELD_WIDTH_CSS.range },
    { ...descCol("Shade / Stage"), width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charges"), width: FIELD_WIDTH_CSS.hug },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Accessories Processes — the same steps as Yarn Processes: 1024, + 72 =
     1096 <= 1155 -> 5xl. */
  const accessoryProcessColumns: CostCol[] = withRowRules([
    { ...processCol((p) => p.for_trims), width: FIELD_WIDTH_CSS.range },
    { ...itemCol("For"), width: FIELD_WIDTH_CSS.code },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charges"), width: FIELD_WIDTH_CSS.hug },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Garment Processes — 112 + 112 + 112 + 72 + 88 + 88 + 88 + 72 + 88 + 88
     + 112 = 1032, + 72 = 1104 <= 1155 -> 5xl.
     THE CLIENT'S OWN COLUMNS (Process Rates blueprint): S No · Process · Type ·
     For · UOM · No of Pcs · No of Units · Reqd · FOC · Rate Type · Charge
     (INR). No currency — a garment step is job-worker labour quoted in rupees,
     so these lines are INR like CMT (`INR_ONLY_SOURCES`). The Curr / Ex Rate /
     INR Rate trio was added in Phase 2 for sameness, not because anyone asked,
     and it kept this grid from being a table at all (1,256 with it).
     Reqd is `hug`, not `num`: SQ Qty x pcs x units reaches five and six digits
     on a real order ("50,000"). */
  const garmentProcessColumns: CostCol[] = withRowRules([
    { ...processCol((p) => p.for_garments || p.for_components), width: FIELD_WIDTH_CSS.range },
    { ...garmentTypeCol, width: FIELD_WIDTH_CSS.range },
    { ...descCol("For"), width: FIELD_WIDTH_CSS.range },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...countCol("No of Pcs", "no_of_pcs"), width: FIELD_WIDTH_CSS.hug },
    { ...countCol("No of Units", "no_of_units"), width: FIELD_WIDTH_CSS.hug },
    { ...derivedReqdCol, width: FIELD_WIDTH_CSS.hug },
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charge (INR)"), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /** One Fabric Processes group's lines — the first cell names the grain the
   *  group was split by, and is text: it came from the split, not a keyboard.
   *
   *  176 + 88 + 72 + 144 + 72 + 88 + 72 + 88 + 112 = 912, + 72 = 984 <= 1155
   *  -> 5xl. It sits in the fold's panel, ~50px narrower than the pane (the
   *  panel's indent and the list's frame) — still 1,105 at the smallest pane,
   *  which this clears by 121. */
  const fabricLineColumns = (basis: string): CostCol[] =>
    withRowRules([
      {
        header: basis === "color" ? "Colour" : basis === "process" ? "Process" : "Fabric",
        width: FIELD_WIDTH_CSS.term,
        cell: (r) => <Truncated>{r.description}</Truncated>,
      },
      { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
      { ...focCol, width: FIELD_WIDTH_CSS.num },
      { ...rateTypeCol, width: FIELD_WIDTH_CSS.code },
      { ...currencyCol, width: FIELD_WIDTH_CSS.num },
      { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
      { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
      { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
      { ...amountCol, width: FIELD_WIDTH_CSS.range },
    ]);

  // ---- CMTs -----------------------------------------------------------------
  //
  // One row per (order, style, coordinate), pulled (doc "Phase 3"). The style's
  // facts are looked up LIVE from the order rather than copied onto the line:
  // the line stores the style's KEY (`style_ref_no`) and the coordinate
  // (`item_id`), and a description or article corrected on the order reads
  // correctly here the next time the budget is opened.

  const styleOf = (r: CostRow) =>
    (r.garment_order_id &&
      r.style_ref_no &&
      orderById
        .get(r.garment_order_id)
        ?.styles?.find((st) => st.style_ref_no === r.style_ref_no)) ||
    null;
  /** A pulled CMT line is bound to a style; a hand-added one is not. */
  const styleBound = (r: CostRow) => !!r.style_ref_no;
  const coordinateName = (r: CostRow) =>
    (r.item_id && styleOf(r)?.coordinates.find((c) => c.id === r.item_id)?.name) || "";
  const hasBreakup = (r: CostRow) => CMT_OPERATIONS.some((op) => r[op.key].trim() !== "");

  /** Two facts in one cell, the second muted beneath — the blueprint's
   *  "Style / Article" and "SC No / Order No". */
  const twoTier = (top: string | null | undefined, bottom: string | null | undefined) => (
    <div className="min-w-0 leading-tight">
      <Truncated className="text-sm">{top ?? ""}</Truncated>
      <Truncated className="text-xs text-muted-foreground">{bottom ?? ""}</Truncated>
    </div>
  );

  /* CMTs — 112 + 176 + 144 + 144 + 88 + 88 + 88 + 88 + 112 = 1040, + 72 = 1112
     <= 1155 -> 5xl.
     A hand-added line shows its Description under "Style Ref No" in the table
     (its style cells are empty — `showFor`); the card layout below the
     threshold labels it as a Description. */
  const cmtColumns: CostCol[] = withRowRules([
    {
      header: "Style Ref No",
      width: FIELD_WIDTH_CSS.range,
      // A HAND-ADDED LINE HAS NO STYLE, so its first cell is what it IS — a
      // typed description, labelled as one.
      labelFor: (r) => (styleBound(r) ? "Style Ref No" : "Description"),
      cell: (r) =>
        styleBound(r) ? (
          <Truncated className="text-sm">{r.style_ref_no}</Truncated>
        ) : (
          <Input
            className="h-8"
            readOnly={!editable}
            value={r.description}
            onChange={(e) => setCost(r.key, { description: e.target.value })}
          />
        ),
    },
    {
      header: "Style / Article",
      width: FIELD_WIDTH_CSS.term,
      showFor: styleBound,
      cell: (r) => twoTier(styleOf(r)?.style_description, styleOf(r)?.article_no),
    },
    {
      header: "SC No / Order No",
      width: FIELD_WIDTH_CSS.code,
      showFor: styleBound,
      cell: (r) => {
        const o = r.garment_order_id ? orderById.get(r.garment_order_id) : null;
        return twoTier(o?.re_no ?? o?.sc_no, o?.po_no);
      },
    },
    {
      header: "Coordinate",
      width: FIELD_WIDTH_CSS.code,
      showFor: styleBound,
      cell: (r) => <Truncated className="text-sm">{coordinateName(r)}</Truncated>,
    },
    {
      header: "Order Qty",
      width: FIELD_WIDTH_CSS.hug,
      showFor: styleBound,
      cell: (r) => {
        const q = styleOf(r)?.order_qty;
        return <span className="tabular-nums text-sm">{q == null ? "" : fmtNumber(q)}</span>;
      },
    },
    {
      header: "SQ Qty",
      width: FIELD_WIDTH_CSS.hug,
      // PULLED, the style's SQ Qty — pieces MADE, not ordered (doc "Phase 3":
      // 5321 against an Order Qty of 5028). Read-only, like every pulled
      // quantity: re-typing it is a second answer to an answered question. A
      // hand-added line has nothing to pull and types its own.
      requiredFor: (r) => !styleBound(r) && qtyRequired(r),
      cell: (r) => (
        <>
          <Input
            {...errProps(r, "qty")}
            className="h-8 text-right"
            required={!styleBound(r) && qtyRequired(r)}
            readOnly={!editable || styleBound(r)}
            inputMode="decimal"
            value={r.qty}
            onChange={(e) => setCost(r.key, { qty: e.target.value })}
          />
          {errNode(r, "qty")}
        </>
      ),
    },
    {
      header: "CMT Rate",
      width: FIELD_WIDTH_CSS.hug,
      requiredFor: rateRequired,
      cell: (r) => (
        <>
          <Input
            {...errProps(r, "rate")}
            className="h-8 text-right"
            required={rateRequired(r)}
            // WHILE A BREAKUP EXISTS THE RATE IS ITS TOTAL — shown here, edited
            // there. Two boxes that could each set the rate would disagree the
            // first time one of them was used (0574's check).
            readOnly={!editable || hasBreakup(r)}
            inputMode="decimal"
            value={r.rate}
            onChange={(e) => setCost(r.key, { rate: e.target.value })}
          />
          {errNode(r, "rate")}
        </>
      ),
    },
    {
      header: "Breakup",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full"
          // `data-row-open` PUTS IT ON THE ROW'S KEYBOARD AXIS — the Fabric BOM
          // Components [Click] precedent: a button that opens something the
          // keyboard cannot otherwise reach, so Tab and ← → land on it like a
          // cell. A marker, never a handler.
          data-row-open
          aria-label={`CMT breakup for ${r.style_ref_no ?? (r.description || "this line")}`}
          onClick={(e) => {
            // `currentTarget`, never `target` — the click can land on the text.
            setBreakupOrigin(e.currentTarget.getBoundingClientRect());
            setBreakupKey(r.key);
          }}
        >
          {hasBreakup(r) ? "Breakup ✓" : "Breakup"}
        </Button>
      ),
    },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /**
   * Write one operation's figure, and the line's rate with it.
   *
   * The rate follows the TOTAL whenever there is one, so the breakup can never
   * disagree with the rate it explains (0574). When every box is cleared there
   * is no total — the rate is left as it last stood and the CMT Rate box opens
   * for typing again. A refused total (a negative figure) leaves it alone too:
   * the sheet prints the sentence, and a rate is not written from a refusal.
   */
  function setBreakup(key: string, op: CmtOperationKey, value: string) {
    touch(key);
    mutCosts((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        const next = { ...x, [op]: value };
        const total = cmtBreakupTotal(breakupOf(next));
        return typeof total === "number" ? { ...next, rate: String(total) } : next;
      }),
    );
  }

  const breakupRow = breakupKey ? (costs.find((c) => c.key === breakupKey) ?? null) : null;

  // ---- Other Expenses / Other Incomes ----------------------------------------

  /** A head picker's options: its own kind only, and a disabled head only when
   *  this line already holds it (AGENTS.md "Disabled rows"). */
  const headOptions = (kind: "expense_head" | "income_head", held: string | null) =>
    data.lookups.filter((l) => l.kind === kind && (!isInactive(l) || l.id === held));

  const headCol = (kind: "expense_head" | "income_head", header: string): CostCol => ({
    header,
    cell: (r) =>
      // THE PICKER HAS NO READ-ONLY STATE, so a budget that is no longer the
      // operator's shows the head as text — a read-only box, off the Tab path.
      editable ? (
        <LookupDialogPicker
          kind={kind}
          label={header}
          compact
          options={headOptions(kind, r.cost_head_id)}
          value={r.cost_head_id}
          onChange={(id) => setCost(r.key, { cost_head_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ) : (
        <Input
          className="h-8"
          readOnly
          value={data.lookups.find((l) => l.id === r.cost_head_id)?.name ?? ""}
        />
      ),
  });

  /**
   * The SQ Qty of a scope — the whole group, one order, or one style — or the
   * sentence for why there isn't one. The same figure the Budget section and
   * the CMT lines read: within one budget "pieces made" is one number.
   */
  const scopeSqQty = (r: Pick<CostRow, "scope" | "garment_order_id" | "style_ref_no">) => {
    if (r.scope === "sq") return groupSqQty;
    const o = r.garment_order_id ? orderById.get(r.garment_order_id) : null;
    if (!o) return null;
    if (r.scope === "order") {
      return o.sq_qty ?? { refused: o.sq_refusal ?? `${o.sc_no ?? o.order_code ?? "This order"} has no SQ Qty yet` };
    }
    const st = r.style_ref_no ? o.styles?.find((x) => x.style_ref_no === r.style_ref_no) : null;
    if (!st) return null;
    return st.sq_qty ?? { refused: st.sq_refusal ?? `${st.style_ref_no} has no SQ Qty yet` };
  };

  /**
   * Re-scope a line and, on a Qty line, fill Qty with the new scope's SQ Qty.
   *
   * The fill happens HERE, on the operator's act of choosing, never in an effect
   * watching the scope — an effect would also fire on opening a saved budget and
   * overwrite every quantity someone had corrected. A refused SQ Qty leaves the
   * box blank and SAYS why, rather than filling in a number nobody can defend.
   * A scope not yet complete (Order Wise with no order picked) fills nothing.
   */
  function rescope(r: CostRow, patch: Partial<CostRow>) {
    const next = { ...r, ...patch };
    if (next.rate_type !== "per_unit") {
      setCost(r.key, patch);
      return;
    }
    const q = scopeSqQty(next);
    if (q == null) {
      setCost(r.key, patch);
      return;
    }
    if (isRefusal(q)) {
      setCost(r.key, { ...patch, qty: "" });
      // UNDER THIS ROW'S QTY, not a toast — the sentence is about the box
      // that was just left blank (Phase 7). Set after `setCost`, which clears
      // a row's note whenever its Qty changes.
      setRowNotes((n) => ({ ...n, [r.key]: q.refused }));
      return;
    }
    setCost(r.key, { ...patch, qty: String(q) });
  }

  const orderItems = pickedFacts.map((o) => ({
    id: o.id,
    code: o.sc_no ?? o.order_code,
    name: [o.sc_no ?? o.order_code, o.po_no].filter(Boolean).join(" · ") || "(order)",
    inactive: false,
  }));

  const scopeCol: CostCol = {
    header: "Type",
    cell: (r) => (
      <Select
        compact
        className="h-8"
        disabled={!editable}
        value={r.scope}
        onChange={(e) => {
          const scope = e.target.value as Scope;
          // SQ Wise drops the order and style; Order Wise keeps the order and
          // drops the style; Style Wise keeps both until they are picked.
          rescope(r, {
            scope,
            garment_order_id: scope === "sq" ? null : r.garment_order_id,
            style_ref_no: scope === "style" ? r.style_ref_no : null,
          });
        }}
      >
        <option value="sq">SQ Wise</option>
        <option value="order">Order Wise</option>
        {/* NOT FOR A PERCENTAGE — no sales value exists per style, so a
            style-scoped percent line could only ever refuse (engine). Offered
            greyed rather than removed, so the operator sees why. */}
        <option value="style" disabled={r.rate_type === "percent"}>
          Style Wise
        </option>
      </Select>
    ),
  };

  const scopeOrderCol: CostCol = {
    header: "Order",
    showFor: (r) => r.scope !== "sq",
    requiredFor: (r) => r.scope !== "sq",
    cell: (r) => (
      <>
        <RecordPicker
          id={cellId(r, "order")}
          label="Order"
          compact
          required={r.scope !== "sq"}
          disabled={!editable}
          items={orderItems}
          value={r.garment_order_id}
          onChange={(id) => rescope(r, { garment_order_id: id, style_ref_no: null })}
        />
        <FieldError id={`${cellId(r, "order")}-error`}>
          {shown(r) && r.scope !== "sq" && !r.garment_order_id
            ? "Choose the order this expense is for"
            : null}
        </FieldError>
      </>
    ),
  };

  const scopeStyleCol: CostCol = {
    header: "Style",
    showFor: (r) => r.scope === "style",
    requiredFor: (r) => r.scope === "style",
    cell: (r) => (
      <>
        <RecordPicker
          id={cellId(r, "style")}
          label="Style"
          compact
          required={r.scope === "style"}
          disabled={!editable || !r.garment_order_id}
          // KEYED BY THE STYLE'S REF — the line stores `style_ref_no`, the same
          // text key the order's style lines and the CMT lines use.
          items={(
            (r.garment_order_id && orderById.get(r.garment_order_id)?.styles) ||
            []
          ).map((st) => ({
            id: st.style_ref_no,
            code: st.style_ref_no,
            name: [st.style_ref_no, st.style_description].filter(Boolean).join(" · "),
            inactive: false,
          }))}
          // A STATE OF THE RECORD, which is what a placeholder may still say.
          placeholder={r.garment_order_id ? undefined : "Pick the order first"}
          value={r.style_ref_no}
          onChange={(id) => rescope(r, { style_ref_no: id })}
        />
        <FieldError id={`${cellId(r, "style")}-error`}>
          {shown(r) && r.scope === "style" && r.garment_order_id && !r.style_ref_no
            ? "Choose the style this expense is for"
            : null}
        </FieldError>
      </>
    ),
  };

  const RATE_TYPE_WORDS: Record<RateType, string> = {
    per_unit: "Qty",
    flat: "Flat",
    percent: "Percentage",
  };

  const otherRateTypeCol = (header: string, types: readonly RateType[]): CostCol => ({
    header,
    cell: (r) => (
      <Select
        compact
        className="h-8"
        disabled={!editable}
        value={r.rate_type}
        onChange={(e) => {
          const rate_type = e.target.value as RateType;
          // BECOMING A QTY LINE FILLS ITS QTY from the scope, exactly as
          // choosing a scope does — a Qty line with no quantity is not priced.
          // BECOMING A PERCENTAGE widens a Style Wise line to its order: a
          // style has no sales value of its own to take a percentage of.
          rescope(
            r,
            rate_type === "percent" && r.scope === "style"
              ? { rate_type, scope: "order", style_ref_no: null }
              : { rate_type },
          );
        }}
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {RATE_TYPE_WORDS[t]}
          </option>
        ))}
      </Select>
    ),
  });

  /** UOM: a picker on a Qty line, the "%" a percentage is in, nothing on Flat. */
  const otherUnitCol: CostCol = {
    header: "UOM",
    showFor: (r) => r.rate_type !== "flat",
    cell: (r) =>
      r.rate_type === "percent" ? <span className="text-sm">%</span> : unitCol.cell(r, 0),
  };

  /**
   * Qty: typed on a Qty line; on a Flat line a 1 that is DISPLAY ONLY — a flat
   * charge is not multiplied (`lineAmount` never reads its quantity), and the
   * 1 says so rather than leaving the box to be read as missing. Not on a
   * percentage at all: there is no quantity in "2% of sales".
   */
  const otherQtyCol: CostCol = {
    header: "Qty",
    showFor: (r) => r.rate_type !== "percent",
    requiredFor: qtyRequired,
    cell: (r) =>
      r.rate_type === "flat" ? (
        <Input className="h-8 text-right" readOnly value="1" />
      ) : (
        qtyCol("Qty").cell(r, 0)
      ),
  };

  const otherRateCol: CostCol = {
    ...rateCol("Rate"),
    labelFor: (r) => (r.rate_type === "percent" ? "%" : "Rate"),
  };

  const valueCol: CostCol = { ...amountCol, header: "Value (INR)" };

  /* Other Expenses — 144 + 112 + 112 + 112 + 112 + 112 + 72 + 72 + 72 + 112
     = 1032, + 72 = 1104 <= 1155 -> 5xl. Re-cut from 1,312: Order and Style are
     COLUMNS in the table even on an SQ Wise row (their cells stay empty —
     `showFor`), so they are paid for on every row; the text cells take the
     steps that pay for them. "Order Wise" and "Percentage" are ~10
     characters, which `range` holds with its chevron. */
  const expenseColumns: CostCol[] = withRowRules([
    { ...headCol("expense_head", "Cost Head"), width: FIELD_WIDTH_CSS.code },
    { ...descCol("Description"), width: FIELD_WIDTH_CSS.range },
    { ...scopeCol, width: FIELD_WIDTH_CSS.range },
    { ...scopeOrderCol, width: FIELD_WIDTH_CSS.range },
    { ...scopeStyleCol, width: FIELD_WIDTH_CSS.range },
    { ...otherRateTypeCol("Rate Type", ["per_unit", "flat", "percent"]), width: FIELD_WIDTH_CSS.range },
    { ...otherUnitCol, width: FIELD_WIDTH_CSS.num },
    { ...otherQtyCol, width: FIELD_WIDTH_CSS.num },
    { ...otherRateCol, width: FIELD_WIDTH_CSS.num },
    { ...valueCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Other Incomes — whole-budget scope, so no Type. 200 + 176 + 144 + 88 +
     112 = 720, + 72 = 792 <= 1155 -> 5xl. */
  const incomeColumns: CostCol[] = withRowRules([
    { ...headCol("income_head", "Income Head"), width: FIELD_WIDTH_CSS.party },
    { ...descCol("Description"), width: FIELD_WIDTH_CSS.term },
    { ...otherRateTypeCol("Basis", ["percent", "flat"]), width: FIELD_WIDTH_CSS.code },
    { ...{ ...otherRateCol, header: "Rate / %" }, width: FIELD_WIDTH_CSS.hug },
    { ...valueCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /**
   * THE COST GRIDS — one literal `<ChildGrid>` each, its `tableFrom` and its
   * `…Columns` array written ON THE TAG, so `npm run check:grid-budget` can
   * read both (it measured none of them while they went through a helper).
   *
   * Every grid: a table from `5xl`, one-frame cards below it (`flatRows`),
   * never a sideways scroll.
   *
   * THE LAST LINE CAN GO, AND A BLANK ONE TAKES ITS PLACE. The pulled grids
   * keep `keepOne={false}` so a typed line, or a pulled line the BOM no longer
   * has, can be removed even when it is the last row — every other pulled line
   * keeps no ✕ at all (`pulledRowLocked`, 0591). The table never empties
   * (AGENTS.md, default rows): `removeCost` refills it with a blank row, which is
   * never saved. Other Expenses / Incomes keep `keepOne`, as before.
   *
   * No `label=` caption: the section, and the tab inside it, names each grid.
   */
  const rowsOf = (source: string) => costs.filter((c) => c.source === source);
  /** A PULLED LINE CANNOT BE REMOVED (0591) — it is a cost the BOM says this
   *  order has, and the budget is the BOMs' answer with prices on it. A line
   *  that should not be paid for is FOC, not deleted. The one exception is a
   *  line the BOM no longer has (`staleKeys`), and a line typed by hand. */
  const pulledRowLocked = (r: CostRow) => r.from_bom && !staleKeys.has(r.key);
  const addCost = (source: BudgetSource) => mutCosts((xs) => [...xs, blankFor(newKey(), source)]);
  const removeCost = (r: CostRow) => {
    if (staleKeys.has(r.key)) {
      setStaleKeys((s0) => {
        const next = new Set(s0);
        next.delete(r.key);
        return next;
      });
    }
    if (r.key in rowNotes) {
      setRowNotes((n) => {
        const next = { ...n };
        delete next[r.key];
        return next;
      });
    }
    mutCosts((xs) => {
      const rest = xs.filter((x) => x.key !== r.key);
      return isSeeded(r.source) && !rest.some((x) => x.source === r.source)
        ? [...rest, blankFor(newKey(), r.source as BudgetSource)]
        : rest;
    });
  };

  const yarnPurchaseGrid = (
      <ChildGrid<CostRow>
        columns={yarnPurchaseColumns}
        rows={rowsOf("yarn")}
        tableFrom="7xl"
        flatRows
        renderMobileRow={(row, i) => costCard(yarnPurchaseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("yarn")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const fabricPurchaseGrid = (
      <ChildGrid<CostRow>
        columns={fabricPurchaseColumns}
        rows={rowsOf("fabric")}
        tableFrom="7xl"
        flatRows
        renderMobileRow={(row, i) => costCard(fabricPurchaseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("fabric")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const accessoryPurchaseGrid = (
      <ChildGrid<CostRow>
        columns={accessoryPurchaseColumns}
        rows={rowsOf("material")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(accessoryPurchaseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("material")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const yarnProcessGrid = (
      <ChildGrid<CostRow>
        columns={yarnProcessColumns}
        rows={rowsOf("yarn_process")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(yarnProcessColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("yarn_process")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const accessoryProcessGrid = (
      <ChildGrid<CostRow>
        columns={accessoryProcessColumns}
        rows={rowsOf("material_process")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(accessoryProcessColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("material_process")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  // A GARMENT STEP TYPED BY HAND IS PRICED ONCE PER PROCESS — `blankFor`
  // stamps `basis` 'process', the Processwise grain.
  const garmentProcessGrid = (
      <ChildGrid<CostRow>
        columns={garmentProcessColumns}
        rows={rowsOf("garment_process")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(garmentProcessColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("garment_process")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const cmtGrid = (
      <ChildGrid<CostRow>
        columns={cmtColumns}
        rows={rowsOf("cmt")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(cmtColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        lockRow={pulledRowLocked}
        onAdd={() => addCost("cmt")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const expenseGrid = (
      <ChildGrid<CostRow>
        columns={expenseColumns}
        rows={rowsOf("expense")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(expenseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={true}
        onAdd={() => addCost("expense")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const incomeGrid = (
      <ChildGrid<CostRow>
        columns={incomeColumns}
        rows={rowsOf("income")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(incomeColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={true}
        onAdd={() => addCost("income")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  // ---- Fabric Processes: the fold -------------------------------------------

  /** Every line of one process on one order, in the order the lines sit. */
  const fabricGroups: FabricGroup[] = [];
  for (const c of costs) {
    if (c.source !== "fabric_process") continue;
    const k = fabricGroupKey(c);
    const g = fabricGroups.find((x) => x.key === k);
    if (g) g.lines.push(c);
    else
      fabricGroups.push({
        key: k,
        garment_order_id: c.garment_order_id,
        process_id: c.process_id,
        lines: [c],
      });
  }
  const basisOf = (g: FabricGroup): BudgetLineBasis => g.lines[0]?.basis ?? "fabric";

  /** The group's one value, or "Mixed" — a summary cell is a single fact. */
  const oneOf = (vals: string[]) =>
    vals.length === 0 ? "" : vals.every((v) => v === vals[0]) ? vals[0] : "Mixed";

  /** Σ over the group, or the first line's sentence — never a part-sum. */
  const groupSum = (g: FabricGroup, f: (l: BudgetLineInput) => number | { refused: string }) => {
    // (`lineAmount` below is passed bare: a fabric process is never a percent line.)
    let n = 0;
    for (const l of g.lines) {
      const v = f(lineInput(l));
      if (isRefusal(v)) return v;
      n += v;
    }
    return Math.round(n * 1000) / 1000;
  };

  const fabricFoldColumns: FoldListColumn<FabricGroup>[] = [
    {
      header: "Process",
      width: "14rem",
      cell: (g) => <Truncated>{processName(g.process_id)}</Truncated>,
    },
    {
      header: "For",
      width: "7rem",
      cell: (g) => <span className="text-sm">{BASIS_LABELS[basisOf(g)]}</span>,
    },
    {
      header: "Unit",
      width: "5rem",
      cell: (g) => <span className="text-sm">{oneOf(g.lines.map((l) => uomCode(l.uom_id)))}</span>,
    },
    {
      header: "Reqd",
      width: "8rem",
      align: "right",
      cell: (g) => figure(groupSum(g, lineReqd)),
    },
    {
      header: "Rate Type",
      width: "7rem",
      cell: (g) => (
        <span className="text-sm">
          {oneOf(g.lines.map((l) => rateTypeLabel(l.rate_type, l.uom_id)))}
        </span>
      ),
    },
    {
      header: "Charges",
      width: "9rem",
      align: "right",
      // THE GROUP'S AMOUNT, refusing on its first unpriced line — a charge
      // summed over the priced half would look finished.
      cell: (g) => figure(groupSum(g, lineAmount)),
    },
  ];

  /**
   * CHANGE HOW A FABRIC PROCESS IS PRICED — per fabric, per colour, or once for
   * the whole process. The group's lines are REPLACED by the engine's split of
   * the Fabric BOM's breakdown; they are never edited into shape, because the
   * three grains are three different sets of rows over one quantity.
   *
   * A RATE SURVIVES ONLY WHEN IT WAS ONE RATE (`carryRate`): a single price for
   * every fabric is still a single price per colour, but three different prices
   * have no answer for a line that merges them, and guessing one would be a
   * number nobody typed. So it carries or it goes blank — and a blank rate holds
   * the cursor on the line, which is how the operator learns it needs one.
   *
   * The breakdown is fetched on the first change and kept (see
   * `fabricBreakdown`): the Fabric BOM report is not cheap, and switching back
   * and forth is exactly what an operator comparing grains does.
   */
  function refitFabricGroup(g: FabricGroup, basis: ProcessBasis) {
    const ids = pickedOrders.map((o) => o.garment_order_id as string);
    const orderKey = [...ids].sort().join(",");
    start(async () => {
      let groups: FabricBreakdownGroup[];
      let refusals: string[];
      if (fabricBreakdown?.orderKey === orderKey) {
        ({ groups, refusals } = fabricBreakdown);
      } else {
        const res = await loadFabricProcessBreakdown(ids);
        if (!res.ok) {
          toastError(res.error);
          return;
        }
        ({ groups, refusals } = res);
        setFabricBreakdown({ orderKey, groups, refusals });
      }
      const src = groups.find(
        (x) => x.garment_order_id === g.garment_order_id && x.process_id === g.process_id,
      );
      // FROM HERE ON, WHAT THE BREAKDOWN SAID ABOUT THIS GROUP goes under its
      // For select — the field whose change asked the question (Phase 7). Only
      // the fetch failing above is a toast: that is the server, not the group.
      const note = (msg: string | null) =>
        setFoldNotes((n) => {
          const next = { ...n };
          if (msg) next[g.key] = msg;
          else delete next[g.key];
          return next;
        });
      if (!src) {
        note(
          `${processName(g.process_id) || "This process"} is no longer on the order's Fabric BOM — pull the costs again`,
        );
        return;
      }
      const split = splitFabricProcess(src.rows, basis);
      if (split.length === 0) {
        // AN EMPTY SPLIT NEVER WIPES THE GROUP. The lines on screen are the
        // last answer anyone had; replacing them with nothing would drop the
        // process's cost from the budget on a report that had nothing to say.
        note(
          refusals[0] ??
            `The Fabric BOM has no quantities for ${processName(g.process_id) || "this process"} — the lines are left as they were`,
        );
        return;
      }
      const carried = carryRate(g.lines.map(lineInput));
      // FOC IS A FACT ABOUT THE WHOLE PROCESS OR ABOUT NONE OF IT. `carryRate`
      // leaves it alone; a group whose every line was free stays free, and a
      // mixed one has no answer for a merged line, so it goes back to paid.
      const allFoc = g.lines.length > 0 && g.lines.every((l) => l.is_foc);
      const fresh = split.map((sp) =>
        rowOf(newKey(), {
          source: "fabric_process",
          garment_order_id: g.garment_order_id,
          process_id: g.process_id,
          uom_id: src.uom_id,
          item_id: sp.item_id,
          combo: sp.combo,
          basis: sp.basis,
          description: sp.description,
          qty: sp.qty,
          rate: carried?.rate ?? null,
          currency_code: carried?.currency_code ?? null,
          ex_rate: carried?.ex_rate ?? null,
          rate_type: carried?.rate_type ?? null,
          is_foc: allFoc,
          // Still the BOM's kilograms at another grain — locked, like the lines
          // it replaces (0591).
          from_bom: true,
        }),
      );
      // IN PLACE — the group keeps its position among the other groups, so the
      // fold row the operator is standing on does not jump down the list.
      mutCosts((xs) => {
        const inGroup = (x: CostRow) =>
          x.source === "fabric_process" && fabricGroupKey(x) === g.key;
        const at = xs.findIndex(inGroup);
        const rest = xs.filter((x) => !inGroup(x));
        const before = at < 0 ? rest.length : xs.slice(0, at).filter((x) => !inGroup(x)).length;
        return [...rest.slice(0, before), ...fresh, ...rest.slice(before)];
      });
      // THE REPORT'S OWN SENTENCES for weights it could not place — said, so a
      // re-split cannot look complete while a fabric's kilograms are missing
      // from it. One sentence and a count, as the Save gate does. A clean split
      // clears the group's note.
      note(
        refusals.length === 0
          ? null
          : refusals.length === 1
            ? refusals[0]
            : `${refusals[0]} — and ${refusals.length - 1} more the Fabric BOM could not place`,
      );
    });
  }

  const fabricProcessList = (
    <ProcessFoldList<FabricGroup>
      columns={fabricFoldColumns}
      rows={fabricGroups}
      openKey={fabricOpenKey}
      onToggle={setFabricOpenKey}
      renderPanel={(g) => (
        <div className="space-y-3">
          <FieldGrid>
            {/* THE PANEL'S FIRST FIELD — the grain the lines below are split
                by. Changing it re-splits them; see `refitFabricGroup`. */}
            <Field
              label="For"
              size="sm"
              htmlFor={`bl-fold-${g.key}`}
              error={foldNotes[g.key] ?? null}
            >
              <Select
                id={`bl-fold-${g.key}`}
                disabled={!editable || isPending}
                value={basisOf(g)}
                onChange={(e) => refitFabricGroup(g, e.target.value as ProcessBasis)}
              >
                <option value="fabric">{BASIS_LABELS.fabric}</option>
                <option value="color">{BASIS_LABELS.color}</option>
                <option value="process">{BASIS_LABELS.process}</option>
              </Select>
            </Field>
          </FieldGrid>
          {/* The group's lines come from the split, so this grid cannot grow —
              and it may be emptied, like every pulled grid. */}
          <ChildGrid<CostRow>
            columns={fabricLineColumns(basisOf(g))}
            rows={g.lines}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => costCard(fabricLineColumns(basisOf(g)), row, i)}
            hideAdd
            lockExisting={!editable}
            keepOne={false}
            lockRow={pulledRowLocked}
            onAdd={() => false}
            onRemove={removeCost}
          />
        </div>
      )}
    />
  );

  // ---- the totals ----------------------------------------------------------

  /** The lines that SAVE — the seeded blanks dropped. Totals, validity and the
   *  payload all read this one list, so what is counted is what is written. */
  const enteredCosts = costs.filter((c) => !isBlankLine(c));

  const { totals, sales, general } = budgetFigures({
    lines: enteredCosts,
    facts: pickedFacts,
    entryDate: form.budget_date || null,
  });
  /** The picked orders' one currency and rate, read off Order Entry — null when
   *  there is none (no order yet, or orders that disagree). */
  const orderCurrency = isRefusal(sales.currency) ? null : sales.currency;
  const orderRate = typeof sales.conv === "number" ? sales.conv : null;

  // ---- the Amendment Protocol's record --------------------------------------

  /** The budget as last saved — its revision history lives there, not in the
   *  editor's state, because only the reopen RPC ever writes a revision. */
  const saved = editId ? (budgets.find((b) => b.id === editId) ?? null) : null;
  /** Oldest first (service order). */
  const revisions = saved?.revisions ?? [];
  const latestRevision = revisions.length > 0 ? revisions[revisions.length - 1] : null;
  /** What the latest reopen froze — the APPROVED figures the current ones are
   *  measured against in General. Absent until a budget has been reopened. */
  const baselineRows = latestRevision?.baseline
    ? compareToBaseline(latestRevision.baseline as Pick<BudgetBaseline, "general">, general)
    : null;


  // ---- the SQ facts --------------------------------------------------------

  /**
   * One fact about the group: the orders' shared value when they agree, else
   * `many`. DERIVED, never stored — the budget groups orders, and these belong
   * to the orders (doc/order/budget-purchase-rates.md, "The group model stays").
   * Blank with no order picked: an empty box, not a sentence about one.
   */
  const groupFact = (get: (o: BudgetableOrder) => string | null, many: string): string => {
    if (pickedFacts.length === 0) return "";
    const first = get(pickedFacts[0]);
    return pickedFacts.every((o) => get(o) === first) ? (first ?? "") : many;
  };
  const nOrders = `${pickedFacts.length} orders`;
  /** A header figure's text — blank when it refuses (the sentence is the
   *  Field's `error`) or when no order is picked. */
  const figureText = (v: number | string | { refused: string }) =>
    pickedFacts.length === 0 || isRefusal(v) ? "" : typeof v === "number" ? fmtNumber(v) : v;
  /** A header figure's refusal, for the Field's `error`. */
  const refusalOf = (v: number | string | { refused: string }) =>
    pickedFacts.length > 0 && isRefusal(v) ? v.refused : null;
  const asText = (v: number | string | { refused: string }) =>
    pickedFacts.length === 0
      ? ""
      : isRefusal(v)
        ? v.refused
        : typeof v === "number"
          ? fmtNumber(v)
          : v;

  // ---- validity ------------------------------------------------------------

  const firstUnpriced = totals.unpriced[0] ? enteredCosts[totals.unpriced[0].index] : null;
  const unscoped = enteredCosts.find(
    (c) =>
      c.source === "expense" &&
      ((c.scope !== "sq" && !c.garment_order_id) || (c.scope === "style" && !c.style_ref_no)),
  );

  const validity = sectionValidity({
    sections: [
      { key: "budget" },
      ...BUDGET_SECTIONS.map((s) => ({ key: s.key })),
      { key: "general" },
    ],
    values: form,
    fields: [
      { section: "budget", id: "bg-date", label: "Date", required: true, empty: (f) => !f.budget_date },
    ],
    extra: [
      ...(pickedOrders.length === 0
        ? [
            {
              section: "budget",
              label: "Orders",
              message: "Add at least one garment order.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(firstUnpriced
        ? [
            {
              // THE SECTION THAT HOLDS THE FIRST ONE, so a blocked Save lands on
              // the line rather than on a section that merely totals it.
              section: sectionOfSource(firstUnpriced.source),
              // THE FIELD, so a blocked Save lands the cursor in the very box
              // whose message is now showing under it (Phase 7).
              fieldId: totals.unpriced[0].field
                ? cellId(firstUnpriced, totals.unpriced[0].field)
                : undefined,
              label: "Cost lines",
              // The ENGINE'S sentence for the first one, and the count. A list of
              // eight identical messages is noise; one plus "and 7 more" is not.
              message:
                totals.unpriced.length === 1
                  ? totals.unpriced[0].reason
                  : `${totals.unpriced[0].reason} — and ${totals.unpriced.length - 1} more unpriced ${totals.unpriced.length === 2 ? "line" : "lines"}`,
              kind: "custom" as const,
            },
          ]
        : []),
      // A TYPE WITH NO SCOPE BEHIND IT. Type is not stored — the scope is — so
      // an Order Wise line saved without its order would come back as SQ Wise,
      // and be a percentage of the whole group's sales instead of one order's.
      ...(unscoped
        ? [
            {
              section: "expense",
              fieldId: cellId(unscoped, unscoped.garment_order_id ? "style" : "order"),
              label: "Other Expenses",
              message:
                unscoped.scope === "style" && unscoped.garment_order_id
                  ? "Choose the style this expense is for"
                  : "Choose the order this expense is for",
              kind: "custom" as const,
            },
          ]
        : []),
    ],
  });

  /**
   * A BLOCKED SAVE SAYS NOTHING OF ITS OWN — it turns every row's messages on
   * (`saveAttempted`) and takes the cursor to the first one, where the sentence
   * is already sitting under its field. It used to toast the sentence, which
   * named the problem and then vanished before the operator found the box.
   */
  const revealFirstProblem = () => {
    setSaveAttempted(true);
    const p = validity.first;
    if (!p) return;
    // Purchase Rates mounts ONE tab at a time, so the line's own tab has to be
    // the open one before the cursor can land on it.
    if (p.section === "purchase" && firstUnpriced) setPurchaseTab(firstUnpriced.source);
    // ...and Process Rates likewise, plus the FOLD: a Fabric Processes line
    // lives inside a group's panel, which is not in the DOM while it is shut.
    if (p.section === "process" && firstUnpriced) {
      setProcessTab(firstUnpriced.source);
      if (firstUnpriced.source === "fabric_process") setFabricOpenKey(fabricGroupKey(firstUnpriced));
    }
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "budget",
      label: "Budget",
      icon: Coins,
      // The orders live in this section now, so it is done once it has both.
      done: !!form.budget_date && pickedOrders.length > 0,
      content: (
        <SectionBody title="Budget">
          {/* WIDTHS, NOT TWELFTHS (Phase 6, the house convention — commits
              794b29e / 77fb979 / 8f37c22). Each field takes one of the seven
              `FIELD_WIDTH` steps by the KIND of value it holds, so a
              three-letter currency no longer spans a sixth of the pane.

              COMPACT BOXES, MORE OF THEM PER ROW (2026-09-19, four rounds in
              one day — keep all three in mind before changing this):
                1. each row cut to its own widths ended at 712 / 900 / 272 /
                   912px — a ragged edge, no column under another (shot 2946);
                2. stretching the fields to the pane filled it but blew a
                   3-letter Currency up to ~190px (shot 2947);
                3. the user: "compact the field size using the skill". So the
                   boxes keep their width STEP (raagam-screen-layout) and the
                   pane is used by putting the order facts on ONE row instead
                   of stretching any box.

                track     A term 176   B term 176   C party 200   D hug 88    E hug 88   then
                budget    Entry No     Date         Group         Currency    Exch. rate SQ Description (name 288)
                orders    SQ No        RE No        Customer      Order Qty   SQ Qty     Unit (hug 88)

                budget  176 + 176 + 200 + 88 + 88 + 288 = 1016 + 5 x 12 = 1076
                orders  176 + 176 + 200 + 88 + 88 + 88  =  816 + 5 x 12 =  876

              4. SQ DESCRIPTION MOVED UP beside the exchange rate (user, shot
                 2948): with it on the orders row the two rows ended 400px
                 apart (776 / 1176) and the gap sat right after Exchange rate.
                 Up here they end 200px apart and the widest row is 100px
                 narrower. It is an order fact on the budget's row — accepted
                 for the balance; every other order fact stays below.
              5. NO REMARK BOX (user, shot 2951: "no need remarks in new
                 budget"). It came with the first build (70c25a8, 2026-08-17),
                 was never in the client's budget blueprint, and no budget had
                 one. Only the editor dropped it: `order_budgets.remark` and the
                 optional schema field stay, so no migration was needed. The
                 approver's remark (`decision_remark`, mandatory on a reject)
                 and the Reopen remark are different fields and are untouched.

              The first five columns are shared, so Currency sits over Order
              Qty and Exchange rate over SQ Qty. The two rows split by WHO owns
              the value: the budget's own fields above, facts read off the
              picked orders below.

              A and B are `term`, not `code`: a document number in this house
              is "HO/RE/26-27/0001", 16 characters, ~150px — `code` (144)
              clipped the RE No, and Entry No / SQ No follow the same series.

              6. CURRENCY, EXCHANGE RATE AND SQ DESCRIPTION REMOVED (client,
                 2026-09-19, shot 2957), then Group (same day).
              7. ONE LINE (user, shot 2959: "align it in single line using the
                 required skill"). With four boxes gone, the two rows were two
                 short lines — Entry No · Date alone above the order facts. They
                 are one FieldRow now, and the two boxes whose values are short
                 took the step that fits the VALUE (raagam-screen-layout: width
                 by the kind of value), which is what makes the line fit:

                   Entry No  hug   88   a plain serial (0593), "1" … "9999"
                   Date      code 144   the house step for a date box
                   SQ No     term 176   a document number, "HO/…/26-27/0001"
                   RE No     term 176   the same series; the picker
                   Customer  party 200
                   Order Qty hug   88
                   SQ Qty    hug   88
                   Unit      num   72   "PCS" / "SETS"; a one-word label

                   88 + 144 + 176 + 176 + 200 + 88 + 88 + 72 = 1032,
                   + 7 x 12 gaps = 1116.

              THE CAP IS DEFINITE — 71rem, 1136px: the 1116 line plus 20px of
              slack so a sub-pixel font metric cannot wrap it. On the client's
              ~1,270px pane it is one line. On a pane narrower than 1116 (a
              1366 laptop's section is ~1090) the LAST box, Unit, folds onto a
              second line like any `FieldRow` — never a sideways scroll. Never
              `max-w-fit`: inside a container-query ancestor a content-sized cap
              resolves to zero (the Vendor bug, 8f37c22). */}
          <div className="max-w-[71rem]">
            <FieldRow>
              {/* THE BUDGET'S OWN NUMBER — a plain serial, 1, 2, 3 … (client,
                  2026-09-19), given by the database on first save (0593's
                  `trg_ob_assign_code`). A new budget shows the number it will
                  most likely get: one past the highest on the list. That is a
                  prediction, not a reservation — two people saving at once, or
                  a unit's budgets this user cannot see, can move it, and the
                  saved number is the database's. */}
              <Field label="Entry No" w="hug" htmlFor="bg-code">
                <Input id="bg-code" readOnly value={editCode ?? (editId ? "" : nextEntryNo)} />
              </Field>
              <Field
                label="Date"
                required
                w="code"
                htmlFor="bg-date"
                error={saveAttempted && !form.budget_date ? "Enter the budget date" : null}
              >
                <Input
                  id="bg-date"
                  type="date"
                  readOnly={!editable}
                  value={form.budget_date}
                  onChange={(e) => set({ budget_date: e.target.value })}
                />
              </Field>
              {/* NO GROUP BOX (client, 2026-09-19): a budget is one order's and
                  is known by its Entry No and RE No. `order_budgets.description`
                  stays in the schema and in what an older budget saved; the
                  editor just no longer asks for it. */}
              {/* NO CURRENCY, EXCHANGE RATE OR SQ DESCRIPTION (client, 2026-09-19,
                  screenshot 2957). Currency and rate are the ORDER's, fetched
                  from Order Entry and shown in the Sales bar below, which is
                  where they are used; a second, read-only copy up here was one
                  more box to read. SQ Description went because an order is
                  known by its RE No / SQ No, never by its description text. */}
              {/* THE SQ FACTS — read off the picked order, read-only, and so off
                  the Tab path by `readOnly` alone. The RE No is the one picker. */}
              <Field label="SQ No" w="term" htmlFor="bg-sq">
                <Input id="bg-sq" readOnly value={groupFact((o) => o.sq_no, nOrders)} />
              </Field>
              <Field label="RE No" required w="term" htmlFor="bg-re" error={reMessage}>
                {/* A budget saved over SEVERAL orders (the old grid allowed it)
                    shows them as text rather than a picker that could only
                    hold one of them. */}
                {editable && pickedFacts.length <= 1 ? (
                  <RecordPicker
                    id="bg-re"
                    label="RE No"
                    /* `compact` — the Field above already prints "RE No *";
                       without it the picker drew its own caption as well and
                       the label showed twice (screenshot 2958). */
                    compact
                    required
                    items={reOptions}
                    value={heldOrder?.garment_order_id ?? null}
                    onChange={(id) => pickReNo(id || null)}
                  />
                ) : (
                  <Input id="bg-re" readOnly value={groupFact((o) => o.re_no, nOrders)} />
                )}
              </Field>
              <Field label="Customer" w="party" htmlFor="bg-cust">
                <Input id="bg-cust" readOnly value={groupFact((o) => o.customer_name, "Mixed")} />
              </Field>
              {/* TWO QUANTITIES, AND PHASE 1 SHOWED THE WRONG ONE UNDER THIS NAME.
                  Order Qty is what was ORDERED (Σ po_qty — Avg Price divides by
                  it); SQ Qty is what will be MADE (order + excess + rejection +
                  approval — CMT and garment processes are priced on it). The
                  blueprint's own figures need both: 5028 sold, 5321 made.

                  A REFUSAL IS THE FIELD'S `error`, under the box, and the box
                  stays blank (Phase 7) — it used to be the box's VALUE, clipped
                  to 88px, with the whole sentence hidden in a hover `title`. */}
              <Field label="Order Qty" w="hug" htmlFor="bg-qty" error={refusalOf(sales.qty)}>
                <Input id="bg-qty" readOnly className="text-right" value={figureText(sales.qty)} />
              </Field>
              <Field label="SQ Qty" w="hug" htmlFor="bg-sqqty" error={refusalOf(groupSqQty)}>
                <Input id="bg-sqqty" readOnly className="text-right" value={figureText(groupSqQty)} />
              </Field>
              <Field label="Unit" w="num" htmlFor="bg-unit">
                <Input id="bg-unit" readOnly value={asText(sales.unit)} />
              </Field>
            </FieldRow>
          </div>

          {!editable && (
            <p className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {status === "submitted"
                ? "This budget is with the approver. It cannot be changed until it comes back."
                : perms.canApprove
                  ? "An approved budget cannot be changed. Reopen it (Amendment) to revise it — its orders stay locked until then."
                  : "An approved budget cannot be changed. An approver can reopen it (Amendment) to revise it."}
            </p>
          )}

          {revisions.length > 0 && <RevisionHistory revisions={revisions} />}
        </SectionBody>
      ),
    },
    /* OTHER INCOMES IS GONE FROM THE RAIL (client, 2026-09-19, shot 2957):
       duty drawback and export incentives are not added to an order budget by
       the merchandiser. Hidden here, not deleted from the engine: `income`
       stays a source (the partition check, and any line an older budget
       holds), it just has no table to type one into. */
    ...BUDGET_SECTIONS.filter((s) => s.key !== "income").map((s): FullScreenSection => {
      const lines = enteredCosts.filter((c) => (s.sources as readonly string[]).includes(c.source));
      /** THE STRIP CARRIES A COUNT even though the rail does not (operator
       *  rule 2): one tab is mounted at a time, and a line refusing on a closed
       *  tab is otherwise invisible from here. */
      const tabProblems = (source: string) =>
        totals.unpriced.filter((u) => enteredCosts[u.index]?.source === source).length;
      if (s.key === "purchase") {
        return {
          key: s.key,
          label: s.label,
          icon: SECTION_ICONS[s.key],
          done: lines.length > 0,
          content: (
            <SectionBody title={s.label}>
              <Tabs
                value={purchaseTab}
                onChange={setPurchaseTab}
                items={PURCHASE_TABS.map((t) => ({
                  key: t.source,
                  label: t.label,
                  done: lines.some((c) => c.source === t.source),
                  problems: tabProblems(t.source),
                  content:
                    t.source === "yarn"
                      ? yarnPurchaseGrid
                      : t.source === "fabric"
                        ? fabricPurchaseGrid
                        : accessoryPurchaseGrid,
                }))}
              />
            </SectionBody>
          ),
        };
      }

      if (s.key === "process") {
        return {
          key: s.key,
          label: s.label,
          icon: SECTION_ICONS[s.key],
          done: lines.length > 0,
          content: (
            <SectionBody title={s.label}>
              <Tabs
                value={processTab}
                onChange={setProcessTab}
                items={PROCESS_TABS.map((t) => ({
                  key: t.source,
                  label: t.label,
                  done: lines.some((c) => c.source === t.source),
                  problems: tabProblems(t.source),
                  content:
                    t.source === "yarn_process"
                      ? yarnProcessGrid
                      : t.source === "fabric_process"
                        ? fabricProcessList
                        : t.source === "material_process"
                          ? accessoryProcessGrid
                          : garmentProcessGrid,
                }))}
              />
            </SectionBody>
          ),
        };
      }

      if (s.key === "cmt") {
        return {
          key: s.key,
          label: s.label,
          icon: SECTION_ICONS[s.key],
          done: lines.length > 0,
          content: (
            <SectionBody title={s.label}>
              {cmtGrid}
            </SectionBody>
          ),
        };
      }

      return {
        key: s.key,
        label: s.label,
        icon: SECTION_ICONS[s.key],
        done: lines.length > 0,
        content: (
          <SectionBody title={s.label}>
            {s.key === "income" ? incomeGrid : expenseGrid}
          </SectionBody>
        ),
      };
    }),
    {
      // THE LAST ROW, READ-ONLY — the category matrix and the bottom line.
      // `done` when the profit resolves: that is the one question this page
      // exists to answer, and a refused profit is a budget still missing a fact.
      key: "general",
      label: "General",
      icon: PieChart,
      done: !isRefusal(totals.profit),
      content: (
        <SectionBody title="General">
          <BudgetGeneral summary={general} baseline={baselineRows} />
        </SectionBody>
      ),
    },
  ];

  // ---- the Amendment Protocol ----------------------------------------------

  /**
   * REOPEN AN APPROVED BUDGET — Amendment Protocol (doc/order/budget.md §4.4).
   *
   * The baseline — the approved figures and lines as they stood — is frozen
   * by the SERVER from the stored budget, through `figures.ts`, the assembly
   * this screen also reads. Built there rather than here so a stale tab cannot
   * freeze figures that were never approved.
   *
   * ONE CALL. The RPC inserts the revision and moves the budget to draft in one
   * transaction; two calls could leave a revision with no reopen, or a reopen
   * nobody can explain.
   */
  function reopen(answers: ReopenAnswers) {
    if (!editId) return;
    start(async () => {
      const res = await reopenBudget(editId, answers);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setReopenOpen(false);
      setStatus("draft");
      setDirty(false);
      success(
        `Budget reopened${res.revisionNo ? ` as Revision ${res.revisionNo}` : ""} — its orders are unlocked until it is approved again`,
      );
      router.refresh();
    });
  }

  // ---- saving --------------------------------------------------------------

  function payloadOf(): Parameters<typeof createOrderBudget>[0] {
    return {
      budget_date: form.budget_date,
      description: form.description || null,
      // THE ORDERS' TERMS, SNAPSHOT — approval routing (`currency_code` in the
      // flow context) and the approver's screen read these. A group with no
      // single rate stores 1, the column's own default: nothing converts
      // through it (`inrValue` uses each order's rate).
      currency_code: orderCurrency,
      exchange_rate: orderRate ?? 1,
      orders: pickedOrders.map((o, i) => {
        const oo = orderById.get(o.garment_order_id as string);
        return {
          sno: i + 1,
          garment_order_id: o.garment_order_id as string,
          // THE SNAPSHOT, taken at save. 0428: an approved budget must keep
          // meaning what it meant.
          sales_value: oo?.sales_value ?? null,
          sales_refusal: oo?.sales_refusal ?? null,
        };
      }),
      // `enteredCosts`, NOT `costs` — the seeded blank rows are dropped here.
      lines: enteredCosts.map((c, i) => ({
        sno: i + 1,
        source: c.source as BudgetSource,
        garment_order_id: c.garment_order_id,
        item_id: c.item_id,
        description: c.description || null,
        qty: numOrNull(c.qty),
        uom_id: c.uom_id,
        rate: numOrNull(c.rate),
        notes: null,
        specification: c.specification || null,
        // NULL TOGETHER OR NOT AT ALL (0572's check) — an INR line sends no rate.
        currency_code: INR_ONLY_SOURCES.has(c.source) ? null : c.currency_code || null,
        ex_rate:
          INR_ONLY_SOURCES.has(c.source) || !c.currency_code ? null : numOrNull(c.ex_rate),
        is_foc: c.is_foc,
        is_import: c.is_import,
        process_id: c.process_id,
        basis: c.basis,
        combo: c.combo,
        rate_type: c.rate_type,
        no_of_pcs: numOrNull(c.no_of_pcs),
        no_of_units: numOrNull(c.no_of_units),
        style_ref_no: c.style_ref_no,
        component_id: c.component_id,
        cost_head_id: c.cost_head_id,
        stage_id: c.stage_id,
        from_bom: c.from_bom,
        // 0574 — null each when not broken up. The schema derives `rate` from
        // these when any is set, so the two cannot be sent disagreeing.
        ...breakupOf(c),
      })),
    };
  }

  function submit() {
    setSaveAttempted(true);
    start(async () => {
      const res = editId
        ? await updateOrderBudget(editId, payloadOf())
        : await createOrderBudget(payloadOf());
      if (res.ok) {
        success(editId ? "Budget updated" : "Budget created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /** Save, then send to the approver — never one without the other. Submitting a
   *  budget whose latest edits are only in the browser is how an approver ends up
   *  approving a document nobody can reproduce. */
  function saveAndSubmit() {
    setSaveAttempted(true);
    start(async () => {
      const res = editId
        ? await updateOrderBudget(editId, payloadOf())
        : await createOrderBudget(payloadOf());
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const sent = await submitBudget(res.id as string);
      if (!sent.ok) {
        toastError(sent.error);
        return;
      }
      success("Budget sent for approval");
      setDirty(false);
      setMode("list");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteOrderBudget(id);
      if (res.ok) {
        success("Budget deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ------------------------------------------------------------

  /** The budget a queue card stands for — the one `in_budget` names. A
   *  submitted or approved budget is not deletable (with the approver / what
   *  purchase acts on), nor one ever reopened (0576's audit history):
   *  `canDeleteBudget` says so, as it did for the table's row action. */
  const budgetOfCard = (o: BudgetableOrder) =>
    o.in_budget ? (budgets.find((x) => x.id === o.in_budget?.id) ?? null) : null;

  /* NOT SENT WHILE THE BUDGET TRAILS ITS BOMs (0591) — a pending refresh or a
     line the BOM no longer has. `submitBudget` refuses it anyway; the button
     just does not offer what the server will refuse. */
  const canSubmit =
    editable &&
    canTransition(status, "submitted") &&
    validity.canSave &&
    enteredCosts.length > 0 &&
    bomDrift == null &&
    staleKeys.size === 0;

  return (
    <>
      <div className="space-y-4">
        {/* ONE LIST — the orders, as cards (user 2026-09-20, screenshot 2964:
            the page "listing two type, hold the card type listing, remove the
            budget … section"). The Budgets table and its search box are gone:
            every budget is reached through its order's card, which opens it,
            and deleted there too. "+ New Budget" moved into the header. */}
        <PageHeader
          title="Budgeting"
          description="Step 5 — cost a group of orders from their BOMs, and send the budget for approval."
          actions={
            perms.canCreate ? (
              <Button size="md" onClick={openNew}>
                + New Budget
              </Button>
            ) : undefined
          }
        />

        <BudgetQueue
          orders={data.orders}
          onOpen={openForOrder}
          canDelete={perms.canDelete}
          canDeleteRow={(o) => !!budgetOfCard(o) && canDeleteBudget(budgetOfCard(o)!)}
          onDelete={(o) => {
            const b = budgetOfCard(o);
            if (b) remove(b.id);
          }}
          isPending={isPending}
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">budget</span>
          </>
        }
        header={{
          initials: "BG",
          // The order it budgets, now that there is no Group to name it by.
          title:
            (pickedFacts.length === 1 ? (pickedFacts[0].re_no ?? pickedFacts[0].order_code) : null) ??
            (form.description || (editId ? "Budget" : "New budget")),
          badges: (
            <span className="flex items-center gap-2">
              <StatusPill tone={budgetStatusTone(status)}>{budgetStatusText(status)}</StatusPill>
              {latestRevision && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  Revision {latestRevision.revision_no}
                </span>
              )}
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </span>
          ),
          meta: (
            <>
              <span>
                {pickedOrders.length} {pickedOrders.length === 1 ? "order" : "orders"}
              </span>
              <span>· {enteredCosts.length} cost lines</span>
              {form.budget_date && <span>· {fmtDate(form.budget_date)}</span>}
              {editable && bomDrift != null && (
                <span className="font-medium text-warning">
                  · The BOMs changed since this budget was filled ({bomDrift}{" "}
                  {bomDrift === 1 ? "line" : "lines"}) — Refresh from BOMs
                </span>
              )}
              {editable && staleKeys.size > 0 && (
                <span className="font-medium text-warning">
                  · {staleKeys.size} {staleKeys.size === 1 ? "line is" : "lines are"} no longer on the BOM
                </span>
              )}
            </>
          ),
          // SUBMIT LIVES HERE, NOT IN THE FOOTER. See the file header:
          // `submitTargetOf` reads the footer's last enabled button, so Enter off
          // the last field would otherwise send the document for approval.
          right: editable ? (
            <span className="flex items-center gap-2">
              {/* ONE REFRESH FOR EVERY SOURCE — see `refreshFromBoms`. Picking an
                  order already fills its lines; this brings them back in step
                  after a BOM is edited. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  refreshFromBoms(
                    pickedOrders.map((o) => o.garment_order_id as string),
                    "refresh",
                  )
                }
                disabled={pickedOrders.length === 0 || isPending}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Refresh from BOMs
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={(e) => {
                  // `currentTarget`, never `target` — the click can land on the
                  // icon or the text node inside the button.
                  setCopyOrigin(e.currentTarget.getBoundingClientRect());
                  setCopyOpen(true);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy From
              </Button>
              {canSubmit && (
                <Button type="button" variant="outline" size="sm" onClick={saveAndSubmit} disabled={isPending}>
                  <Send className="h-4 w-4" aria-hidden />
                  Save &amp; send for approval
                </Button>
              )}
            </span>
          ) : canReopen(status) && perms.canApprove && editId ? (
            // THE ONLY WAY BACK FROM APPROVED, and the approver's alone. In the
            // header for the reason Submit is: a workflow act never sits in the
            // footer, where Enter off the last field would reach it.
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={(e) => {
                setReopenOrigin(e.currentTarget.getBoundingClientRect());
                setReopenOpen(true);
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reopen (Amendment)
            </Button>
          ) : undefined,
        }}
        sections={sections}
        summary={<BudgetSummaryBar totals={totals} sales={sales} />}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New budget",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save budget",
          canSave: validity.canSave && editable,
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />

      <CopyFromSheet
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        excludeId={editId}
        origin={copyOrigin}
        isPending={isPending}
        onCopy={copyFrom}
      />

      {reopenOpen && (
        <ReopenBudgetSheet
          onClose={() => setReopenOpen(false)}
          origin={reopenOrigin}
          isPending={isPending}
          budgetLabel={editCode ?? (form.description || "budget")}
          onReopen={reopen}
        />
      )}

      <CmtBreakupSheet
        open={!!breakupRow}
        onClose={() => setBreakupKey(null)}
        origin={breakupOrigin}
        title={
          breakupRow
            ? ["CMT breakup", breakupRow.style_ref_no ?? breakupRow.description, coordinateName(breakupRow)]
                .filter(Boolean)
                .join(" · ")
            : "CMT breakup"
        }
        values={breakupRow ?? BLANK_BREAKUP}
        editable={editable}
        onChange={(op, v) => breakupRow && setBreakup(breakupRow.key, op, v)}
      />
    </>
  );
}

const SOURCE_LABEL = Object.fromEntries(AMENDMENT_SOURCES.map((x) => [x.value, x.label]));
const TYPE_LABEL = Object.fromEntries(AMENDMENT_TYPES.map((x) => [x.value, x.label]));

/**
 * Every reopen of this budget, newest first — who, when, why. Read-only, and
 * text only: the history is append-only in the database (0576), so nothing
 * here is a field.
 *
 * Rows of text rather than a table (a screen composes, it does not draw): four
 * short facts and a sentence, with nothing to sort or select.
 */
function RevisionHistory({ revisions }: { revisions: OrderBudget["revisions"] }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-foreground">
        Revisions
      </h3>
      <ol className="divide-y divide-border rounded-lg border border-border">
        {[...revisions].reverse().map((r) => (
          <li key={r.id} className="space-y-0.5 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-semibold">Revision {r.revision_no}</span>
              <span>{SOURCE_LABEL[r.source] ?? r.source}</span>
              <span>{TYPE_LABEL[r.amendment_type] ?? r.amendment_type}</span>
              <span className="text-xs text-muted-foreground">
                {[r.reopened_by_name, fmtDateTime(r.reopened_at)].filter(Boolean).join(" · ")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{r.reason}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
