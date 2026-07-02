"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProformaLine,
  deleteProformaLine,
  setProformaStatus,
} from "@/lib/logistics/proforma/actions";
import {
  PROFORMA_STATUS_LABELS,
  proformaStatusTone,
  lineAmount,
  type ProformaLine,
  type ProformaStatus,
} from "@/lib/logistics/proforma/types";
import type { ProformaWithBuyer } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  proforma: ProformaWithBuyer;
  lines: ProformaLine[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ProformaDetail({ proforma, lines, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [hsn, setHsn] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  const cur = proforma.currency_code ?? "USD";
  const total = lines.reduce((s, l) => s + lineAmount(l), 0);

  function resetForm() {
    setDescription("");
    setHsn("");
    setQuantity("");
    setUnitPrice("");
    setFormOpen(false);
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addProformaLine(proforma.id, {
        description: description.trim(),
        hsn_code: hsn.trim() || null,
        quantity: Number(quantity) || 0,
        unit_price: Number(unitPrice) || 0,
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
      const result = await deleteProformaLine(lineId, proforma.id);
      if (result.ok) {
        success("Line removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function changeStatus(status: ProformaStatus, msg: string) {
    startTransition(async () => {
      const result = await setProformaStatus(proforma.id, status);
      if (result.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const lineColumns: Column<ProformaLine>[] = [
    {
      header: "Description",
      cell: (l) => <span className="text-sm font-medium">{l.description}</span>,
    },
    {
      header: "HSN",
      cell: (l) => <span className="font-mono text-xs text-muted-foreground">{l.hsn_code ?? "—"}</span>,
    },
    {
      header: "Qty",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.quantity)}</span>,
    },
    {
      header: "Unit price",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtMoney(l.unit_price, cur)}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtMoney(lineAmount(l), cur)}
        </span>
      ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (l: ProformaLine) => (
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
          } satisfies Column<ProformaLine>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Proforma invoice</CardTitle>
          <div className="flex items-center gap-2">
            <StatusPill tone={proformaStatusTone(proforma.status)}>
              {PROFORMA_STATUS_LABELS[proforma.status]}
            </StatusPill>
            {canEdit && proforma.status === "draft" && (
              <Button
                size="sm"
                onClick={() => changeStatus("sent", "Marked as sent")}
                disabled={isPending}
              >
                Mark sent
              </Button>
            )}
            {canEdit && proforma.status === "sent" && (
              <Button
                size="sm"
                onClick={() => changeStatus("accepted", "Marked accepted")}
                disabled={isPending}
              >
                Mark accepted
              </Button>
            )}
            {canEdit && proforma.status !== "cancelled" && proforma.status !== "accepted" && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => changeStatus("cancelled", "Cancelled")}
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
              <dd className="font-mono font-medium">{proforma.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{proforma.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="font-medium">{proforma.currency_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Incoterm</dt>
              <dd className="font-medium">{proforma.incoterm ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Issue date</dt>
              <dd className="tabular-nums font-medium">{fmtDate(proforma.issue_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valid until</dt>
              <dd className="tabular-nums font-medium">{fmtDate(proforma.valid_until)}</dd>
            </div>
            {proforma.remarks && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Remarks</dt>
                <dd className="text-sm">{proforma.remarks}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Line items ({lines.length})</CardTitle>
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
            empty="No line items yet."
          />

          {lines.length > 0 && (
            <div className="flex justify-end border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">
                Total:{" "}
                <strong className="tabular-nums text-foreground">
                  {fmtMoney(total, cur)}
                </strong>
              </span>
            </div>
          )}

          {canEdit && formOpen && (
            <form
              onSubmit={handleAddLine}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-48 flex-1">
                <Label htmlFor="pl-desc" className="mb-0.5">
                  Description *
                </Label>
                <Input
                  id="pl-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Men's knitted polo"
                  required
                />
              </div>
              <div>
                <Label htmlFor="pl-hsn" className="mb-0.5">
                  HSN
                </Label>
                <Input
                  id="pl-hsn"
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  placeholder="6109"
                  className="w-24"
                />
              </div>
              <div>
                <Label htmlFor="pl-qty" className="mb-0.5">
                  Qty
                </Label>
                <Input
                  id="pl-qty"
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
                <Label htmlFor="pl-price" className="mb-0.5">
                  Unit price
                </Label>
                <Input
                  id="pl-price"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-28"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending || !description.trim()}>
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
