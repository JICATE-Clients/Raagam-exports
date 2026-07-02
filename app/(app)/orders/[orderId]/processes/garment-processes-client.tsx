"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addOrderProcess,
  deleteOrderProcess,
} from "@/lib/orders/garment-processes/actions";
import {
  PROCESS_MODES,
  PROCESS_MODE_LABELS,
  processModeTone,
  COMMON_PROCESSES,
  type OrderGarmentProcess,
  type ProcessMode,
} from "@/lib/orders/garment-processes/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

interface Props {
  orderId: string;
  processes: OrderGarmentProcess[];
  canCreate: boolean;
  canDelete: boolean;
}

export function GarmentProcessesClient({
  orderId,
  processes,
  canCreate,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ProcessMode>("in_house");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setName("");
    setMode("in_house");
    setNotes("");
    setFormOpen(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    // next sequence = last + 10 (leaves room to re-order later)
    const nextSeq =
      (processes.reduce((max, p) => Math.max(max, p.sequence), 0) || 0) + 10;
    startTransition(async () => {
      const result = await addOrderProcess({
        sales_order_id: orderId,
        name: name.trim(),
        mode,
        sequence: nextSeq,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        success("Process added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(processId: string) {
    startTransition(async () => {
      const result = await deleteOrderProcess(processId, orderId);
      if (result.ok) {
        success("Process removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<OrderGarmentProcess>[] = [
    {
      header: "#",
      cell: (p) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {p.sequence}
        </span>
      ),
    },
    { header: "Process", cell: (p) => <span className="text-sm font-medium">{p.name}</span> },
    {
      header: "Mode",
      cell: (p) => (
        <StatusPill tone={processModeTone(p.mode)}>
          {PROCESS_MODE_LABELS[p.mode]}
        </StatusPill>
      ),
    },
    {
      header: "Notes",
      cell: (p) => (
        <span className="text-sm text-muted-foreground">{p.notes ?? "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (p: OrderGarmentProcess) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(p.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Delete
              </Button>
            ),
          } satisfies Column<OrderGarmentProcess>,
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process sequence ({processes.length})</CardTitle>
        {canCreate && !formOpen && (
          <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
            + Add process
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <DataTable
          columns={columns}
          rows={processes}
          getKey={(p) => p.id}
          empty="No garment processes defined yet — add the first step below."
        />

        {canCreate && formOpen && (
          <form
            onSubmit={handleAdd}
            className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
          >
            <div>
              <Label htmlFor="gp-name" className="mb-0.5">
                Process *
              </Label>
              <Input
                id="gp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Embroidery"
                list="common-processes"
                required
                className="w-40"
              />
              <datalist id="common-processes">
                {COMMON_PROCESSES.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="gp-mode" className="mb-0.5">
                Mode
              </Label>
              <Select
                id="gp-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ProcessMode)}
                className="w-36"
              >
                {PROCESS_MODES.map((m) => (
                  <option key={m} value={m}>
                    {PROCESS_MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-40 flex-1">
              <Label htmlFor="gp-notes" className="mb-0.5">
                Notes
              </Label>
              <Input
                id="gp-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
                {isPending ? "Adding…" : "Add"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
