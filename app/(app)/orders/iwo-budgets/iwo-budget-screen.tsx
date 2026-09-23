"use client";

/**
 * Orders ▸ Order Execution ▸ IWO Budget — the budget of an Internal Work Order
 * (0594; client audio 2026-09-19: "Completed IWO BOMs auto-populate into the
 * Budget screen under the respective Yarn, Fabric or Accessories purchase /
 * process tabs", and the merchandiser types the rates).
 *
 * A SEPARATE SCREEN, by the user's decision: the order Budget
 * (`app/(app)/orders/budgets/`) is garment-order-keyed at every layer. What is
 * SHARED is the arithmetic — every line is valued by the order Budget's own
 * `lineAmount` / `lineInrRate` / `budgetTotals`, so an IWO line and an order
 * line with the same quantity and rate cost the same, to the paisa.
 *
 * WHAT IS NOT HERE, AND WHY: no Customer, Cut Qty, Order Qty, Sales, Profit or
 * margin — a stock run has no buyer, and `budgetTotals` refuses sales rather
 * than printing 0; no CMT or Garment Processes — nothing is sewn; no percent
 * rate — there is no sales value to take a percent of (0594 refuses it).
 *
 * PULLED LINES FOLLOW THE BOM. Picking a work order pulls its BOM's lines;
 * "Refresh from BOM" re-reads them (`merge.ts`): the BOM's quantity, unit and
 * stage replace a pulled line's, the typed rate stays, a line the BOM dropped
 * is flagged rather than deleted. On a pulled line only the rate and its terms
 * are typed — the rest is the BOM's (`lockRow` keeps its ✕ off until stale).
 */

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Calculator, ClipboardList, Package, Receipt, Users, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, FIELD_WIDTH_CSS, fieldWidthStep, RequiredScope } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
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
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import {
  createdByFacet,
  createdDateFacet,
  urgencyFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";
import { Toggle } from "@/components/ui/toggle";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import { stageRank } from "@/lib/orders/fabric-bom/stage-routes";
import { IWO_FOR, IWO_FOR_LABELS, type IwoFor } from "@/lib/orders/internal-work-orders/types";
import { budgetTotals, isRefusal, lineAmount, lineInrRate } from "@/lib/orders/budget/totals";
import { lineInputOf } from "@/lib/orders/budget/figures";
import type { IwoBudgetSource, IwoPulledLine } from "@/lib/orders/iwo-budget/pull";
import {
  IWO_BUDGET_GRIDS,
  IWO_BUDGET_SOURCE_LABELS,
  type IwoBudgetLineRow,
} from "@/lib/orders/iwo-budget/types";
import {
  isBlankIwoBudgetLine,
  iwoBudgetProblems,
  keptIwoBudgetLines,
  sourcesFor,
  type IwoBudgetLineFacts,
} from "@/lib/orders/iwo-budget/rules";
import { iwoMergeIsEmpty, mergeIwoPulled } from "@/lib/orders/iwo-budget/merge";
import {
  deleteIwoBudget,
  loadIwoCostLines,
  reopenIwoBudget,
  saveIwoBudget,
  submitIwoBudget,
} from "@/lib/orders/iwo-budget/actions";
import type { IwoBudgetFormData, IwoBudgetTask } from "@/lib/orders/iwo-budget/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean };

// React keys from a module counter, as the order screens do — not a ref.
let keySeq = 0;
const newKey = () => `k${keySeq++}`;

/** One line as the grids edit it. Numbers are held as the TEXT typed. */
type CostRow = {
  key: string;
  source: IwoBudgetSource;
  item_id: string | null;
  process_id: string | null;
  cost_head_id: string | null;
  stage_id: string | null;
  description: string;
  specification: string;
  combo: string;
  basis: "process" | "fabric" | "color" | null;
  qty: string;
  uom_id: string | null;
  rate: string;
  rate_type: "per_unit" | "flat";
  /** "" = INR (0572). */
  currency_code: string;
  ex_rate: string;
  is_foc: boolean;
  is_import: boolean;
  from_bom: boolean;
  /** SCREEN STATE, NEVER SENT: a pulled line the BOM no longer has (`merge.ts`). */
  stale: boolean;
};

/** EVERY SEED IS BLANK but its Qty: 1 is pre-filled VISIBLY for a typed line,
 *  the order Budget's rule — and `isBlankIwoBudgetLine` never reads Qty, so an
 *  untouched seed is still dropped on save. */
const blankCost = (source: IwoBudgetSource): CostRow => ({
  key: newKey(),
  source,
  item_id: null,
  process_id: null,
  cost_head_id: null,
  stage_id: null,
  description: "",
  specification: "",
  combo: "",
  basis: null,
  qty: "1",
  uom_id: null,
  rate: "",
  rate_type: "per_unit",
  currency_code: "",
  ex_rate: "",
  is_foc: false,
  is_import: false,
  from_bom: false,
  stale: false,
});

const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};

const rowOfStored = (l: IwoBudgetLineRow): CostRow => ({
  key: newKey(),
  source: l.source,
  item_id: l.item_id,
  process_id: l.process_id,
  cost_head_id: l.cost_head_id,
  stage_id: l.stage_id,
  description: l.description ?? "",
  specification: l.specification ?? "",
  combo: l.combo ?? "",
  basis: l.basis,
  qty: str(l.qty),
  uom_id: l.uom_id,
  rate: str(l.rate),
  rate_type: l.rate_type,
  currency_code: l.currency_code ?? "",
  ex_rate: str(l.ex_rate),
  is_foc: l.is_foc,
  is_import: l.is_import,
  from_bom: l.from_bom,
  stale: false,
});

/** The BOM's facts on a line — what a pull or a refresh writes. */
const bomFacts = (l: IwoPulledLine): Partial<CostRow> => ({
  source: l.source,
  item_id: l.item_id,
  process_id: l.process_id,
  combo: l.combo ?? "",
  basis: l.basis,
  qty: str(l.qty),
  uom_id: l.uom_id,
  stage_id: l.stage_id,
  from_bom: true,
  stale: false,
  // FOC on an accessory is the Material BOM line's (the order Budget's rule).
  ...(l.source === "material" ? { is_foc: l.is_foc, specification: l.specification ?? "" } : {}),
});

const factsOf = (r: CostRow): IwoBudgetLineFacts => ({
  source: r.source,
  item_id: r.item_id,
  process_id: r.process_id,
  cost_head_id: r.cost_head_id,
  description: r.description.trim() || null,
  qty: num(r.qty),
  rate: num(r.rate),
  rate_type: r.rate_type,
  currency_code: r.currency_code || null,
  ex_rate: num(r.ex_rate),
  is_foc: r.is_foc,
  from_bom: r.from_bom,
});

/** One row as the order Budget's engine reads it. */
const engineLine = (r: CostRow) => lineInputOf(factsOf(r));

/**
 * The holds — a seeded row holds nothing until something is typed on it (the
 * order Budget's `qtyRequired` / `rateRequired` / `exRateRequired`).
 */
