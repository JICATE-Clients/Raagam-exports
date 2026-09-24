"use client";

/**
 * Orders ▸ Order Execution ▸ IWO Material BOM — the order Material BOM screen,
 * DUPLICATED for an Internal Work Order For Accessories (client 2026-09-19,
 * screenshot 2941; 0584).
 *
 * THE ORDER SCREEN IS NOT TOUCHED. `app/(app)/orders/material-bom/` stays as it
 * is; this copies its shape — the rail, an Items grid, a Processes grid, a
 * read-only Requirement — and drops what only an order has: the garment-order
 * picker, the production strip, the order's explosion, garment parts and
 * combinations. The planner TYPES the Planned Qty (SRS §5: "piece-level
 * consumption is overridden"), or types it per colour / size under the line
 * (0614, `breakup-grid.tsx`).
 *
 * WITHDRAWN FROM THE ITEMS TAB (user 2026-09-22): FOC, Advised item, Round To,
 * then Brand / Specs, Colour and MOQ the same morning. Withdrawn, not deleted —
 * the columns, `iwoMbItemInput` and `ItemRow` keep them and the screen
 * round-trips a stored value untouched, because the save rewrites the item
 * list from the payload and a field the form stops carrying is one the next
 * save would blank (the order screen's `Required By` shape). Two consequences
 * a reader should know: a line saved Advised before this still blocks its
 * purchase orders (0586), and a stored MOQ still lifts the purchase figure
 * (`iwoMbQuantity`) — nothing on this screen can set or clear either any
 * more. A colour on a colour-wise line is now only ever on its rows.
 *
 * EVERY QUANTITY IS THE ORDER BOM'S ARITHMETIC — Planned × (1 + loss%), the
 * purchase pack, MOQ, Round To — through `lib/orders/iwo-material-bom/rules.ts`,
 * the same function the save calls. The preview is the stored figure.
 */

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Boxes, CalendarRange, ClipboardList, Layers, Users, Workflow } from "lucide-react";
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
  flagFacet,
  urgencyFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";
import { IWO_STATUSES, IWO_STATUS_LABELS } from "@/lib/orders/internal-work-orders/types";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { materialsForCategory } from "@/lib/orders/material-bom-amendment/material-options";
import { uomPatchForMaterial } from "@/lib/orders/material-bom/uom-prefill";
import { isRefusal } from "@/lib/orders/material-bom/requirement";
import {
  IWO_MB_ATTRIBUTE_LABELS,
  IWO_MB_ATTRIBUTES,
  IWO_MB_STAGES,
  type IwoMbAttribute,
} from "@/lib/orders/iwo-material-bom/types";
import {
  isBlankIwoMbProcess,
  iwoMbProblems,
  iwoMbQuantity,
  keptIwoMbLines,
  keptIwoMbProcesses,
  plannedQtyOf,
  type IwoMbLineFacts,
  type IwoMbProcessFacts,
} from "@/lib/orders/iwo-material-bom/rules";
import { blankBreakupRow, BreakupGrid, type BreakupRow } from "./breakup-grid";
import { deleteIwoMaterialBom, saveIwoMaterialBom } from "@/lib/orders/iwo-material-bom/actions";
import type { IwoMaterialBomFormData, IwoMaterialBomTask } from "@/lib/orders/iwo-material-bom/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
/** Add / Modify on the Colour and Size pickers write a MASTER list — the order
 *  Material BOM's `masterPerms`, gated by `masters`, not `orders`. */
type MasterPerms = { canCreate: boolean; canEdit: boolean };

// React keys from a module counter, as the order screens do — not a ref.
let keySeq = 0;
const newKey = () => `k${keySeq++}`;

/** One item line as the grid edits it. Numbers are held as the TEXT typed, so
 *  a half-typed "12." is not rewritten under the caret. */
type ItemRow = {
  key: string;
  category_id: string | null;
  item_id: string | null;
  consumption_uom_id: string | null;
  purchase_uom_id: string | null;
  uom_conversion_id: string | null;
  planned_qty: string;
  /** 0614 — how the line breaks up, and its rows (see `breakup-grid.tsx`). */
  attribute: IwoMbAttribute;
  slices: BreakupRow[];
  /** CARRIED, NOT SHOWN (user 2026-09-22) — loaded from the record, sent back
   *  as loaded, no cell edits them. See the file header. */
  specification: string;
  item_color_id: string | null;
  moq: string;
  round_to: string;
  is_advised: boolean;
  send_out: boolean;
  is_foc: boolean;
};
type ProcRow = {
  key: string;
  item_id: string | null;
  stage: string;
  process_id: string | null;
  loss_pct: string;
  vendor_id: string | null;
};

