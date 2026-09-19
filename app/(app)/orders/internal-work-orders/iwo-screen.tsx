"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ClipboardList, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, RequiredScope } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { FABRIC_FORM_OPTIONS } from "@/lib/orders/fabric-bom/component-map";
import {
  deleteInternalWorkOrder,
  previewIwoNumber,
  saveInternalWorkOrder,
  setIwoStatus,
} from "@/lib/orders/internal-work-orders/actions";
import {
  IWO_FOR,
  IWO_FOR_LABELS,
  IWO_STATUS_LABELS,
  isIwoFor,
  iwoStatusTone,
  type IwoAccessoryLineInput,
  type IwoAccessoryProcessInput,
  type IwoFabricLineInput,
  type IwoFor,
  type IwoInput,
  type IwoStatus,
  type IwoYarnLineInput,
  type IwoYarnProcessInput,
  type IwoFabricProcessInput,
} from "@/lib/orders/internal-work-orders/types";
import {
  grossUpKgs,
  isBlankAccessoryProcess,
  isBlankFabricProcess,
  isBlankYarnProcess,
  lineProblems,
} from "@/lib/orders/internal-work-orders/lines";
import type { IwoFormData, IwoRow } from "@/lib/orders/internal-work-orders/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// ---------------------------------------------------------------------------
// Draft rows — what the grids hold while the operator types. Numbers stay
// STRINGS until the payload is built, so a half-typed "12." survives a render.
//
// EVERY SEED IS BLANK. The save side drops an untouched row by testing the
// fields the operator types (`lines.ts`); a default stamped in here would make
// that test the constant `true` and save a phantom line.
// ---------------------------------------------------------------------------

type YarnRow = { key: string; item_id: string | null; stage_id: string | null; planned_kgs: string };
/** A process row names its line by the line's client KEY, not its position —
 *  removing line 1 must not move line 2's shades onto line 1. */
type YarnProcRow = {
  key: string;
  line_key: string | null;
  process_id: string | null;
  shade_id: string | null;
  qty_kgs: string;
  rate: string;
};
type FabricRow = {
  key: string;
  /** A NARROWING FACET, not stored: the fabric carries its own structure
   *  (`items.category_id`), so this is filled from the fabric on load. */
  structure_id: string | null;
  item_id: string | null;
  stage_id: string | null;
  color_id: string | null;
  print_id: string | null;
  gsm: string;
  fabric_form: string;
  dia: string;
  planned_kgs: string;
};
type FabricProcRow = {
  key: string;
  line_key: string | null;
  process_id: string | null;
  loss_pct: string;
  rate: string;
};
type AccRow = {
  key: string;
  item_id: string | null;
  specs: string;
  color_id: string | null;
  size_id: string | null;
  uom_id: string | null;
  planned_qty: string;
  is_advised: boolean;
};
type AccProcRow = {
  key: string;
  line_key: string | null;
  process_id: string | null;
  vendor_id: string | null;
  rate: string;
};

type Form = {
  iwo_date: string;
  iwo_for: IwoFor | "";
  sales_order_id: string | null;
  style_ref_no: string;
  deli_date: string;
  remarks: string;
};
const blankForm = (): Form => ({
  iwo_date: today(),
  iwo_for: "",
  sales_order_id: null,
  style_ref_no: "",
  deli_date: "",
  remarks: "",
});

/** "" → null; anything else → a number, or NaN for a non-number, which the
 *  line rules then refuse by name rather than letting it read as blank. */
const num = (s: string): number | null => {
  const t = s.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const kg = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));