const qtyRequired = (r: CostRow) => r.rate_type === "per_unit" && !isBlankIwoBudgetLine(factsOf(r));
const rateRequired = (r: CostRow) => !r.is_foc && !isBlankIwoBudgetLine(factsOf(r));
const exRateRequired = (r: CostRow) => !!r.currency_code && !isBlankIwoBudgetLine(factsOf(r));

type CostCol = ChildGridColumn<CostRow> & {
  requiredFor?: (r: CostRow) => boolean;
  /** Per-ROW presence — the cell is empty in the table and absent from the
   *  card when this says no (the order Budget's `showFor`). */
  showFor?: (r: CostRow) => boolean;
};

/** Per-ROW required: the column's star for the table header, the row's own
 *  `RequiredScope` for the hold (the order Budget's `withRowRules`). */
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
 * THE CARD KEEPS THE TABLE'S WIDTHS — each cell a `Field` at the step its
 * column declared, in a wrapping `FieldRow` (the order Budget's `costCard`,
 * and its note on why a `FieldGrid` of `size="sm"` cells was a quarter of the
 * pane each; user 2026-09-21).
 */
// grid-required-mobile: exempt -- every cost grid's renderMobileRow is costCard(), which declares `required` on each Field from requiredFor(row), and withRowRules() gives each such cell its own RequiredScope — the order Budget's shape
function costCard(columns: CostCol[], row: CostRow, i: number) {
  return (
    <FieldRow align="start" gap="tight">
      {columns.map((c, ci) =>
        c.showFor && !c.showFor(row) ? null : (
          <Field
            key={ci}
            label={c.header}
            required={c.requiredFor ? c.requiredFor(row) : c.required}
            w={fieldWidthStep(c.width) ?? "hug"}
          >
            {c.cell(row, i)}
          </Field>
        ),
      )}
    </FieldRow>
  );
}

type Form = { iwo_id: string | null; budget_date: string; remark: string };

/**
 * THE PENDING / UPDATED / DRAFT BOX (user, 2026-09-23: "in budget we have
 * pending, update, draft button need to implement same order module fully").
 * Budgeting's own mapping (`budget-queue.tsx`), read over the same five states
 * the Budget column shows:
 *   Pending = Not started — no budget on the work order yet: the work waiting
 *                           on whoever opens this list
 *   Updated = Submitted / Approved / Rejected — a budget exists and has left
 *             the writer's hands, whatever the approver made of it
 *   Draft   = Draft — saved as draft, still being written
 * One word per row, so a Draft counts as Draft only (Budgeting's hand-rolled
 * box also lit it under Updated). The drawer's Budget facet still reaches each
 * approval state by name; while it is set the box stands down (the Budget
 * Approval rule, `useQuickStatus`'s `standDown`).
 */
const budgetWord = (t: IwoBudgetTask): QuickWord =>
  !t.budget ? "pending" : t.budget.status === "draft" ? "draft" : "updated";

/**
 * THE LIST'S FILTERS — the grouped drawer (user, 2026-09-23: "implement the
 * Material BOM filter in every Orders child"). The list had no filter bar at
 * all. Every facet is read off the `IwoBudgetTask` the table already shows,
 * so none costs a query; the Budget and BOM buckets are those columns' own
 * pill words.
 */
const IWO_BUDGET_FACETS: FacetGroup<IwoBudgetTask>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "budget",
        label: "Budget",
        all: "All",
        wide: true,
        counted: true,
        options: [
          { value: "none", label: "Not started" },
          { value: "draft", label: "Draft" },
          { value: "submitted", label: "Submitted" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ],
        match: (t, v) => (t.budget?.status ?? "none") === v,
      },
      { key: "iwoDate", label: "Date", all: "Any date", date: (t) => t.iwo_date },
      { key: "deliDate", label: "Deli Dt", all: "Any date", date: (t) => t.deli_date },
    ],
  },
  {
    title: "Work order & BOM",
    icon: <ClipboardList />,
    facets: [
      {
        key: "for",
        label: "For",
        all: "All kinds",
        wide: true,
        counted: true,
        options: IWO_FOR.map((f) => ({ value: f, label: IWO_FOR_LABELS[f] })),
        match: (t, v) => t.iwo_for === v,
      },
      {
        key: "bom",
        label: "BOM",
        all: "Any",
        counted: true,
        options: [
          { value: "none", label: "Not started" },
          { value: "draft", label: "Draft" },
          { value: "saved", label: "Saved" },
        ],
        match: (t, v) => t.bom === v,
      },
    ],
  },
  {
    title: "Delivery & created",
    icon: <Users />,
    facets: [
      { ...urgencyFacet<IwoBudgetTask>((t) => t.deli_date), wide: true },
      createdDateFacet(),
      createdByFacet(),
    ],
  },
];

