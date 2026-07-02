"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createKnittingProgram,
  setKnittingProgramStatus,
  deleteKnittingProgram,
} from "@/lib/process/knitting/actions";
import {
  KP_STATUSES,
  KP_STATUS_LABELS,
  kpStatusTone,
  type KpStatus,
} from "@/lib/process/knitting/types";
import type {
  KnittingProgramRow,
  OrderOption,
} from "@/lib/process/knitting/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  programs: KnittingProgramRow[];
  orders: OrderOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function KnittingProgramsClient({
  programs,
  orders,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [orderId, setOrderId] = useState("");
  const [fabric, setFabric] = useState("");
  const [yarn, setYarn] = useState("");
  const [gauge, setGauge] = useState("");
  const [diameter, setDiameter] = useState("");
  const [gsm, setGsm] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState("Kg");
  const [machine, setMachine] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setOrderId("");
    setFabric("");
    setYarn("");
    setGauge("");
    setDiameter("");
    setGsm("");
    setQty("");
    setUom("Kg");
    setMachine("");
    setStartDate("");
    setEndDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createKnittingProgram({
        sales_order_id: orderId || null,
        fabric_desc: fabric || null,
        yarn_desc: yarn || null,
        gauge: gauge || null,
        diameter: diameter || null,
        gsm: gsm ? Number(gsm) : null,
        planned_qty: Number(qty) || 0,
        uom: uom || null,
        machine: machine || null,
        start_date: startDate || null,
        end_date: endDate || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Knitting program created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: KpStatus) {
    startTransition(async () => {
      const result = await setKnittingProgramStatus(id, status);
      if (result.ok) {
        success("Status updated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteKnittingProgram(id);
      if (result.ok) {
        success("Program removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<KnittingProgramRow>[] = [
    { header: "Code", cell: (p) => <span className="font-mono text-xs font-medium">{p.code ?? "—"}</span> },
    { header: "Order", cell: (p) => <span className="font-mono text-xs">{p.sales_orders?.order_number ?? "—"}</span> },
    { header: "Fabric / Yarn", cell: (p) => <span className="text-sm">{p.fabric_desc ?? p.yarn_desc ?? "—"}</span> },
    {
      header: "Spec",
      cell: (p) => (
        <span className="text-xs text-muted-foreground">
          {[p.gauge, p.diameter, p.gsm ? `${p.gsm} GSM` : null].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      header: "Planned",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(p.planned_qty)} {p.uom ?? ""}
        </span>
      ),
    },
    { header: "Start", cell: (p) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(p.start_date)}</span> },
    {
      header: "Status",
      cell: (p) =>
        canEdit ? (
          <Select
            value={p.status}
            onChange={(e) => handleStatus(p.id, e.target.value as KpStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Knitting program status"
          >
            {KP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {KP_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={kpStatusTone(p.status)}>{KP_STATUS_LABELS[p.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (p: KnittingProgramRow) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<KnittingProgramRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New program</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New knitting program</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="kp-order">Order</Label>
                <Select id="kp-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  <option value="">— none —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number ?? o.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="kp-fabric">Fabric</Label>
                <Input id="kp-fabric" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="e.g. Single Jersey" />
              </div>
              <div>
                <Label htmlFor="kp-yarn">Yarn</Label>
                <Input id="kp-yarn" value={yarn} onChange={(e) => setYarn(e.target.value)} placeholder="e.g. 30s Combed" />
              </div>
              <div>
                <Label htmlFor="kp-gauge">Gauge</Label>
                <Input id="kp-gauge" value={gauge} onChange={(e) => setGauge(e.target.value)} placeholder="e.g. 24G" />
              </div>
              <div>
                <Label htmlFor="kp-dia">Diameter</Label>
                <Input id="kp-dia" value={diameter} onChange={(e) => setDiameter(e.target.value)} placeholder='e.g. 34"' />
              </div>
              <div>
                <Label htmlFor="kp-gsm">GSM</Label>
                <Input id="kp-gsm" type="number" min="0" step="0.01" value={gsm} onChange={(e) => setGsm(e.target.value)} placeholder="180" />
              </div>
              <div>
                <Label htmlFor="kp-qty">Planned qty</Label>
                <Input id="kp-qty" type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="kp-uom">UOM</Label>
                <Input id="kp-uom" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="Kg" />
              </div>
              <div>
                <Label htmlFor="kp-machine">Machine</Label>
                <Input id="kp-machine" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor="kp-start">Start date</Label>
                <Input id="kp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="kp-end">End date</Label>
                <Input id="kp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <Label htmlFor="kp-rem">Remarks</Label>
                <Input id="kp-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating…" : "Create program"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={programs}
        getKey={(p) => p.id}
        empty="No knitting programs yet."
      />
    </div>
  );
}