// EVERY SEED IS BLANK — the save drops an untouched row by testing what is typed.
const blankItem = (): ItemRow => ({
  key: newKey(),
  category_id: null,
  item_id: null,
  specification: "",
  item_color_id: null,
  consumption_uom_id: null,
  purchase_uom_id: null,
  uom_conversion_id: null,
  planned_qty: "",
  attribute: "item",
  slices: [],
  moq: "",
  round_to: "",
  is_advised: false,
  send_out: false,
  is_foc: false,
});
const blankProc = (): ProcRow => ({
  key: newKey(),
  item_id: null,
  stage: "",
  process_id: null,
  loss_pct: "",
  vendor_id: null,
});

type Form = { iwo_id: string | null; bom_date: string };

/** "" → null; anything else → a number, or NaN for a non-number. */
const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

const itemFacts = (l: ItemRow): IwoMbLineFacts => ({
  category_id: l.category_id,
  item_id: l.item_id,
  specification: l.specification.trim() || null,
  item_color_id: l.item_color_id,
  consumption_uom_id: l.consumption_uom_id,
  purchase_uom_id: l.purchase_uom_id,
  uom_conversion_id: l.uom_conversion_id,
  planned_qty: num(l.planned_qty),
  attribute: l.attribute,
  slices: l.slices.map((sl) => ({ item_color_id: sl.item_color_id, size: sl.size.trim() || null, planned_qty: num(sl.planned_qty) })),
  moq: num(l.moq),
  round_to: num(l.round_to),
  is_advised: l.is_advised,
  send_out: l.send_out,
  is_foc: l.is_foc,
});
const procFacts = (p: ProcRow): IwoMbProcessFacts => ({
  item_id: p.item_id,
  stage: p.stage || null,
  process_id: p.process_id,
  loss_pct: num(p.loss_pct),
  vendor_id: p.vendor_id,
});

/**
 * THE PENDING / UPDATED / DRAFT BOX (user, 2026-09-23: "in budget we have
 * pending, update, draft button need to implement same order module fully").
 * The three words are read over this list's own "Not started / Draft / Saved"
 * — the Material BOM column's words — as the question the box asks on the order
 * BOM queues and Budgeting: is the work still to do, or done.
 *   Pending = Not started — a work order with no Material BOM yet: the work
 *                           waiting on whoever opens this list
 *   Updated = Saved       — the Material BOM is written and final
 *   Draft   = Draft       — saved as draft, not finished
 * Every row is one of the three. The drawer's Material BOM facet asks the same
 * question, so the box stands down while it is set (the Budget Approval rule,
 * `useQuickStatus`'s `standDown`).
 */
const bomWord = (t: IwoMaterialBomTask): QuickWord => (!t.bom ? "pending" : t.bom.is_draft ? "draft" : "updated");

/**
 * THE LIST'S FILTERS — the grouped drawer (user, 2026-09-23: "implement the
 * Material BOM filter in every Orders child"). The list had no filter bar at
 * all. Every facet is read off the `IwoMaterialBomTask` the table already
 * shows, so none costs a query. No For facet: every row here is Accessories.
 */
const IWO_MATERIAL_BOM_FACETS: FacetGroup<IwoMaterialBomTask>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "bom",
        label: "Material BOM",
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
        key: "iwoStatus",
        label: "Work Order Status",
        all: "All",
        wide: true,
        counted: true,
        options: IWO_STATUSES.map((s) => ({ value: s, label: IWO_STATUS_LABELS[s] })),
        match: (t, v) => t.status === v,
      },
      flagFacet<IwoMaterialBomTask>(
        "lines",
        "Material Lines",
        (t) => (t.bom?.iwo_material_bom_items.length ?? 0) > 0,
        "Has lines",
        "No lines yet",
      ),
    ],
  },
  {
    title: "Delivery & created",
    icon: <Users />,
    facets: [
      { ...urgencyFacet<IwoMaterialBomTask>((t) => t.deli_date), wide: true },
      createdDateFacet(),
      createdByFacet(),
    ],
  },
];

