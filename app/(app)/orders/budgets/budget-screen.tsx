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

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Coins,
  Copy,
  Factory,
  PieChart,
  HandCoins,
  ListChecks,
  Receipt,
  RotateCcw,
  Scissors,
  Send,
  ShoppingCart,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
import { DataTable, type Column } from "@/components/ui/data-table";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { isInactive } from "@/lib/masters/inactive";
import { ProcessFoldList, type FoldListColumn } from "@/components/orders/process-fold-list";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
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
  pulledLineKey,
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
  currency_code: string;
  exchange_rate: string;
  remark: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({
  budget_date: today(),
  description: "",
  currency_code: "",
  exchange_rate: "1",
  remark: "",
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
const SEEDED_SOURCES: readonly BudgetSource[] = BUDGET_SOURCES.filter((s) => s !== "fabric_process");
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
}: {
  budgets: OrderBudget[];
  data: BudgetFormData;
  perms: Perms;
  /** The head pickers add and rename `config_lookups` rows — MASTER data. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
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
  const [search, setSearch] = useState("");
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

  useUnsavedGuard(dirty || isPending);

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

  const pickedOrders = orders.filter((o) => o.garment_order_id);

  const orderById = useMemo(
    () => new Map(data.orders.map((o) => [o.id, o] as const)),
    [data.orders],
  );

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
      currency_code: b.currency_code ?? "",
      exchange_rate: String(b.exchange_rate ?? 1),
      remark: b.remark ?? "",
    });
    setOrders(
      (b.orders ?? []).map((o) => ({ key: newKey(), garment_order_id: o.garment_order_id })),
    );
    setCosts(
      withSeededRows((b.lines ?? []).map((l) => rowOf(newKey(), l))),
    );
    setPurchaseTab(PURCHASE_TABS[0].source);
    setProcessTab(PROCESS_TABS[0].source);
    setFabricOpenKey(null);
    setBreakupKey(null);
    setTouched(new Set());
    setSaveAttempted(false);
    setRowNotes({});
    setFoldNotes({});
    setDirty(false);
    setMode("edit");
  }

  // ---- pulling the BOM costs ----------------------------------------------

  /**
   * ADDS the BOM lines that are not already here. Never replaces.
   *
   * Same call the Fabric BOM's seed makes and for the same reason: the button is
   * most useful on a half-built budget, and wholesale replacement would throw
   * away typed rates to re-add rows the operator had already accepted. "Already
   * here" is the engine's `pulledLineKey` — since 0573 a pulled cost is not
   * (source, order, item) alone: one fabric carries several processes, and a
   * colour-wise split carries one line per combo.
   *
   * ONE BUTTON, IN THE HEADER, for every source. It used to sit on the Costs
   * section; it now fills two sections (Purchase Rates and Process Rates), and a
   * copy in each would be two buttons doing one thing, one of them always on a
   * section the operator is not looking at.
   */
  function pullFromBoms() {
    const ids = orders.map((o) => o.garment_order_id).filter(Boolean) as string[];
    start(async () => {
      const res = await loadCostLines(ids);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const held = new Set(
        costs.filter((c) => PULLED_SOURCES.has(c.source as BudgetSource)).map(pulledLineKey),
      );
      // A FABRIC PROCESS GROUP ALREADY HERE IS THE OPERATOR'S SPLIT. The pull
      // brings each one fabric-wise; once a group has been re-split colour- or
      // process-wise its lines carry other keys, and matching line by line would
      // add the fabric-wise lines back BESIDE the split — the same cost twice.
      const heldGroups = new Set(
        costs.filter((c) => c.source === "fabric_process").map(fabricGroupKey),
      );
      const fresh = res.lines.filter((l) =>
        l.source === "fabric_process"
          ? !heldGroups.has(fabricGroupKey(l))
          : !held.has(pulledLineKey(l)),
      );

      if (fresh.length === 0) {
        success("Every BOM line for these orders is already on the budget");
        return;
      }
      // THE SEEDED BLANK MAKES WAY. A tab that receives real lines loses its
      // untouched blank row, which would otherwise sit among the BOM's lines
      // looking like one of them. A row the operator has typed on is not blank
      // (`isBlankLine`) and stays.
      const filled = new Set<string>(fresh.map((l) => l.source));
      mutCosts((xs) => [
        ...xs.filter((x) => !(filled.has(x.source) && isBlankLine(x))),
        ...fresh.map((l) => rowOf(newKey(), l)),
      ]);
      success(
        res.skipped > 0
          ? // THE SKIPPED COUNT IS SAID OUT LOUD. A refused BOM figure dropped
            // in silence makes a budget look complete while a real cost is
            // missing from it — and this document gets approved.
            `${fresh.length} cost lines pulled · ${res.skipped} BOM figures skipped as unanswered`
          : `${fresh.length} cost line${fresh.length === 1 ? "" : "s"} pulled from the BOMs`,
      );
    });
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

  const orderColumns: ChildGridColumn<OrderRow>[] = [
    {
      header: "Garment order",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Garment order"
          compact
          required
          disabled={!editable}
          items={data.orders.map((o) => ({
            id: o.id,
            code: o.sc_no ?? o.order_code,
            name: [o.sc_no ?? o.order_code, o.po_no, o.customer_name].filter(Boolean).join(" · "),
            inactive: false,
          }))}
          // PICK-ONCE. The same order twice would double its costs and its sales
          // value, and the totals would look internally consistent.
          usedIds={orders.filter((x) => x.key !== r.key).map((x) => x.garment_order_id ?? "")}
          value={r.garment_order_id}
          onChange={(id) =>
            mutOrders((xs) => xs.map((x) => (x.key === r.key ? { ...x, garment_order_id: id } : x)))
          }
        />
      ),
    },
    {
      header: "Customer",
      width: "12rem",
      cell: (r) => (
        <Truncated>
          {(r.garment_order_id && orderById.get(r.garment_order_id)?.customer_name) || "—"}
        </Truncated>
      ),
    },
    {
      header: "Delivery",
      width: "8rem",
      cell: (r) => {
        const d = r.garment_order_id ? orderById.get(r.garment_order_id)?.delivery_date : null;
        return <span className="tabular-nums text-sm">{d ? fmtDate(d) : "—"}</span>;
      },
    },
    {
      header: "Order value",
      align: "right",
      width: "12rem",
      cell: (r) => {
        const o = r.garment_order_id ? orderById.get(r.garment_order_id) : null;
        if (!o) return <span className="text-muted-foreground">—</span>;
        // THE REFUSAL IS PRINTED. "No value" and "not valued yet" are the same
        // empty cell otherwise, and only one of them is something to act on.
        return o.sales_value == null ? (
          <span className="text-xs text-danger">{o.sales_refusal ?? "no value"}</span>
        ) : (
          <span className="tabular-nums text-sm">{fmtNumber(o.sales_value)}</span>
        );
      },
    },
    {
      header: "Already budgeted",
      width: "11rem",
      cell: (r) => {
        const b = r.garment_order_id ? orderById.get(r.garment_order_id)?.in_budget : null;
        if (!b || b.id === editId) return <span className="text-muted-foreground">—</span>;
        // ADVISORY, never a block. Two DRAFT budgets over one order is someone
        // comparing two groupings; only APPROVAL is refused (0428), and it is
        // refused by the server with the other budget named.
        return (
          <span className={b.status === "approved" ? "text-xs text-danger" : "text-xs text-warning"}>
            {b.code ?? "another budget"} ({budgetStatusText(b.status)})
          </span>
        );
      },
    },
  ];

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
        disabled={!editable}
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
        readOnly={!editable}
        value={r.description}
        onChange={(e) => setCost(r.key, { description: e.target.value })}
      />
    ),
  });

  const specCol: CostCol = {
    header: "Brand / Specifications",
    cell: (r) => (
      <Input
        className="h-8"
        readOnly={!editable}
        value={r.specification}
        onChange={(e) => setCost(r.key, { specification: e.target.value })}
      />
    ),
  };

  const qtyCol = (header: string): CostCol => ({
    header,
    requiredFor: qtyRequired,
    cell: (r) => (
      <>
        <Input
          {...errProps(r, "qty")}
          className="h-8 text-right"
          required={qtyRequired(r)}
          readOnly={!editable}
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
        disabled={!editable}
        items={data.uoms}
        value={r.uom_id}
        onChange={(id) => setCost(r.key, { uom_id: id })}
      />
    ),
  };

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

  /**
   * THE CURRENCY'S BLANK IS INR, AND SAYS SO. `currency_code` NULL is INR by
   * 0572's definition, so the empty option is labelled with the currency it
   * stands for rather than left blank — and picking INR from the list stores
   * the same NULL, so there is exactly one way to say "rupees".
   *
   * Clearing the currency clears the exchange rate with it (0572's check:
   * the two are null together). Choosing one fills the rate only from the
   * budget's OWN header rate for that same currency; otherwise it stays blank
   * for the operator, and `lineInrRate` refuses with a sentence until it is.
   */
  const pickCurrency = (r: CostRow, raw: string) => {
    const code = raw === "INR" ? "" : raw;
    const ex_rate = !code
      ? ""
      : code === r.currency_code
        ? r.ex_rate
        : code === form.currency_code
          ? form.exchange_rate
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
        disabled={!editable}
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
   * FOC and Import as ONE cell — two 36px switches side by side, FOC first,
   * each carrying its own `aria-label`. Merged because two separate `num`
   * columns (144px) cost the yarn grid its table on the client's display, and
   * the pair is 88px here (Phase 6's own suggested re-cut). `hug`: 36 + 4 + 36
   * + the cell's 12px padding = 88. Splitting them back would put Yarn
   * Purchases at 1152px against the 1155px budget — 3px from dropping to cards.
   *
   * EACH SWITCH NAMES ITSELF (user 2026-09-19, screenshot 2950: "why this
   * screen have two toggle button single field"). The header "FOC · Import"
   * named the pair, but nothing said WHICH switch was which, so the cell read as
   * one field with two toggles. A 10px caption sits over each switch — the
   * cell stays 88px wide — and `min-h-0` drops `Toggle`'s 36px floor so
   * caption + gap + switch (10 + 2 + 20) fits the row's 32px controls instead
   * of growing every line. The captions are `aria-hidden`: each checkbox
   * already carries its own name ("Free of cost", "Imported").
   */
  const flagsCol: CostCol = {
    header: "FOC · Import",
    cell: (r) => (
      <span className="inline-flex items-end gap-1">
        {(
          [
            ["is_foc", "FOC", "Free of cost"],
            ["is_import", "Import", "Imported"],
          ] as const
        ).map(([key, caption, aria]) => (
          <span key={key} className="flex w-9 flex-col items-center gap-0.5">
            <span aria-hidden className="text-[10px] leading-none text-muted-foreground">
              {caption}
            </span>
            {flagToggle(r, key, aria, "min-h-0")}
          </span>
        ))}
      </span>
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
     the yarn; the text is the pulled line's note), Curr and Rate -> num. */
  const yarnPurchaseColumns: CostCol[] = withRowRules([
    { ...itemCol("Yarn"), width: FIELD_WIDTH_CSS.code },
    { ...descCol("Description"), width: FIELD_WIDTH_CSS.hug },
    { ...specCol, width: FIELD_WIDTH_CSS.range },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...flagsCol, width: FIELD_WIDTH_CSS.hug },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Fabric Purchases — 176 + 200 + 88 + 72 + 72 + 72 + 88 + 88 + 112 = 968,
     + 72 = 1040 <= 1155 -> 5xl. */
  const fabricPurchaseColumns: CostCol[] = withRowRules([
    { ...itemCol("Fabric"), width: FIELD_WIDTH_CSS.term },
    { ...descCol("Fabric & Colour"), width: FIELD_WIDTH_CSS.party },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.num },
    { ...currencyCol, width: FIELD_WIDTH_CSS.num },
    { ...exRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...inrRateCol, width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
  ]);

  /* Accessories Purchases — 144 + 112 + 88 + 72 + 88 + 88 + 72 + 88 + 72 + 88
     + 112 = 1024, + 72 = 1096 <= 1155 -> 5xl. Yarn's re-cut; Specifications
     takes the `hug` here and Colour keeps `range`, because on a trim the colour
     is the fact that varies. */
  const accessoryPurchaseColumns: CostCol[] = withRowRules([
    { ...itemCol("Item"), width: FIELD_WIDTH_CSS.code },
    { ...descCol("Colour / Description"), width: FIELD_WIDTH_CSS.range },
    { ...specCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...qtyCol("Reqd"), width: FIELD_WIDTH_CSS.hug },
    { ...flagsCol, width: FIELD_WIDTH_CSS.hug },
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
   * THE LAST LINE CAN GO, AND A BLANK ONE TAKES ITS PLACE. A PULLED grid's rows
   * come from the BOMs, and removing the last one is a cost the operator decided
   * not to budget — so the pulled grids keep `keepOne={false}` and the ✕ still
   * works on the last row. But the table never empties (AGENTS.md, default rows):
   * `removeCost` refills it with a blank row, which is never saved. Other
   * Expenses / Incomes keep `keepOne`, as before.
   *
   * No `label=` caption: the section, and the tab inside it, names each grid.
   */
  const rowsOf = (source: string) => costs.filter((c) => c.source === source);
  const addCost = (source: BudgetSource) => mutCosts((xs) => [...xs, blankFor(newKey(), source)]);
  const removeCost = (r: CostRow) =>
    mutCosts((xs) => {
      const rest = xs.filter((x) => x.key !== r.key);
      return isSeeded(r.source) && !rest.some((x) => x.source === r.source)
        ? [...rest, blankFor(newKey(), r.source as BudgetSource)]
        : rest;
    });

  const yarnPurchaseGrid = (
      <ChildGrid<CostRow>
        columns={yarnPurchaseColumns}
        rows={rowsOf("yarn")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(yarnPurchaseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
        onAdd={() => addCost("yarn")}
        onRemove={removeCost}
        addLabel="+ Add line"
      />
  );

  const fabricPurchaseGrid = (
      <ChildGrid<CostRow>
        columns={fabricPurchaseColumns}
        rows={rowsOf("fabric")}
        tableFrom="5xl"
        flatRows
        renderMobileRow={(row, i) => costCard(fabricPurchaseColumns, row, i)}
        hideAdd={!editable}
        lockExisting={!editable}
        keepOne={false}
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
      { key: "orders" },
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
              section: "orders",
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
      ...(numOrNull(form.exchange_rate) == null || (numOrNull(form.exchange_rate) as number) <= 0
        ? [
            {
              section: "budget",
              fieldId: "budget-exchange-rate",
              label: "Exchange rate",
              message: "Exchange rate must be more than 0",
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
      done: !!form.budget_date,
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
                remark    Remark, to the cap

                budget  176 + 176 + 200 + 88 + 88 + 288 = 1016 + 5 x 12 = 1076
                orders  176 + 176 + 200 + 88 + 88 + 88  =  816 + 5 x 12 =  876

              4. SQ DESCRIPTION MOVED UP beside the exchange rate (user, shot
                 2948): with it on the orders row the two rows ended 400px
                 apart (776 / 1176) and the gap sat right after Exchange rate.
                 Up here they end 200px apart and the widest row is 100px
                 narrower. It is an order fact on the budget's row — accepted
                 for the balance; every other order fact stays below.

              The first five columns are shared, so Currency sits over Order
              Qty and Exchange rate over SQ Qty. The two rows split by WHO owns
              the value: the budget's own fields above, facts read off the
              picked orders below.

              A and B are `term`, not `code`: a document number in this house
              is "HO/RE/26-27/0001", 16 characters, ~150px — `code` (144)
              clipped the RE No, and Entry No / SQ No follow the same series.

              THE CAP IS DEFINITE — 68rem, 1088px: the 1076 budget row plus
              12px of slack so a sub-pixel font metric cannot wrap it, and the
              Remark ends on that same edge. Below it (a 1366 laptop's pane is
              ~1090px, so it just fits) a row folds its last field onto a new
              line, like any `FieldRow`, rather than scrolling. Never `max-w-fit`:
              inside a container-query ancestor a content-sized cap resolves to
              zero (the Vendor bug, 8f37c22). */}
          <div className="max-w-[68rem] space-y-2">
            <FieldRow>
              {/* THE BUDGET'S OWN NUMBER — assigned on first save, so blank on a
                  new one rather than a guess at what it will be. */}
              <Field label="Entry No" w="term" htmlFor="bg-code">
                <Input id="bg-code" readOnly value={editCode ?? ""} />
              </Field>
              <Field
                label="Date"
                required
                w="term"
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
              <Field label="Group" w="party" htmlFor="bg-desc">
                <Input
                  id="bg-desc"
                  readOnly={!editable}
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
              {/* THE CODE ONLY — "USD", not "USD · US Dollar". The field is
                  `hug` (88px); the name beside the code would be clipped to
                  "USD · U…" in every row it appears, and the code is what the
                  operator types to find it anyway. */}
              <Field label="Currency" w="hug" htmlFor="bg-cur">
                <Select
                  id="bg-cur"
                  disabled={!editable}
                  value={form.currency_code}
                  onChange={(e) => set({ currency_code: e.target.value })}
                >
                  <option value=""></option>
                  {data.currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Exchange rate"
                w="hug"
                htmlFor="budget-exchange-rate"
                error={
                  numOrNull(form.exchange_rate) == null || (numOrNull(form.exchange_rate) as number) <= 0
                    ? "Exchange rate must be more than 0"
                    : null
                }
              >
                <Input
                  id="budget-exchange-rate"
                  inputMode="decimal"
                  readOnly={!editable}
                  value={form.exchange_rate}
                  onChange={(e) => set({ exchange_rate: e.target.value })}
                />
              </Field>
              {/* UP HERE, beside the exchange rate, to fill that row's gap — see
                  the layout comment above (user, screenshot 2948). */}
              <Field label="SQ Description" w="name" htmlFor="bg-sqd">
                <Input id="bg-sqd" readOnly value={groupFact((o) => o.sq_description, "Mixed")} />
              </Field>
            </FieldRow>
            {/* THE SQ FACTS — read off the picked orders, read-only, and so off
                the Tab path by `readOnly` alone. */}
            <FieldRow>
              <Field label="SQ No" w="term" htmlFor="bg-sq">
                <Input id="bg-sq" readOnly value={groupFact((o) => o.sq_no, nOrders)} />
              </Field>
              <Field label="RE No" w="term" htmlFor="bg-re">
                <Input id="bg-re" readOnly value={groupFact((o) => o.re_no, nOrders)} />
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
              <Field label="Unit" w="hug" htmlFor="bg-unit">
                <Input id="bg-unit" readOnly value={asText(sales.unit)} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Remark" htmlFor="bg-remark" className="w-full">
                <Textarea
                  id="bg-remark"
                  rows={2}
                  readOnly={!editable}
                  value={form.remark}
                  onChange={(e) => set({ remark: e.target.value })}
                />
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
    {
      key: "orders",
      label: "Orders",
      icon: ListChecks,
      done: pickedOrders.length > 0,
      content: (
        <SectionBody title="Orders">
          <ChildGrid<OrderRow>
            columns={orderColumns}
            rows={orders}
            seedRow
            hideAdd={!editable}
            lockExisting={!editable}
            onAdd={() => mutOrders((xs) => [...xs, { key: newKey(), garment_order_id: null }])}
            onRemove={(r) => mutOrders((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add order"
          />
          {/* UNDER THE GRID IT IS ABOUT — a blocked Save used to toast it. Only
              once a Save was tried: a new budget with no order yet is not an
              error, it is a budget nobody has started. */}
          <FieldError id="bg-orders-error">
            {saveAttempted && pickedOrders.length === 0 ? "Add at least one garment order." : null}
          </FieldError>
        </SectionBody>
      ),
    },
    ...BUDGET_SECTIONS.map((s): FullScreenSection => {
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
      currency_code: form.currency_code || null,
      exchange_rate: numOrNull(form.exchange_rate) ?? 1,
      remark: form.remark || null,
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return budgets;
    return budgets.filter((b) =>
      [b.code, b.description].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [budgets, search]);

  const columns: Column<OrderBudget>[] = [
    {
      header: "Budget",
      cell: (b) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => openExisting(b.id)}
        >
          {b.code ?? b.id.slice(0, 8)}
        </button>
      ),
    },
    { header: "Group", cell: (b) => <Truncated>{b.description ?? "—"}</Truncated> },
    {
      header: "Date",
      cell: (b) => <span className="tabular-nums text-sm">{fmtDate(b.budget_date)}</span>,
    },
    {
      header: "Orders",
      align: "right",
      cell: (b) => <span className="tabular-nums text-sm">{(b.orders ?? []).length}</span>,
    },
    {
      header: "Lines",
      align: "right",
      cell: (b) => <span className="tabular-nums text-sm">{(b.lines ?? []).length}</span>,
    },
    {
      header: "Status",
      cell: (b) => <StatusPill tone={budgetStatusTone(b.status)}>{budgetStatusText(b.status)}</StatusPill>,
    },
    rowActionsColumn<OrderBudget>((b) => (
      <RowActions
        label={b.code ?? b.description}
        onEdit={() => openExisting(b.id)}
        canEdit={perms.canEdit}
        // A SUBMITTED OR APPROVED BUDGET IS NOT DELETABLE. The first is with
        // someone else and the second is what purchase is acting on.
        // `canDeleteBudget`: draft or rejected AND never reopened — a reopened
        // budget's revisions are the Amendment Protocol's audit history, and the
        // server and 0576 both refuse to delete it.
        canDelete={perms.canDelete && canDeleteBudget(b)}
        onDelete={() => remove(b.id)}
        deleteLabel="Delete budget"
        isPending={isPending}
      />
    )),
  ];

  const canSubmit =
    editable && canTransition(status, "submitted") && validity.canSave && enteredCosts.length > 0;

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Budgeting"
          description="Step 5 — cost a group of orders from their BOMs, and send the budget for approval."
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* caps-input: exempt -- a search QUERY is not a stored value. */}
          <Input uppercase={false}
            className="w-64"
            placeholder="Search budget or group…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
            {perms.canCreate && (
              <Button size="md" onClick={openNew}>
                + New Budget
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(b) => b.id}
          empty="No budgets yet. A budget groups several orders and costs them from their BOMs."
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
          title: form.description || (editId ? "Budget" : "New budget"),
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
            </>
          ),
          // SUBMIT LIVES HERE, NOT IN THE FOOTER. See the file header:
          // `submitTargetOf` reads the footer's last enabled button, so Enter off
          // the last field would otherwise send the document for approval.
          right: editable ? (
            <span className="flex items-center gap-2">
              {/* ONE PULL FOR EVERY SOURCE — see `pullFromBoms`. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pullFromBoms}
                disabled={pickedOrders.length === 0 || isPending}
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Pull costs from the BOMs
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
