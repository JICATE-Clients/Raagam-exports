"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import { createTaPlan, updateTaPlan, deleteTaPlan } from "@/lib/orders/ta-plan/actions";
import type { TaPlanDoc } from "@/lib/orders/ta-plan/types";
import type { TaPlanFormData } from "@/lib/orders/ta-plan/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: TaPlanDoc[];
  data: TaPlanFormData;
  perms: Perms;
}

type LineRow = {
  key: string;
  activity_id: string | null;
  from_activity_id: string | null;
  details: string;
  start_date: string;
  days_required: string;
  end_date: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** End = Start + Days Required (when both present). */
function withEnd(row: LineRow): LineRow {
  const days = Number(row.days_required);
  if (row.start_date && row.days_required !== "" && !Number.isNaN(days)) {
    return { ...row, end_date: addDays(row.start_date, days) };
  }
  return row;
}

export function TaPlanScreen({ rows, data, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);

  // header
  const [planDate, setPlanDate] = useState(() => today());
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  const [startDate, setStartDate] = useState("");
  const [styleId, setStyleId] = useState<string | null>(null);
  // footer
  const [deliveryDate, setDeliveryDate] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [proposedDeliveryDate, setProposedDeliveryDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [noOfDays, setNoOfDays] = useState("");
  // grid
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Inline editor, not a Sheet / MasterFullScreen — see mba-master-screen.tsx.
  useUnsavedGuard(mode === "edit" || isPending);

  const activityName = useMemo(() => {
    const m = new Map<string, string>();
    data.activities.forEach((a) => m.set(a.id, a.name));
    return m;
  }, [data.activities]);

  function blankLine(): LineRow {
    return {
      key: newKey(),
      activity_id: null,
      from_activity_id: null,
      details: "",
      start_date: "",
      days_required: "",
      end_date: "",
    };
  }

  function openAdd() {
    setEditId(null);
    setPlanDate(today());
    setCustomerId(null);
    setOrderId(null);
    setShipmentId(null);
    setOrderNo("");
    setStartDate("");
    setStyleId(null);
    setDeliveryDate("");
    setOrderQty("");
    setProposedDeliveryDate("");
    setTargetDate("");
    setNoOfDays("");
    setLines([blankLine()]);
    setMode("edit");
  }

  useCreateIntent(() => openAdd());

  function openEdit(r: TaPlanDoc) {
    setEditId(r.id);
    setPlanDate(r.plan_date ?? today());
    setCustomerId(r.customer_id);
    setOrderId(r.sales_order_id);
    setShipmentId(r.shipment_plan_id);
    setOrderNo(r.order_no ?? "");
    setStartDate(r.start_date ?? "");
    setStyleId(r.style_id);
    setDeliveryDate(r.delivery_date ?? "");
    setOrderQty(r.order_qty != null ? String(r.order_qty) : "");
    setProposedDeliveryDate(r.proposed_delivery_date ?? "");
    setTargetDate(r.target_date ?? "");
    setNoOfDays(r.no_of_days != null ? String(r.no_of_days) : "");
    setLines(
      r.activities.length
        ? r.activities.map((a) => ({
            key: newKey(),
            activity_id: a.activity_id,
            from_activity_id: a.from_activity_id,
            details: a.details ?? "",
            start_date: a.start_date ?? "",
            days_required: a.days_required != null ? String(a.days_required) : "",
            end_date: a.end_date ?? "",
          }))
        : [blankLine()],
    );
    setMode("edit");
  }

  function onPickOrder(id: string | null) {
    setOrderId(id);
    if (!id) return;
    const o = data.orders.find((x) => x.id === id);
    if (!o) return;
    if (o.buyer_id) setCustomerId(o.buyer_id);
    if (o.order_number) setOrderNo(o.order_number);
    if (o.order_qty != null) setOrderQty(String(o.order_qty));
    if (o.ship_date) setDeliveryDate(o.ship_date);
  }

  function patchLine(key: string, patch: Partial<LineRow>) {
    setLines((xs) => xs.map((x) => (x.key === key ? withEnd({ ...x, ...patch }) : x)));
  }

  function onPickFromActivity(key: string, fromActivityId: string | null) {
    // suggest this row's Start Dt = the predecessor row's End Dt
    const predecessor = lines.find(
      (l) => l.key !== key && l.activity_id === fromActivityId && l.end_date,
    );
    patchLine(key, {
      from_activity_id: fromActivityId,
      ...(predecessor ? { start_date: predecessor.end_date } : {}),
    });
  }

  function submit() {
    const payload = {
      plan_date: planDate,
      customer_id: customerId,
      sales_order_id: orderId,
      shipment_plan_id: shipmentId,
      order_no: orderNo || null,
      start_date: startDate || null,
      style_id: styleId,
      delivery_date: deliveryDate || null,
      order_qty: orderQty ? Number(orderQty) : null,
      proposed_delivery_date: proposedDeliveryDate || null,
      target_date: targetDate || null,
      no_of_days: noOfDays ? Number(noOfDays) : null,
      activities: lines.map((l) => ({
        sno: 0,
        activity_id: l.activity_id,
        from_activity_id: l.from_activity_id,
        details: l.details || null,
        start_date: l.start_date || null,
        days_required: l.days_required ? Number(l.days_required) : null,
        end_date: l.end_date || null,
      })),
    };
    start(async () => {
      const res = editId ? await updateTaPlan(editId, payload) : await createTaPlan(payload);
      if (res.ok) {
        success(editId ? "Plan updated" : "Plan created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: TaPlanDoc) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteTaPlan(r.id);
      if (res.ok) {
        success("Plan deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST ----------------
  if (mode === "list") {
    const columns: Column<TaPlanDoc>[] = [
      {
        header: "No",
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
      { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.plan_date)}</span> },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      {
        header: "SC No",
        cell: (r) => <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>,
      },
      { header: "Style", cell: (r) => <span className="text-sm">{r.style?.style_name ?? "—"}</span> },
      {
        header: "Activities",
        align: "right",
        cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.activities.length}</span>,
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
          title="TA Plan"
          description="Time & Action plan document — schedule activities against an order with target dates."
          actions={perms.canCreate ? <Button onClick={openAdd}>New TA Plan</Button> : undefined}
        />
        <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No TA plans yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  // From-Activity options = other rows in this plan that have an activity picked.
  const fromActivityOptions = lines
    .filter((l) => l.activity_id)
    .map((l) => ({ id: l.activity_id as string, name: activityName.get(l.activity_id as string) ?? "—" }));

  const activityColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Activity",
      className: "min-w-[180px]",
      cell: (r) => (
        <RecordPicker
          label="Activity"
          items={data.activities}
          value={r.activity_id}
          onChange={(id) => patchLine(r.key, { activity_id: id })}
          compact
        />
      ),
    },
    {
      header: "From Activity",
      className: "min-w-[160px]",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.from_activity_id ?? ""}
          onChange={(e) => onPickFromActivity(r.key, e.target.value || null)}
        >
          <option value="">—</option>
          {fromActivityOptions
            .filter((o) => o.id !== r.activity_id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </Select>
      ),
    },
    {
      header: "Details",
      className: "min-w-[140px]",
      cell: (r) => (
        <Input
          className="h-8"
          value={r.details}
          onChange={(e) => patchLine(r.key, { details: e.target.value })}
        />
      ),
    },
    {
      header: "Start Dt",
      className: "min-w-[9rem]",
      cell: (r) => (
        <Input
          className="h-8"
          type="date"
          value={r.start_date}
          onChange={(e) => patchLine(r.key, { start_date: e.target.value })}
        />
      ),
    },
    {
      header: "Days Req.",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          type="number"
          min="0"
          value={r.days_required}
          onChange={(e) => patchLine(r.key, { days_required: e.target.value })}
        />
      ),
    },
    {
      // Derived — `withEnd` recomputes it from Start Dt + Days Required on every
      // patch — but still editable, because the legacy screen lets a planner
      // override a computed date without changing the inputs behind it.
      header: "End Dt",
      className: "min-w-[9rem]",
      cell: (r) => (
        <Input
          className="h-8"
          type="date"
          value={r.end_date}
          onChange={(e) => patchLine(r.key, { end_date: e.target.value })}
        />
      ),
    },
  ];

  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <PageHeader
        title={editId ? "Edit TA Plan" : "New TA Plan"}
        description="Schedule activities against the order. End Dt = Start Dt + Days Required."
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band — `FieldGrid`, not a hand-rolled
          `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. A screen composes
          primitives, it does not draw (LAYOUT.md §3), and every field takes the
          one width the app fixes a field at. */}
      <Card>
        <CardBody>
          <FieldGrid>
            {/* `readOnly`, NOT `disabled` — the legacy TA Plan shows its number
                in a normal box, and `disabled` renders it at `opacity-50`
                (input.tsx), so an auto value read as switched off rather than as
                filled in (operator, 2026-08-11). `readOnly` also keeps the value
                in the accessibility tree, which `disabled` removes, and `Input`
                already sets `tabIndex={-1}` on a readOnly field so it stays off
                the typing path. */}
            <Field label="No" size="sm" htmlFor="tap-no">
              <Input
                id="tap-no"
                className="font-mono"
                value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"}
                readOnly
              />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the same
                prop draws the star AND stamps `data-required-empty`, so the
                cursor actually holds on a blank box. Typed by hand it was
                decoration and Tab walked straight past it. */}
            <Field label="Dt" required size="sm" htmlFor="tap-date">
              <Input id="tap-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </Field>
            {/* The pickers draw their own labels; `Field` carries the span. */}
            <Field size="sm">
              <RecordPicker label="Customer" items={data.buyers} value={customerId} onChange={setCustomerId} />
            </Field>
            <Field size="sm">
              {/* `identity="code"` — on an SC No the CODE is the identity and the
                  name is the customer, so without it several orders for one buyer
                  are indistinguishable in the list. */}
              <RecordPicker
                label="SC No"
                identity="code"
                items={data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.order_number ?? "—" }))}
                value={orderId}
                onChange={onPickOrder}
              />
            </Field>
            <Field size="sm">
              <RecordPicker label="SH Ref No" items={data.shipmentPlans} value={shipmentId} onChange={setShipmentId} />
            </Field>
            <Field label="Order No" size="sm" htmlFor="tap-orderno">
              <Input id="tap-orderno" uppercase value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
            </Field>
            <Field label="Start Dt" size="sm" htmlFor="tap-start">
              <Input id="tap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field size="sm">
              <RecordPicker label="Style" items={data.styles} value={styleId} onChange={setStyleId} />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {/* Activity grid — `ChildGrid`, not the hand-rolled <table> this carried.
          That one drew its own S No cell and its own Trash2 button, so it
          inherited neither Ctrl+Del nor `data-row-remove` — two of the ~22 grids
          AGENTS.md counts under "Tab lands on fields". Six columns fit the width,
          so it keeps the table layout rather than wrapping. */}
      <Card>
        <CardBody>
          <ChildGrid<LineRow>
            label="Activities"
            columns={activityColumns}
            rows={lines}
            seedRow
            onAdd={() => setLines((xs) => [...xs, blankLine()])}
            onRemove={(r) => setLines((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add activity"
          />
        </CardBody>
      </Card>

      {/* Footer band — the same one field track as the header, in place of its
          own `lg:grid-cols-5`. Five columns was a third width on one screen. */}
      <Card>
        <CardBody>
          <FieldGrid>
            <Field label="Deliv. Dt" size="sm" htmlFor="tap-deliv">
              <Input id="tap-deliv" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </Field>
            <Field label="Order Qty" size="sm" htmlFor="tap-qty">
              <Input id="tap-qty" type="number" min="0" value={orderQty} onChange={(e) => setOrderQty(e.target.value)} />
            </Field>
            <Field label="Proposed Deliv. Dt" size="sm" htmlFor="tap-prop">
              <Input id="tap-prop" type="date" value={proposedDeliveryDate} onChange={(e) => setProposedDeliveryDate(e.target.value)} />
            </Field>
            <Field label="Target Dt" size="sm" htmlFor="tap-target">
              <Input id="tap-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
            <Field label="No of Days" size="sm" htmlFor="tap-nod">
              <Input id="tap-nod" type="number" min="0" value={noOfDays} onChange={(e) => setNoOfDays(e.target.value)} />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button disabled={isPending || !planDate} onClick={submit}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
