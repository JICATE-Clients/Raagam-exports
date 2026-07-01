"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { createJob } from "@/lib/process/actions";
import {
  PROCESS_TYPES,
  PROCESS_TYPE_LABELS,
  type ProcessJobStatus,
} from "@/lib/process/types";
import type { ProcessJobWithProcessor } from "@/lib/process/service";
import type { StatusTone } from "@/components/ui/status-pill";
import type {
  ProcessorOption,
  ItemOption,
  UomOption,
  OrderPickerItem,
  FabricBomPickerItem,
  DcPickerItem,
} from "@/lib/process/service";

// ---------- status helpers ----------

function jobStatusTone(status: ProcessJobStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "in_process":
      return "warning";
    case "received":
      return "success";
    case "closed":
      return "neutral";
  }
}

const JOB_STATUS_LABELS: Record<ProcessJobStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  in_process: "In Process",
  received: "Received",
  closed: "Closed",
};

// ---------- job list table ----------

const jobColumns: Column<ProcessJobWithProcessor>[] = [
  {
    header: "Job #",
    cell: (row) => (
      <Link
        href={`/process/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Type",
    cell: (row) => (
      <span className="text-sm">{PROCESS_TYPE_LABELS[row.process_type]}</span>
    ),
  },
  {
    header: "Processor",
    cell: (row) => (
      <span className="text-sm">{row.vendors?.name ?? <span className="text-muted-foreground">—</span>}</span>
    ),
  },
  {
    header: "Sent qty",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.sent_qty)}</span>
    ),
  },
  {
    header: "Expected return",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtDate(row.expected_return_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={jobStatusTone(row.status)}>
        {JOB_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
];

// ---------- new job form ----------

interface NewJobFormProps {
  processors: ProcessorOption[];
  items: ItemOption[];
  uoms: UomOption[];
  orders: OrderPickerItem[];
  fabricBoms: FabricBomPickerItem[];
  dcs: DcPickerItem[];
}

function NewJobForm({ processors, items, uoms, orders, fabricBoms, dcs }: NewJobFormProps) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // form fields
  const [processType, setProcessType] = useState<typeof PROCESS_TYPES[number]>("knitting");
  const [processorId, setProcessorId] = useState("");
  const [salesOrderId, setSalesOrderId] = useState("");
  const [fabricBomId, setFabricBomId] = useState("");
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [sentQty, setSentQty] = useState("");
  const [uomId, setUomId] = useState("");
  const [dcId, setDcId] = useState("");
  const [plannedLossPct, setPlannedLossPct] = useState("");
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setProcessType("knitting");
    setProcessorId("");
    setSalesOrderId("");
    setFabricBomId("");
    setItemId("");
    setDescription("");
    setSentQty("");
    setUomId("");
    setDcId("");
    setPlannedLossPct("");
    setExpectedReturnDate("");
    setNotes("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createJob({
        process_type: processType,
        processor_id: processorId || null,
        sales_order_id: salesOrderId || null,
        fabric_bom_id: fabricBomId || null,
        item_id: itemId || null,
        description: description || null,
        sent_qty: parseFloat(sentQty) || 0,
        uom_id: uomId || null,
        dc_id: dcId || null,
        planned_loss_pct: parseFloat(plannedLossPct) || 0,
        expected_return_date: expectedReturnDate || null,
        notes: notes || null,
      });
      if (result.ok) {
        success("Job order created");
        router.push(`/process/${result.jobId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New job order</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New process job order</CardTitle>
        <Button variant="outline" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="pj-type">Process type</Label>
              <Select
                id="pj-type"
                value={processType}
                onChange={(e) => setProcessType(e.target.value as typeof PROCESS_TYPES[number])}
                required
              >
                {PROCESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROCESS_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-processor">Processor (vendor)</Label>
              <Select
                id="pj-processor"
                value={processorId}
                onChange={(e) => setProcessorId(e.target.value)}
              >
                <option value="">— select processor —</option>
                {processors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ` : ""}{p.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-order">Sales order (optional)</Label>
              <Select
                id="pj-order"
                value={salesOrderId}
                onChange={(e) => setSalesOrderId(e.target.value)}
              >
                <option value="">— none —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number ?? o.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-bom">Fabric BOM (optional)</Label>
              <Select
                id="pj-bom"
                value={fabricBomId}
                onChange={(e) => setFabricBomId(e.target.value)}
              >
                <option value="">— none —</option>
                {fabricBoms.map((b) => (
                  <option key={b.id} value={b.id}>
                    BOM {b.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-item">Item (optional)</Label>
              <Select
                id="pj-item"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="">— none —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code ? `${i.code} — ` : ""}{i.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-desc">Description</Label>
              <Input
                id="pj-desc"
                placeholder="Brief description…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="pj-sentqty">Sent qty</Label>
              <Input
                id="pj-sentqty"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={sentQty}
                onChange={(e) => setSentQty(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="pj-uom">UOM</Label>
              <Select
                id="pj-uom"
                value={uomId}
                onChange={(e) => setUomId(e.target.value)}
              >
                <option value="">— select UOM —</option>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-dc">Delivery challan (optional)</Label>
              <Select
                id="pj-dc"
                value={dcId}
                onChange={(e) => setDcId(e.target.value)}
              >
                <option value="">— none —</option>
                {dcs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code ?? d.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="pj-loss">Planned loss %</Label>
              <Input
                id="pj-loss"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="0.00"
                value={plannedLossPct}
                onChange={(e) => setPlannedLossPct(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="pj-return">Expected return date</Label>
              <Input
                id="pj-return"
                type="date"
                value={expectedReturnDate}
                onChange={(e) => setExpectedReturnDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="pj-notes">Notes</Label>
            <Textarea
              id="pj-notes"
              placeholder="Any additional notes…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save as draft"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------- tabbed job list ----------

function JobListTab({ jobs }: { jobs: ProcessJobWithProcessor[] }) {
  if (jobs.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No jobs in this view.
      </p>
    );
  }
  return (
    <DataTable
      columns={jobColumns}
      rows={jobs}
      getKey={(r) => r.id}
      empty="No jobs in this view."
    />
  );
}

// ---------- main export ----------

interface Props {
  allJobs: ProcessJobWithProcessor[];
  processors: ProcessorOption[];
  items: ItemOption[];
  uoms: UomOption[];
  orders: OrderPickerItem[];
  fabricBoms: FabricBomPickerItem[];
  dcs: DcPickerItem[];
}

export function ProcessTabs({
  allJobs,
  processors,
  items,
  uoms,
  orders,
  fabricBoms,
  dcs,
}: Props) {
  const openJobs = allJobs.filter((j) =>
    (["draft", "issued", "in_process"] as ProcessJobStatus[]).includes(j.status),
  );
  const closedJobs = allJobs.filter((j) =>
    (["received", "closed"] as ProcessJobStatus[]).includes(j.status),
  );

  const tabItems = [
    {
      key: "open",
      label: `Open (${openJobs.length})`,
      content: <JobListTab jobs={openJobs} />,
    },
    {
      key: "received",
      label: `Received (${closedJobs.length})`,
      content: <JobListTab jobs={closedJobs} />,
    },
    {
      key: "all",
      label: `All (${allJobs.length})`,
      content: <JobListTab jobs={allJobs} />,
    },
  ];

  return (
    <div className="space-y-4">
      <NewJobForm
        processors={processors}
        items={items}
        uoms={uoms}
        orders={orders}
        fabricBoms={fabricBoms}
        dcs={dcs}
      />
      <Tabs items={tabItems} defaultKey="open" />
    </div>
  );
}