export function IwoMaterialBomScreen({
  tasks,
  data,
  perms,
  masterPerms,
}: {
  tasks: IwoMaterialBomTask[];
  data: IwoMaterialBomFormData;
  perms: Perms;
  masterPerms: MasterPerms;
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
  const [form, setForm] = useState<Form>({ iwo_id: null, bom_date: today() });
  const [items, setItems] = useState<ItemRow[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);
  /** The lines whose breakup (0614) is FOLDED — absent means open, the order
   *  screen's `closedSlices`: a default of closed would hide the rows a new
   *  split line is about to ask for. */
  const [closedBreakups, setClosedBreakups] = useState<Set<string>>(() => new Set());

  /** Real edits only — an overlay's own guard is not read by `confirmDiscard()`,
   *  so this is what protects the typing and holds off the silent reload. */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // THE LIST'S FILTERS — hooks here, near the top: this component has no early
  // return today, and a hook down by the list would be the first to break if
  // one is added (AGENTS.md, hooks above every early return).
  const [listQuery, setListQuery] = useState("");
  const listFacets = useFacetFilter(tasks, IWO_MATERIAL_BOM_FACETS);
  const facetMatches = listFacets.matches;
  /* THE SET THE FIGURES ARE COUNTED OVER — the list with the search and the
     Filters panel applied and this box's own word left off, so a figure is
     exactly what clicking that word would show. */
  const base = useMemo(() => {
    const needle = listQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!facetMatches(t)) return false;
      if (!needle) return true;
      return [t.code, t.reference_no].some((v) => (v ?? "").toLowerCase().includes(needle));
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
  const materialById = useMemo(() => new Map(data.materials.map((m) => [m.id, m])), [data.materials]);
  const uomById = useMemo(() => new Map(data.uoms.map((u) => [u.id, u])), [data.uoms]);

  /** The IWO picker offers Accessories work orders WITHOUT a BOM — one per IWO
   *  (0584); the one this BOM already names always survives. */
  const iwoItems: PickerItem[] = tasks
    .filter((t) => !t.bom || t.id === form.iwo_id)
    .map((t) => ({ id: t.id, code: t.code, name: t.code ?? "(unnumbered)", inactive: false }));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const patchItem = (key: string, patch: Partial<ItemRow>) => {
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const patchProc = (key: string, patch: Partial<ProcRow>) => {
    setProcs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  // ---- open ------------------------------------------------------------------

  /** Seeds every grid BEFORE `setDirty(false)` — never through `onAdd`, which
   *  would open every record reading "Unsaved changes". */
  function openNew(iwoId: string | null) {
    setEditId(null);
    setForm({ iwo_id: iwoId, bom_date: today() });
    setItems([blankItem()]);
    setProcs([blankProc()]);
    setDirty(false);
    setMode("edit");
  }

  function openTask(t: IwoMaterialBomTask) {
    const b = t.bom;
    if (!b) return openNew(t.id);
    setEditId(b.id);
    setForm({ iwo_id: t.id, bom_date: b.bom_date });
    const is = b.iwo_material_bom_items.map((r) => ({
      key: newKey(),
      category_id: r.category_id,
      item_id: r.item_id,
      specification: r.specification ?? "",
      item_color_id: r.item_color_id,
      consumption_uom_id: r.consumption_uom_id,
      purchase_uom_id: r.purchase_uom_id,
      uom_conversion_id: r.uom_conversion_id,
      planned_qty: str(r.planned_qty),
      attribute: r.attribute ?? "item",
      slices: (r.iwo_material_bom_item_slices ?? []).map((sl) => ({
        key: newKey(),
        item_color_id: sl.item_color_id,
        size: sl.size ?? "",
        planned_qty: str(sl.planned_qty),
      })),
      moq: str(r.moq),
      round_to: str(r.round_to),
      is_advised: !!r.is_advised,
      send_out: !!r.send_out,
      is_foc: !!r.is_foc,
    }));
    const ps = b.iwo_material_bom_processes.map((r) => ({
      key: newKey(),
      item_id: r.item_id,
      stage: r.stage ?? "",
      process_id: r.process_id,
      loss_pct: str(r.loss_pct),
      vendor_id: r.vendor_id,
    }));
    // `[]` means "no lines yet" and opens ready to type, same as a new record.
    setItems(is.length ? is : [blankItem()]);
    setProcs(ps.length ? ps : [blankProc()]);
    setDirty(false);
    setMode("edit");
  }

  /** `?open=<iwoId>` — the IWO screen's "Open Material BOM" lands here, IN that
   *  work order's BOM. Declared after `openTask`, above any branch. */
  useOpenIntent((iwoId) => {
    const t = taskById.get(iwoId);
    if (t && (t.bom ? perms.canEdit : perms.canCreate)) openTask(t);
  });

  // ---- the quantity chain, previewed with the SAME function the save calls ----

  const quantityFor = (l: ItemRow) =>
    iwoMbQuantity(
      itemFacts(l),
      procs
        .filter((p) => p.item_id && p.item_id === l.item_id && !isBlankIwoMbProcess(procFacts(p)))
        .map((p) => ({ loss_pct: num(p.loss_pct) })),
      uomById,
      data.conversions,
    );

  // ---- validity ----------------------------------------------------------------

  const problems = iwoMbProblems(items.map(itemFacts), procs.map(procFacts));

  const validity = sectionValidity({
    sections: [{ key: "bom" }, { key: "items" }, { key: "processes" }, { key: "requirement" }],
    values: form,
    fields: [
      { section: "bom", id: "imb-iwo", label: "I.WO No", required: true, empty: (f) => !f.iwo_id },
      { section: "bom", id: "imb-date", label: "Date", required: true, empty: (f) => !f.bom_date },
    ],
    extra: [
      ...(form.bom_date && form.bom_date > today()
        ? [{ section: "bom", label: "Date", message: "The BOM date cannot be in the future.", kind: "custom" as const }]
        : []),
      ...problems.map((p) => ({
        section: p.section,
        label: p.section === "items" ? "Items" : "Processes",
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

  function submit(asDraft: boolean) {
    if (!form.iwo_id) return;
    // Blank rows are dropped HERE as well as in the action: the schema requires
    // a material on every row it is sent.
    const payload = {
      iwo_id: form.iwo_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      items: keptIwoMbLines(items.map(itemFacts))
        .filter((l) => !!l.item_id)
        .map((l) => ({ ...l, item_id: l.item_id as string, slices: [...(l.slices ?? [])] })),
      processes: keptIwoMbProcesses(procs.map(procFacts))
        .filter((p) => !!p.item_id)
        .map((p) => ({ ...p, item_id: p.item_id as string, stage: p.stage as "GREIGE" | "DYED" | null })),
    };
    start(async () => {
      const res = await saveIwoMaterialBom(editId, payload);
      if (res.ok) {
        success(editId ? "Material BOM updated" : "Material BOM created");
        setDirty(false);
        leaveEditor();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(t: IwoMaterialBomTask) {
    if (!t.bom) return;
    const bomId = t.bom.id;
    start(async () => {
      const res = await deleteIwoMaterialBom(bomId);
      if (res.ok) {
        success("Material BOM deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ----------------------------------------------------------------

  const columns: Column<IwoMaterialBomTask>[] = [
    {
      header: "I.WO No",
      cell: (t) => (
        <button
          type="button"
          onClick={() => (t.bom ? perms.canEdit : perms.canCreate) && openTask(t)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {t.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.iwo_date)}</span> },
    { header: "RE No", cell: (t) => <span className="font-mono text-xs">{t.reference_no ?? "—"}</span> },
    { header: "Deli Dt", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.deli_date)}</span> },
    {
      header: "Material BOM",
      cell: (t) =>
        !t.bom ? (
          <StatusPill tone="neutral">Not started</StatusPill>
        ) : t.bom.is_draft ? (
          <StatusPill tone="info">Draft</StatusPill>
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
        deleteLabel="Delete BOM"
        isPending={isPending}
      />
    )),
  ];

  // ---- Items -------------------------------------------------------------------

  /** The units a material may be bought / consumed in — its base unit, its
   *  purchase unit when it declares an alternate, and whatever the row already
   *  holds (the order screen's `uomOptionsFor`, copied). No material: every
   *  active unit. */
  const uomOptionsFor = (itemId: string | null, current: string | null): PickerItem[] => {
    const m = itemId ? materialById.get(itemId) : undefined;
    const allowed = new Set<string>();
    if (m?.base_uom_id) allowed.add(m.base_uom_id);
    if (m?.has_alternate_uom && m.purchase_uom_id) allowed.add(m.purchase_uom_id);
    if (current) allowed.add(current);
    return data.uoms
      .filter((u) => (allowed.size && m ? allowed.has(u.id) : !u.inactive || u.id === current))
      .map((u) => ({ id: u.id, code: u.code, name: u.code ?? u.name, inactive: u.inactive }));
  };

  const decimalCell = (value: string, label: string, onChange: (v: string) => void, required = false) => (
    <Input
      className="h-8 text-right"
      inputMode="decimal"
      required={required}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  /**
   * THE ORDER BOM'S ITEM ROW, minus the order's explosion: Attribute
   * (requirement grain), Combination and the slice grid are gone, and Planned
   * Qty — typed — stands where the calculated need stood. Advised is the order
   * screen's TBA switch under the SRS's own name.
   *
   * A FIXED-WIDTH TABLE, NOT CARDS (user 2026-09-21, screenshot 2985: "compact
   * it"). It opened as `forceCards` + `FieldGrid size="sm"` — twelve quarter-pane
   * boxes over three lines per item, ~200px tall for one row of facts. The
   * `raagam-screen-layout` rule since 09-18: vocabulary widths on every column
   * and a table from `5xl`; the card below the threshold keeps the SAME widths
   * (`fieldWidthStep`), so a 1366 laptop folds the row instead of inflating it.
   *
   * THE ATTRIBUTE (0614, user 2026-09-21: "the attribute field is missing …
   * add it too") — Item / Colour / Size / Colour + Size. Not the order BOM's
   * explosion (no order to explode by) but a BREAKUP the planner types in the
   * rows UNDER the line (`breakup-grid.tsx`); under a split attribute the
   * Planned Qty cell is read-only Σ of those rows (`plannedQtyOf`, the one
   * reader the rules, the chain and the save use).
   *
   * CARDS, NOT A TABLE, SINCE 2026-09-22 — and the same widths. The rows of a
   * split line list under it the way the order Material BOM lists its
   * Attribute rows (user: "use the same logic and UI for listing it"), and a
   * `ChildGrid` table cannot carry a panel under a row (a second `<tr>` falls
   * outside the row's `data-grid-row`, so Tab never reaches it —
   * `process-fold-list.tsx`'s note). A `flatRows` card is what this grid
   * already drew under `5xl`: one `FieldRow` at the vocabulary widths below,
   * folding on a narrow pane instead of inflating — not the quarter-pane boxes
   * of screenshot 2985.
   *
   * WIDTHS (the card's `FieldRow`, kept at the table's steps): hug 88
   * (Category) + term 176 (Material) + range 112 (Attribute) + num 72
   * (Cons. Uom) + hug 88 (Planned Qty) + num 72 (Pur. Uom) + num 72 (Process)
   * = 680. Round To, the Advised / FOC switches, Brand / Specs, Colour and MOQ
   * left on 2026-09-22 (file header).
   */
  const itemColumns: ChildGridColumn<ItemRow>[] = [
    {
      header: "Category",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <RecordPicker
          label="Category"
          compact
          items={data.categories}
          value={r.category_id}
          onChange={(id) => {
            // The cascading-picker rule: a category the held material is not
            // filed under clears it; one it is under keeps it.
            const held = r.item_id ? materialById.get(r.item_id) : undefined;
            patchItem(r.key, {
              category_id: id,
              item_id: held && id && held.category_id && held.category_id !== id ? null : r.item_id,
            });
          }}
        />
      ),
    },
    {
      header: "Material",
      required: true,
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <RecordPicker
          label="Material"
          compact
          required
          items={materialsForCategory(data.materials, { categoryId: r.category_id, currentValue: r.item_id })}
          value={r.item_id}
          onChange={(id) => {
            const m = id ? materialById.get(id) : undefined;
            patchItem(r.key, {
              item_id: id,
              category_id: r.category_id ?? m?.category_id ?? null,
              // The order screen's unit prefill: drop units the new material
              // cannot take, fill both when it declares one.
              ...uomPatchForMaterial(
                r,
                id,
                uomOptionsFor(id, null).map((u) => u.id),
                data.conversions,
              ),
            });
          }}
        />
      ),
    },
    {
      /* SWITCHING THE ATTRIBUTE KEEPS THE ROWS. Colour → Colour + Size keeps
         every colour row and asks for its size; back to Item keeps the rows
         out of sight (the save drops them — `attribute = item` writes none)
         so a mis-click costs nothing typed. A split line with no rows yet is
         seeded with one blank row so the sheet opens ready to type. */
      header: "Attribute",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Select
          compact
          className="h-8"
          aria-label="Attribute"
          value={r.attribute}
          onChange={(e) => {
            const attribute = e.target.value as IwoMbAttribute;
            patchItem(r.key, {
              attribute,
              slices: attribute !== "item" && r.slices.length === 0 ? [blankBreakupRow(newKey)] : r.slices,
            });
          }}
        >
          {IWO_MB_ATTRIBUTES.map((a) => (
            <option key={a} value={a}>
              {IWO_MB_ATTRIBUTE_LABELS[a]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Cons. Uom",
      required: true,
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <RecordPicker
          label="Cons. Uom"
          compact
          required
          items={uomOptionsFor(r.item_id, r.consumption_uom_id)}
          value={r.consumption_uom_id}
          onChange={(id) => patchItem(r.key, { consumption_uom_id: id, uom_conversion_id: null })}
        />
      ),
    },
    {
      header: "Planned Qty",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        if (r.attribute === "item") {
          return decimalCell(r.planned_qty, "Planned Qty", (v) => patchItem(r.key, { planned_qty: v }), true);
        }
        /* UNDER A SPLIT ATTRIBUTE THE CELL IS Σ THE ROWS BENEATH, read-only —
           the order screen's line figure. The star stays (the record still
           needs the quantity) and a `readOnly` box never holds, so the
           requiredness is enforced on the rows' own cells and the Save gate;
           `tabIndex={-1}` comes with `readOnly`, so Tab goes from Cons. Uom
           straight on to Pur. Uom and reaches the rows after the line. */
        const total = plannedQtyOf(itemFacts(r));
        return (
          <Input
            className="h-8 text-right"
            readOnly
            aria-label="Planned Qty — the total of the rows under the line"
            value={total == null ? "" : fmtNumber(total)}
          />
        );
      },
    },
    {
      header: "Pur. Uom",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <RecordPicker
          label="Pur. Uom"
          compact
          items={uomOptionsFor(r.item_id, r.purchase_uom_id)}
          value={r.purchase_uom_id}
          onChange={(id) => patchItem(r.key, { purchase_uom_id: id, uom_conversion_id: null })}
        />
      ),
    },
    {
      /* Process = send out for processing, which offers the material on the
         Processes grid. It shared this cell with Advised and FOC until
         2026-09-22 (file header). */
      header: "Process",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <Toggle checked={r.send_out} ariaLabel="Send out for processing" onChange={(v) => patchItem(r.key, { send_out: v })} />
      ),
    },
  ];

  // ---- Processes -----------------------------------------------------------------

  /** A cell owed only once its row has been STARTED — Budget's `requiredFor`. */
  const reqIf = (on: boolean, label: string, node: ReactNode) => (
    <RequiredScope required={on} label={label}>
      {node}
    </RequiredScope>
  );

  /** The materials a process row may name: those ticked Process on Items, plus
   *  any a row already names (so an untick cannot blank a saved row's cell). */
  const processMaterials = (held: string | null): PickerItem[] => {
    const ids = new Set(items.filter((l) => l.item_id && l.send_out).map((l) => l.item_id as string));
    if (held) ids.add(held);
    return [...ids].map((id) => ({ id, code: null, name: materialById.get(id)?.name ?? "", inactive: false }));
  };

  /**
   * WIDTHS (check:grid-budget): name 288 + code 144 + term 176 + num 72 +
   * name 288 = 968 + 72 chrome = 1040 <= 1155.
   */
  const processColumns: ChildGridColumn<ProcRow>[] = [
    {
      header: "Material",
      required: true,
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => {
        const on = !isBlankIwoMbProcess(procFacts(r));
        return reqIf(
          on,
          "Material",
          <RecordPicker
            label="Material"
            compact
            required={on}
            items={processMaterials(r.item_id)}
            emptyHint="Tick Process on an item first."
            value={r.item_id}
            onChange={(id) => patchProc(r.key, { item_id: id })}
          />,
        );
      },
    },
    {
      header: "Stage",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Select compact className="h-8" aria-label="Stage" value={r.stage} onChange={(e) => patchProc(r.key, { stage: e.target.value })}>
          <option value="" />
          {IWO_MB_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Process",
      required: true,
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => {
        const on = !isBlankIwoMbProcess(procFacts(r));
        return reqIf(
          on,
          "Process",
          <RecordPicker
            label="Process"
            compact
            required={on}
            items={data.processes}
            value={r.process_id}
            onChange={(id) => patchProc(r.key, { process_id: id })}
          />,
        );
      },
    },
    {
      header: "Loss %",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => decimalCell(r.loss_pct, "Loss %", (v) => patchProc(r.key, { loss_pct: v })),
    },
    {
      header: "Vendor",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <RecordPicker
          label="Vendor"
          compact
          items={data.vendors}
          value={r.vendor_id}
          onChange={(id) => patchProc(r.key, { vendor_id: id })}
        />
      ),
    },
  ];

  // ---- Requirement (read-only) ---------------------------------------------------

  type ReqRow = { key: string; sno: number; line: ItemRow };
  const reqRows: ReqRow[] = items
    .map((line, i) => ({ key: line.key, sno: i + 1, line }))
    .filter((r) => !!r.line.item_id);
  const uomCode = (id: string | null) => (id ? (uomById.get(id)?.code ?? "") : "");

  const reqColumns: Column<ReqRow>[] = [
    { header: "#", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.sno}</span> },
    {
      header: "Material",
      cell: (r) => (
        <div className="min-w-0">
          <Truncated className="text-sm">{materialById.get(r.line.item_id ?? "")?.name ?? ""}</Truncated>
        </div>
      ),
    },
    {
      header: "Planned",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {(() => {
            // The line's own figure, or Σ its breakup (0614) — one reader.
            const planned = plannedQtyOf(itemFacts(r.line));
            return planned != null ? `${fmtNumber(planned)} ${uomCode(r.line.consumption_uom_id)}` : "";
          })()}
        </span>
      ),
    },
    {
      header: "Required (after loss)",
      align: "right",
      cell: (r) => {
        const q = quantityFor(r.line);
        return (
          <span className="tabular-nums text-sm">
            {isRefusal(q) ? "" : `${fmtNumber(q.required)} ${uomCode(r.line.consumption_uom_id)}`}
          </span>
        );
      },
    },
    {
      header: "Purchase Qty",
      align: "right",
      cell: (r) => {
        const q = quantityFor(r.line);
        return isRefusal(q) ? (
          <span className="text-xs text-danger">{q.refused}</span>
        ) : (
          <span className="tabular-nums text-sm font-medium">{`${fmtNumber(q.purchase)} ${uomCode(q.purchase_uom_id)}`}</span>
        );
      },
    },
  ];

  // ---- sections ------------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Material BOM",
      icon: Layers,
      done: !!form.iwo_id,
      content: (
        <SectionBody title="Material BOM">
          {/* The order screen's header, with the IWO standing where the Garment
              Order stood. Everything but the IWO and the Date is READ from the
              IWO — a readOnly field never holds the cursor. */}
          <FieldRow className="[&_input]:h-9">
            <Field label="I.WO No" required className="w-full max-w-[240px]" htmlFor="imb-iwo">
              <RecordPicker
                id="imb-iwo"
                label="I.WO No"
                compact
                items={iwoItems}
                value={form.iwo_id}
                // LOCKED ONCE NAMED: lines typed against one work order must
                // never be re-pointed at another.
                disabled={!!form.iwo_id}
                onChange={(id) => set({ iwo_id: id })}
              />
            </Field>
            <Field label="Date" required className="w-[145px]" htmlFor="imb-date">
              <Input
                id="imb-date"
                type="date"
                max={today()}
                disabled={!!editId}
                value={form.bom_date}
                onChange={(e) => set({ bom_date: e.target.value })}
              />
            </Field>
            <Field label="RE No" className="w-[170px]" htmlFor="imb-re">
              <Input id="imb-re" readOnly value={picked?.reference_no ?? ""} />
            </Field>
            <Field label="Deli Dt" className="w-[130px]" htmlFor="imb-deli">
              <Input id="imb-deli" readOnly value={picked?.deli_date ? fmtDate(picked.deli_date) : ""} />
            </Field>
          </FieldRow>

          {/* NOTHING TO PICK — a state of the data, said with the way out. */}
          {!form.iwo_id && iwoItems.length === 0 && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">
                No Internal Work Order For Accessories is waiting for a Material BOM.
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
        </SectionBody>
      ),
    },
    {
      key: "items",
      label: "Items",
      icon: Boxes,
      done: items.some((l) => !!l.item_id),
      content: (
        <SectionBody title="Items">
          {/* ONE-LINE CARDS AT THE TABLE'S OWN WIDTHS (see `itemColumns`' note),
              in one frame (`flatRows`). Labels and `required` are read off
              `itemColumns`, on the `Field` AND on the control. A split line
              lists its rows beneath its fields, INSIDE the card, so they are
              part of the row for Tab and the arrows. */}
          {/* THE ORDER MATERIAL BOM'S ITEM LISTING (user 2026-09-22, screenshot
              3018: "the material same item listing UI need to apply here … now
              lists rendering one by one"). `foldRows` opens ONE line at a time
              and `masterDetail` stands the others in a list beside it, so a
              ten-line BOM never pushes the open line down the page — the same
              two props, the same list item and the same folded row the order
              screen uses. The pane appears with the SECOND line (`mdActive`
              in `child-grid.tsx`: a list of one is not a list). */}
          <ChildGrid<ItemRow>
            columns={itemColumns}
            rows={items}
            forceCards
            flatRows
            foldRows
            masterDetail
            renderListItem={(row) => {
              /* INERT BY CONTRACT (see `renderListItem` on the grid): text, a
                 dot and a figure; the fields live in the pane next door. */
              const name = row.item_id ? (materialById.get(row.item_id)?.name ?? null) : null;
              const q = name ? quantityFor(row) : null;
              const state = !name ? "idle" : q && isRefusal(q) ? "warn" : "ok";
              const attr = row.attribute !== "item" ? IWO_MB_ATTRIBUTE_LABELS[row.attribute] : null;
              const planned = plannedQtyOf(itemFacts(row));
              return (
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      state === "ok" && "bg-success",
                      state === "warn" && "bg-warning",
                      state === "idle" && "bg-border-strong opacity-50",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <Truncated className={cn("block text-[12.5px] leading-tight", name ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {name ?? "New material"}
                    </Truncated>
                    {(attr || planned != null) && (
                      <Truncated className="block text-[10px] leading-tight text-muted-foreground">
                        {[attr, planned != null ? `${fmtNumber(planned)} ${uomCode(row.consumption_uom_id)}`.trim() : null].filter(Boolean).join(" · ")}
                      </Truncated>
                    )}
                  </span>
                  {/* THE FIGURE THE LINE PRODUCES — a refusal in words, never a
                      dash that reads as zero. The order screen's own rule. */}
                  <span className="shrink-0 text-right leading-tight">
                    {q && isRefusal(q) ? (
                      <span className="text-[10px] font-medium text-warning">Needs attention</span>
                    ) : q ? (
                      <>
                        <span className="block text-[12px] font-semibold tabular-nums text-accent">{fmtNumber(q.purchase)}</span>
                        <span className="block text-[9px] tracking-wide text-muted-foreground">{uomCode(q.purchase_uom_id)}</span>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            }}
            /* WHAT A FOLDED LINE SHOWS — ONE REAL FIELD, not a nicety: Tab lands
               on fields, so a folded row rendering none would be reachable by
               mouse alone, and focusing it is what opens it again. The Material
               picker is the right one: the line's identity. `label=""` keeps the
               row's line box (a `Label` with no children has none). */
            renderFoldedRow={(row, i) => {
              const material = itemColumns.find((c) => c.header === "Material")!;
              const planned = plannedQtyOf(itemFacts(row));
              const summary = [
                row.attribute !== "item" ? IWO_MB_ATTRIBUTE_LABELS[row.attribute] : null,
                planned != null ? `${fmtNumber(planned)} ${uomCode(row.consumption_uom_id)}`.trim() : null,
              ]
                .filter(Boolean)
                .join("  ·  ");
              return (
                <FieldRow>
                  <Field label="" required={material.required} w="term">
                    {material.cell(row, i)}
                  </Field>
                  <Field label="" className="min-w-0 flex-1">
                    <div className="flex min-h-8 items-center">
                      <Truncated className="text-sm text-muted-foreground">
                        {summary || (row.item_id ? "Nothing else filled in yet" : "New material — not filled in")}
                      </Truncated>
                    </div>
                  </Field>
                </FieldRow>
              );
            }}
            renderMobileRow={(row, i) => (
              <div>
                {/* WHICH LINE AM I FILLING IN? — the pane leads with the line's
                    name at the section heading's own weight, and the figure it
                    produces on the right (the order screen's pane header). */}
                <div className="mb-2 flex items-baseline gap-3 pr-9">
                  <Truncated className="min-w-0 text-[15px] font-bold tracking-tight text-foreground">
                    {row.item_id ? (materialById.get(row.item_id)?.name ?? "") : "New material"}
                  </Truncated>
                  {(() => {
                    const q = row.item_id ? quantityFor(row) : null;
                    return q && !isRefusal(q) ? (
                      <span className="ml-auto shrink-0 text-right">
                        <span className="text-base font-semibold tabular-nums text-accent">{fmtNumber(q.purchase)}</span>{" "}
                        <span className="text-[10px] tracking-wide text-muted-foreground">{uomCode(q.purchase_uom_id)}</span>
                      </span>
                    ) : null;
                  })()}
                </div>
                <FieldRow align="start" gap="tight">
                  {itemColumns.map((c, ci) => (
                    <Field key={ci} label={c.header} required={c.required} w={fieldWidthStep(c.width) ?? "hug"}>
                      {c.cell(row, i)}
                    </Field>
                  ))}
                </FieldRow>
                {row.attribute !== "item" && (
                  <BreakupGrid
                    attribute={row.attribute}
                    uomCode={uomCode(row.consumption_uom_id)}
                    rows={row.slices}
                    onChange={(next) => patchItem(row.key, { slices: next })}
                    colors={data.colors}
                    sizes={data.sizes}
                    masterPerms={masterPerms}
                    newKey={newKey}
                    open={!closedBreakups.has(row.key)}
                    onToggle={() =>
                      setClosedBreakups((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                  />
                )}
              </div>
            )}
            /* FINISH THE LINE FIRST (the order screen's gate): under
               `masterDetail` a new line opens and folds the current one, so an
               unfinished line would fold with its problem out of sight. The
               same rules Save runs, on the last line alone; the toast names
               what is missing and the grid declines the add (`false`). */
            onAdd={() => {
              const last = items[items.length - 1];
              if (last) {
                const missing = iwoMbProblems([itemFacts(last)], []).filter((p) => p.section === "items");
                if (missing.length) {
                  toastError(missing[0].message.replace(/^Line 1/, "The open line"));
                  return false;
                }
              }
              setItems((xs) => [...xs, blankItem()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setItems((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add item"
          />
        </SectionBody>
      ),
    },
    {
      key: "processes",
      label: "Processes",
      icon: Workflow,
      done: procs.some((p) => !isBlankIwoMbProcess(procFacts(p))),
      content: (
        <SectionBody title="Processes">
          <ChildGrid<ProcRow>
            columns={processColumns}
            rows={procs}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => (
              // The card keeps the table's widths — the Items grid's note.
              <FieldRow align="start" gap="tight">
                {processColumns.map((c, ci) => (
                  <Field
                    key={ci}
                    label={c.header}
                    required={c.required ? !isBlankIwoMbProcess(procFacts(row)) : false}
                    w={fieldWidthStep(c.width) ?? "hug"}
                  >
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldRow>
            )}
            onAdd={() => {
              setProcs((xs) => [...xs, blankProc()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setProcs((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add process"
          />
        </SectionBody>
      ),
    },
    {
      key: "requirement",
      label: "Requirement",
      icon: ClipboardList,
      done: reqRows.length > 0,
      content: (
        <SectionBody title="Requirement">
          <DataTable columns={reqColumns} rows={reqRows} getKey={(r) => r.key} empty="Pick a material on Items first." />
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="IWO Material BOM"
          description="The Material BOM for an Internal Work Order For Accessories — no garment breakdown; the quantity is typed."
          actions={perms.canCreate ? <Button onClick={() => openNew(null)}>+ New Material BOM</Button> : undefined}
        />
        <FilterBar
          leading={quick.segment}
          search={listQuery}
          onSearch={setListQuery}
          searchPlaceholder="Search I.WO No or RE No…"
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
              ? "No Internal Work Orders For Accessories at this unit yet."
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
            {editId ? "Editing" : "New"} <span className="font-semibold text-foreground">IWO material BOM</span>
          </>
        }
        header={{
          initials: "MB",
          title: picked?.code ?? "New Material BOM",
          badges: dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null,
          meta: (
            <>
              <span>{picked ? "For Accessories" : "No work order chosen"}</span>
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New Material BOM",
          onCancel: () => leaveEditor(),
          onSave: () => submit(false),
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          saveLabel: "Save Material BOM",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
