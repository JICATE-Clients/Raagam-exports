"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import {
  ChildGrid,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { computeCbm } from "@/lib/orders/packing-advice/cbm";
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
import type {
  PackingAdviceFormData,
  PickerRow,
} from "@/lib/orders/packing-advice/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Compact flat controls (2026-09-15): `py-1 px-2 text-sm` on every typed box.
 * `h-7` goes with it — the primitive's `h-9` would swallow the padding, and one
 * height on the header AND the line cards is what keeps the two bands level.
 * `Input` / `Select` merge `className` through tailwind-merge, so these
 * REPLACE the primitive's `px-2.5` / `text-base` rather than stacking. (Was
 * `h-8` earlier the same day; the operator asked for "h-7 py-1 px-2 text-sm"
 * verbatim on the second pass, and the 20px `text-sm` line + 8px of `py-1`
 * is exactly 28px, so nothing is clipped.)
 */
const COMPACT_TEXT = "px-2 py-1 text-sm";
const COMPACT = `h-7 ${COMPACT_TEXT}`;
/**
 * A picker draws its own `<input>` and its adapters forward no `className`, so
 * the same numbers reach it through the wrapping `Field`. `:not([type=checkbox])`
 * keeps the Mult. Pack tick at `h-4 w-4` — the arbitrary variant would otherwise
 * out-rank the box's own size.
 */
const COMPACT_PICKER =
  "[&_input:not([type=checkbox])]:h-7 [&_input:not([type=checkbox])]:px-2 [&_input:not([type=checkbox])]:py-1 [&_input:not([type=checkbox])]:text-sm";

/**
 * ONE UNIFORM GRID, SIX ACROSS, CAPPED (operator, 2026-09-15: "strictly uniform,
 * neat … a well-structured tight grid (e.g. grid-cols-6) with consistent column
 * spans so all input boxes have a uniform, neat width").
 *
 * THIS REVERSES THE SAME DAY'S SHRINK-WRAP, DELIBERATELY. The morning pass laid
 * the header out as two `FieldRow`s with each field at its own `FieldWidth`
 * (`erp-form-compact`: a Ctns total is not the width of a customer name), and
 * that comment stood right here. The operator looked at the ragged result and
 * asked for the opposite property — every box the same width, on a grid — so
 * the fields are back on `FieldGrid`'s twelve-column track, every one at `xs`
 * (2 of 12 = six per row), which is `grid-cols-6` in the vocabulary this app
 * already has rather than a hand-rolled one (LAYOUT.md §3).
 *
 * `FORM_W` IS WHAT STOPS A FRACTION FROM STRETCHING. A sixth of a 1440px pane
 * is ~230px; capped at 64rem (1024) it is (1024 - 5 x 12) / 6 = ~160px, the
 * `code`/`term` band, on every pane wide enough to reach it. The same cap goes
 * on the line grid below so the two bands share one right edge; on a laptop
 * both simply shrink together.
 *
 * `gap-x-3 gap-y-2` is `FIELD_TRACK`'s own default and is what the operator
 * named, so no gap override — the earlier `COMPACT_GRID` (8px / 6px) is gone.
 */
const FORM_W = "max-w-[64rem]";

/**
 * LABELS AT 10px, UPPERCASE, TRUNCATED (operator, 2026-09-15, verbatim:
 * "text-[10px] uppercase text-gray-500 mb-0.5 truncate"). Reached through the
 * form container with a descendant selector, because the pickers draw their
 * own `<Label>` and a per-call-site class would miss them. `.scope label`
 * (0,1,1) outranks the primitive's bare `text-xs` (0,1,0).
 *
 * TWO SUBSTITUTIONS, BOTH ON PURPOSE. `text-muted-foreground` for
 * `text-gray-500`: it is the token `Label` already uses, and it is the one
 * that survives the dark theme. `tracking-wide` added: 10px capitals with no
 * tracking close up into a smear.
 *
 * KNOWN DEPARTURE. `label.tsx` refuses 11px in writing — "these are
 * muted-foreground labels and 11px would sit below a readable floor" — and
 * `erp-form-compact` says to treat the band as 12px "unless the client
 * overrides that directly". This is that override, scoped to this screen and
 * to nothing else; it is not a new default and must not be lifted into the
 * primitive.
 */
