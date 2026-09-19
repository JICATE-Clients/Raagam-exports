"use client";

/**
 * Orders ▸ Order Execution ▸ IWO Material BOM — the order Material BOM screen,
 * DUPLICATED for an Internal Work Order For Accessories (client 2026-09-19,
 * screenshot 2941; 0584).
 *
 * THE ORDER SCREEN IS NOT TOUCHED. `app/(app)/orders/material-bom/` stays as it
 * is; this copies its shape — the rail, an Items grid, a Processes grid, a
 * read-only Requirement — and drops what only an order has: the garment-order
 * picker, the production strip, the per-colourway / per-size slice grid, the
 * Attribute (requirement grain), garment parts and combinations. The planner
 * TYPES the Planned Qty (SRS §5: "piece-level consumption is overridden").
 *
 * EVERY QUANTITY IS THE ORDER BOM'S ARITHMETIC — Planned × (1 + loss%), the
 * purchase pack, MOQ, Round To — through `lib/orders/iwo-material-bom/rules.ts`,
 * the same function the save calls. The preview is the stored figure.
 */

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ClipboardList, Layers, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldGrid, FieldRow, FIELD_WIDTH_CSS, RequiredScope } from "@/components/ui/field";
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
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { materialsForCategory } from "@/lib/orders/material-bom-amendment/material-options";
import { uomPatchForMaterial } from "@/lib/orders/material-bom/uom-prefill";
import { isRefusal } from "@/lib/orders/material-bom/requirement";
import { IWO_MB_STAGES } from "@/lib/orders/iwo-material-bom/types";
import {
  isBlankIwoMbProcess,
  iwoMbProblems,
  iwoMbQuantity,
  keptIwoMbLines,
  keptIwoMbProcesses,
  type IwoMbLineFacts,
  type IwoMbProcessFacts,
} from "@/lib/orders/iwo-material-bom/rules";
import { deleteIwoMaterialBom, saveIwoMaterialBom } from "@/lib/orders/iwo-material-bom/actions";
import type { IwoMaterialBomFormData, IwoMaterialBomTask } from "@/lib/orders/iwo-material-bom/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// React keys from a module counter, as the order screens do — not a ref.
let keySeq = 0;
const newKey = () => `k${keySeq++}`;

/** One item line as the grid edits it. Numbers are held as the TEXT typed, so
 *  a half-typed "12." is not rewritten under the caret. */
type ItemRow = {
  key: string;
  category_id: string | null;
  item_id: string | null;
  specification: string;
  item_color_id: string | null;
  consumption_uom_id: string | null;
  purchase_uom_id: string | null;
  uom_conversion_id: string | null;
  planned_qty: string;
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

export function IwoMaterialBomScreen({
  tasks,
  data,
  perms,
}: {
  tasks: IwoMaterialBomTask[];
  data: IwoMaterialBomFormData;
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
  const [form, setForm] = useState<Form>({ iwo_id: null, bom_date: today() });
  const [items, setItems] = useState<ItemRow[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);

  /** Real edits only — an overlay's own guard is not read by `confirmDiscard()`,
   *  so this is what protects the typing and holds off the silent reload. */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
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
        .map((l) => ({ ...l, item_id: l.item_id as string })),
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
    { header: "Style", cell: (t) => <span className="text-sm">{t.style_ref_no ?? "—"}</span> },
    { header: "RE No", cell: (t) => <span className="font-mono text-xs">{t.sales_orders?.order_number ?? "—"}</span> },
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
   */
  const itemColumns: ChildGridColumn<ItemRow>[] = [
    {
      header: "Category",
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
      header: "Brand / Specs",
      cell: (r) => (
        <Input
          className="h-8"
          aria-label="Brand / Specs"
          value={r.specification}
          onChange={(e) => patchItem(r.key, { specification: e.target.value })}
        />
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
          value={r.item_color_id}
          onChange={(id) => patchItem(r.key, { item_color_id: id })}
        />
      ),
    },
    {
      header: "Cons. Uom",
      required: true,
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
      cell: (r) => decimalCell(r.planned_qty, "Planned Qty", (v) => patchItem(r.key, { planned_qty: v }), true),
    },
    {
      header: "Pur. Uom",
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
      header: "MOQ",
      align: "right",
      cell: (r) => decimalCell(r.moq, "MOQ", (v) => patchItem(r.key, { moq: v })),
    },
    {
      header: "Round To",
      align: "right",
      cell: (r) => decimalCell(r.round_to, "Round To", (v) => patchItem(r.key, { round_to: v })),
    },
    {
      // The order screen's TBA — "To be advised": spec or buyer approval
      // pending (screenshot 2941's "Is Advised Item"). Recorded; the PO block
      // is its own step (0584's header).
      header: "Advised",
      cell: (r) => (
        <Toggle checked={r.is_advised} ariaLabel="Advised item" onChange={(v) => patchItem(r.key, { is_advised: v })} />
      ),
    },
    {
      // Send out for processing — offers the material on the Processes grid.
      header: "Process",
      cell: (r) => (
        <Toggle checked={r.send_out} ariaLabel="Send out for processing" onChange={(v) => patchItem(r.key, { send_out: v })} />
      ),
    },
    {
      header: "FOC",
      cell: (r) => <Toggle checked={r.is_foc} ariaLabel="Free of charge" onChange={(v) => patchItem(r.key, { is_foc: v })} />,
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
          {r.line.specification.trim() && (
            <Truncated className="block text-xs text-muted-foreground">{r.line.specification}</Truncated>
          )}
        </div>
      ),
    },
    {
      header: "Colour",
      cell: (r) => <span className="text-sm">{data.colors.find((c) => c.id === r.line.item_color_id)?.name ?? ""}</span>,
    },
    {
      header: "Planned",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {num(r.line.planned_qty) != null ? `${fmtNumber(num(r.line.planned_qty))} ${uomCode(r.line.consumption_uom_id)}` : ""}
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
    {
      // What the tick DOES, not only that it is set: purchase orders for this
      // work order refuse the material until it is unticked (0586).
      header: "Purchase",
      cell: (r) =>
        r.line.is_advised ? (
          <StatusPill tone="warning">Advised · PO blocked</StatusPill>
        ) : (
          <span className="text-xs text-muted-foreground">Open</span>
        ),
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
            <Field label="Style" className="w-[150px]" htmlFor="imb-style">
              <Input id="imb-style" readOnly value={picked?.style_ref_no ?? ""} />
            </Field>
            <Field label="RE No" className="w-[170px]" htmlFor="imb-re">
              <Input id="imb-re" readOnly value={picked?.sales_orders?.order_number ?? ""} />
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
          {/* TWELVE COLUMNS, so rule 4 of `raagam-screen-layout`: the row wraps
              inside ONE frame (`forceCards` + `flatRows`) instead of scrolling
              sideways. Labels and `required` are read off `itemColumns`, on the
              `Field` AND on the control. */}
          <ChildGrid<ItemRow>
            columns={itemColumns}
            rows={items}
            forceCards
            flatRows
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {itemColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => {
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
              <FieldGrid>
                {processColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required ? !isBlankIwoMbProcess(procFacts(row)) : false} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
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
        <DataTable
          columns={withCreatedColumns(columns, tasks)}
          rows={tasks}
          getKey={(t) => t.id}
          empty="No Internal Work Orders For Accessories at this unit yet."
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
              {picked?.style_ref_no && <span>· {picked.style_ref_no}</span>}
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