export function IwoBudgetScreen({
  tasks,
  data,
  perms,
}: {
  tasks: IwoBudgetTask[];
  data: IwoBudgetFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");


  /** Leaving the editor goes back to the WORK ORDER (2026-09-20): this

   *  screen has no entry of its own on Order Execution any more — it is

   *  opened from the work order, so that is where closing it returns. */

  function leaveEditor() {

    setMode("list");

    router.push("/orders/internal-work-orders");

  }
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ iwo_id: null, budget_date: today(), remark: "" });
  const [rows, setRows] = useState<CostRow[]>([]);
  /** What the last pull could not state — the BOM's own sentences. */
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  /** The approver's reason for reopening an approved budget (0595). */
  const [reopenReason, setReopenReason] = useState("");
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // THE LIST'S FILTERS — hooks here, near the top: this component has no early
  // return today, and a hook down by the list would be the first to break if
  // one is added (AGENTS.md, hooks above every early return).
  const [listQuery, setListQuery] = useState("");
  const listFacets = useFacetFilter(tasks, IWO_BUDGET_FACETS);
  const facetMatches = listFacets.matches;
  const quick = useQuickStatus(budgetWord, {
    standDown: !!listFacets.values.budget,
    onPick: () => listFacets.set("budget", ""),
  });
  const qm = quick.matches;
  const listed = useMemo(() => {
    const needle = listQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!facetMatches(t)) return false;
      if (!qm(t)) return false;
      if (!needle) return true;
      return [t.code, t.reference_no, t.budget?.code].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [tasks, listQuery, facetMatches, qm]);
  const picked = form.iwo_id ? (taskById.get(form.iwo_id) ?? null) : null;
  const iwoFor: IwoFor | null = picked?.iwo_for ?? null;
  const status = picked?.budget?.status ?? "draft";
  /** A submitted or approved budget is the approver's (Phase 5). */
  const editable = (editId ? perms.canEdit : perms.canCreate) && (status === "draft" || status === "rejected");

  /** Work orders without a budget; the one this budget holds always survives. */
  const iwoItems: PickerItem[] = tasks
    .filter((t) => !t.budget || t.id === form.iwo_id)
    .map((t) => ({ id: t.id, code: t.code, name: `${t.code ?? "(unnumbered)"} · ${IWO_FOR_LABELS[t.iwo_for]}`, inactive: false }));

  // ---- opening -------------------------------------------------------------

  /** One blank row per grid this For carries, seeded into STATE before
   *  `setDirty(false)` — never via `onAdd`, which marks the record dirty. Run on
   *  every open: this editor does not remount between records. */
  const seeded = (xs: CostRow[], f: IwoFor | null): CostRow[] => {
    if (!f) return xs;
    const out = [...xs];
    for (const s of sourcesFor(f)) if (!out.some((r) => r.source === s)) out.push(blankCost(s));
    return out;
  };

  function openNew(iwoId: string | null) {
    setEditId(null);
    setForm({ iwo_id: iwoId, budget_date: today(), remark: "" });
    const f = iwoId ? (taskById.get(iwoId)?.iwo_for ?? null) : null;
    setRows(seeded([], f));
    setSkipped([]);
    setDirty(false);
    setMode("edit");
    if (iwoId) pull(iwoId, seeded([], f), true);
  }

  function openTask(t: IwoBudgetTask) {
    const b = t.budget;
    if (!b) return openNew(t.id);
    setEditId(b.id);
    setForm({ iwo_id: t.id, budget_date: b.budget_date, remark: b.remark ?? "" });
    setRows(seeded(b.iwo_budget_lines.map(rowOfStored), t.iwo_for));
    setSkipped([]);
    setDirty(false);
    setMode("edit");
  }

  /** `?open=<id>` — the IWO screens' "Open Budget" passes the WORK ORDER's id;
   *  the approval inbox (`WORKFLOWS.iwo_budget.href`) passes the BUDGET's. An
   *  approver without edit rights still opens it, read-only, to decide. */
  useOpenIntent((id) => {
    const t = taskById.get(id) ?? tasks.find((x) => x.budget?.id === id);
    if (t && (t.budget || perms.canCreate)) openTask(t);
  });

  // ---- the pull ------------------------------------------------------------

  /**
   * Pull (first time) or Refresh (after) — one rule, `mergeIwoPulled`. A
   * matched line takes the BOM's facts and keeps its rate; a new BOM line is
   * added; a pulled line the BOM dropped is flagged. Blank seeds of a grid
   * that received lines are dropped, and every grid left empty is re-seeded.
   */
  function pull(iwoId: string, base: CostRow[], first: boolean) {
    start(async () => {
      const res = await loadIwoCostLines(iwoId);
      if ("refused" in res) {
        // On a new budget an unready BOM is a sentence under the header, not
        // an error toast: typing lines by hand is still allowed.
        setSkipped([res.refused]);
        if (!first) toastError(res.refused);
        return;
      }
      setSkipped(res.skipped);
      const held = base
        .filter((r) => !isBlankIwoBudgetLine(factsOf(r)))
        .map((r) => ({
          key: r.key,
          from_bom: r.from_bom,
          source: r.source,
          item_id: r.item_id,
          process_id: r.process_id,
          combo: r.combo || null,
          basis: r.basis,
          qty: num(r.qty),
          uom_id: r.uom_id,
          stage_id: r.stage_id,
          is_foc: r.is_foc,
        }));
      const m = mergeIwoPulled(held, res.lines);
      if (iwoMergeIsEmpty(m)) {
        if (!first) success("The budget already matches the BOM.");
        return;
      }
      const upd = new Map(m.update.map((u) => [u.key, u.line]));
      const stale = new Set(m.stale);
      const addedSources = new Set(m.add.map((l) => l.source));
      const next = base
        .filter((r) => !(addedSources.has(r.source) && isBlankIwoBudgetLine(factsOf(r))))
        .map((r) => {
          const u = upd.get(r.key);
          if (u) return { ...r, ...bomFacts(u) };
          return stale.has(r.key) ? { ...r, stale: true } : r;
        });
      for (const l of m.add) next.push({ ...blankCost(l.source), qty: "", ...bomFacts(l) });
      const f = taskById.get(iwoId)?.iwo_for ?? null;
      setRows(seeded(next, f));
      setDirty(true);
      if (!first) {
        success(
          `From the BOM: ${m.add.length} added, ${m.update.length} updated` +
            (m.stale.length ? `, ${m.stale.length} no longer on it (flagged)` : "") +
            ".",
        );
      }
    });
  }

  // ---- edits ---------------------------------------------------------------

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setCost = (key: string, patch: Partial<CostRow>) => {
    setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const addRow = (source: IwoBudgetSource) => {
    setRows((xs) => [...xs, blankCost(source)]);
    setDirty(true);
  };
  /** The last row of a grid comes back blank — a grid never shows as a bare button. */
  const removeRow = (r: CostRow) => {
    setRows((xs) => {
      const left = xs.filter((x) => x.key !== r.key);
      return left.some((x) => x.source === r.source) ? left : [...left, blankCost(r.source)];
    });
    setDirty(true);
  };
  /** A pulled line's ✕ is off until the BOM drops it (the order Budget's `lockRow`). */
  const lockedRow = (r: CostRow) => !editable || (r.from_bom && !r.stale);
  /** On a pulled line the item, process, qty, unit, stage and shade are the BOM's. */
  const bomLocked = (r: CostRow) => !editable || r.from_bom;

  const pickIwo = (id: string | null) => {
    const f = id ? (taskById.get(id)?.iwo_for ?? null) : null;
    setForm((x) => ({ ...x, iwo_id: id }));
    // A different work order is a different budget: its own grids, its own pull.
    const base = seeded([], f);
    setRows(base);
    setSkipped([]);
    setDirty(true);
    if (id) pull(id, base, true);
  };

  // ---- values --------------------------------------------------------------

  const kept = keptIwoBudgetLines(rows.map(factsOf));
  const totals = budgetTotals(
    rows.filter((r) => !isBlankIwoBudgetLine(factsOf(r))).map(engineLine),
    // NO ORDERS — a stock run has no sales. `budgetTotals` then refuses sales
    // and profit (never 0) and totals cost as it always does.
    [],
  );
  const problems = iwoFor ? iwoBudgetProblems(rows.map(factsOf), iwoFor) : [];

  const sectionOfSource = (s: IwoBudgetSource) =>
    s === "expense" ? "expense" : s === "yarn" || s === "material" ? "purchase" : "process";

  const validity = sectionValidity({
    sections: [{ key: "budget" }, { key: "purchase" }, { key: "process" }, { key: "expense" }, { key: "summary" }],
    values: form,
    fields: [
      { section: "budget", id: "ib-iwo", label: "I.WO No", required: true, empty: (f) => !f.iwo_id },
      { section: "budget", id: "ib-date", label: "Date", required: true, empty: (f) => !f.budget_date },
    ],
    extra: [
      ...(form.budget_date && form.budget_date > today()
        ? [{ section: "budget", label: "Date", message: "The budget date cannot be in the future.", kind: "custom" as const }]
        : []),
      ...problems.map((p) => ({
        section: sectionOfSource(p.source),
        label: IWO_BUDGET_SOURCE_LABELS[p.source],
        message: p.message,
        kind: "custom" as const,
      })),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- save ------------------------------------------------------------------

  function submit() {
    if (!form.iwo_id) return;
    const lines = rows
      .filter((r) => !isBlankIwoBudgetLine(factsOf(r)))
      .map((r) => ({
        source: r.source,
        item_id: r.item_id,
        process_id: r.process_id,
        cost_head_id: r.cost_head_id,
        stage_id: r.stage_id,
        description: r.description.trim() || null,
        specification: r.specification.trim() || null,
        combo: r.combo.trim() || null,
        basis: r.basis,
        qty: num(r.qty),
        uom_id: r.uom_id,
        rate: num(r.rate),
        rate_type: r.rate_type,
        currency_code: r.currency_code || null,
        ex_rate: r.currency_code ? num(r.ex_rate) : null,
        is_foc: r.is_foc,
        is_import: r.is_import,
        from_bom: r.from_bom,
      }));
    start(async () => {
      const res = await saveIwoBudget(editId, {
        iwo_id: form.iwo_id as string,
        budget_date: form.budget_date,
        remark: form.remark.trim() || null,
        lines,
      });
      if (res.ok) {
        success(editId ? "Budget updated" : "Budget created");
        setDirty(false);
        leaveEditor();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /** Submit the SAVED budget (0595). Unsaved edits are saved first by the
   *  operator — submitting what is not stored would send the approver a budget
   *  nobody can open. */
  function submitForApproval() {
    if (!editId) return;
    if (dirty) {
      toastError("Save the budget first — then submit it.");
      return;
    }
    start(async () => {
      const res = await submitIwoBudget(editId);
      if (res.ok) {
        success("Submitted for approval — the work order's BOMs are locked until it is decided.");
        leaveEditor();
        router.refresh();
      } else toastError(res.error);
    });
  }

  function reopen() {
    if (!editId) return;
    if (!reopenReason.trim()) {
      toastError("Say why the budget is being reopened.");
      return;
    }
    start(async () => {
      const res = await reopenIwoBudget(editId, reopenReason.trim());
      if (res.ok) {
        success("Budget reopened — it is a draft again, and the BOMs are unlocked.");
        setReopenReason("");
        leaveEditor();
        router.refresh();
      } else toastError(res.error);
    });
  }

  function del(t: IwoBudgetTask) {
    if (!t.budget) return;
    const id = t.budget.id;
    start(async () => {
      const res = await deleteIwoBudget(id);
      if (res.ok) {
        success("Budget deleted");
        router.refresh();
      } else toastError(res.error);
    });
  }

  // ---- the list ----------------------------------------------------------------

  const listTotal = (t: IwoBudgetTask) => {
    if (!t.budget) return null;
    const c = budgetTotals(t.budget.iwo_budget_lines.map((l) => lineInputOf(l)), []).cost;
    return isRefusal(c) ? null : c;
  };

  const columns: Column<IwoBudgetTask>[] = [
    {
      header: "I.WO No",
      cell: (t) => (
        <button
          type="button"
          onClick={() => (t.budget ? perms.canEdit : perms.canCreate) && openTask(t)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {t.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.iwo_date)}</span> },
    { header: "For", cell: (t) => <span className="text-sm">{IWO_FOR_LABELS[t.iwo_for] ?? "—"}</span> },
    { header: "Deli Dt", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.deli_date)}</span> },
    {
      header: "BOM",
      cell: (t) =>
        t.bom === "saved" ? (
          <StatusPill tone="success">Saved</StatusPill>
        ) : t.bom === "draft" ? (
          <StatusPill tone="info">Draft</StatusPill>
        ) : (
          <StatusPill tone="neutral">Not started</StatusPill>
        ),
    },
    { header: "Entry No", cell: (t) => <span className="font-mono text-xs">{t.budget?.code ?? "—"}</span> },
    {
      header: "Budget Cost (INR)",
      cell: (t) => {
        const c = listTotal(t);
        return <span className="tabular-nums text-sm">{c == null ? "—" : fmtNumber(c)}</span>;
      },
    },
    {
      header: "Budget",
      cell: (t) =>
        !t.budget ? (
          <StatusPill tone="neutral">Not started</StatusPill>
        ) : t.budget.status === "approved" ? (
          <StatusPill tone="success">Approved</StatusPill>
        ) : t.budget.status === "submitted" ? (
          <StatusPill tone="info">Submitted</StatusPill>
        ) : t.budget.status === "rejected" ? (
          <StatusPill tone="danger">Rejected</StatusPill>
        ) : (
          <StatusPill tone="warning">Draft</StatusPill>
        ),
    },
    rowActionsColumn((t) => (
      <RowActions
        label={t.code}
        onEdit={() => openTask(t)}
        canEdit={t.budget ? perms.canEdit : perms.canCreate}
        onDelete={t.budget ? () => del(t) : undefined}
        canDelete={!!t.budget && perms.canDelete && (t.budget.status === "draft" || t.budget.status === "rejected")}
        deleteLabel="Delete budget"
        isPending={isPending}
      />
    )),
  ];

  // ---- the cells -------------------------------------------------------------
  //
  // One definition per cell, as on the order Budget: "Rate" means the same
  // thing on every grid, and INR Rate and Amount beside it are the same engine
  // call.

  const itemsOfClass = (klasses: readonly string[], held: string | null) =>
    data.items.filter((i) => (klasses.includes(i.klass ?? "") && !isInactive(i)) || i.id === held);

  const itemCol = (header: string, klasses: readonly string[]): CostCol => ({
    header,
    cell: (r) => (
      <div className="min-w-0">
        <RecordPicker
          label={header}
          compact
          disabled={bomLocked(r)}
          items={itemsOfClass(klasses, r.item_id)}
          value={r.item_id}
          onChange={(id) => setCost(r.key, { item_id: id })}
        />
        {r.stale && <div className="mt-0.5 text-[11px] text-warning">No longer on the BOM</div>}
      </div>
    ),
  });

  const processCol = (applies: (p: IwoBudgetFormData["processes"][number]) => boolean): CostCol => ({
    header: "Process",
    cell: (r) => (
      <RecordPicker
        label="Process"
        compact
        disabled={bomLocked(r)}
        items={data.processes.filter((p) => (applies(p) && !isInactive(p)) || p.id === r.process_id)}
        value={r.process_id}
        onChange={(id) => setCost(r.key, { process_id: id })}
      />
    ),
  });

  /** Stage of a yarn purchase — GREY / DYED, the line's own on a Yarn IWO. A
   *  native Select over stored data, so the inactive filter is at the call site. */
  /** NO SHADE AT GREY (client rule, 2026-09-21) — the order Budget's
   *  `colourCol.showFor`, same test (`stageRank === 0`), same reason: grey
   *  yarn is uncoloured, so the box asks a question with no answer. Picking
   *  GREY clears a shade the hidden box would otherwise still hold. */
  const isGreigeStageId = (id: string | null) => {
    const stage = id ? data.lookups.find((l) => l.id === id) : undefined;
    return !!stage && stageRank(stage) === 0;
  };
  const stageCol: CostCol = {
    header: "Stage",
    cell: (r) => (
      <Select
        compact
        className="h-8"
        aria-label="Stage"
        disabled={bomLocked(r)}
        value={r.stage_id ?? ""}
        onChange={(e) => {
          const stage_id = e.target.value || null;
          setCost(r.key, { stage_id, ...(isGreigeStageId(stage_id) ? { combo: "" } : {}) });
        }}
      >
        <option value="" />
        {data.lookups
          .filter((l) => l.kind === "yarn_stage" && (!isInactive(l) || l.id === r.stage_id))
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
      </Select>
    ),
  };

  const textCol = (header: string, key: "combo" | "specification" | "description", lockOnPull: boolean): CostCol => ({
    header,
    // The Shade / Colour box stands down at GREY — see `isGreigeStageId`.
    showFor: key === "combo" ? (r) => !isGreigeStageId(r.stage_id) : undefined,
    cell: (r) => (
      <Input
        className="h-8"
        aria-label={header}
        readOnly={lockOnPull ? bomLocked(r) : !editable}
        value={r[key]}
        onChange={(e) => setCost(r.key, { [key]: e.target.value })}
      />
    ),
  });

  const qtyCol: CostCol = {
    header: "Reqd",
    requiredFor: qtyRequired,
    cell: (r) => (
      <Input
        className="h-8 text-right"
        inputMode="decimal"
        aria-label="Reqd"
        required={qtyRequired(r)}
        readOnly={bomLocked(r)}
        value={r.qty}
        onChange={(e) => setCost(r.key, { qty: e.target.value })}
      />
    ),
  };

  const unitCol: CostCol = {
    header: "Unit",
    cell: (r) => (
      <RecordPicker
        label="Unit"
        compact
        disabled={bomLocked(r)}
        items={data.uoms.filter((u) => !isInactive(u) || u.id === r.uom_id)}
        value={r.uom_id}
        onChange={(id) => setCost(r.key, { uom_id: id })}
      />
    ),
  };

  /** FOC — the Material BOM line's on a pulled accessory, the operator's elsewhere. */
  const focCol: CostCol = {
    header: "FOC",
    cell: (r) => (
      // Off the typing path while OFF (client 2026-09-21) — the order Budget's
      // `flagToggle` note: Tab and Enter step over it, the arrows still reach it.
      <span data-focus-optional={r.is_foc ? undefined : ""}>
        <Toggle
          checked={r.is_foc}
          ariaLabel="Free of cost"
          disabled={!editable || (r.from_bom && r.source === "material")}
          onChange={(v) => setCost(r.key, { is_foc: v })}
        />
      </span>
    ),
  };

  /**
   * IMPORT — the order Budget's switch (client 2026-09-23: "do same in iwo
   * budget too"). A line is priced in rupees unless it is imported: Curr ·
   * Ex Rate · INR Rate show only on an imported line (`importOnly` on the
   * purchase grids, `importStackCol` on the rest), and switching Import OFF
   * takes the line back to INR — a currency left behind under hidden columns
   * would price it in dollars with nothing on screen saying so.
   */
  const importToggle = (r: CostRow) => (
    // Off the typing path while OFF, as FOC is.
    <span data-focus-optional={r.is_import ? undefined : ""}>
      <Toggle
        checked={r.is_import}
        ariaLabel="Imported"
        disabled={!editable}
        onChange={(v) =>
          setCost(r.key, v ? { is_import: true } : { is_import: false, currency_code: "", ex_rate: "" })
        }
      />
    </span>
  );
  const importCol: CostCol = { header: "Import", cell: (r) => importToggle(r) };

  /** THE CURRENCY'S BLANK IS INR, AND SAYS SO (0572); clearing it clears the rate. */
  const currencyCol: CostCol = {
    header: "Curr",
    cell: (r) => (
      // Off the typing path while it reads INR — the order Budget's
      // `currencyCol`, and on a wrapper for the reason given there.
      <span data-focus-optional={r.currency_code ? undefined : ""}>
        <Select
          compact
          className="h-8"
          aria-label="Currency"
          disabled={!editable}
          value={r.currency_code}
          onChange={(e) => {
            const code = e.target.value === "INR" ? "" : e.target.value;
            setCost(r.key, { currency_code: code, ex_rate: code && code === r.currency_code ? r.ex_rate : "" });
          }}
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
      </span>
    ),
  };

  const exRateCol: CostCol = {
    header: "Ex Rate",
    requiredFor: exRateRequired,
    cell: (r) => (
      <Input
        className="h-8 text-right"
        inputMode="decimal"
        aria-label="Exchange rate"
        required={exRateRequired(r)}
        // An INR line has no exchange rate — read-only, so Tab steps over it.
        readOnly={!editable || !r.currency_code}
        value={r.ex_rate}
        onChange={(e) => setCost(r.key, { ex_rate: e.target.value })}
      />
    ),
  };

  const rateCol = (header: string): CostCol => ({
    header,
    requiredFor: rateRequired,
    cell: (r) => (
      <Input
        // The section lands here (`focusFirstField`) — the order Budget's `rateCol`.
        data-focus-land=""
        className="h-8 text-right"
        inputMode="decimal"
        aria-label={header}
        required={rateRequired(r)}
        readOnly={!editable}
        value={r.rate}
        onChange={(e) => setCost(r.key, { rate: e.target.value })}
      />
    ),
  });

  const uomCode = (id: string | null) => (id && data.uoms.find((u) => u.id === id)?.code) || "unit";
  const rateTypeCol: CostCol = {
    header: "Rate Type",
    cell: (r) => (
      <Select
        compact
        className="h-8"
        aria-label="Rate type"
        disabled={!editable}
        value={r.rate_type}
        onChange={(e) => setCost(r.key, { rate_type: e.target.value as CostRow["rate_type"] })}
      >
        <option value="per_unit">{`Per ${uomCode(r.uom_id)}`}</option>
        <option value="flat">Flat</option>
      </Select>
    ),
  };

  const figure = (v: number | { refused: string }) =>
    isRefusal(v) ? null : <span className="tabular-nums text-sm">{fmtNumber(v)}</span>;
  const inrRateCol: CostCol = { header: "INR Rate", cell: (r) => figure(lineInrRate(engineLine(r))) };

  /** On an imported line only — or one already holding a foreign currency,
   *  which is never hidden while it prices the line. */
  const importOnly = (c: CostCol): CostCol => ({
    ...c,
    showFor: (r) => (r.is_import || !!r.currency_code) && (!c.showFor || c.showFor(r)),
  });

  /** Where there is no room for three more columns, Curr · Ex Rate · INR Rate
   *  open INSIDE the Import cell, under its switch — the order Budget's
   *  `importStackCol`. */
  const importStackCol: CostCol = {
    header: "Import",
    cell: (r, i) => (
      <div className="space-y-1">
        {importToggle(r)}
        {(r.is_import || !!r.currency_code) && (
          <>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Curr</div>
            {currencyCol.cell(r, i)}
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">
              Ex Rate{exRateRequired(r) ? " *" : ""}
            </div>
            {exRateCol.cell(r, i)}
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">INR Rate</div>
            <div className="text-right">{inrRateCol.cell(r, i)}</div>
          </>
        )}
      </div>
    ),
  };
  const amountCol: CostCol = {
    header: "Amount",
    total: {
      kind: "sum",
      of: (r) => {
        const a = lineAmount(engineLine(r));
        // A refused line adds 0 to the band and is counted on Summary.
        return isRefusal(a) ? 0 : a;
      },
    },
    cell: (r) => figure(lineAmount(engineLine(r))),
  };

  const headCol: CostCol = {
    header: "Head",
    cell: (r) => (
      <RecordPicker
        label="Head"
        compact
        disabled={!editable}
        items={data.lookups
          .filter((l) => l.kind === "expense_head" && (!isInactive(l) || l.id === r.cost_head_id))
          .map((l) => ({ id: l.id, code: l.code, name: l.name, is_active: l.is_active }))}
        value={r.cost_head_id}
        onChange={(id) => setCost(r.key, { cost_head_id: id })}
      />
    ),
  };

  /*
   * THE COLUMN WIDTHS — every column one `FIELD_WIDTH_CSS` step, so
   * `npm run check:grid-budget` can add them. The budget is the smallest
   * supported pane: 1155px, minus 72 row chrome = 1083 for columns; every grid
   * takes `tableFrom="5xl"`.
   */

  /* Yarn Purchases — code 144 + hug 88 (Stage) + hug 88 (Shade) + hug 88 (Reqd)
     + num 72 (Unit) + num 72 (FOC) + num 72 (Curr) + hug 88 (Ex Rate) + hug 88
     (Rate) + hug 88 (INR Rate) + range 112 (Amount) = 1000, + 72 = 1072. */
  /** A column no row needs is not drawn — the order Budget's `usedColumns`:
   *  all GREY, no Shade column; one DYED line and it is back. */
  const usedColumns = (source: IwoBudgetSource, cols: CostCol[]) => {
    const own = rows.filter((r) => r.source === source);
    return cols.filter((c) => !c.showFor || own.length === 0 || own.some((r) => c.showFor!(r)));
  };
  const iwoYarnPurchaseColumns: CostCol[] = usedColumns("yarn", withRowRules([
    { ...itemCol("Yarn", ["YARN"]), width: FIELD_WIDTH_CSS.code },
    { ...stageCol, width: FIELD_WIDTH_CSS.hug },
    { ...textCol("Shade", "combo", true), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    // Curr · Ex Rate · INR Rate only once Import is on (client 2026-09-23).
    { ...importOnly(currencyCol), width: FIELD_WIDTH_CSS.num },
    { ...importOnly(exRateCol), width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.hug },
    { ...importOnly(inrRateCol), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    { ...importCol, width: FIELD_WIDTH_CSS.num },
  ]));

  /* Accessories Purchases — code 144 + hug 88 (Colour) + range 112 (Spec) +
     hug 88 + num 72 + num 72 + num 72 + hug 88 + hug 88 + hug 88 + range 112 =
     1024, + 72 = 1096.
     2026-09-23: + Import (num 72), Specification range -> hug (-24): 1072, +
     72 = 1144. Yarn Purchases likewise: 1000 + 72 = 1072, + 72 = 1144. */
  const iwoMaterialPurchaseColumns: CostCol[] = usedColumns("material", withRowRules([
    { ...itemCol("Item", ["SEW", "PACK"]), width: FIELD_WIDTH_CSS.code },
    { ...textCol("Colour", "combo", true), width: FIELD_WIDTH_CSS.hug },
    // 2026-09-23: range -> hug (-24) to pay for the Import column.
    { ...textCol("Specification", "specification", true), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...focCol, width: FIELD_WIDTH_CSS.num },
    // Curr · Ex Rate · INR Rate only once Import is on (client 2026-09-23).
    { ...importOnly(currencyCol), width: FIELD_WIDTH_CSS.num },
    { ...importOnly(exRateCol), width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.hug },
    { ...importOnly(inrRateCol), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    { ...importCol, width: FIELD_WIDTH_CSS.num },
  ]));

  /* The three process grids — code 144 (item) + code 144 (Process) + hug 88
     (Shade) + hug 88 (Reqd) + num 72 (Unit) + hug 88 (Rate Type) + num 72
     (Curr) + hug 88 (Ex Rate) + hug 88 (Charges) + hug 88 (INR Rate) + range
     112 (Amount) = 1072, + 72 = 1144 <= 1155. 11px of headroom: a new column
     here needs a re-cut.
     2026-09-23: Curr + Ex Rate + INR Rate (248) folded into one Import cell
     (num 72): 896, + 72 = 968. Other Expenses the same: 840, + 72 = 912. */
  const iwoYarnProcessColumns: CostCol[] = withRowRules([
    { ...itemCol("Yarn", ["YARN"]), width: FIELD_WIDTH_CSS.code },
    { ...processCol((p) => p.for_yarn), width: FIELD_WIDTH_CSS.code },
    { ...textCol("Shade", "combo", true), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charges"), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    // 2026-09-23: Curr · Ex Rate · INR Rate open inside Import (`importStackCol`).
    { ...importStackCol, width: FIELD_WIDTH_CSS.num },
  ]);
  const iwoFabricProcessColumns: CostCol[] = withRowRules([
    { ...itemCol("Fabric", ["FABRIC"]), width: FIELD_WIDTH_CSS.code },
    { ...processCol((p) => p.for_fabric), width: FIELD_WIDTH_CSS.code },
    { ...textCol("Colour", "combo", true), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charges"), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    // 2026-09-23: Curr · Ex Rate · INR Rate open inside Import (`importStackCol`).
    { ...importStackCol, width: FIELD_WIDTH_CSS.num },
  ]);
  const iwoMaterialProcessColumns: CostCol[] = withRowRules([
    { ...itemCol("Item", ["SEW", "PACK"]), width: FIELD_WIDTH_CSS.code },
    { ...processCol((p) => p.for_trims), width: FIELD_WIDTH_CSS.code },
    { ...textCol("Colour", "combo", true), width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...rateCol("Charges"), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    // 2026-09-23: Curr · Ex Rate · INR Rate open inside Import (`importStackCol`).
    { ...importStackCol, width: FIELD_WIDTH_CSS.num },
  ]);

  /* Other Expenses — code 144 (Head) + term 176 (Description) + hug 88 (Rate
     Type) + hug 88 (Qty) + num 72 (Unit) + num 72 (Curr) + hug 88 + hug 88 +
     hug 88 + range 112 = 1016, + 72 = 1088. */
  const iwoExpenseColumns: CostCol[] = withRowRules([
    { ...headCol, width: FIELD_WIDTH_CSS.code },
    { ...textCol("Description", "description", false), width: FIELD_WIDTH_CSS.term },
    { ...rateTypeCol, width: FIELD_WIDTH_CSS.hug },
    { ...qtyCol, width: FIELD_WIDTH_CSS.hug },
    { ...unitCol, width: FIELD_WIDTH_CSS.num },
    { ...rateCol("Rate"), width: FIELD_WIDTH_CSS.hug },
    { ...amountCol, width: FIELD_WIDTH_CSS.range },
    // 2026-09-23: Curr · Ex Rate · INR Rate open inside Import (`importStackCol`).
    { ...importStackCol, width: FIELD_WIDTH_CSS.num },
  ]);

  const rowsOf = (s: IwoBudgetSource) => rows.filter((r) => r.source === s);
  const grids = iwoFor ? IWO_BUDGET_GRIDS[iwoFor] : { purchase: [], process: [] };
  const heading = (s: IwoBudgetSource, children: ReactNode) => (
    <div key={s} className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{IWO_BUDGET_SOURCE_LABELS[s]}</h3>
      {children}
    </div>
  );
  const addLabel: Record<IwoBudgetSource, string> = {
    yarn: "+ Add yarn",
    yarn_process: "+ Add yarn process",
    fabric_process: "+ Add fabric process",
    material: "+ Add item",
    material_process: "+ Add process",
    expense: "+ Add expense",
  };

  /**
   * Each grid written out ON THE TAG — its own line, its `…Columns` array and a
   * literal `tableFrom`, no spread — because that is what `check:grid-budget`
   * can read. A one-line or spread-prop grid is invisible to it, and an
   * unmeasured grid passes silently (the 2026-09-18 Budget lesson).
   */
  const grid = (s: IwoBudgetSource): ReactNode => {
    switch (s) {
      case "yarn":
      return heading(
        "yarn",
        <ChildGrid<CostRow>
          columns={iwoYarnPurchaseColumns}
          rows={rowsOf("yarn")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoYarnPurchaseColumns, row, i)}
          onAdd={() => addRow("yarn")}
          onRemove={removeRow}
          addLabel={addLabel.yarn}
          hideAdd={!editable}
          lockRow={lockedRow}
        />,
      );
      case "material":
      return heading(
        "material",
        <ChildGrid<CostRow>
          columns={iwoMaterialPurchaseColumns}
          rows={rowsOf("material")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoMaterialPurchaseColumns, row, i)}
          onAdd={() => addRow("material")}
          onRemove={removeRow}
          addLabel={addLabel.material}
          hideAdd={!editable}
          lockRow={lockedRow}
        />,
      );
      case "yarn_process":
      return heading(
        "yarn_process",
        <ChildGrid<CostRow>
          columns={iwoYarnProcessColumns}
          rows={rowsOf("yarn_process")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoYarnProcessColumns, row, i)}
          onAdd={() => addRow("yarn_process")}
          onRemove={removeRow}
          addLabel={addLabel.yarn_process}
          hideAdd={!editable}
          lockRow={lockedRow}
        />,
      );
      case "fabric_process":
      return heading(
        "fabric_process",
        <ChildGrid<CostRow>
          columns={iwoFabricProcessColumns}
          rows={rowsOf("fabric_process")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoFabricProcessColumns, row, i)}
          onAdd={() => addRow("fabric_process")}
          onRemove={removeRow}
          addLabel={addLabel.fabric_process}
          hideAdd={!editable}
          lockRow={lockedRow}
        />,
      );
      case "material_process":
      return heading(
        "material_process",
        <ChildGrid<CostRow>
          columns={iwoMaterialProcessColumns}
          rows={rowsOf("material_process")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoMaterialProcessColumns, row, i)}
          onAdd={() => addRow("material_process")}
          onRemove={removeRow}
          addLabel={addLabel.material_process}
          hideAdd={!editable}
          lockRow={lockedRow}
        />,
      );
      case "expense":
      return (
        <ChildGrid<CostRow>
          columns={iwoExpenseColumns}
          rows={rowsOf("expense")}
          tableFrom="5xl"
          flatRows
          renderMobileRow={(row, i) => costCard(iwoExpenseColumns, row, i)}
          onAdd={() => addRow("expense")}
          onRemove={removeRow}
          addLabel={addLabel.expense}
          hideAdd={!editable}
          lockRow={lockedRow}
        />
      );
    }
  };

  const noWorkOrder = (
    <p className="text-sm text-muted-foreground">Choose the work order on the Budget section first.</p>
  );

  // ---- sections ----------------------------------------------------------------

  const money = (v: number | { refused: string }) => (isRefusal(v) ? "—" : fmtNumber(v));
  const shownSources = iwoFor ? sourcesFor(iwoFor) : [];

  const sections: FullScreenSection[] = [
    {
      key: "budget",
      label: "Budget",
      icon: ClipboardList,
      done: !!form.iwo_id,
      content: (
        <SectionBody title="Budget">
          {/* THE CAP IS DEFINITE — 46rem, 736px: the widest row is I.WO No
              (party 200) + For (term 176) + Deli Dt (term 176) + RE No (term
              176) = 728, + 3 gaps. Never `max-w-fit` (a content-sized cap
              resolves to zero inside a container-query ancestor). */}
          <div className="max-w-[46rem] space-y-2">
            <FieldRow>
              <Field label="I.WO No" required w="party" htmlFor="ib-iwo">
                {editId || !editable ? (
                  <Input id="ib-iwo" readOnly value={picked?.code ?? ""} />
                ) : (
                  <RecordPicker
                    id="ib-iwo"
                    label="I.WO No"
                    compact
                    required
                    items={iwoItems}
                    value={form.iwo_id}
                    onChange={(id) => pickIwo(id || null)}
                  />
                )}
              </Field>
              <Field label="For" w="term" htmlFor="ib-for">
                <Input id="ib-for" readOnly value={iwoFor ? IWO_FOR_LABELS[iwoFor] : ""} />
              </Field>
              <Field label="Deli Dt" w="term" htmlFor="ib-deli">
                <Input id="ib-deli" readOnly value={picked?.deli_date ? fmtDate(picked.deli_date) : ""} />
              </Field>
              <Field label="RE No" w="term" htmlFor="ib-re">
                <Input id="ib-re" readOnly value={picked?.reference_no ?? ""} />
              </Field>
            </FieldRow>
            <FieldRow>
              {/* Entry No — a plain serial given by the database on first save
                  (0594, 0593's rule). */}
              <Field label="Entry No" w="term" htmlFor="ib-code">
                <Input id="ib-code" readOnly value={picked?.budget?.code ?? ""} placeholder="On save" />
              </Field>
              <Field label="Date" required w="term" htmlFor="ib-date">
                <Input
                  id="ib-date"
                  type="date"
                  max={today()}
                  readOnly={!editable}
                  value={form.budget_date}
                  onChange={(e) => set({ budget_date: e.target.value })}
                />
              </Field>
              <Field label="Remark" w="name" htmlFor="ib-remark">
                <Input
                  id="ib-remark"
                  readOnly={!editable}
                  value={form.remark}
                  onChange={(e) => set({ remark: e.target.value })}
                />
              </Field>
            </FieldRow>
          </div>

          {form.iwo_id && (
            <div className="mt-4 space-y-2">
              {editable && (
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => pull(form.iwo_id as string, rows, false)}>
                  Refresh from BOM
                </Button>
              )}
              {picked?.bom !== "saved" && (
                <p className="text-sm text-warning">
                  {picked?.bom === "draft"
                    ? "The BOM is still a draft — save it (not as a draft) to pull its lines. Lines can still be typed by hand."
                    : "This work order has no BOM yet — raise it to pull its lines. Lines can still be typed by hand."}
                </p>
              )}
              {skipped.length > 0 && (
                <div className="rounded-md border border-warning/40 p-2 text-xs">
                  <div className="mb-1 font-medium text-warning">Not pulled — the BOM could not state these:</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {picked?.budget?.status === "rejected" && picked.budget.decision_remark && (
                <p className="text-sm text-danger">Rejected: {picked.budget.decision_remark}</p>
              )}
              {status === "draft" && picked?.budget?.decision_remark?.startsWith("REOPENED") && (
                <p className="text-sm text-muted-foreground">{picked.budget.decision_remark}</p>
              )}
            </div>
          )}

          {/* APPROVAL (0595) — submitting sends the SAVED budget to the approver
              and locks the work order's BOMs until it is decided; an approved
              budget stays locked until an approver reopens it, with a reason. */}
          {editId && (
            <div className="mt-4 max-w-[46rem] space-y-2 border-t border-border/60 pt-3">
              {(status === "draft" || status === "rejected") && perms.canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={isPending} onClick={submitForApproval}>
                    Submit for approval
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {dirty ? "Save first — only the saved budget is submitted." : "The work order's BOMs lock while it is with the approver."}
                  </span>
                </div>
              )}
              {status === "submitted" && (
                <p className="text-sm text-muted-foreground">
                  With the approver. The work order&apos;s BOMs and this budget are locked until it is decided.
                </p>
              )}
              {status === "approved" && (
                <>
                  <p className="text-sm text-success">
                    Approved{picked?.budget?.decision_remark ? ` — ${picked.budget.decision_remark}` : ""}. The work order&apos;s
                    BOMs are locked, and yarn purchases for it are held to the BOM&apos;s purchase weight.
                  </p>
                  {perms.canApprove && (
                    <FieldRow>
                      <Field label="Reason to reopen" w="name" htmlFor="ib-reopen">
                        <Input
                          id="ib-reopen"
                          value={reopenReason}
                          onChange={(e) => setReopenReason(e.target.value)}
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button type="button" variant="outline" size="sm" disabled={isPending || !reopenReason.trim()} onClick={reopen}>
                          Reopen budget
                        </Button>
                      </div>
                    </FieldRow>
                  )}
                </>
              )}
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "purchase",
      label: "Purchase Rates",
      icon: Package,
      done: rows.some((r) => (r.source === "yarn" || r.source === "material") && !!r.rate.trim()),
      content: (
        <SectionBody title="Purchase Rates">
          {iwoFor ? <div className="space-y-4">{grids.purchase.map(grid)}</div> : noWorkOrder}
        </SectionBody>
      ),
    },
    {
      key: "process",
      label: "Process Rates",
      icon: Workflow,
      done: rows.some((r) => r.source.endsWith("_process") && !!r.rate.trim()),
      content: (
        <SectionBody title="Process Rates">
          {iwoFor ? <div className="space-y-4">{grids.process.map(grid)}</div> : noWorkOrder}
        </SectionBody>
      ),
    },
    {
      key: "expense",
      label: "Other Expenses",
      icon: Receipt,
      done: rows.some((r) => r.source === "expense" && !isBlankIwoBudgetLine(factsOf(r))),
      content: <SectionBody title="Other Expenses">{iwoFor ? grid("expense") : noWorkOrder}</SectionBody>,
    },
    {
      key: "summary",
      label: "Summary",
      icon: Calculator,
      done: kept.length > 0,
      content: (
        <SectionBody title="Summary">
          {/* A definite cap: two columns, source (name 288) + amount (code 144). */}
          <div className="max-w-[28rem] space-y-3">
            {/* A read-out, not a grid: a definition list, one row per source. */}
            <dl className="text-sm">
              {shownSources.map((s) => (
                <div key={s} className="flex justify-between gap-4 border-b border-border/60 py-1.5">
                  <dt className="text-muted-foreground">{IWO_BUDGET_SOURCE_LABELS[s]}</dt>
                  <dd className="tabular-nums">{money(totals.costBySource[s])}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 py-2 font-semibold">
                <dt>Budget cost (INR)</dt>
                <dd className="tabular-nums">{money(totals.cost)}</dd>
              </div>
            </dl>
            {totals.unpriced.length > 0 && (
              <p className="text-sm text-warning">
                {totals.unpriced.length} line{totals.unpriced.length === 1 ? " is" : "s are"} not priced yet and{" "}
                {totals.unpriced.length === 1 ? "is" : "are"} left out of the cost.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A work order is a stock run: there is no buyer and no sales value, so no profit or margin is shown.
            </p>
          </div>
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="IWO Budget"
          description="Rates and cost for an Internal Work Order — its lines pulled from the work order's BOM."
          actions={perms.canCreate ? <Button onClick={() => openNew(null)}>+ New IWO Budget</Button> : undefined}
        />
        <FilterBar
          leading={quick.segment}
          search={listQuery}
          onSearch={setListQuery}
          searchPlaceholder="Search I.WO No, RE No or Entry No…"
          activeCount={listFacets.activeCount}
          onReset={listFacets.activeCount ? listFacets.reset : undefined}
          panel={listFacets.panel}
          right={`${listed.length} of ${tasks.length}`}
        />
        <DataTable
          columns={withCreatedColumns(columns, tasks)}
          rows={listed}
          getKey={(t) => t.id}
          empty={
            !tasks.length
              ? "No Internal Work Orders at this unit yet."
              : quick.value
                ? `No ${quick.value} work orders${listFacets.activeCount || listQuery ? " match these filters" : ""}.`
                : "No work orders match these filters."
          }
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => leaveEditor()}
        modeLabel={
          <>
            {editId ? "Editing" : "New"} <span className="font-semibold text-foreground">IWO budget</span>
          </>
        }
        header={{
          initials: "IB",
          title: picked?.code ?? "New IWO Budget",
          badges: dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null,
          meta: (
            <>
              <span>{iwoFor ? `For ${IWO_FOR_LABELS[iwoFor]}` : "No work order chosen"}</span>
              {form.budget_date && <span>· {fmtDate(form.budget_date)}</span>}
              {!isRefusal(totals.cost) && <span>· ₹ {fmtNumber(totals.cost)}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New IWO Budget",
          onCancel: () => leaveEditor(),
          // A submitted / approved budget is read-only: `canSave` holds Save.
          onSave: submit,
          saveLabel: "Save Budget",
          canSave: validity.canSave && editable,
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
