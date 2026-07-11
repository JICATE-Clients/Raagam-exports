"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addIwoLine,
  deleteIwoLine,
  setIwoStatus,
} from "@/lib/orders/internal-work-orders/actions";
import {
  IWO_STATUS_LABELS,
  iwoStatusTone,
  type IwoLine,
  type IwoStatus,
} from "@/lib/orders/internal-work-orders/types";
import type { IwoDetail as IwoDetailType } from "@/lib/orders/internal-work-orders/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  iwo: IwoDetailType;
  lines: IwoLine[];
  canEdit: boolean;
  canDelete: boolean;
}

export function IwoDetail({ iwo, lines, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setDescription("");
    setQuantity("");
    setUnit("");
    setNotes("");
    setFormOpen(false);
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addIwoLine(iwo.id, {
        description: description.trim(),
        quantity: Number(quantity) || 0,
        unit: unit.trim() || null,
        notes: notes.trim() || null,
        sort_order: (lines.length + 1) * 10,
      });
      if (result.ok) {
        success("Line added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteLine(lineId: string) {
    startTransition(async () => {
      const result = await deleteIwoLine(lineId, iwo.id);
      if (result.ok) {
        success("Line removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function changeStatus(status: IwoStatus, msg: string) {
    startTransition(async () => {
      const result = await setIwoStatus(iwo.id, status);
      if (result.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const lineColumns: Column<IwoLine>[] = [
    {
      header: "Description",
      cell: (l) => <span className="text-sm font-medium">{l.description}</span>,
    },
    {
      header: "Qty",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.quantity)}</span>,
    },
    {
      header: "Unit",
      cell: (l) => <span className="text-sm text-muted-foreground">{l.unit ?? "—"}</span>,
    },
    {
      header: "Notes",
      cell: (l) => (
        <span className="text-sm text-muted-foreground">{l.notes ?? "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (l: IwoLine) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDeleteLine(l.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Delete
              </Button>
            ),
          } satisfies Column<IwoLine>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Work order</CardTitle>
          <div className="flex items-center gap-2">
            <StatusPill tone={iwoStatusTone(iwo.status)}>
              {IWO_STATUS_LABELS[iwo.status]}
            </StatusPill>
            {canEdit && iwo.status === "draft" && (
              <Button
                size="sm"
                onClick={() => changeStatus("issued", "Work order issued")}
                disabled={isPending}
              >
                Issue
              </Button>
            )}
            {canEdit && iwo.status === "issued" && (
              <Button
                size="sm"
                onClick={() => changeStatus("completed", "Work order completed")}
                disabled={isPending}
              >
                Mark complete
              </Button>
            )}
            {canEdit && (iwo.status === "draft" || iwo.status === "issued") && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => changeStatus("cancelled", "Work order cancelled")}
                disabled={isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono font-medium">{iwo.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium">{iwo.iwo_type ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order</dt>
              <dd className="font-medium">
                {iwo.sales_order_id ? (
                  <Link
                    href={`/orders/${iwo.sales_order_id}`}
                    className="text-primary hover:underline"
                  >
                    {iwo.sales_orders?.order_number ?? "—"}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{iwo.customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Style</dt>
              <dd className="font-medium">{iwo.style?.style_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Deli Dt</dt>
              <dd className="tabular-nums font-medium">{fmtDate(iwo.deli_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unit / Location</dt>
              <dd className="font-medium">
                {iwo.locations ? `${iwo.locations.code} — ${iwo.locations.name}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Issued</dt>
              <dd className="tabular-nums font-medium">{fmtDate(iwo.issued_at)}</dd>
            </div>
            {iwo.instructions && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Instructions</dt>
                <dd className="text-sm">{iwo.instructions}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Lines ({lines.length})</CardTitle>
          {canEdit && !formOpen && (
            <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
              + Add line
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable
            columns={lineColumns}
            rows={lines}
            getKey={(l) => l.id}
            empty="No lines yet."
          />

          {canEdit && formOpen && (
            <form
              onSubmit={handleAddLine}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-48 flex-1">
                <Label htmlFor="l-desc" className="mb-0.5">
                  Description *
                </Label>
                <Input
                  id="l-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Body panels"
                  required
                />
              </div>
              <div>
                <Label htmlFor="l-qty" className="mb-0.5">
                  Qty
                </Label>
                <Input
                  id="l-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                  className="w-24"
                />
              </div>
              <div>
                <Label htmlFor="l-unit" className="mb-0.5">
                  Unit
                </Label>
                <Input
                  id="l-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="pcs"
                  className="w-24"
                />
              </div>
              <div className="min-w-40 flex-1">
                <Label htmlFor="l-notes" className="mb-0.5">
                  Notes
                </Label>
                <Input
                  id="l-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !description.trim()}
                >
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
    </div>
  );
}
