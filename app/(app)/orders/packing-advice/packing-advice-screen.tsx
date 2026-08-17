"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createPackingAdvice,
  updatePackingAdvice,
  deletePackingAdvice,
} from "@/lib/orders/packing-advice/actions";
import {
  CARTON_SLNO_BY,
  ASSORT_TYPES,
  PLA_STATUS_LABELS,
  plaStatusTone,
  type PackingAdvice,
  type PlaStatus,
} from "@/lib/orders/packing-advice/types";
import type { PackingAdviceFormData, PickerRow } from "@/lib/orders/packing-advice/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: PackingAdvice[];
  data: PackingAdviceFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type LineRow = {
  key: string;
  ctn_from: string;
  ctn_to: string;
  ctns: string;
  sc_no_id: string | null;
  po_no: string;
  country_id: string | null;
  ref_no: string;
  assort_type: string;
  customer_order_no: string;
  multiple_pack: boolean;
  qty_per_ctn: string;
  total_qty: string;
  unit_id: string | null;
  measurement: string;
};

type HeaderForm = {
  advice_date: string;
  reference: string;
  carton_slno_by: string;
  customer_id: string | null;
  consignee_id: string | null;
  warehouse_id: string | null;
  warehouse_address: string;
  status: PlaStatus;
};

const BLANK: HeaderForm = {
  advice_date: "",
  reference: "",
  carton_slno_by: "",
  customer_id: null,
  consignee_id: null,
  warehouse_id: null,
  warehouse_address: "",
  status: "draft",
};

const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);
const n = (v: string) => Number(v) || 0;

