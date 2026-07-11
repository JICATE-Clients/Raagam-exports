"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { fmtDate } from "@/lib/format";
import { RecordPicker } from "@/components/masters/record-picker";
import { createTaPlan, updateTaPlan, deleteTaPlan } from "@/lib/orders/ta-plan/actions";
import type { TaPlanDoc } from "@/lib/orders/ta-plan/types";
import type { TaPlanFormData } from "@/lib/orders/ta-plan/service";

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
    if (!confirm(`Delete plan ${r.code ?? ""}?`)) return;
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
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>Delete</Button>
            )}
          </div>
        ),
      },
    ];
    return (
      <div className="space-y-4">
        <PageHeader
          title="TA Plan"
          description="Time & Action plan document — schedule activities against an order with target dates."
          actions={perms.canCreate ? <Button onClick={openAdd}>New TA Plan</Button> : undefined}
        />
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No TA plans yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  // From-Activity options = other rows in this plan that have an activity picked.
  const fromActivityOptions = lines
    .filter((l) => l.activity_id)
    .map((l) => ({ id: l.activity_id as string, name: activityName.get(l.activity_id as string) ?? "—" }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit TA Plan" : "New TA Plan"}
        description="Schedule activities against the order. End Dt = Start Dt + Days Required."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>No</Label>
            <Input value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"} disabled />
          </div>
          <div>
            <Label htmlFor="tap-date">Dt *</Label>
            <Input id="tap-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </div>
          <RecordPicker label="Customer" items={data.buyers} value={customerId} onChange={setCustomerId} />
          <RecordPicker label="SC No" items={data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.order_number ?? "—" }))} value={orderId} onChange={onPickOrder} />
          <RecordPicker label="SH Ref No" items={data.shipmentPlans} value={shipmentId} onChange={setShipmentId} />
          <div>
            <Label htmlFor="tap-orderno">Order No</Label>
            <Input id="tap-orderno" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tap-start">Start Dt</Label>
            <Input id="tap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <RecordPicker label="Style" items={data.styles} value={styleId} onChange={setStyleId} />
        </CardBody>
      </Card>

      {/* Activity grid */}
      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Activities</h3>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={() => setLines((xs) => [...xs, blankLine()])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add row
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <th className="w-10 px-2 py-1.5 text-left font-medium">S No</th>
                  <th className="min-w-[180px] px-2 py-1.5 text-left font-medium">Activity</th>
                  <th className="min-w-[160px] px-2 py-1.5 text-left font-medium">From Activity</th>
                  <th className="min-w-[140px] px-2 py-1.5 text-left font-medium">Details</th>
                  <th className="w-36 px-2 py-1.5 text-left font-medium">Start Dt</th>
                  <th className="w-24 px-2 py-1.5 text-left font-medium">Days Req.</th>
                  <th className="w-36 px-2 py-1.5 text-left font-medium">End Dt</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((r, i) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1">
                      <RecordPicker
                        label="Activity"
                        items={data.activities}
                        value={r.activity_id}
                        onChange={(id) => patchLine(r.key, { activity_id: id })}
                        compact
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Select
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
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={r.details}
                        onChange={(e) => patchLine(r.key, { details: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={r.start_date}
                        onChange={(e) => patchLine(r.key, { start_date: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min="0"
                        value={r.days_required}
                        onChange={(e) => patchLine(r.key, { days_required: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="date"
                        value={r.end_date}
                        onChange={(e) => patchLine(r.key, { end_date: e.target.value })}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => setLines((xs) => xs.filter((x) => x.key !== r.key))}
                        aria-label="Remove row"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Footer band */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label htmlFor="tap-deliv">Deliv. Dt</Label>
            <Input id="tap-deliv" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tap-qty">Order Qty</Label>
            <Input id="tap-qty" type="number" min="0" value={orderQty} onChange={(e) => setOrderQty(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tap-prop">Proposed Deliv. Dt</Label>
            <Input id="tap-prop" type="date" value={proposedDeliveryDate} onChange={(e) => setProposedDeliveryDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tap-target">Target Dt</Label>
            <Input id="tap-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tap-nod">No of Days</Label>
            <Input id="tap-nod" type="number" min="0" value={noOfDays} onChange={(e) => setNoOfDays(e.target.value)} />
          </div>
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
