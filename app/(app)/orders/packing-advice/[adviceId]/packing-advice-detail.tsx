"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addPackingLine,
  deletePackingLine,
  setPackingAdviceStatus,
} from "@/lib/orders/packing-advice/actions";
import {
  PACK_METHOD_LABELS,
  PLA_STATUS_LABELS,
  plaStatusTone,
  lineTotalPcs,
  type PackingAdviceLine,
  type PlaStatus,
} from "@/lib/orders/packing-advice/types";
import type { PackingAdviceWithOrder } from "@/lib/orders/packing-advice/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  advice: PackingAdviceWithOrder;
  lines: PackingAdviceLine[];
  canEdit: boolean;
  canDelete: boolean;
}

export function PackingAdviceDetail({
  advice,
  lines,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [pcsPerCarton, setPcsPerCarton] = useState("");
  const [cartonCount, setCartonCount] = useState("");
  const [netWeight, setNetWeight] = useState("");
  const [grossWeight, setGrossWeight] = useState("");

  function resetForm() {
    setDescription("");
    setPcsPerCarton("");
    setCartonCount("");
    setNetWeight("");
    setGrossWeight("");
    setFormOpen(false);
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addPackingLine(advice.id, {
        description: description.trim(),
        pcs_per_carton: Number(pcsPerCarton) || 0,
        carton_count: Number(cartonCount) || 0,
        net_weight: netWeight ? Number(netWeight) : null,
        gross_weight: grossWeight ? Number(grossWeight) : null,
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
      const result = await deletePackingLine(lineId, advice.id);
      if (result.ok) {
        success("Line removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function changeStatus(status: PlaStatus, msg: string) {
    startTransition(async () => {
      const result = await setPackingAdviceStatus(advice.id, status);
      if (result.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const totalCartons = lines.reduce((s, l) => s + (l.carton_count || 0), 0);
  const totalPcs = lines.reduce((s, l) => s + lineTotalPcs(l), 0);

  const lineColumns: Column<PackingAdviceLine>[] = [
    {
      header: "Assortment",
      cell: (l) => <span className="text-sm font-medium">{l.description}</span>,
    },
    {
      header: "Pcs/carton",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.pcs_per_carton)}</span>,
    },
    {
      header: "Cartons",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.carton_count)}</span>,
    },
    {
      header: "Total pcs",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtNumber(lineTotalPcs(l))}
        </span>
      ),
    },
    {
      header: "Net wt",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {l.net_weight != null ? fmtNumber(l.net_weight) : "—"}
        </span>
      ),
    },
    {
      header: "Gross wt",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {l.gross_weight != null ? fmtNumber(l.gross_weight) : "—"}
        </span>
      ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (l: PackingAdviceLine) => (
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
          } satisfies Column<PackingAdviceLine>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Packing advice</CardTitle>
          <div className="flex items-center gap-2">
            <StatusPill tone={plaStatusTone(advice.status)}>
              {PLA_STATUS_LABELS[advice.status]}
            </StatusPill>
            {canEdit && advice.status === "draft" && (
              <>
                <Button
                  size="sm"
                  onClick={() => changeStatus("finalised", "Packing advice finalised")}
                  disabled={isPending}
                >
                  Finalise
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => changeStatus("cancelled", "Packing advice cancelled")}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </>
            )}
            {canEdit && advice.status === "finalised" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => changeStatus("draft", "Reopened as draft")}
                disabled={isPending}
              >
                Reopen
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono font-medium">{advice.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order</dt>
              <dd className="font-medium">
                <Link
                  href={`/orders/${advice.sales_order_id}`}
                  className="text-primary hover:underline"
                >
                  {advice.sales_orders?.order_number ?? "—"}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{advice.sales_orders?.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pack method</dt>
              <dd className="font-medium">{PACK_METHOD_LABELS[advice.pack_method]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="tabular-nums font-medium">{fmtDate(advice.created_at)}</dd>
            </div>
            {advice.remarks && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Remarks</dt>
                <dd className="text-sm">{advice.remarks}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Carton lines ({lines.length})</CardTitle>
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
            empty="No carton lines yet."
          />

          {lines.length > 0 && (
            <div className="flex justify-end gap-6 border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">
                Total cartons:{" "}
                <strong className="tabular-nums text-foreground">
                  {fmtNumber(totalCartons)}
                </strong>
              </span>
              <span className="text-muted-foreground">
                Total pcs:{" "}
                <strong className="tabular-nums text-foreground">
                  {fmtNumber(totalPcs)}
                </strong>
              </span>
            </div>
          )}

          {canEdit && formOpen && (
            <form
              onSubmit={handleAddLine}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-40 flex-1">
                <Label htmlFor="pl-desc" className="mb-0.5">
                  Assortment *
                </Label>
                <Input
                  id="pl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Navy S/M/L 1:2:1"
                  required
                />
              </div>
              <div>
                <Label htmlFor="pl-ppc" className="mb-0.5">
                  Pcs/carton
                </Label>
                <Input
                  id="pl-ppc"
                  type="number"
                  min="0"
                  step="0.01"
                  value={pcsPerCarton}
                  onChange={(e) => setPcsPerCarton(e.target.value)}
                  placeholder="0"
                  className="w-24"
                />
              </div>
              <div>
                <Label htmlFor="pl-ctn" className="mb-0.5">
                  Cartons
                </Label>
                <Input
                  id="pl-ctn"
                  type="number"
                  min="0"
                  value={cartonCount}
                  onChange={(e) => setCartonCount(e.target.value)}
                  placeholder="0"
                  className="w-24"
                />
              </div>
              <div>
                <Label htmlFor="pl-net" className="mb-0.5">
                  Net wt
                </Label>
                <Input
                  id="pl-net"
                  type="number"
                  min="0"
                  step="0.001"
                  value={netWeight}
                  onChange={(e) => setNetWeight(e.target.value)}
                  placeholder="kg"
                  className="w-24"
                />
              </div>
              <div>
                <Label htmlFor="pl-gross" className="mb-0.5">
                  Gross wt
                </Label>
                <Input
                  id="pl-gross"
                  type="number"
                  min="0"
                  step="0.001"
                  value={grossWeight}
                  onChange={(e) => setGrossWeight(e.target.value)}
                  placeholder="kg"
                  className="w-24"
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
