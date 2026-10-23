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

import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Boxes, CalendarRange, ClipboardList, Layers, Users, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { raiseSampleGroupAccessoriesIw } from "@/lib/sales/sample-grouping/accessories-actions";
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
import { sampleFillLines } from "@/lib/orders/iwo-material-bom/sample-fill";
import { loadSwoCostingTrims, type SwoSampleTrims } from "@/lib/orders/iwo-material-bom/sample-fill-actions";
import { createdMeta, hasCreatedInfo, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { GlowRecordCard, sharedPrefix, sharedValue } from "@/app/(app)/sales/sample-costing/costing-card";
import { CardAction, CardDeleteAction, DUO } from "@/components/ui/card-action";
import { GLOW_RULE } from "@/lib/ui/buyer-glow";
import { QUICK_WORDS_4, useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
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
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import type { ApprovalRun, CanActVerdict } from "@/lib/approvals/types";
import { useEmbeddedEditor, type EmbedTarget } from "@/lib/use-embedded-editor";
import { EmbeddedEditorWait } from "@/components/orders/embedded-editor-wait";
import { PlanLockFence } from "@/components/sales/plan-lock-fence";
import {
  getAccessoriesPlanApproval,
  submitSampleAccessoriesPlan,
  type AccessoriesPlanRevision,
} from "@/lib/orders/iwo-material-bom/approval-actions";
import {
  planApprovalLabel,
  planApprovalTone,
  planReportHref,
  type PlanApprovalStatus,
} from "@/lib/sales/plan-reports/types";
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
  hasIwoMbRows,
  isBlankIwoMbLine,
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

/** `perSmp` — a SAMPLE plan (0711): the line is the SWO's consolidated
 *  accessory and its quantity is the Σ of the per-SMP rows under it. */
const itemFacts = (l: ItemRow, perSmp = false): IwoMbLineFacts => ({
  per_smp: perSmp,
  category_id: l.category_id,
  item_id: l.item_id,
  specification: l.specification.trim() || null,
  item_color_id: l.item_color_id,
  consumption_uom_id: l.consumption_uom_id,
  purchase_uom_id: l.purchase_uom_id,
  uom_conversion_id: l.uom_conversion_id,
  planned_qty: num(l.planned_qty),
  attribute: l.attribute,
  slices: l.slices.map((sl) => ({
    sample_style_id: sl.sample_style_id || null,
    item_color_id: sl.item_color_id,
    size: sl.size.trim() || null,
    planned_qty: num(sl.planned_qty),
  })),
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
/**
 * PENDING · UNDER PROGRESS · APPROVED · DRAFT (user 2026-10-15, the sweep after
 * Fabric BOM). No plan → Pending; the approver approved it → Approved; saved
 * as a draft → Draft; any other saved plan — not yet sent, with the approver,
 * or sent back — → Under Progress. Before this every saved plan read Updated,
 * so a plan the approver returned sat beside the approved ones.
 */
const bomWord = (t: IwoMaterialBomTask): QuickWord =>
  !t.bom ? "pending" : t.bom.approval_status === "approved" ? "approved" : t.bom.is_draft ? "draft" : "progress";

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
        label: "Accessories Plan",
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
  sample = false,
  swos,
  initialOpen = null,
  embed = null,
}: {
  tasks: IwoMaterialBomTask[];
  data: IwoMaterialBomFormData;
  perms: Perms;
  masterPerms: MasterPerms;
  /** Sample ▸ Accessories Plan (0704): the same screen over the SAMPLE work
   *  orders only. Closing stays on this list, and a new work order is raised in place. */
  sample?: boolean;
  /** Sample ▸ Accessories Plan (0709): the SWOs with no accessories work order
   *  yet — offered in the SWO No picker, which raises one when picked. */
  swos?: { id: string; code: string }[];
  /** A plan id to open on arrival (`?open=`). */
  initialOpen?: string | null;
  /** EMBEDDED in Sample ▸ Revision's workspace (`useEmbeddedEditor`): open
   *  this PLAN id, hide the list, and return to the revision on close. */
  embed?: EmbedTarget | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  /** Raising an SWO's accessories work order from the SWO No picker. */
  const [swoRaising, startSwo] = useTransition();
  /** The SWO's samples and their costing trims (0710) — what SMP No lists and
   *  what "fill from costing" reads. Keyed by the work order it was read for,
   *  so a stale answer for another plan is never used. */
  const [swoTrims, setSwoTrims] = useState<{ iwoId: string; data: SwoSampleTrims } | null>(null);
  const [filling, startFill] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");


  /** Leaving the editor goes back to the WORK ORDER (2026-09-20): this

   *  screen has no entry of its own on Order Execution any more — it is

   *  opened from the work order, so that is where closing it returns. */

  function leaveEditor() {

    setMode("list");

    // Sample ▸ Accessories Plan is its own sidebar row, so closing returns to its list.
    if (!sample) router.push("/orders/internal-work-orders");

  }
  const [editId, setEditId] = useState<string | null>(null);
  /** SAMPLE PLAN APPROVAL (0720, the Fabric Plan's twin): the open plan's run,
   *  whether this user may decide it, and its revision log — keyed `forId`. */
  const [approval, setApproval] = useState<{
    forId: string;
    run: ApprovalRun | null;
    verdict: CanActVerdict | null;
    revisions: AccessoriesPlanRevision[];
    /** This user sent the live run — the editor then offers no decision. */
    mine: boolean;
  } | null>(null);
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
      return [t.code, t.reference_no, t.swo?.code].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [tasks, listQuery, facetMatches]);
  const quick = useQuickStatus(bomWord, {
    words: QUICK_WORDS_4,
    standDown: !!listFacets.values.bom,
    onPick: () => listFacets.set("bom", ""),
    countRows: base,
  });
  /* CARD VIEW / LIST VIEW (user 2026-10-16) — the tab's own default until the
     operator picks; then this screen keeps the pick. Above every early return. */
  const viewMode = useViewMode("iwo-material-bom", quick.value === "updated" ? "list" : "cards");
  const qm = quick.matches;
  const listed = useMemo(() => base.filter(qm), [base, qm]);
  /* THE COSTING CARD'S "EACH WORD ONCE" (user 2026-10-23: accessories cards like
     Costing's): the SWO / SMP series prefix and the delivery year every card in
     the pile shares are left off the card. A plain pass — cheap, no memo. */
  const cardShared = {
    swo: sharedPrefix(listed.map((t) => t.swo?.code ?? t.code)),
    smp: sharedPrefix(listed.flatMap((t) => t.swo?.smp_nos ?? [])),
    year: sharedValue(listed.map((t) => t.deli_date?.slice(0, 4))),
  };
  const stripPrefix = (v: string | null | undefined, prefix: string) => (v && prefix && v.startsWith(prefix) ? v.slice(prefix.length) : v);
  const picked = form.iwo_id ? (taskById.get(form.iwo_id) ?? null) : null;
  const materialById = useMemo(() => new Map(data.materials.map((m) => [m.id, m])), [data.materials]);
  const uomById = useMemo(() => new Map(data.uoms.map((u) => [u.id, u])), [data.uoms]);

  /** The IWO picker offers Accessories work orders WITHOUT a BOM — one per IWO
   *  (0584); the one this BOM already names always survives. */
  const iwoItems: PickerItem[] = tasks
    .filter((t) => !t.bom || t.id === form.iwo_id)
    .map((t) => ({ id: t.id, code: t.code, name: t.code ?? "(unnumbered)", inactive: false }));
  /**
   * SAMPLE: THE HEADER IS THE SWO (0709; user 2026-10-12, screenshot 3437 —
   * "Swo number from grouping, Date* … remove the remaining all the fields").
   * One list, two kinds of row: an SWO whose accessories work order exists and
   * has no plan yet (its id IS the work order's), and an SWO past Draft with
   * none (`swo:` + group id), which `pickSwo` raises first. A sample work order
   * raised before 0709 has no SWO and keeps its SIW number.
   */
  const swoItems: PickerItem[] = [
    ...iwoItems.map((it) => ({ ...it, code: null, name: taskById.get(it.id)?.swo?.code ?? it.name })),
    ...(swos ?? []).map((g) => ({ id: `swo:${g.id}`, code: null, name: g.code, inactive: false })),
  ];
  const pickSwo = (id: string | null) => {
    if (!id || !id.startsWith("swo:")) {
      set({ iwo_id: id });
      return;
    }
    startSwo(async () => {
      const res = await raiseSampleGroupAccessoriesIw(id.slice(4));
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

  // ---- SWO samples + fill from costing (0710; user 2026-10-12) ---------------
  const swoId = sample ? (picked?.swo?.id ?? null) : null;
  const trims = swoTrims && swoTrims.iwoId === form.iwo_id ? swoTrims.data : null;
  const swoStyleIds = swoId && trims ? new Set(trims.samples.map((x) => x.style_id)) : null;
  /** What the SMP No picker under every line offers (0711) — null while no SWO
   *  is read, so the column shows greyed; undefined on a production IWO. */
  const smpOptions = sample
    ? swoStyleIds
      ? (trims?.samples ?? []).map((x) => ({ id: x.style_id, label: `${x.label} (${x.pieces} pcs)` }))
      : null
    : undefined;
  /** Every reader of a line goes through this, so a sample plan's quantity is
   *  always Σ its SMP rows — the screen, Save and the action read one rule. */
  const facts = (l: ItemRow) => itemFacts(l, sample);
  /** A new line: on a sample plan it opens with one SMP row standing ready
   *  (AGENTS.md, editable sub-tables open with a row). */
  const newItem = (): ItemRow => (sample ? { ...blankItem(), slices: [blankBreakupRow(newKey)] } : blankItem());

  /** The costing's lines as grid rows — the same unit prefill a material pick
   *  runs, so a filled line is exactly what picking that material would give. */
  const rowsFromCosting = (t: SwoSampleTrims) => {
    const { lines, skipped } = sampleFillLines(t.samples);
    /* THE SWO'S CONSOLIDATED ACCESSORY (0711): the costing gives one figure
       per (SMP, material); the grid holds ONE line per material with a row per
       SMP beneath it — a button on both samples is bought once. */
    const byMaterial = new Map<string, typeof lines>();
    for (const l of lines) byMaterial.set(l.item_id, [...(byMaterial.get(l.item_id) ?? []), l]);
    const rows = [...byMaterial].map(([itemId, ls]) => {
      const base: ItemRow = {
        ...blankItem(),
        category_id: t.category_of[itemId] ?? materialById.get(itemId)?.category_id ?? null,
        item_id: itemId,
        slices: ls.map((l) => ({ ...blankBreakupRow(newKey), sample_style_id: l.style_id, planned_qty: String(l.planned_qty) })),
      };
      // The units `uomOptionsFor` (below) would offer a fresh row: the base
      // unit, and the purchase unit when the material declares an alternate.
      const m = materialById.get(itemId);
      const allowed = [m?.base_uom_id, m?.has_alternate_uom ? m.purchase_uom_id : null].filter((x): x is string => !!x);
      const units = allowed.length ? allowed : data.uoms.filter((u) => !u.inactive).map((u) => u.id);
      return { ...base, ...uomPatchForMaterial(base, itemId, units, data.conversions) };
    });
    return { rows, skipped };
  };

  /**
   * READ THE SWO WHEN THE PLAN NAMES ONE, and on a NEW plan whose grid is
   * still blank, FILL IT (user 2026-10-12: "auto-populate on SWO selection").
   * A saved plan is never refilled here — that is the button's job — and a
   * grid the planner has typed into is never overwritten.
   */
  /* `?open=<plan id>` (2026-10-14): Sample ▸ Revision and Plan Approval's
     "Open plan" land on the PLAN, not on the list beside it. Once, on mount;
     a plan this list does not hold (another unit, deleted) leaves the list. */
  useEffect(() => {
    if (!initialOpen) return;
    const t = tasks.find((x) => x.bom?.id === initialOpen);
    if (!t) return;
    // From a timer, not the effect body (react-hooks/set-state-in-effect); the
    // cleanup makes React's dev double-mount open it exactly once.
    const id = window.setTimeout(() => openTask(t), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, from the link
  }, []);

  useEffect(() => {
    if (!sample || !form.iwo_id || !swoId) return;
    if (swoTrims?.iwoId === form.iwo_id) return;
    const iwoId = form.iwo_id;
    let cancelled = false;
    loadSwoCostingTrims(iwoId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setSwoTrims({ iwoId, data: res.data });
      if (editId) return;
      setItems((xs) => {
        if (!xs.every((x) => isBlankIwoMbLine(facts(x)))) return xs;
        const { rows, skipped } = rowsFromCosting(res.data);
        if (skipped.length) toastError(`Not filled from costing: ${skipped.join("; ")}.`);
        return rows.length ? rows : xs;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read only when the plan's work order or its SWO changes
  }, [sample, form.iwo_id, swoId, editId]);

  /**
   * REFILL FROM COSTING — on demand, and a MERGE, never a wipe: under an Item
   * wise line of the same material, the row of the same SMP takes the
   * costing's Planned Qty and a missing SMP row is added; a material the grid
   * does not hold yet is added as a line; every other line and row — the
   * planner's own additions, a colour / size split — is left exactly as it
   * is. Nothing is saved until Save.
   */
  const refillFromCosting = () => {
    if (!form.iwo_id) return;
    const iwoId = form.iwo_id;
    startFill(async () => {
      const res = await loadSwoCostingTrims(iwoId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setSwoTrims({ iwoId, data: res.data });
      const { rows, skipped } = rowsFromCosting(res.data);
      let updated = 0;
      let added = 0;
      setItems((xs) => {
        const kept = xs.filter((x) => !isBlankIwoMbLine(facts(x)));
        const next = [...kept];
        for (const r of rows) {
          const i = next.findIndex((x) => x.item_id === r.item_id && x.attribute === "item");
          if (i < 0) {
            added += r.slices.length;
            next.push(r);
            continue;
          }
          // The rows anyone typed on, plus the costing's — a blank seed row goes.
          const slices = next[i].slices.filter((sl) => !!(sl.sample_style_id || sl.item_color_id || sl.size.trim() || sl.planned_qty.trim()));
          for (const sl of r.slices) {
            const j = slices.findIndex((x) => x.sample_style_id === sl.sample_style_id);
            if (j >= 0) {
              if (slices[j].planned_qty !== sl.planned_qty) updated++;
              slices[j] = { ...slices[j], planned_qty: sl.planned_qty };
            } else {
              added++;
              slices.push(sl);
            }
          }
          next[i] = { ...next[i], slices };
        }
        return next.length ? next : [newItem()];
      });
      setDirty(true);
      success(`Refilled from costing — ${updated} updated, ${added} added. Save to keep it.`);
      if (skipped.length) toastError(`Not filled from costing: ${skipped.join("; ")}.`);
    });
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
    setItems([newItem()]);
    setProcs([blankProc()]);
    setDirty(false);
    setMode("edit");
  }

  function loadApproval(bomId: string) {
    getAccessoriesPlanApproval(bomId).then(
      (p) => setApproval({ forId: bomId, run: p.run, verdict: p.verdict, revisions: p.revisions, mine: p.mine }),
      () => setApproval(null),
    );
  }

  function openTask(t: IwoMaterialBomTask) {
    const b = t.bom;
    if (!b) return openNew(t.id);
    setEditId(b.id);
    setApproval(null);
    if (sample) loadApproval(b.id);
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
      slices: (r.iwo_material_bom_item_slices ?? []).map((sl, j, all) => ({
        key: newKey(),
        sample_style_id: sl.sample_style_id ?? "",
        item_color_id: sl.item_color_id,
        size: sl.size ?? "",
        planned_qty: str(sl.planned_qty),
        // A row straight after one of the same SMP is a further colour / size
        // of it (0711) — saved in order, so the run comes back as typed.
        sub: j > 0 && !!sl.sample_style_id && all[j - 1].sample_style_id === sl.sample_style_id,
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
    // A sample plan's line with no rows yet opens with one standing ready.
    setItems(is.length ? is.map((x) => (sample && x.slices.length === 0 ? { ...x, slices: [blankBreakupRow(newKey)] } : x)) : [newItem()]);
    setProcs(ps.length ? ps : [blankProc()]);
    setDirty(false);
    setMode("edit");
  }

  /** `?open=<iwoId>` — the IWO screen's "Open Material BOM" lands here, IN that
   *  work order's BOM. Declared after `openTask`, above any branch. */
  useOpenIntent((id) => {
    // A work order id, or a PLAN id (Sample ▸ Plan Approval's "Open plan").
    const t = taskById.get(id) ?? tasks.find((x) => x.bom?.id === id);
    if (t && (t.bom ? true : perms.canCreate)) openTask(t);
  });
  /* EMBEDDED IN SAMPLE ▸ REVISION'S WORKSPACE (2026-10-15) — the plan id the
     revision reopened. Above every branch, like every hook. */
  useEmbeddedEditor({
    embed,
    mode,
    open: (bomId) => {
      const t = tasks.find((x) => x.bom?.id === bomId);
      if (t) openTask(t);
    },
  });

  // ---- the quantity chain, previewed with the SAME function the save calls ----

  const quantityFor = (l: ItemRow) =>
    iwoMbQuantity(
      facts(l),
      procs
        .filter((p) => p.item_id && p.item_id === l.item_id && !isBlankIwoMbProcess(procFacts(p)))
        .map((p) => ({ loss_pct: num(p.loss_pct) })),
      uomById,
      data.conversions,
    );

  // ---- validity ----------------------------------------------------------------

  const problems = iwoMbProblems(items.map(facts), procs.map(procFacts), swoStyleIds);

  const validity = sectionValidity({
    sections: [{ key: "bom" }, { key: "items" }, { key: "processes" }, { key: "requirement" }],
    values: form,
    fields: [
      { section: "bom", id: "imb-iwo", label: sample ? "SWO No" : "I.WO No", required: true, empty: (f) => !f.iwo_id },
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
    if (!form.iwo_id) return;
    // Blank rows are dropped HERE as well as in the action: the schema requires
    // a material on every row it is sent.
    const payload = {
      iwo_id: form.iwo_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      items: keptIwoMbLines(items.map(facts))
        .filter((l) => !!l.item_id)
        .map((l) => ({ ...l, item_id: l.item_id as string, slices: [...(l.slices ?? [])] })),
      processes: keptIwoMbProcesses(procs.map(procFacts))
        .filter((p) => !!p.item_id)
        .map((p) => ({ ...p, item_id: p.item_id as string, stage: p.stage as "GREIGE" | "DYED" | null })),
    };
    start(async () => {
      const res = await saveIwoMaterialBom(editId, payload);
      if (res.ok) {
        success(editId ? "Accessories Plan updated" : "Accessories Plan created");
        setDirty(false);
        if (sample) reopenBom.current = res.bomId;
        else leaveEditor();
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
        success("Accessories Plan deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ----------------------------------------------------------------

  // ---- sample plan approval (0720) ---------------------------------------------
  // The Fabric Plan's rules, on the trims plan: the DATABASE is the lock and
  // the purchase gate; this says so on screen. `sample` gates all of it.
  // The lock follows the plan, not the route — see the Fabric Plan's note.
  const planBom = editId ? (picked?.bom ?? null) : null;
  const planStatus: PlanApprovalStatus | null = planBom?.approval_status ?? null;
  const planRev = planBom?.revision_no ?? 0;
  const planLocked = planStatus === "submitted" || planStatus === "approved";
  const panel = approval && approval.forId === editId ? approval : null;
  const decide =
    panel?.run && panel.verdict && panel.run.status === "in_progress" && panel.verdict.can_act && !panel.mine ? (
      <ApprovalActionBar
        run={panel.run}
        verdict={panel.verdict}
        subjectPath="/sales/sample-accessories-plan"
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
      const res = await submitSampleAccessoriesPlan(bomId);
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
      ? `${planRev ? `Revision ${planRev} is` : "This Accessories Plan is"} with the approver — nothing in it can change until it is approved or sent back, and no trims can be bought yet.`
      : planStatus === "approved"
        ? `Approved${planRev ? ` (Revision ${planRev})` : ""} and locked — trims can be bought up to its purchase quantities. To change them, Raise Revision.`
        : null;

  const columns: Column<IwoMaterialBomTask>[] = [
    {
      // A sample plan is known by its SWO (0709) — the SIW number stays
      // underneath and is shown only for a work order raised before it.
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
      : [{ header: "RE No", cell: (t: IwoMaterialBomTask) => <span className="font-mono text-xs">{t.reference_no ?? "—"}</span> }]),
    { header: "Deli Dt", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.deli_date)}</span> },
    {
      header: "Accessories Plan",
      cell: (t) =>
        !t.bom ? (
          <StatusPill tone="neutral">Not started</StatusPill>
        ) : t.bom.is_draft ? (
          <StatusPill tone="info">Draft</StatusPill>
        ) : sample ? (
          <StatusPill tone={planApprovalTone(t.bom.approval_status, t.bom.revision_no)}>
            {planApprovalLabel(t.bom.approval_status, t.bom.revision_no)}
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
            ? "An approved Accessories Plan cannot be deleted"
            : t.bom?.approval_status === "submitted"
              ? "This Accessories Plan is with the approver"
              : null
        }
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
    /* NO SMP NO ON THE LINE (0711; client 2026-10-12, the Fabric Plan's
       Allocation / Consumption split, reversing 82b3ce6): a sample plan's
       line is the SWO's consolidated accessory, bought once for the group.
       Which sample takes how much is the rows UNDER the line, one SMP each
       (`BreakupGrid`'s `samples`), and the line's Planned Qty is their sum. */
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
              slices: (sample || attribute !== "item") && r.slices.length === 0 ? [blankBreakupRow(newKey)] : r.slices,
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
        if (!hasIwoMbRows(facts(r))) {
          return decimalCell(r.planned_qty, "Planned Qty", (v) => patchItem(r.key, { planned_qty: v }), true);
        }
        /* UNDER A SPLIT ATTRIBUTE THE CELL IS Σ THE ROWS BENEATH, read-only —
           the order screen's line figure. The star stays (the record still
           needs the quantity) and a `readOnly` box never holds, so the
           requiredness is enforced on the rows' own cells and the Save gate;
           `tabIndex={-1}` comes with `readOnly`, so Tab goes from Cons. Uom
           straight on to Pur. Uom and reaches the rows after the line. */
        const total = plannedQtyOf(facts(r));
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
            const planned = plannedQtyOf(facts(r.line));
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
      label: "Accessories Plan",
      icon: Layers,
      done: !!form.iwo_id,
      content: (
        <SectionBody title="Accessories Plan">
          {/* The order screen's header, with the IWO standing where the Garment
              Order stood. Everything but the IWO and the Date is READ from the
              IWO — a readOnly field never holds the cursor. */}
          <FieldRow className="[&_input]:h-9">
            {sample ? (
              <Field label="SWO No" required className="w-full max-w-[240px]" htmlFor="imb-iwo">
                <RecordPicker
                  id="imb-iwo"
                  label="SWO No"
                  compact
                  items={swoItems}
                  value={form.iwo_id}
                  // LOCKED ONCE NAMED, and while its work order is being raised.
                  disabled={!!form.iwo_id || swoRaising || !perms.canCreate}
                  onChange={pickSwo}
                />
              </Field>
            ) : (
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
            )}
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
            {/* SAMPLE: SWO No and Date only (screenshot 3437). */}
            {!sample && (
              <>
                <Field label="RE No" className="w-[170px]" htmlFor="imb-re">
                  <Input id="imb-re" readOnly value={picked?.reference_no ?? ""} />
                </Field>
                <Field label="Deli Dt" className="w-[130px]" htmlFor="imb-deli">
                  <Input id="imb-deli" readOnly value={picked?.deli_date ? fmtDate(picked.deli_date) : ""} />
                </Field>
              </>
            )}
          </FieldRow>

          {/* NOTHING TO PICK — a state of the data, said with the way out. */}
          {/* SAMPLE: no create box — picking an SWO raises its work order (0709). */}
          {!sample && !form.iwo_id && iwoItems.length === 0 && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">
                No Internal Work Order For Accessories is waiting for an Accessories Plan.
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
          {/* REFILL FROM COSTING (user 2026-10-12) — on an SWO's plan only, a
              merge with the latest costing trims; see `refillFromCosting`. */}
          {sample && swoStyleIds && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {trims?.swo_code}: {trims?.samples.length ?? 0} sample{trims?.samples.length === 1 ? "" : "s"} — lines start from each
                sample&apos;s costing trims (qty per garment × pieces).
              </span>
              <Button type="button" variant="outline" disabled={filling} onClick={refillFromCosting} className="ml-auto">
                {filling ? "Refilling…" : "Refill from Costing"}
              </Button>
            </div>
          )}
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
              const planned = plannedQtyOf(facts(row));
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
              const planned = plannedQtyOf(facts(row));
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
                {hasIwoMbRows(facts(row)) && (
                  <BreakupGrid
                    samples={smpOptions}
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
                const missing = iwoMbProblems([facts(last)], [], swoStyleIds).filter((p) => p.section === "items");
                if (missing.length) {
                  toastError(missing[0].message.replace(/^Line 1/, "The open line"));
                  return false;
                }
              }
              setItems((xs) => [...xs, newItem()]);
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
      {embed && mode === "list" && (
        <EmbeddedEditorWait found={tasks.some((x) => x.bom?.id === embed.id)} returnHref={embed.returnHref} what="Accessories Plan" />
      )}
      <div className="space-y-4" hidden={!!embed}>
        <PageHeader
          title={sample ? "Accessories Plan" : "IWO Accessories Plan"}
          description={
            sample
              ? "The trims and accessories plan for a sample work order — the same plan the Orders module opens as the IWO Accessories Plan, listing the work orders raised from Sample."
              : "The Accessories Plan for an Internal Work Order For Accessories — no garment breakdown; the quantity is typed."
          }
          actions={perms.canCreate ? <Button onClick={() => openNew(null)}>+ New Accessories Plan</Button> : undefined}
        />
        <FilterBar
          trailing={<ViewToggle value={viewMode.view} onChange={viewMode.setView} />}
          leading={quick.segment}
          search={listQuery}
          onSearch={setListQuery}
          searchPlaceholder={sample ? "Search SWO No…" : "Search I.WO No or RE No…"}
          activeCount={listFacets.activeCount}
          onReset={listFacets.activeCount ? listFacets.reset : undefined}
          panel={listFacets.panel}
          right={`${listed.length} of ${tasks.length}`}
        />
        {sample ? (
          /* SAMPLE ▸ ACCESSORIES PLAN AS CARDS (user 2026-10-12: "same for this
             too"; plan "Sample card queues") — one card per SWO, its SMP
             numbers under the number, the way Orders ▸ Accessories Plan lists
             garment orders. Same rows, box, search and click as the table. */
          <SampleCards<IwoMaterialBomTask>
            rows={listed}
            getKey={(t) => t.id}
            title={(t) => <span className="font-mono">{t.swo?.code ?? t.code ?? "—"}</span>}
            subtitle={(t) => <span className="font-mono">{t.swo?.smp_nos.join(" · ") || "—"}</span>}
            // A SAVED SAMPLE PLAN IS COLOURED BY ITS APPROVAL (2026-10-13): the
            // box's word put every saved plan in green — "Not submitted",
            // "Revision 1 open" and "Sent back" read as done. Green is approved,
            // red is sent back (the planner owes the next step), the rest neutral.
            state={(t): SampleCardState => {
              // The card's colour reads the plan itself, not the box's word.
              if (!t.bom) return "pending";
              if (t.bom.is_draft) return "draft";
              if (t.bom.approval_status === "approved") return "updated";
              if (t.bom.approval_status === "returned") return "pending";
              return "neutral";
            }}
            // A saved sample plan's word is its APPROVAL (0720).
            // The labels are composite ("Approved · Rev 2"), so the icon reads the status itself.
            mark={(t) =>
              !t.bom || t.bom.is_draft || t.bom.approval_status === "returned"
                ? "todo"
                : t.bom.approval_status === "approved"
                  ? "done"
                  : t.bom.approval_status === "submitted"
                    ? "wait"
                    : "todo"
            }
            pillText={(t) =>
              !t.bom ? "Not started" : t.bom.is_draft ? "Draft" : planApprovalLabel(t.bom.approval_status, t.bom.revision_no)
            }
            stats={(t) => [
              { label: "Samples", value: String(t.swo?.smp_nos.length ?? 0) },
              { label: "Trims", value: String(t.bom?.iwo_material_bom_items.length ?? 0), lead: true },
              { label: "Deli Dt", value: t.deli_date ? fmtDate(t.deli_date) : "—" },
            ]}
            onOpen={(t) => (t.bom ? true : perms.canCreate) && openTask(t)}
            footerNote={hasCreatedInfo(tasks) ? (t) => `Created ${createdMeta(t)}` : undefined}
            canDelete={perms.canDelete}
            canDeleteRow={(t) => !!t.bom && t.bom.approval_status !== "submitted" && t.bom.approval_status !== "approved"}
            onDelete={del}
            onReports={(t) => t.bom && router.push(planReportHref("accessories", t.bom.id))}
            canReportsRow={(t) => !!t.bom && !t.bom.is_draft}
            onSend={sendPlan}
            canSendRow={canSendPlan}
            isPending={isPending}
            // Updated is done work — a table, as Orders draws it; Pending and
            // Draft stay cards (user 2026-10-13).
            table={{ title: "SWO No", subtitle: "SMP No" }}
            /* THE COSTING CARD (user 2026-10-23: "accessories plan la irukka cards um
               costing la irukka mari venum") — `GlowRecordCard`, the body Costing's
               card is drawn from: the SWO number in its chip, the SMP numbers beside
               the initials, the plan's state as the sub-line (said once, in words —
               no corner mark), the figures with no label row, and the actions as
               one spread row of duotone tiles. A greyed tile says why. */
            renderCard={(t) => {
              const stateWord = !t.bom ? "Not started" : t.bom.is_draft ? "Draft" : planApprovalLabel(t.bom.approval_status, t.bom.revision_no);
              const deli = t.deli_date ? (cardShared.year ? fmtDate(t.deli_date).slice(0, 5) : fmtDate(t.deli_date)) : "—";
              const deleteWhy = !t.bom
                ? "Not planned yet — nothing to delete"
                : t.bom.approval_status === "submitted"
                  ? "With the approver — it cannot be deleted"
                  : t.bom.approval_status === "approved"
                    ? "Approved — it cannot be deleted"
                    : null;
              return (
                <GlowRecordCard
                  code={stripPrefix(t.swo?.code ?? t.code, cardShared.swo) ?? "—"}
                  title={(t.swo?.smp_nos ?? []).map((n) => stripPrefix(n, cardShared.smp)).join(" · ") || "—"}
                  hue={t.swo?.code ?? t.code}
                  sub={stateWord}
                  start={!t.bom && perms.canCreate ? "Start plan" : undefined}
                  figures={[
                    ...(t.bom ? [{ label: "Trims", value: `${t.bom.iwo_material_bom_items.length} trims` }] : []),
                    { label: "Delivery date", value: deli },
                  ]}
                  onOpen={t.bom || perms.canCreate ? () => openTask(t) : undefined}
                  footer={
                    <div className={cn("mx-3 flex min-h-10 items-center justify-between gap-1 py-1", GLOW_RULE)}>
                      <CardAction
                        label="Reports"
                        tone="violet"
                        icon={DUO.doc}
                        reason={!t.bom || t.bom.is_draft ? "Nothing to report on yet — save the plan first" : null}
                        onClick={() => t.bom && router.push(planReportHref("accessories", t.bom.id))}
                      />
                      <CardAction
                        label="Send for approval"
                        tone="primary"
                        icon={DUO.send}
                        reason={
                          canSendPlan(t)
                            ? null
                            : !t.bom || t.bom.is_draft
                              ? "Save the plan first"
                              : !perms.canEdit
                                ? "Needs the edit permission"
                                : "Already with the approver, or approved"
                        }
                        disabled={isPending}
                        onClick={() => sendPlan(t)}
                      />
                      {perms.canDelete ? <CardDeleteAction reason={deleteWhy} isPending={isPending} onConfirm={() => del(t)} /> : null}
                    </div>
                  }
                />
              );
            }}
        view={viewMode.view}
            empty={
              !tasks.length
                ? "No accessories plans at this unit yet — + New Accessories Plan, then pick the SWO."
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
                ? "No accessories plans at this unit yet — + New Accessories Plan, then pick the SWO."
                : "No Internal Work Orders For Accessories at this unit yet."
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
            {editId ? "Editing" : "New"} <span className="font-semibold text-foreground">IWO material BOM</span>
          </>
        }
        header={{
          initials: "MB",
          title: (sample ? (picked?.swo?.code ?? picked?.code) : picked?.code) ?? "New Accessories Plan",
          badges: (
            <>
              {/* A production plan never has an approval to show; a sample one
                  shows it on either route. */}
              {planStatus && planBom && !planBom.is_draft && (sample || planStatus !== "open") ? (
                <StatusPill tone={planApprovalTone(planStatus, planRev)}>{planApprovalLabel(planStatus, planRev)}</StatusPill>
              ) : null}
              {dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null}
            </>
          ),
          meta: (
            <>
              <span>{picked ? "For Accessories" : sample ? "No SWO chosen" : "No work order chosen"}</span>
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
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
        // A SUBMITTED OR APPROVED SAMPLE PLAN IS LOCKED (0720): read-only, one
        // Close, the reason at the top — and the way on at its right.
        locked={
          planLockMessage
            ? {
                message: planLockMessage,
                action:
                  decide ??
                  (planStatus === "approved" && perms.canEdit ? (
                    // ONE RAISE DOOR (2026-10-15): Sample ▸ Revision's page, this plan ticked.
                    <Button
                      variant="outline"
                      onClick={() => router.push(`/sales/sample-revision/new?plan=${encodeURIComponent(`accessories:${editId}`)}`)}
                    >
                      Raise Revision
                    </Button>
                  ) : undefined),
              }
            : false
        }
        viewOnly={!!editId && !perms.canEdit}
        // NOTHING IN A LOCKED PLAN TAKES INPUT — see PlanLockFence.
        sections={sections.map((sec) => ({ ...sec, content: <PlanLockFence locked={planLocked}>{sec.content}</PlanLockFence> }))}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New Accessories Plan",
          onCancel: () => leaveEditor(),
          onSave: () => submit(false),
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          saveLabel: "Save Accessories Plan",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          // Saved and untouched: Submit stands where Save stood (user 2026-10-14).
          submit: canSubmitPlan ? { label: "Submit for Approval", onClick: submitPlan } : null,
          isPending,
        }}
      />

    </>
  );
}