const DENSE_LABELS =
  "[&_label]:mb-0.5 [&_label]:truncate [&_label]:text-[10px] [&_label]:uppercase [&_label]:tracking-wide [&_label]:text-muted-foreground";

/**
 * ONE LINE, NO LINE BREAKS. `warehouse_address` is a `text` column and stored
 * rows can carry newlines from the old `Textarea`. An `<input>` DROPS them
 * outright — the browser's value sanitisation deletes LF rather than replacing
 * it — so "12 Main St\nChennai" would come back as "12 Main StChennai" the
 * first time the box was edited. Flattening at load turns each break into a
 * comma-space, which is what the address means on one line, and it happens
 * BEFORE the value reaches the input so the operator sees what will be saved.
 */
const oneLine = (v: string | null | undefined) =>
  (v ?? "").replace(/\r?\n+/g, ", ");

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
  /* Orphaned since 0033 — wired up 0557, doc/order/update.md §3.1. */
  gross_weight: string;
  net_weight: string;
  /* 0558, doc/order/update.md §3.1. CBM is computed from these, never typed
     or stored — see computeCbm(). */
  length_cm: string;
  width_cm: string;
  height_cm: string;
};

type HeaderForm = {
  advice_date: string;
  reference: string;
  carton_slno_by: string;
  customer_id: string | null;
  consignee_id: string | null;
  warehouse_id: string | null;
  warehouse_address: string;
  remarks: string;
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
  remarks: "",
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

  const set = (patch: Partial<HeaderForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  const warehouseOpts = useMemo(
    () => data.lookups.filter((l) => l.kind === "warehouse"),
    [data.lookups],
  );
  // SC No picker items {id, code: order#, name: buyer}.
  const orderItems: PickerRow[] = useMemo(
    () =>
      data.orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "(no buyer)",
      })),
    [data.orders],
  );

  // Header Ctns / Qty are the live totals of the line grid (legacy behaviour).
  const ctnsTotal = useMemo(
    () => lines.reduce((t, l) => t + n(l.ctns), 0),
    [lines],
  );
  const qtyTotal = useMemo(
    () => lines.reduce((t, l) => t + n(l.total_qty), 0),
    [lines],
  );

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
    gross_weight: "",
    net_weight: "",
    length_cm: "",
    width_cm: "",
    height_cm: "",
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
      warehouse_address: oneLine(r.warehouse_address),
      remarks: r.remarks ?? "",
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
            gross_weight: l.gross_weight != null ? String(l.gross_weight) : "",
            net_weight: l.net_weight != null ? String(l.net_weight) : "",
            length_cm: l.length_cm != null ? String(l.length_cm) : "",
            width_cm: l.width_cm != null ? String(l.width_cm) : "",
            height_cm: l.height_cm != null ? String(l.height_cm) : "",
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
      remarks: form.remarks || null,
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
        gross_weight: numOrNull(l.gross_weight),
        net_weight: numOrNull(l.net_weight),
        length_cm: numOrNull(l.length_cm),
        width_cm: numOrNull(l.width_cm),
        height_cm: numOrNull(l.height_cm),
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
      {
        header: "Date",
        cell: (r) => (
          <span className="tabular-nums text-sm">{fmtDate(r.advice_date)}</span>
        ),
      },
      {
        header: "Customer",
        cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
      },
      {
        header: "Consignee",
        cell: (r) => (
          <span className="text-sm">{r.consignee?.name ?? "—"}</span>
        ),
      },
      {
        header: "Ctns",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums text-sm">
            {fmtNumber(r.ctns_total)}
          </span>
        ),
      },
      {
        header: "Status",
        cell: (r) => (
          <StatusPill tone={plaStatusTone(r.status)}>
            {PLA_STATUS_LABELS[r.status]}
          </StatusPill>
        ),
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
          actions={
            perms.canCreate ? (
              <Button onClick={openAdd}>New Packing Advice</Button>
            ) : undefined
          }
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
    {
      header: "Ctn From",
      cell: (r) => (
        <Input
          className={COMPACT}
          value={r.ctn_from}
          onChange={(e) => updateLine(r.key, { ctn_from: e.target.value })}
        />
      ),
    },
    {
      header: "Ctn To",
      cell: (r) => (
        <Input
          className={COMPACT}
          value={r.ctn_to}
          onChange={(e) => updateLine(r.key, { ctn_to: e.target.value })}
        />
      ),
    },
    {
      header: "Ctns",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.ctns}
          onChange={(e) => updateLine(r.key, { ctns: e.target.value })}
        />
      ),
    },
    {
      header: "RE No",
      className: "min-w-[180px]",
      cell: (r) => (
        <RecordPicker
          label="RE No"
          compact
          identity="code"
          items={orderItems}
          value={r.sc_no_id}
          onChange={(id) => updateLine(r.key, { sc_no_id: id })}
        />
      ),
    },
    {
      header: "PO No",
      cell: (r) => (
        <Input
          className={COMPACT}
          uppercase
          value={r.po_no}
          onChange={(e) => updateLine(r.key, { po_no: e.target.value })}
        />
      ),
    },
    {
      header: "Country",
      className: "min-w-[160px]",
      cell: (r) => (
        <CountryPicker
          compact
          countries={data.countries}
          value={r.country_id}
          onChange={(id) => updateLine(r.key, { country_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ),
    },
    {
      header: "Ref No",
      cell: (r) => (
        <Input
          className={COMPACT}
          uppercase
          value={r.ref_no}
          onChange={(e) => updateLine(r.key, { ref_no: e.target.value })}
        />
      ),
    },
    {
      header: "Assort Type",
      cell: (r) => (
        <Select
          className={COMPACT}
          value={r.assort_type}
          onChange={(e) => updateLine(r.key, { assort_type: e.target.value })}
        >
          <option value=""></option>
          {ASSORT_TYPES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Cust Order No",
      cell: (r) => (
        <Input
          className={COMPACT}
          uppercase
          value={r.customer_order_no}
          onChange={(e) =>
            updateLine(r.key, { customer_order_no: e.target.value })
          }
        />
      ),
    },
    {
      // A tick box is a column on the arrow axis (`ROW_FIELDS`), so it keeps its
      // place in the typing path rather than being reachable only by mouse.
      header: "Mult. Pack",
      align: "center",
      cell: (r) => (
        <input
          type="checkbox"
          checked={r.multiple_pack}
          onChange={(e) =>
            updateLine(r.key, { multiple_pack: e.target.checked })
          }
          className="h-4 w-4 rounded border-border accent-primary"
        />
      ),
    },
    {
      // Disabled until the nested Assort screen has a spec. A disabled control is
      // deliberately NOT a field (`ROW_FIELDS` excludes `[disabled]`), so the
      // arrows step over it instead of dying on a dead cell.
      header: "Assort",
      align: "center",
      cell: () => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled
          title="Nested Assort screen — awaiting spec"
        >
          Assort
        </Button>
      ),
    },
    {
      header: "Qty/Ctn",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.qty_per_ctn}
          onChange={(e) => updateLine(r.key, { qty_per_ctn: e.target.value })}
        />
      ),
    },
    {
      header: "Total Qty",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.total_qty}
          onChange={(e) => updateLine(r.key, { total_qty: e.target.value })}
        />
      ),
    },
    {
      header: "Unit",
      className: "min-w-[140px]",
      cell: (r) => (
        <RecordPicker
          label="Unit"
          compact
          items={data.uoms}
          value={r.unit_id}
          onChange={(id) => updateLine(r.key, { unit_id: id })}
        />
      ),
    },
    {
      header: "Measurement",
      cell: (r) => (
        <Input
          className={COMPACT}
          uppercase
          value={r.measurement}
          onChange={(e) => updateLine(r.key, { measurement: e.target.value })}
        />
      ),
    },
    /* Length / Width / Height (0558, doc/order/update.md §3.1) — CBM below is
       DERIVED from these three plus Ctns (`computeCbm`), never typed. */
    {
      header: "Length (cm)",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.length_cm}
          onChange={(e) => updateLine(r.key, { length_cm: e.target.value })}
        />
      ),
    },
    {
      header: "Width (cm)",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.width_cm}
          onChange={(e) => updateLine(r.key, { width_cm: e.target.value })}
        />
      ),
    },
    {
      header: "Height (cm)",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.height_cm}
          onChange={(e) => updateLine(r.key, { height_cm: e.target.value })}
        />
      ),
    },
    {
      header: "CBM",
      align: "right",
      cell: (r) => {
        const cbm = computeCbm(
          n(r.length_cm) || null,
          n(r.width_cm) || null,
          n(r.height_cm) || null,
          n(r.ctns) || null,
        );
        return (
          <Input
            readOnly
            className={`${COMPACT} bg-surface-muted text-right`}
            value={cbm != null ? cbm.toFixed(3) : ""}
          />
        );
      },
    },
    /* Columns already existed on `packing_advice_lines` since 0033 but were
       never wired to a cell — see doc/order/update.md §3.1. Per carton, so
       they sit beside the rest of the line rather than on the header. */
    {
      header: "Net Wt",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.net_weight}
          onChange={(e) => updateLine(r.key, { net_weight: e.target.value })}
        />
      ),
    },
    {
      header: "Gross Wt",
      align: "right",
      cell: (r) => (
        <Input
          type="number"
          className={`${COMPACT} text-right`}
          value={r.gross_weight}
          onChange={(e) => updateLine(r.key, { gross_weight: e.target.value })}
        />
      ),
    },
  ];

  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className={`space-y-4 ${DENSE_LABELS}`}>
      <PageHeader
        title={
          editId
            ? `Edit Packing Advice ${editCode ?? ""}`
            : "New Packing Advice"
        }
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

      {/* Header band — ONE `FieldGrid`, every field `xs`, capped by `FORM_W`.
          See the note above `FORM_W` for why this is a grid again and not the
          two shrink-wrapped `FieldRow`s of the morning. No `Card` around it:
          the compact flat design (2026-09-15) has the form sit straight on
          the page background. A screen composes primitives, it does not draw
          (LAYOUT.md §3). */}
      <FieldGrid className={FORM_W}>
        {/* `Input readOnly` rather than a styled `<div>`: the div was a value
            the primitives could not see, and readOnly brings the right look,
            keeps it in the accessibility tree and sets `tabIndex={-1}` so it
            stays off the typing path. */}
        <Field label="PL Adv No" size="xs" htmlFor="pa-no">
          <Input
            id="pa-no"
            className={`${COMPACT} font-mono`}
            value={editCode ?? "Auto (on save)"}
            readOnly
          />
        </Field>
        {/* `required` on the Field, not a `*` typed into the label — the same
            prop draws the star AND stamps `data-required-empty`, so the
            cursor holds on a blank box. */}
        <Field label="Date" required size="xs" htmlFor="pa-date">
          <Input
            id="pa-date"
            type="date"
            className={COMPACT}
            value={form.advice_date}
            onChange={(e) => set({ advice_date: e.target.value })}
          />
        </Field>
        <Field label="Reference" size="xs" htmlFor="pa-ref">
          <Input
            id="pa-ref"
            className={COMPACT}
            uppercase
            value={form.reference}
            onChange={(e) => set({ reference: e.target.value })}
          />
        </Field>
        <Field label="Carton SlNo.By" size="xs" htmlFor="pa-carton">
          <Select
            id="pa-carton"
            className={COMPACT}
            value={form.carton_slno_by}
            onChange={(e) => set({ carton_slno_by: e.target.value })}
          >
            <option value=""></option>
            {CARTON_SLNO_BY.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        {/* The pickers draw their own labels; `Field` carries the span. */}
        <Field size="xs" className={COMPACT_PICKER}>
          <RecordPicker
            label="Customer"
            items={data.buyers}
            value={form.customer_id}
            onChange={(id) => set({ customer_id: id })}
          />
        </Field>
        <Field size="xs" className={COMPACT_PICKER}>
          <RecordPicker
            label="Consignee"
            items={data.consignees}
            value={form.consignee_id}
            onChange={(id) => set({ consignee_id: id })}
          />
        </Field>
        {/* Derived totals AS BOXES (operator, 2026-09-15: "convert … from plain
            text '0' into <input type=\"number\"> fields … the exact same classes
            as the other inputs"). They were bare text so the band read as
            two labels with a number under each; now they are the same `h-7`
            box as everything beside them, so the row is one unbroken line.

            `readOnly`, NOT editable — and this is the half that matters. Both
            are sums over the lines below (`ctnsTotal` / `qtyTotal`) and are
            saved as `ctns_total` / `qty_total` from those same memos, so a
            typed value would be overwritten by the next keystroke in the grid
            and could never reach the save. `readOnly` gives the box look, keeps
            it in the accessibility tree, sets `tabIndex={-1}` so Tab steps
            over it, and — per the CAPITALS rule — never re-cases a value the
            operator did not type. `bg-surface-muted` is the same tell the CBM
            cell in the grid uses for "computed, not typed". Value is the raw
            number (an `<input type="number">` rejects `fmtNumber`'s grouping),
            and with no lines it is 0. */}
        <Field label="Ctns" size="xs" htmlFor="pa-ctns">
          <Input
            id="pa-ctns"
            type="number"
            readOnly
            className={`${COMPACT} bg-surface-muted text-right`}
            value={ctnsTotal}
          />
        </Field>
        <Field label="Qty" size="xs" htmlFor="pa-qty">
          <Input
            id="pa-qty"
            type="number"
            readOnly
            className={`${COMPACT} bg-surface-muted text-right`}
            value={qtyTotal}
          />
        </Field>
        <Field size="xs" className={COMPACT_PICKER}>
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
        {/* An `Input`, not the one-row `Textarea` it was (operator, 2026-09-15:
            "crucial to keep the row heights perfectly aligned"). A textarea at
            `rows={1}` grew on the second line and broke the band; a stored
            address with line breaks is flattened by `oneLine` at load — see
            that helper for why it cannot be left to the input. */}
        <Field label="Warehouse Address" size="xs" htmlFor="pa-waddr">
          <Input
            id="pa-waddr"
            className={COMPACT}
            value={form.warehouse_address}
            onChange={(e) => set({ warehouse_address: e.target.value })}
          />
        </Field>
        {/* `packing_advices.remarks` (0033) — a single-line box, wired to the
            header for the first time here. */}
        <Field label="Remarks" size="xs" htmlFor="pa-remarks">
          <Input
            id="pa-remarks"
            className={COMPACT}
            uppercase
            value={form.remarks}
            onChange={(e) => set({ remarks: e.target.value })}
          />
        </Field>
      </FieldGrid>

      {/* Packing List detail grid — WRAPS, NEVER SCROLLS SIDEWAYS.
          Sixteen columns at `min-w-[1720px]` was the worst case of the rule in
          the whole module: the operator filled Ctn From, then dragged a bar past
          fifteen cells to reach Measurement with the start of the line scrolled
          out of sight. `forceCards` + `renderMobileRow` lays each line out as the
          same `FieldGrid` the header uses — six across at `xs`, the same cap,
          the same `gap-x-3 gap-y-2`, flowing onto as many rows as it takes (see
          "The operator's five", rule 4b). The cap sits on the wrapper so the
          grid's own chrome (label, "+ Add line") ends where the fields do. */}
      <div className={FORM_W}>
        <ChildGrid<LineRow>
          label="Packing List — Details"
          columns={lineColumns}
          rows={lines}
          seedRow
          forceCards
          flatRows
          renderMobileRow={(row, i) => (
            <FieldGrid>
              {lineColumns.map((c, ci) => (
                // Labels and cells both read off `lineColumns`, so a new column
                // cannot leave the card and the declaration disagreeing.
                <Field
                  key={ci}
                  label={c.header}
                  required={c.required}
                  size="xs"
                  className={COMPACT_PICKER}
                >
                  {c.cell(row, i)}
                </Field>
              ))}
            </FieldGrid>
          )}
          onAdd={() => setLines((xs) => [...xs, blankLine()])}
          onRemove={(r) => setLines((xs) => xs.filter((x) => x.key !== r.key))}
          addLabel="+ Add line"
        />
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button
            variant="outline"
            disabled={isPending || !canSave}
            onClick={() => submit("draft")}
          >
            Save as Draft
          </Button>
        )}
        <Button
          disabled={isPending || !canSave}
          onClick={() => submit("finalised")}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
