"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProcessQuote,
  deleteProcessQuote,
  confirmProcessQuote,
  approveOverBudget,
  cancelProcessRfq,
} from "@/lib/process/rfq/actions";
import {
  PRFQ_STATUS_LABELS,
  prfqStatusTone,
} from "@/lib/process/rfq/types";
import type {
  ProcessRfqDetail as ProcessRfqDetailType,
  QuoteRow,
  VendorOption,
} from "@/lib/process/rfq/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber } from "@/lib/format";

interface Props {
  rfq: ProcessRfqDetailType;
  quotes: QuoteRow[];
  vendors: VendorOption[];
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}

export function ProcessRfqDetail({
  rfq,
  quotes,
  vendors,
  canEdit,
  canDelete,
  canApprove,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [rate, setRate] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [remarks, setRemarks] = useState("");

  const isOpen = rfq.status === "open";

  function resetForm() {
    setVendorId("");
    setRate("");
    setDeliveryDays("");
    setRemarks("");
    setFormOpen(false);
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(msg);
        after?.();
        router.refresh();
      } else {
        toastError(r.error ?? "Action failed");
      }
    });
  }

  const quoteColumns: Column<QuoteRow>[] = [
    { header: "Vendor", cell: (q) => <span className="text-sm font-medium">{q.vendors?.name ?? "—"}</span> },
    {
      header: "Rate",
      align: "right",
      cell: (q) => {
        const over = Number(q.rate) > Number(rfq.budget_rate);
        return (
          <span className={`tabular-nums text-sm ${over ? "text-danger" : ""}`}>
            {fmtNumber(q.rate)}
            {over ? <span className="ml-1 text-xs">(over)</span> : null}
          </span>
        );
      },
    },
    {
      header: "Delivery",
      align: "right",
      cell: (q) => <span className="tabular-nums text-xs text-muted-foreground">{q.delivery_days != null ? `${q.delivery_days}d` : "—"}</span>,
    },
    { header: "Remarks", cell: (q) => <span className="text-xs text-muted-foreground">{q.remarks ?? "—"}</span> },
    {
      header: "",
      align: "right",
      cell: (q) => (
        <div className="flex justify-end gap-1">
          {canEdit && isOpen && (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => run(() => confirmProcessQuote(q.id), "Quote confirmed")}
              disabled={isPending}
              className="h-7 px-2 text-xs"
            >
              Confirm
            </Button>
          )}
          {canDelete && isOpen && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => deleteProcessQuote(q.id, rfq.id), "Quote removed")}
              disabled={isPending}
              className="h-7 px-2 text-xs text-danger hover:opacity-80"
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>RFQ details</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={prfqStatusTone(rfq.status)}>
              {PRFQ_STATUS_LABELS[rfq.status]}
            </StatusPill>
            {rfq.over_budget_approved && (
              <StatusPill tone="warning">Over-budget approved</StatusPill>
            )}
            {canApprove && isOpen && !rfq.over_budget_approved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(() => approveOverBudget(rfq.id), "Over-budget approved")}
                disabled={isPending}
              >
                Approve over-budget
              </Button>
            )}
            {canEdit && isOpen && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => run(() => cancelProcessRfq(rfq.id), "RFQ cancelled")}
                disabled={isPending}
              >
                Cancel RFQ
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Process</dt>
              <dd className="font-medium capitalize">{rfq.process_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Quantity</dt>
              <dd className="tabular-nums font-medium">{fmtNumber(rfq.quantity)} {rfq.uom ?? ""}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Budget rate</dt>
              <dd className="tabular-nums font-medium">{fmtNumber(rfq.budget_rate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Confirmed</dt>
              <dd className="tabular-nums font-medium">
                {rfq.confirmed_rate != null
                  ? `${fmtNumber(rfq.confirmed_rate)} — ${rfq.vendors?.name ?? ""}`
                  : "—"}
              </dd>
            </div>
            {rfq.description && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Description</dt>
                <dd className="text-sm">{rfq.description}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Quotes */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor quotes ({quotes.length})</CardTitle>
          {canEdit && isOpen && !formOpen && (
            <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
              + Add quote
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable columns={quoteColumns} rows={quotes} getKey={(q) => q.id} empty="No quotes received yet." />

          {canEdit && isOpen && formOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    addProcessQuote(rfq.id, {
                      vendor_id: vendorId,
                      rate: Number(rate) || 0,
                      delivery_days: deliveryDays ? Number(deliveryDays) : null,
                      remarks: remarks.trim() || null,
                    }),
                  "Quote added",
                  resetForm,
                );
              }}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
            >
              <div className="min-w-40">
                <Label htmlFor="q-vendor" className="mb-0.5">Vendor *</Label>
                <Select id="q-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required className="w-44">
                  <option value="">— select —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="q-rate" className="mb-0.5">Rate</Label>
                <Input id="q-rate" type="number" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} className="w-28" placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="q-days" className="mb-0.5">Delivery (days)</Label>
                <Input id="q-days" type="number" min="0" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} className="w-24" placeholder="0" />
              </div>
              <div className="min-w-32 flex-1">
                <Label htmlFor="q-rem" className="mb-0.5">Remarks</Label>
                <Input id="q-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending || !vendorId}>
                  Add
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