export function PackingAdviceScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Inline editor, not a Sheet / MasterFullScreen — see mba-master-screen.tsx.
  useUnsavedGuard(mode === "edit" || isPending);

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const warehouseOpts = useMemo(
    () => data.lookups.filter((l) => l.kind === "warehouse"),
    [data.lookups],
  );
  // SC No picker items {id, code: order#, name: buyer}.
  const orderItems: PickerRow[] = useMemo(
    () =>
      data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.buyer_name ?? "(no buyer)" })),
    [data.orders],
  );

  // Header Ctns / Qty are the live totals of the line grid (legacy behaviour).
  const ctnsTotal = useMemo(() => lines.reduce((t, l) => t + n(l.ctns), 0), [lines]);
  const qtyTotal = useMemo(() => lines.reduce((t, l) => t + n(l.total_qty), 0), [lines]);

  const blankLine = (): LineRow => ({
    key: newKey(),
    ctn_from: "",
    ctn_to: "",
    ctns: "",
    sc_no_id: null,
    po_no: "",
    country_id: null,
    ref_no: "",
    assort_type: "",
    customer_order_no: "",
    multiple_pack: false,
    qty_per_ctn: "",
    total_qty: "",
    unit_id: null,
    measurement: "",
  });

  const updateLine = (key: string, patch: Partial<LineRow>) =>
    setLines((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        const next = { ...x, ...patch };
        // Auto-compute Total Qty = Ctns × Qty/Ctn when either changes.
        if ("ctns" in patch || "qty_per_ctn" in patch) {
          next.total_qty = String(n(next.ctns) * n(next.qty_per_ctn));
        }
        return next;
      }),
    );

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setForm({ ...BLANK, advice_date: today() });
    setLines([blankLine()]);
    setMode("edit");
  }

  function openEdit(r: PackingAdvice) {
    setEditId(r.id);
    setEditCode(r.code);
    setForm({
      advice_date: r.advice_date ?? today(),
      reference: r.reference ?? "",
      carton_slno_by: r.carton_slno_by ?? "",
      customer_id: r.customer_id,
      consignee_id: r.consignee_id,
      warehouse_id: r.warehouse_id,
      warehouse_address: r.warehouse_address ?? "",
      status: r.status,
    });
    setLines(
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            ctn_from: l.ctn_from ?? "",
            ctn_to: l.ctn_to ?? "",
            ctns: l.ctns ? String(l.ctns) : "",
            sc_no_id: l.sc_no_id,
            po_no: l.po_no ?? "",
            country_id: l.country_id,
            ref_no: l.ref_no ?? "",
            assort_type: l.assort_type ?? "",
            customer_order_no: l.customer_order_no ?? "",
            multiple_pack: l.multiple_pack,
            qty_per_ctn: l.qty_per_ctn ? String(l.qty_per_ctn) : "",
            total_qty: l.total_qty ? String(l.total_qty) : "",
            unit_id: l.unit_id,
            measurement: l.measurement ?? "",
          }))
        : [blankLine()],
    );
    setMode("edit");
  }

  function submit(status: PlaStatus) {
    const payload = {
      status,
      advice_date: form.advice_date,
      reference: form.reference || null,
      carton_slno_by: form.carton_slno_by || null,
      customer_id: form.customer_id,
      consignee_id: form.consignee_id,
      ctns_total: ctnsTotal,
      qty_total: qtyTotal,
      warehouse_id: form.warehouse_id,
      warehouse_address: form.warehouse_address || null,
      lines: lines.map((l) => ({
        sort_order: 0,
        ctn_from: l.ctn_from || null,
        ctn_to: l.ctn_to || null,
        ctns: numOrNull(l.ctns) ?? 0,
        sc_no_id: l.sc_no_id,
        po_no: l.po_no || null,
        country_id: l.country_id,
        ref_no: l.ref_no || null,
        assort_type: l.assort_type || null,
        customer_order_no: l.customer_order_no || null,
        multiple_pack: l.multiple_pack,
        qty_per_ctn: numOrNull(l.qty_per_ctn) ?? 0,
        total_qty: numOrNull(l.total_qty) ?? 0,
        unit_id: l.unit_id,
        measurement: l.measurement || null,
      })),
    };
    start(async () => {
      const res = editId
        ? await updatePackingAdvice(editId, payload)
        : await createPackingAdvice(payload);
      if (res.ok) {
        success(editId ? "Packing advice updated" : "Packing advice created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: PackingAdvice) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deletePackingAdvice(r.id);
      if (res.ok) {
        success("Packing advice deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<PackingAdvice>[] = [
      {
        header: "PL Adv No",
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
      { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.advice_date)}</span> },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      { header: "Consignee", cell: (r) => <span className="text-sm">{r.consignee?.name ?? "—"}</span> },
      {
        header: "Ctns",
        align: "right",
        cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.ctns_total)}</span>,
      },
      {
        header: "Status",
        cell: (r) => <StatusPill tone={plaStatusTone(r.status)}>{PLA_STATUS_LABELS[r.status]}</StatusPill>,
      },
      rowActionsColumn((r) => (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          isPending={isPending}
        />
      )),
    ];

    return (
      <div className="space-y-4">
        <PageHeader
          title="Packing List Advice"
          description="Advise how an order is packed — cartons, assortment, consignee & warehouse."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Packing Advice</Button> : undefined}
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No packing advices yet. Use 'New Packing Advice' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  const canSave = !!form.advice_date;

  /**
   * The sixteen columns of a packing line, declared once.
   *
   * `className` is the TABLE layout's and nothing reads it while `forceCards` is
   * on — kept because those are the widths a reverted table would need, and
   * re-deriving "how wide is Measurement" from scratch is how a reverted grid
   * comes back squashed.
   */
  const lineColumns: ChildGridColumn<LineRow>[] = [
    { header: "Ctn From", cell: (r) => <Input className="h-8" value={r.ctn_from} onChange={(e) => updateLine(r.key, { ctn_from: e.target.value })} /> },
    { header: "Ctn To", cell: (r) => <Input className="h-8" value={r.ctn_to} onChange={(e) => updateLine(r.key, { ctn_to: e.target.value })} /> },
    { header: "Ctns", align: "right", cell: (r) => <Input type="number" className="h-8 text-right" value={r.ctns} onChange={(e) => updateLine(r.key, { ctns: e.target.value })} /> },
    {
      header: "SC No",
      className: "min-w-[180px]",
      cell: (r) => <RecordPicker label="SC No" compact identity="code" items={orderItems} value={r.sc_no_id} onChange={(id) => updateLine(r.key, { sc_no_id: id })} />,
    },
    { header: "PO No", cell: (r) => <Input className="h-8" uppercase value={r.po_no} onChange={(e) => updateLine(r.key, { po_no: e.target.value })} /> },
    {
      header: "Country",
      className: "min-w-[160px]",
      cell: (r) => <CountryPicker compact countries={data.countries} value={r.country_id} onChange={(id) => updateLine(r.key, { country_id: id })} canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} />,
    },
    { header: "Ref No", cell: (r) => <Input className="h-8" uppercase value={r.ref_no} onChange={(e) => updateLine(r.key, { ref_no: e.target.value })} /> },
    {
      header: "Assort Type",
      cell: (r) => (
        <Select className="h-8" value={r.assort_type} onChange={(e) => updateLine(r.key, { assort_type: e.target.value })}>
          <option value="">—</option>
          {ASSORT_TYPES.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      ),
    },
    { header: "Cust Order No", cell: (r) => <Input className="h-8" uppercase value={r.customer_order_no} onChange={(e) => updateLine(r.key, { customer_order_no: e.target.value })} /> },
    {
      // A tick box is a column on the arrow axis (`ROW_FIELDS`), so it keeps its
      // place in the typing path rather than being reachable only by mouse.
      header: "Mult. Pack",
      align: "center",
      cell: (r) => (
        <input type="checkbox" checked={r.multiple_pack} onChange={(e) => updateLine(r.key, { multiple_pack: e.target.checked })} className="h-4 w-4 rounded border-border accent-primary" />
      ),
    },
    {
      // Disabled until the nested Assort screen has a spec. A disabled control is
      // deliberately NOT a field (`ROW_FIELDS` excludes `[disabled]`), so the
      // arrows step over it instead of dying on a dead cell.
      header: "Assort",
      align: "center",
      cell: () => (
        <Button type="button" variant="outline" size="sm" disabled title="Nested Assort screen — awaiting spec">
          Assort
        </Button>
      ),
    },
    { header: "Qty/Ctn", align: "right", cell: (r) => <Input type="number" className="h-8 text-right" value={r.qty_per_ctn} onChange={(e) => updateLine(r.key, { qty_per_ctn: e.target.value })} /> },
    { header: "Total Qty", align: "right", cell: (r) => <Input type="number" className="h-8 text-right" value={r.total_qty} onChange={(e) => updateLine(r.key, { total_qty: e.target.value })} /> },
    {
      header: "Unit",
      className: "min-w-[140px]",
      cell: (r) => <RecordPicker label="Unit" compact items={data.uoms} value={r.unit_id} onChange={(id) => updateLine(r.key, { unit_id: id })} />,
    },
    { header: "Measurement", cell: (r) => <Input className="h-8" uppercase value={r.measurement} onChange={(e) => updateLine(r.key, { measurement: e.target.value })} /> },
  ];


  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <PageHeader
        title={editId ? `Edit Packing Advice ${editCode ?? ""}` : "New Packing Advice"}
        // back={false}: this screen swaps a list and an editor at ONE url, and
        // the editor already shows "← Back to list". The derived hub link is
        // right on the LIST branch above and a second, differently aimed Back here.
        back={false}
        description="Fill the header, then add carton/assortment lines. Every ⓘ / ⊕ field is a picker over stored data."
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band — `FieldGrid`, not a hand-rolled `lg:grid-cols-4` with
          `sm:col-span-2` on the wide pair. A screen composes primitives, it does
          not draw (LAYOUT.md §3). */}
      <Card>
        <CardBody>
          <FieldGrid>
            {/* `Input readOnly` rather than a styled `<div>`: the div was a value
                the primitives could not see, and readOnly brings the right look,
                keeps it in the accessibility tree and sets `tabIndex={-1}` so it
                stays off the typing path. */}
            <Field label="PL Adv No" size="sm" htmlFor="pa-no">
              <Input id="pa-no" className="font-mono" value={editCode ?? "Auto (on save)"} readOnly />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the same
                prop draws the star AND stamps `data-required-empty`, so the
                cursor holds on a blank box. */}
            <Field label="Date" required size="sm" htmlFor="pa-date">
              <Input id="pa-date" type="date" value={form.advice_date} onChange={(e) => set({ advice_date: e.target.value })} />
            </Field>
            <Field label="Reference" size="sm" htmlFor="pa-ref">
              <Input id="pa-ref" uppercase value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
            </Field>
            <Field label="Carton SlNo.By" size="sm" htmlFor="pa-carton">
              <Select id="pa-carton" value={form.carton_slno_by} onChange={(e) => set({ carton_slno_by: e.target.value })}>
                <option value="">—</option>
                {CARTON_SLNO_BY.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
            {/* The pickers draw their own labels; `Field` carries the span. */}
            <Field size="sm">
              <RecordPicker
                label="Customer"
                items={data.buyers}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
              />
            </Field>
            <Field size="sm">
              <RecordPicker
                label="Consignee"
                items={data.consignees}
                value={form.consignee_id}
                onChange={(id) => set({ consignee_id: id })}
              />
            </Field>
            {/* Derived totals — read-only text, not boxes: they are computed from
                the grid below and clicking them does nothing. */}
            <Field label="Ctns (total)" size="sm">
              <div className="flex h-9 items-center justify-end text-sm font-medium tabular-nums">
                {fmtNumber(ctnsTotal)}
              </div>
            </Field>
            <Field label="Qty (total)" size="sm">
              <div className="flex h-9 items-center justify-end text-sm font-medium tabular-nums">
                {fmtNumber(qtyTotal)}
              </div>
            </Field>
            <Field size="lg">
              <LookupDialogPicker
                kind="warehouse"
                label="Warehouse Name"
                options={warehouseOpts}
                value={form.warehouse_id}
                onChange={(id) => set({ warehouse_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
            </Field>
            {/* An address runs long, so it takes half the row rather than a
                quarter — `lg` is the widest a FIELD goes (LAYOUT.md §3). */}
            <Field label="Warehouse Address" size="lg" htmlFor="pa-waddr">
              <Textarea
                id="pa-waddr"
                value={form.warehouse_address}
                onChange={(e) => set({ warehouse_address: e.target.value })}
                rows={2}
              />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {/* Packing List detail grid — WRAPS, NEVER SCROLLS SIDEWAYS.
          Sixteen columns at `min-w-[1720px]` was the worst case of the rule in
          the whole module: the operator filled Ctn From, then dragged a bar past
          fifteen cells to reach Measurement with the start of the line scrolled
          out of sight. `forceCards` + `renderMobileRow` lays each line out as the
          same `FieldGrid` the header uses — four across, flowing onto as many
          rows as it takes (see "The operator's five", rule 4b). */}
      <Card>
        <CardBody>
          <ChildGrid<LineRow>
            label="Packing List — Details"
            columns={lineColumns}
            rows={lines}
            seedRow
            forceCards
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {lineColumns.map((c, ci) => (
                  // Labels and cells both read off `lineColumns`, so a new column
                  // cannot leave the card and the declaration disagreeing.
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => setLines((xs) => [...xs, blankLine()])}
            onRemove={(r) => setLines((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add line"
          />
        </CardBody>
      </Card>

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button variant="outline" disabled={isPending || !canSave} onClick={() => submit("draft")}>
            Save as Draft
          </Button>
        )}
        <Button disabled={isPending || !canSave} onClick={() => submit("finalised")}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