export function IwoScreen({
  rows,
  data,
  perms,
  nextIwoNo,
}: {
  rows: IwoRow[];
  data: IwoFormData;
  perms: Perms;
  /** The I.WO No a work order raised TODAY would get — fetched with the page so
   *  a new one's box is filled on its first paint. */
  nextIwoNo: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [yarn, setYarn] = useState<YarnRow[]>([]);
  const [yarnProcs, setYarnProcs] = useState<YarnProcRow[]>([]);
  const [fabric, setFabric] = useState<FabricRow[]>([]);
  const [fabricProcs, setFabricProcs] = useState<FabricProcRow[]>([]);
  const [acc, setAcc] = useState<AccRow[]>([]);
  const [accProcs, setAccProcs] = useState<AccProcRow[]>([]);

  /**
   * Real edits, never "is the editor open". The overlay mount means
   * `MasterFullScreen` only calls `useModalGuard`, which `confirmDiscard()`
   * deliberately does not read — so THIS is what stands between Escape and a
   * silently discarded work order, and what holds off the silent auto-reload.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  /**
   * THE I.WO NO BOX. Two sources, never both: a saved work order shows its
   * STORED number, a new one shows what `peek_iwo_number` (0580) predicts.
   *
   * Asked from the EVENTS that change the answer — opening a new record, and a
   * Date edit (the Date decides the fiscal year) — rather than from an effect,
   * so no render ever shows a stale year. `previewSeq` drops an answer that
   * arrives after a newer question was asked.
   *
   * A PREDICTION, NOT A RESERVATION: two operators entering at once at one unit
   * see the same number, and only the first to save gets it. The saved number
   * replaces the prediction when the list reloads after Save.
   */
  const [previewNo, setPreviewNo] = useState<string | null>(nextIwoNo);
  const previewSeq = useRef(0);
  const askPreview = (iwoDate: string) => {
    const seq = ++previewSeq.current;
    void previewIwoNumber(iwoDate || null).then((n) => {
      if (seq === previewSeq.current) setPreviewNo(n);
    });
  };

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const blankYarn = (): YarnRow => ({ key: newKey(), item_id: null, stage_id: null, planned_kgs: "" });
  const blankYarnProc = (): YarnProcRow => ({
    key: newKey(),
    line_key: null,
    process_id: null,
    shade_id: null,
    qty_kgs: "",
    rate: "",
  });
  const blankFabric = (): FabricRow => ({
    key: newKey(),
    structure_id: null,
    item_id: null,
    stage_id: null,
    color_id: null,
    print_id: null,
    gsm: "",
    fabric_form: "",
    dia: "",
    planned_kgs: "",
  });
  const blankFabricProc = (): FabricProcRow => ({
    key: newKey(),
    line_key: null,
    process_id: null,
    loss_pct: "",
    rate: "",
  });
  const blankAcc = (): AccRow => ({
    key: newKey(),
    item_id: null,
    specs: "",
    color_id: null,
    size_id: null,
    uom_id: null,
    planned_qty: "",
    is_advised: false,
  });
  const blankAccProc = (): AccProcRow => ({
    key: newKey(),
    line_key: null,
    process_id: null,
    vendor_id: null,
    rate: "",
  });

  // ---- lookups ---------------------------------------------------------------
  const yarnById = useMemo(() => byId(data.yarns), [data.yarns]);
  const fabricById = useMemo(() => byId(data.fabrics), [data.fabrics]);
  const accById = useMemo(() => byId(data.accessories), [data.accessories]);
  const stageName = useMemo(() => {
    const m = new Map([...data.yarnStages, ...data.fabricStages].map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "") : "");
  }, [data.yarnStages, data.fabricStages]);
  const structureById = useMemo(() => byId(data.structures), [data.structures]);

  // Every mutation marks the record dirty in the same breath, so the flag
  // cannot drift from the state it describes.
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mut =
    <R,>(setter: (fn: (xs: R[]) => R[]) => void) =>
    (fn: (xs: R[]) => R[]) => {
      setter(fn);
      setDirty(true);
    };
  const mutYarn = mut<YarnRow>(setYarn);
  const mutYarnProcs = mut<YarnProcRow>(setYarnProcs);
  const mutFabric = mut<FabricRow>(setFabric);
  const mutFabricProcs = mut<FabricProcRow>(setFabricProcs);
  const mutAcc = mut<AccRow>(setAcc);
  const mutAccProcs = mut<AccProcRow>(setAccProcs);
  const patchIn =
    <R extends { key: string }>(m: (fn: (xs: R[]) => R[]) => void) =>
    (key: string, patch: Partial<R>) =>
      m((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchYarn = patchIn<YarnRow>(mutYarn);
  const patchYarnProc = patchIn<YarnProcRow>(mutYarnProcs);
  const patchFabric = patchIn<FabricRow>(mutFabric);
  const patchFabricProc = patchIn<FabricProcRow>(mutFabricProcs);
  const patchAcc = patchIn<AccRow>(mutAcc);
  const patchAccProc = patchIn<AccProcRow>(mutAccProcs);

  // ---- open ------------------------------------------------------------------

  /**
   * EVERY GRID IS SEEDED HERE, in the open handlers, BEFORE `setDirty(false)`.
   * Not `ChildGrid`'s `seedRow`: that seeds by calling `onAdd` from an effect,
   * and `onAdd` sets `dirty`, so every work order would open reading "Unsaved
   * changes" and pin the silent auto-update off (AGENTS.md, "Editable
   * sub-tables open with a row"). All six are seeded whatever `For` says, so
   * switching `For` lands on a grid that is already ready to type into.
   */
  function openAdd() {
    setEditId(null);
    const fresh = blankForm();
    setForm(fresh);
    // Shown at once from the page's answer, then re-asked: the page may be
    // minutes old, and another IWO may have taken that number since.
    setPreviewNo(nextIwoNo);
    askPreview(fresh.iwo_date);
    setYarn([blankYarn()]);
    setYarnProcs([blankYarnProc()]);
    setFabric([blankFabric()]);
    setFabricProcs([blankFabricProc()]);
    setAcc([blankAcc()]);
    setAccProcs([blankAccProc()]);
    setDirty(false);
    setMode("edit");
  }
  // The palette's "New work order" (`?new=1`). Declared after `openAdd`, and
  // still above any branch — this component has no early return.
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openEdit(r: IwoRow) {
    setEditId(r.id);
    setForm({
      iwo_date: r.iwo_date ?? today(),
      iwo_for: isIwoFor(r.iwo_for) ? r.iwo_for : "",
      sales_order_id: r.sales_order_id,
      style_ref_no: r.style_ref_no ?? "",
      deli_date: r.deli_date ?? "",
      remarks: r.remarks ?? "",
    });

    const yRows: YarnRow[] = [];
    const yProcs: YarnProcRow[] = [];
    for (const l of r.iwo_yarn_items) {
      const key = newKey();
      yRows.push({ key, item_id: l.item_id, stage_id: l.stage_id, planned_kgs: str(l.planned_kgs) });
      for (const p of l.iwo_yarn_process_details) {
        yProcs.push({
          key: newKey(),
          line_key: key,
          process_id: p.process_id,
          shade_id: p.shade_id,
          qty_kgs: str(p.qty_kgs),
          rate: str(p.rate_per_kg),
        });
      }
    }
    const fRows: FabricRow[] = [];
    const fProcs: FabricProcRow[] = [];
    for (const l of r.iwo_fabric_items) {
      const key = newKey();
      fRows.push({
        key,
        structure_id: fabricById.get(l.item_id)?.category_id ?? null,
        item_id: l.item_id,
        stage_id: l.stage_id,
        color_id: l.color_id,
        print_id: l.print_id,
        gsm: str(l.gsm),
        fabric_form: l.fabric_form ?? "",
        dia: l.dia ?? "",
        planned_kgs: str(l.planned_kgs),
      });
      for (const p of l.iwo_fabric_process_details) {
        fProcs.push({
          key: newKey(),
          line_key: key,
          process_id: p.process_id,
          loss_pct: str(p.loss_pct),
          rate: str(p.rate_per_kg),
        });
      }
    }
    const aRows: AccRow[] = [];
    const aProcs: AccProcRow[] = [];
    for (const l of r.iwo_accessory_items) {
      const key = newKey();
      aRows.push({
        key,
        item_id: l.item_id,
        specs: l.specs ?? "",
        color_id: l.color_id,
        size_id: l.size_id,
        uom_id: l.uom_id,
        planned_qty: str(l.planned_qty),
        is_advised: !!l.is_advised,
      });
      for (const p of l.iwo_accessory_process_details) {
        aProcs.push({
          key: newKey(),
          line_key: key,
          process_id: p.process_id,
          vendor_id: p.vendor_id,
          rate: str(p.rate_per_unit),
        });
      }
    }

    // `[]` means "no lines yet" and opens ready to type, same as a new record.
    setYarn(yRows.length ? yRows : [blankYarn()]);
    setYarnProcs(yProcs.length ? yProcs : [blankYarnProc()]);
    setFabric(fRows.length ? fRows : [blankFabric()]);
    setFabricProcs(fProcs.length ? fProcs : [blankFabricProc()]);
    setAcc(aRows.length ? aRows : [blankAcc()]);
    setAccProcs(aProcs.length ? aProcs : [blankAccProc()]);
    setDirty(false);
    setMode("edit");
  }

  // ---- payload ---------------------------------------------------------------

  const yarnProcInput = (p: YarnProcRow): IwoYarnProcessInput => ({
    process_id: p.process_id,
    shade_id: p.shade_id,
    qty_kgs: num(p.qty_kgs),
    rate_per_kg: num(p.rate),
  });
  const fabricProcInput = (p: FabricProcRow): IwoFabricProcessInput => ({
    process_id: p.process_id,
    loss_pct: num(p.loss_pct),
    rate_per_kg: num(p.rate),
  });

  const yarnInput: IwoYarnLineInput[] = yarn.map((l) => ({
    item_id: l.item_id,
    stage_id: l.stage_id,
    planned_kgs: num(l.planned_kgs),
    processes: yarnProcs.filter((p) => p.line_key === l.key).map(yarnProcInput),
  }));
  const fabricInput: IwoFabricLineInput[] = fabric.map((l) => ({
    item_id: l.item_id,
    stage_id: l.stage_id,
    color_id: l.color_id,
    print_id: l.print_id,
    gsm: num(l.gsm),
    fabric_form: l.fabric_form === "open" || l.fabric_form === "tubular" ? l.fabric_form : null,
    dia: l.dia.trim() || null,
    planned_kgs: num(l.planned_kgs),
    processes: fabricProcs.filter((p) => p.line_key === l.key).map(fabricProcInput),
  }));
  const accProcInput = (p: AccProcRow): IwoAccessoryProcessInput => ({
    process_id: p.process_id,
    vendor_id: p.vendor_id,
    rate_per_unit: num(p.rate),
  });
  const accInput: IwoAccessoryLineInput[] = acc.map((l) => ({
    item_id: l.item_id,
    specs: l.specs.trim() || null,
    color_id: l.color_id,
    size_id: l.size_id,
    uom_id: l.uom_id,
    planned_qty: num(l.planned_qty),
    is_advised: l.is_advised,
    processes: accProcs.filter((p) => p.line_key === l.key).map(accProcInput),
  }));

  // ---- validity --------------------------------------------------------------

  const iwoFor = form.iwo_for || null;
  const linesLabel = iwoFor ? IWO_FOR_LABELS[iwoFor] : "Lines";
  const processLabel =
    iwoFor === "fabric" ? "Fabric Process" : iwoFor === "accessories" ? "Accessory Process" : "Yarn Process";

  /**
   * EVERY KIND HAS AN OPTIONAL PROCESS SECTION, once `For` is chosen: a yarn's
   * dyeing shades, a fabric's loss steps, a trim's vendor processing. Nothing
   * in it is mandatory until a row is started, so an IWO that needs none saves
   * without touching it.
   *
   * YARN'S IS NOT GATED ON THE STAGE. Stage is the state the yarn is BOUGHT in;
   * the SRS's own example dyes a GREY elastane (doc/order/internlwork order.md
   * §3). A first cut showed this section only once a line was DYED — backwards.
   */
  const yarnProcStarted = yarnProcs.some((p) => !isBlankYarnProcess(yarnProcInput(p)));
  const showProcess = !!iwoFor;

  // A process row the operator filled but attached to no line cannot travel in
  // the payload (rows are nested under their line), so it is refused here.
  const unattached: string[] = [];
  if (iwoFor === "yarn") {
    yarnProcs.forEach((p, i) => {
      if (!p.line_key && !isBlankYarnProcess(yarnProcInput(p)))
        unattached.push(`Yarn Process row ${i + 1}: choose which yarn it is for.`);
    });
  }
  if (iwoFor === "fabric") {
    fabricProcs.forEach((p, i) => {
      if (!p.line_key && !isBlankFabricProcess(fabricProcInput(p)))
        unattached.push(`Fabric Process row ${i + 1}: choose which fabric it is for.`);
    });
  }
  if (iwoFor === "accessories") {
    accProcs.forEach((p, i) => {
      if (!p.line_key && !isBlankAccessoryProcess(accProcInput(p)))
        unattached.push(`Accessory Process row ${i + 1}: choose which item it is for.`);
    });
  }

  const problems = iwoFor
    ? lineProblems({ iwo_for: iwoFor, yarn: yarnInput, fabric: fabricInput, accessories: accInput })
    : [];

  /**
   * DERIVED, never hand-assembled. The header's two mandatory fields mirror
   * their `required` props below; everything about the lines comes from
   * `lineProblems` — the SAME function the action runs before it writes.
   */
  const validity = sectionValidity({
    sections: [
      { key: "header" },
      { key: "lines", when: () => !!iwoFor },
      { key: "process", when: () => showProcess },
    ],
    values: form,
    fields: [
      { section: "header", id: "iwo-date", label: "Date", required: true, empty: (f) => !f.iwo_date },
      { section: "header", id: "iwo-for", label: "For", required: true, empty: (f) => !f.iwo_for },
    ],
    extra: [
      ...problems.map((p) => ({
        section: p.where,
        label: p.where === "lines" ? linesLabel : processLabel,
        message: p.message,
        kind: "custom" as const,
      })),
      ...unattached.map((message) => ({
        section: "process",
        label: processLabel,
        message,
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

  function submit() {
    if (!iwoFor) return;
    const payload: IwoInput = {
      iwo_date: form.iwo_date,
      iwo_for: iwoFor,
      sales_order_id: form.sales_order_id,
      style_ref_no: form.style_ref_no.trim() || null,
      deli_date: form.deli_date || null,
      remarks: form.remarks.trim() || null,
      yarn: yarnInput,
      fabric: fabricInput,
      accessories: accInput,
    };
    start(async () => {
      const res = await saveInternalWorkOrder(editId, payload);
      if (res.ok) {
        success(editId ? "Work order updated" : "Work order created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: IwoRow) {
    // No confirm() — <RowActions> asks in the row (LAYOUT.md §6a).
    start(async () => {
      const res = await deleteInternalWorkOrder(r.id);
      if (res.ok) {
        success("Work order deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function changeStatus(r: IwoRow, status: IwoStatus, msg: string) {
    start(async () => {
      const res = await setIwoStatus(r.id, status);
      if (res.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ----------------------------------------------------------------

  const orderNo = useMemo(() => {
    const m = new Map(data.orders.map((o) => [o.id, o.name]));
    return (id: string | null) => (id ? (m.get(id) ?? null) : null);
  }, [data.orders]);

  const columns: Column<IwoRow>[] = [
    {
      header: "I.WO No",
      cell: (r) => (
        <button
          type="button"
          onClick={() => perms.canEdit && openEdit(r)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.iwo_date)}</span> },
    {
      header: "For",
      cell: (r) => <span className="text-sm">{isIwoFor(r.iwo_for) ? IWO_FOR_LABELS[r.iwo_for] : "—"}</span>,
    },
    {
      header: "RE No",
      cell: (r) => <span className="font-mono text-xs">{r.sales_orders?.order_number ?? "—"}</span>,
    },
    { header: "Style", cell: (r) => <span className="text-sm">{r.style_ref_no ?? "—"}</span> },
    { header: "Deli Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.deli_date)}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={iwoStatusTone(r.status)}>{IWO_STATUS_LABELS[r.status]}</StatusPill>
      ),
    },
    rowActionsColumn((r) => {
      // The status steps the old detail page carried as buttons live in the
      // row's ⋮ now, since the editor is a mode of this list.
      const menu: RowMenuItem[] = [];
      if (perms.canEdit && r.status === "draft")
        menu.push({ label: "Issue", onClick: () => changeStatus(r, "issued", "Work order issued") });
      if (perms.canEdit && r.status === "issued")
        menu.push({
          label: "Mark complete",
          onClick: () => changeStatus(r, "completed", "Work order completed"),
        });
      if (perms.canEdit && (r.status === "draft" || r.status === "issued"))
        menu.push({
          label: "Cancel work order",
          danger: true,
          onClick: () => changeStatus(r, "cancelled", "Work order cancelled"),
        });
      return (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          isPending={isPending}
          menu={menu.length ? menu : undefined}
        />
      );
    }),
  ];

  // ---- grid helpers ------------------------------------------------------------

  /**
   * A cell mandatory only once its row has been STARTED — Budget's
   * `requiredFor`. The column declares `required` for the header star; this
   * inner scope restates the ROW's answer and wins (context resolves to the
   * nearest provider), so the seeded blank row of an optional grid never holds
   * the cursor.
   */
  const reqIf = (on: boolean, label: string, node: ReactNode) => (
    <RequiredScope required={on} label={label}>
      {node}
    </RequiredScope>
  );

  const decimalCell = (
    value: string,
    onChange: (v: string) => void,
    opts: { required?: boolean; readOnly?: boolean } = {},
  ) => (
    <Input
      className="h-8 text-right"
      inputMode="decimal"
      required={opts.required}
      readOnly={opts.readOnly}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const processItems = (flag: "for_yarn" | "for_fabric", held: string | null): PickerItem[] =>
    // The flag narrows NEW picks; the value a row already holds stays
    // resolvable even if its flag was unticked on the master since.
    data.processes.filter((p) => p[flag] || p.id === held);

  // ---- Yarn --------------------------------------------------------------------

  const yarnColumns: ChildGridColumn<YarnRow>[] = [
    {
      header: "Yarn",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Yarn"
          compact
          required
          items={data.yarns}
          value={r.item_id}
          onChange={(id) => patchYarn(r.key, { item_id: id })}
        />
      ),
    },
    {
      header: "Stage",
      required: true,
      width: "10rem",
      cell: (r) => (
        <LookupDialogPicker
          kind="yarn_stage"
          label="Stage"
          compact
          required
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          options={data.yarnStages}
          value={r.stage_id}
          onChange={(id) => patchYarn(r.key, { stage_id: id })}
        />
      ),
    },
    {
      header: "Planned Weight (KGS)",
      required: true,
      align: "right",
      width: "11rem",
      total: { kind: "sum", of: (r) => num(r.planned_kgs) || 0, format: kg },
      cell: (r) =>
        decimalCell(r.planned_kgs, (v) => patchYarn(r.key, { planned_kgs: v }), { required: true }),
    },
  ];

  /** The yarn lines a process row may name — every line with a yarn picked. */
  const yarnLineItems: PickerItem[] = yarn
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !!l.item_id)
    .map(({ l, i }) => ({
      id: l.key,
      code: null,
      name: `${i + 1} · ${yarnById.get(l.item_id!)?.name ?? ""} · ${stageName(l.stage_id)}`,
      // A line of THIS document, not a master row — nothing can switch it off.
      inactive: false,
    }));

  function pickYarnLine(procKey: string, lineKey: string | null) {
    mutYarnProcs((xs) => {
      const row = xs.find((x) => x.key === procKey);
      const line = yarn.find((l) => l.key === lineKey);
      let qty = row?.qty_kgs ?? "";
      // A convenience on PICK, never at seed: offer what is still unshaded.
      if (row && line && !qty.trim()) {
        const planned = num(line.planned_kgs) || 0;
        const used = xs
          .filter((x) => x.key !== procKey && x.line_key === lineKey)
          .reduce((s, x) => s + (num(x.qty_kgs) || 0), 0);
        const rest = Math.round((planned - used) * 1000) / 1000;
        if (rest > 0) qty = String(rest);
      }
      return xs.map((x) => (x.key === procKey ? { ...x, line_key: lineKey, qty_kgs: qty } : x));
    });
  }

  const yarnProcAmount = (p: YarnProcRow) => {
    const q = num(p.qty_kgs);
    const r = num(p.rate);
    return q != null && r != null && Number.isFinite(q * r) ? q * r : null;
  };

  const yarnProcColumns: ChildGridColumn<YarnProcRow>[] = [
    {
      header: "Yarn",
      required: true,
      cell: (r) => {
        const on = !isBlankYarnProcess(yarnProcInput(r));
        return reqIf(
          on,
          "Yarn",
          <RecordPicker
            label="Yarn"
            compact
            required={on}
            items={yarnLineItems}
            value={r.line_key}
            onChange={(k) => pickYarnLine(r.key, k)}
          />,
        );
      },
    },
    {
      header: "Process",
      required: true,
      width: "12rem",
      cell: (r) => {
        const on = !isBlankYarnProcess(yarnProcInput(r));
        return reqIf(
          on,
          "Process",
          <RecordPicker
            label="Process"
            compact
            required={on}
            items={processItems("for_yarn", r.process_id)}
            value={r.process_id}
            onChange={(id) => patchYarnProc(r.key, { process_id: id })}
          />,
        );
      },
    },
    {
      header: "Shade",
      required: true,
      width: "11rem",
      cell: (r) => {
        const on = !isBlankYarnProcess(yarnProcInput(r));
        return reqIf(
          on,
          "Shade",
          <LookupDialogPicker
            kind="fabric_color"
            label="Shade"
            compact
            required={on}
            options={data.colors}
            canCreate={perms.canCreate}
            value={r.shade_id}
            onChange={(id) => patchYarnProc(r.key, { shade_id: id })}
          />,
        );
      },
    },
    {
      header: "KGS",
      required: true,
      align: "right",
      width: "8rem",
      total: { kind: "sum", of: (r) => num(r.qty_kgs) || 0, format: kg },
      cell: (r) => {
        const on = !isBlankYarnProcess(yarnProcInput(r));
        return reqIf(
          on,
          "KGS",
          decimalCell(r.qty_kgs, (v) => patchYarnProc(r.key, { qty_kgs: v }), { required: on }),
        );
      },
    },
    {
      header: "Rate / KG",
      align: "right",
      width: "8rem",
      cell: (r) => decimalCell(r.rate, (v) => patchYarnProc(r.key, { rate: v })),
    },
    {
      header: "Amount",
      align: "right",
      width: "9rem",
      total: { kind: "sum", of: (r) => yarnProcAmount(r) ?? 0, format: fmtNumber },
      cell: (r) => {
        const a = yarnProcAmount(r);
        return <span className="tabular-nums text-sm">{a == null ? "" : fmtNumber(a)}</span>;
      },
    },
  ];

  // ---- Fabric ------------------------------------------------------------------

  /** Reqd Yarn — the planned weight grossed up through this line's losses. */
  const fabricGross = (l: FabricRow) =>
    grossUpKgs(
      num(l.planned_kgs),
      fabricProcs
        .filter((p) => p.line_key === l.key && !isBlankFabricProcess(fabricProcInput(p)))
        .map((p) => num(p.loss_pct)),
    );

  const fabricColumns: ChildGridColumn<FabricRow>[] = [
    {
      header: "Structure",
      cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          items={data.structures}
          value={r.structure_id}
          onChange={(id) => {
            // Narrowing around a fabric already picked keeps it; a structure it
            // is not in clears it (the cascading-picker rule).
            const held = r.item_id ? fabricById.get(r.item_id) : undefined;
            patchFabric(r.key, {
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
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          items={data.fabrics.filter(
            (f) => !r.structure_id || f.category_id === r.structure_id || f.id === r.item_id,
          )}
          value={r.item_id}
          onChange={(id) =>
            patchFabric(r.key, {
              item_id: id,
              structure_id: (id ? fabricById.get(id)?.category_id : null) ?? r.structure_id,
            })
          }
        />
      ),
    },
    {
      // The SRS's "Structure" (Circular / Flat Knit / Woven) — the knit family
      // of the fabric's structure, read off the master, never typed. `readOnly`
      // keeps it off the Tab path.
      header: "Structure Type",
      cell: (r) => (
        <Input
          className="h-8"
          readOnly
          value={(r.structure_id ? structureById.get(r.structure_id)?.knit : null) ?? ""}
        />
      ),
    },
    {
      header: "Stage",
      required: true,
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_stage"
          label="Stage"
          compact
          required
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          options={data.fabricStages}
          value={r.stage_id}
          onChange={(id) => patchFabric(r.key, { stage_id: id })}
        />
      ),
    },
    {
      header: "Colour / Shade",
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_color"
          label="Colour / Shade"
          compact
          options={data.colors}
          canCreate={perms.canCreate}
          value={r.color_id}
          onChange={(id) => patchFabric(r.key, { color_id: id })}
        />
      ),
    },
    {
      header: "Print",
      cell: (r) => (
        <LookupDialogPicker
          kind="roll_form_print"
          label="Print"
          compact
          options={data.prints}
          canCreate={perms.canCreate}
          value={r.print_id}
          onChange={(id) => patchFabric(r.key, { print_id: id })}
        />
      ),
    },
    {
      header: "GSM",
      align: "right",
      cell: (r) => decimalCell(r.gsm, (v) => patchFabric(r.key, { gsm: v })),
    },
    {
      header: "Form / Tube",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.fabric_form}
          onChange={(e) => patchFabric(r.key, { fabric_form: e.target.value })}
        >
          <option value=""></option>
          {FABRIC_FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Finish Dia",
      cell: (r) => (
        <Input className="h-8" value={r.dia} onChange={(e) => patchFabric(r.key, { dia: e.target.value })} />
      ),
    },
    {
      header: "Req Wt (KGS)",
      required: true,
      align: "right",
      total: { kind: "sum", of: (r) => num(r.planned_kgs) || 0, format: kg },
      cell: (r) =>
        decimalCell(r.planned_kgs, (v) => patchFabric(r.key, { planned_kgs: v }), { required: true }),
    },
    {
      // Derived, never typed — `readOnly` also takes it off the Tab path.
      header: "Gross Yarn Reqd (KGS)",
      align: "right",
      total: { kind: "sum", of: (r) => fabricGross(r) ?? 0, format: kg },
      cell: (r) => {
        const g = fabricGross(r);
        return decimalCell(g == null ? "" : kg(g), () => {}, { readOnly: true });
      },
    },
  ];

  const fabricLineItems: PickerItem[] = fabric
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !!l.item_id)
    .map(({ l, i }) => ({
      id: l.key,
      code: null,
      name: `${i + 1} · ${fabricById.get(l.item_id!)?.name ?? ""}`,
      // A line of THIS document, not a master row — nothing can switch it off.
      inactive: false,
    }));

  const fabricProcColumns: ChildGridColumn<FabricProcRow>[] = [
    {
      header: "Fabric",
      required: true,
      cell: (r) => {
        const on = !isBlankFabricProcess(fabricProcInput(r));
        return reqIf(
          on,
          "Fabric",
          <RecordPicker
            label="Fabric"
            compact
            required={on}
            items={fabricLineItems}
            value={r.line_key}
            onChange={(k) => patchFabricProc(r.key, { line_key: k })}
          />,
        );
      },
    },
    {
      header: "Process",
      required: true,
      width: "13rem",
      cell: (r) => {
        const on = !isBlankFabricProcess(fabricProcInput(r));
        return reqIf(
          on,
          "Process",
          <RecordPicker
            label="Process"
            compact
            required={on}
            items={processItems("for_fabric", r.process_id)}
            value={r.process_id}
            onChange={(id) => patchFabricProc(r.key, { process_id: id })}
          />,
        );
      },
    },
    {
      header: "Loss %",
      align: "right",
      width: "7rem",
      cell: (r) => decimalCell(r.loss_pct, (v) => patchFabricProc(r.key, { loss_pct: v })),
    },
    {
      header: "Rate / KG",
      align: "right",
      width: "8rem",
      cell: (r) => decimalCell(r.rate, (v) => patchFabricProc(r.key, { rate: v })),
    },
  ];

  // ---- Accessories -------------------------------------------------------------

  /** The units an accessory's own master allows; every active unit when the
   *  item names none. The unit a row already holds always survives. */
  const uomsFor = (r: AccRow) => {
    const item = r.item_id ? accById.get(r.item_id) : undefined;
    const allowed = new Set([item?.base_uom_id, item?.purchase_uom_id].filter(Boolean) as string[]);
    return data.uoms.filter((u) =>
      u.id === r.uom_id ? true : allowed.size ? allowed.has(u.id) : !u.inactive,
    );
  };

  const accColumns: ChildGridColumn<AccRow>[] = [
    {
      header: "Item",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Item"
          compact
          required
          items={data.accessories}
          value={r.item_id}
          onChange={(id) => {
            const item = id ? accById.get(id) : undefined;
            const allowed = [item?.purchase_uom_id, item?.base_uom_id].filter(Boolean);
            // Filled on PICK, never at seed — see `isBlankAccessoryLine`.
            patchAcc(r.key, {
              item_id: id,
              uom_id:
                r.uom_id && allowed.includes(r.uom_id)
                  ? r.uom_id
                  : (item?.purchase_uom_id ?? item?.base_uom_id ?? r.uom_id),
            });
          }}
        />
      ),
    },
    {
      header: "Brand / Specs",
      cell: (r) => (
        <Input className="h-8" value={r.specs} onChange={(e) => patchAcc(r.key, { specs: e.target.value })} />
      ),
    },
    {
      header: "Colour",
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_color"
          label="Colour"
          compact
          options={data.colors}
          canCreate={perms.canCreate}
          value={r.color_id}
          onChange={(id) => patchAcc(r.key, { color_id: id })}
        />
      ),
    },
    {
      header: "Size",
      cell: (r) => (
        <LookupDialogPicker
          kind="size"
          label="Size"
          compact
          options={data.sizes}
          canCreate={perms.canCreate}
          value={r.size_id}
          onChange={(id) => patchAcc(r.key, { size_id: id })}
        />
      ),
    },
    {
      header: "Unit",
      required: true,
      cell: (r) => (
        <Select
          className="h-8"
          required
          value={r.uom_id ?? ""}
          onChange={(e) => patchAcc(r.key, { uom_id: e.target.value || null })}
        >
          <option value=""></option>
          {uomsFor(r).map((u) => (
            <option key={u.id} value={u.id}>
              {u.code}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Planned Qty",
      required: true,
      align: "right",
      cell: (r) =>
        decimalCell(r.planned_qty, (v) => patchAcc(r.key, { planned_qty: v }), { required: true }),
    },
    {
      // "Advised?" (2941) — specification or buyer approval still pending. A
      // real checkbox under the switch, so Tab and Enter reach it like a field.
      header: "Advised",
      cell: (r) => (
        <Toggle
          checked={r.is_advised}
          ariaLabel="Advised item"
          onChange={(v) => patchAcc(r.key, { is_advised: v })}
        />
      ),
    },
  ];

  const accLineItems: PickerItem[] = acc
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !!l.item_id)
    .map(({ l, i }) => ({
      id: l.key,
      code: null,
      name: `${i + 1} · ${accById.get(l.item_id!)?.name ?? ""}`,
      // A line of THIS document, not a master row — nothing can switch it off.
      inactive: false,
    }));

  const accProcColumns: ChildGridColumn<AccProcRow>[] = [
    {
      header: "Item",
      required: true,
      cell: (r) => {
        const on = !isBlankAccessoryProcess(accProcInput(r));
        return reqIf(
          on,
          "Item",
          <RecordPicker
            label="Item"
            compact
            required={on}
            items={accLineItems}
            value={r.line_key}
            onChange={(k) => patchAccProc(r.key, { line_key: k })}
          />,
        );
      },
    },
    {
      // The Process master carries no accessory flag (only for_yarn /
      // for_fabric), so every process is offered — TRIMS DYEING is one today.
      header: "Process",
      required: true,
      width: "13rem",
      cell: (r) => {
        const on = !isBlankAccessoryProcess(accProcInput(r));
        return reqIf(
          on,
          "Process",
          <RecordPicker
            label="Process"
            compact
            required={on}
            items={data.processes}
            value={r.process_id}
            onChange={(id) => patchAccProc(r.key, { process_id: id })}
          />,
        );
      },
    },
    {
      header: "Vendor",
      width: "14rem",
      cell: (r) => (
        <RecordPicker
          label="Vendor"
          compact
          items={data.vendors}
          value={r.vendor_id}
          onChange={(id) => patchAccProc(r.key, { vendor_id: id })}
        />
      ),
    },
    {
      header: "Rate / Unit",
      align: "right",
      width: "8rem",
      cell: (r) => decimalCell(r.rate, (v) => patchAccProc(r.key, { rate: v })),
    },
  ];

  // ---- sections ------------------------------------------------------------------

  const code = editId ? (rows.find((r) => r.id === editId)?.code ?? null) : null;
  const iwoNoShown = editId ? code : previewNo;

  /** Removing a line takes its process rows with it — the table's own cascade,
   *  applied on screen so no row is left naming a line that is gone. */
  const removeYarn = (r: YarnRow) => {
    mutYarn((xs) => xs.filter((x) => x.key !== r.key));
    mutYarnProcs((xs) => {
      const kept = xs.filter((x) => x.line_key !== r.key);
      return kept.length ? kept : [blankYarnProc()];
    });
  };
  const removeAcc = (r: AccRow) => {
    mutAcc((xs) => xs.filter((x) => x.key !== r.key));
    mutAccProcs((xs) => {
      const kept = xs.filter((x) => x.line_key !== r.key);
      return kept.length ? kept : [blankAccProc()];
    });
  };
  const removeFabric = (r: FabricRow) => {
    mutFabric((xs) => xs.filter((x) => x.key !== r.key));
    mutFabricProcs((xs) => {
      const kept = xs.filter((x) => x.line_key !== r.key);
      return kept.length ? kept : [blankFabricProc()];
    });
  };

  const linesGrid = () => {
    if (iwoFor === "yarn")
      return (
        <ChildGrid<YarnRow>
          columns={yarnColumns}
          rows={yarn}
          onAdd={() => mutYarn((xs) => [...xs, blankYarn()])}
          onRemove={removeYarn}
          addLabel="+ Add yarn"
        />
      );
    if (iwoFor === "fabric")
      return (
        // ELEVEN COLUMNS, so rule 4 of `raagam-screen-layout`: the row wraps inside
        // ONE frame (`forceCards` + `flatRows`) instead of scrolling sideways.
        // Labels and cells are read off `fabricColumns`, and `required` goes on the
        // `Field` AND reaches the control through the column's own cell.
        <ChildGrid<FabricRow>
          columns={fabricColumns}
          rows={fabric}
          forceCards
          flatRows
          renderMobileRow={(row, i) => (
            <FieldGrid>
              {fabricColumns.map((c, ci) => (
                <Field key={ci} label={c.header} required={c.required} size="sm">
                  {c.cell(row, i)}
                </Field>
              ))}
            </FieldGrid>
          )}
          onAdd={() => mutFabric((xs) => [...xs, blankFabric()])}
          onRemove={removeFabric}
          addLabel="+ Add fabric"
        />
      );
    return (
      // SEVEN COLUMNS — the same one-frame wrap as Fabric, same reasons.
      <ChildGrid<AccRow>
        columns={accColumns}
        rows={acc}
        forceCards
        flatRows
        renderMobileRow={(row, i) => (
          <FieldGrid>
            {accColumns.map((c, ci) => (
              <Field key={ci} label={c.header} required={c.required} size="sm">
                {c.cell(row, i)}
              </Field>
            ))}
          </FieldGrid>
        )}
        onAdd={() => mutAcc((xs) => [...xs, blankAcc()])}
        onRemove={removeAcc}
        addLabel="+ Add accessory"
      />
    );
  };

  const processGrid = () =>
    iwoFor === "accessories" ? (
      <ChildGrid<AccProcRow>
        columns={accProcColumns}
        rows={accProcs}
        onAdd={() => mutAccProcs((xs) => [...xs, blankAccProc()])}
        onRemove={(r) => mutAccProcs((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add process"
      />
    ) : iwoFor === "fabric" ? (
      <ChildGrid<FabricProcRow>
        columns={fabricProcColumns}
        rows={fabricProcs}
        onAdd={() => mutFabricProcs((xs) => [...xs, blankFabricProc()])}
        onRemove={(r) => mutFabricProcs((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add process"
      />
    ) : (
      <ChildGrid<YarnProcRow>
        columns={yarnProcColumns}
        rows={yarnProcs}
        onAdd={() => mutYarnProcs((xs) => [...xs, blankYarnProc()])}
        onRemove={(r) => mutYarnProcs((xs) => xs.filter((x) => x.key !== r.key))}
        addLabel="+ Add shade"
      />
    );

  /**
   * THE SCREEN'S OWN NAME IS THE FIRST RAIL ROW (operator's rule 1): the header
   * fields are a section on the `<Field>` convention, not a band above the rail.
   * The lines section is named by `For` and appears once `For` is chosen.
   */
  const sections: FullScreenSection[] = [
    {
      key: "header",
      label: "Internal Work Order",
      icon: ClipboardList,
      done: !!form.iwo_date && !!form.iwo_for,
      content: (
        <SectionBody title="Internal Work Order">
          <FieldGrid>
            {/* `Input readOnly` takes itself off the Tab path. */}
            <Field label="I.WO No" size="sm" htmlFor="iwo-no">
              <Input id="iwo-no" readOnly value={iwoNoShown ?? ""} className="font-mono" />
            </Field>
            <Field label="Date" required size="sm" htmlFor="iwo-date">
              <Input
                id="iwo-date"
                type="date"
                value={form.iwo_date}
                onChange={(e) => {
                  set({ iwo_date: e.target.value });
                  // The Date decides the fiscal year, so a new record's number
                  // is re-asked; a saved one keeps the number it already has.
                  if (!editId) askPreview(e.target.value);
                }}
              />
            </Field>
            <Field label="For" required size="sm" htmlFor="iwo-for">
              <Select
                id="iwo-for"
                value={form.iwo_for}
                onChange={(e) => set({ iwo_for: isIwoFor(e.target.value) ? e.target.value : "" })}
              >
                <option value=""></option>
                {IWO_FOR.map((f) => (
                  <option key={f} value={f}>
                    {IWO_FOR_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
            {/* The picker draws its own label; `Field` carries the width. */}
            <Field size="sm">
              <RecordPicker
                label="Reference (RE No)"
                items={data.orders}
                value={form.sales_order_id}
                onChange={(id) => set({ sales_order_id: id })}
              />
            </Field>
            <Field label="Style" size="sm" htmlFor="iwo-style">
              <Input
                id="iwo-style"
                value={form.style_ref_no}
                onChange={(e) => set({ style_ref_no: e.target.value })}
              />
            </Field>
            <Field label="Deli Dt" size="sm" htmlFor="iwo-deli">
              <Input
                id="iwo-deli"
                type="date"
                value={form.deli_date}
                onChange={(e) => set({ deli_date: e.target.value })}
              />
            </Field>
            <Field label="Remarks" size="sm" htmlFor="iwo-remarks">
              <Input
                id="iwo-remarks"
                value={form.remarks}
                onChange={(e) => set({ remarks: e.target.value })}
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    ...(iwoFor
      ? [
          {
            key: "lines",
            label: linesLabel,
            icon: Boxes,
            done:
              iwoFor === "yarn"
                ? yarn.some((l) => !!l.item_id)
                : iwoFor === "fabric"
                  ? fabric.some((l) => !!l.item_id)
                  : acc.some((l) => !!l.item_id),
            content: <SectionBody title={linesLabel}>{linesGrid()}</SectionBody>,
          },
        ]
      : []),
    ...(showProcess
      ? [
          {
            key: "process",
            label: processLabel,
            icon: Workflow,
            done:
              iwoFor === "fabric"
                ? fabricProcs.some((p) => !isBlankFabricProcess(fabricProcInput(p)))
                : iwoFor === "accessories"
                  ? accProcs.some((p) => !isBlankAccessoryProcess(accProcInput(p)))
                  : yarnProcStarted,
            content: <SectionBody title={processLabel}>{processGrid()}</SectionBody>,
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Internal Work Order"
          description="Advance procurement of yarn, fabric and accessories before a buyer order exists."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New work order</Button> : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No internal work orders yet."
        />
      </div>

      {/* A FULL-SCREEN TAKEOVER, not a page pane: the module sidebar beside a
          section rail is two navigation lists on one screen (operator's rule 3). */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">internal work order</span>
          </>
        }
        // An overlay covers the route's PageHeader, so without this band nothing
        // on screen names the record being edited.
        header={{
          initials: "IW",
          title: iwoNoShown ?? "New work order",
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>{iwoFor ? `For ${IWO_FOR_LABELS[iwoFor]}` : "For not chosen"}</span>
              {form.iwo_date && <span>· {fmtDate(form.iwo_date)}</span>}
              {orderNo(form.sales_order_id) && <span>· {orderNo(form.sales_order_id)}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New work order",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save work order",
          canSave: validity.canSave,
          // Keeps Save clickable when blocked, so it names the missing field and
          // steers there — and so Ctrl+S and Enter-off-the-last-field reach the
          // same handler.
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
