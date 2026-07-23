"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import type { PieceRecordInput } from "@/lib/hr/types";
import type { PieceRecordRow } from "@/lib/hr/attendance-service";
import type { Worker } from "@/lib/hr/types";
import type { LocationOption, OrderOption } from "@/lib/hr/masters-service";
import {
  recordPieces,
  updatePieces,
  deletePieceRecord,
} from "@/lib/hr/attendance-actions";
import { fmtDate, fmtNumber } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

const DEFAULTS: PieceRecordInput = {
  worker_id: "",
  work_date: "",
  pieces: 0,
  sales_order_id: null,
};

export default function PieceRecordsClient({
  records,
  workers,
  locations,
  orders,
  selectedDate,
  selectedLocationId,
  selectedWorkerId,
}: {
  records: PieceRecordRow[];
  workers: Worker[];
  locations: LocationOption[];
  orders: OrderOption[];
  selectedDate: string;
  selectedLocationId: string | null;
  selectedWorkerId: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // Filter controls
  const [dateVal, setDateVal] = useState(selectedDate);
  const [locationVal, setLocationVal] = useState(selectedLocationId ?? "");
  const [workerVal, setWorkerVal] = useState(selectedWorkerId ?? "");

  // Form state
  const [showForm, setShowForm] = useState(false);
  useCreateIntent(() => setShowForm(true));
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PieceRecordInput>({
    ...DEFAULTS,
    work_date: selectedDate,
  });

  function navigate() {
    const params = new URLSearchParams();
    params.set("date", dateVal);
    if (locationVal) params.set("location", locationVal);
    if (workerVal) params.set("worker", workerVal);
    router.push(`/hr/piece-records?${params.toString()}`);
  }

  function openAdd() {
    setForm({ ...DEFAULTS, work_date: selectedDate });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(r: PieceRecordRow) {
    if (r.is_locked) return; // guard — button hidden for locked rows
    setForm({
      worker_id: r.worker_id,
      work_date: r.work_date,
      pieces: r.pieces,
      sales_order_id: r.sales_order_id,
    });
    setEditId(r.id);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = editId
        ? await updatePieces(editId, form)
        : await recordPieces(form);
      if (result.ok) {
        success(editId ? "Record updated." : "Pieces recorded.");
        cancel();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePieceRecord(id);
      if (result.ok) {
        success("Record deleted.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<PieceRecordRow>[] = [
    { header: "Date", cell: (r) => fmtDate(r.work_date) },
    { header: "Worker", cell: (r) => r.worker_name },
    {
      header: "Pieces",
      align: "right",
      cell: (r) => <span className="tabular-nums">{fmtNumber(r.pieces)}</span>,
    },
    {
      header: "Sales Order",
      cell: (r) => r.order_number ?? "—",
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_locked ? "warning" : "success"}>
          {r.is_locked ? "Locked" : "Open"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.is_locked ? null : (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isPending}
              onClick={() => handleDelete(r.id)}
            >
              Del
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="pr-date">Date</Label>
          <Input
            id="pr-date"
            type="date"
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <Label htmlFor="pr-loc">Location</Label>
          <Select
            id="pr-loc"
            value={locationVal}
            onChange={(e) => setLocationVal(e.target.value)}
            className="w-48"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pr-worker">Worker</Label>
          <Select
            id="pr-worker"
            value={workerVal}
            onChange={(e) => setWorkerVal(e.target.value)}
            className="w-48"
          >
            <option value="">All Workers</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={navigate}>
          Load
        </Button>
        <div className="ml-auto">
          <Button variant="primary" size="sm" onClick={openAdd}>
            + Record Pieces
          </Button>
        </div>
      </div>

      {/* Entry form */}
      {showForm && (
        <Card>
          <CardBody>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2 text-sm font-semibold text-foreground">
                {editId ? "Edit Piece Record" : "New Piece Record"}
              </div>

              <div>
                <Label htmlFor="pr-f-worker">Worker *</Label>
                <Select
                  id="pr-f-worker"
                  value={form.worker_id}
                  onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
                  required
                >
                  <option value="">— Select Worker —</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pr-f-date">Date *</Label>
                <Input
                  id="pr-f-date"
                  type="date"
                  value={form.work_date}
                  onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="pr-f-pieces">Pieces *</Label>
                <Input
                  id="pr-f-pieces"
                  type="number"
                  min={0}
                  step={1}
                  value={form.pieces}
                  onChange={(e) =>
                    setForm({ ...form, pieces: parseInt(e.target.value, 10) || 0 })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="pr-f-so">Sales Order</Label>
                <Select
                  id="pr-f-so"
                  value={form.sales_order_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, sales_order_id: e.target.value || null })
                  }
                >
                  <option value="">— None —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={cancel}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={records}
        getKey={(r) => r.id}
        empty="No piece records for the selected filters."
      />
    </div>
  );
}
