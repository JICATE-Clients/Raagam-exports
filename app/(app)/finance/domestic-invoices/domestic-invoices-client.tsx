"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createDomesticInvoice,
  setDomesticInvoiceStatus,
  deleteDomesticInvoice,
} from "@/lib/finance/domestic-invoices/actions";
import {
  DGI_STATUSES,
  DGI_STATUS_LABELS,
  dgiStatusTone,
  invoiceTotal,
  type DgiStatus,
} from "@/lib/finance/domestic-invoices/types";
import type { DomesticInvoiceRow } from "@/lib/finance/domestic-invoices/service";
import type { PartyOption } from "@/lib/finance/notes/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  invoices: DomesticInvoiceRow[];
  buyers: PartyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canExport: boolean;
  canDelete: boolean;
}

export function DomesticInvoicesClient({
  invoices,
  buyers,
  canCreate,
  canEdit,
  canExport,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [buyerId, setBuyerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [taxable, setTaxable] = useState("");
  const [gst, setGst] = useState("");
  const [remarks, setRemarks] = useState("");

  const previewTotal = (Number(taxable) || 0) + (Number(gst) || 0);

  function resetForm() {
    setBuyerId("");
    setInvoiceDate("");
    setTaxable("");
    setGst("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createDomesticInvoice({
        buyer_id: buyerId || null,
        invoice_date: invoiceDate || null,
        taxable_amount: Number(taxable) || 0,
        gst_amount: Number(gst) || 0,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Invoice created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: DgiStatus) {
    startTransition(async () => {
      const result = await setDomesticInvoiceStatus(id, status);
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
      const result = await deleteDomesticInvoice(id);
      if (result.ok) {
        success("Invoice removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<DomesticInvoiceRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Buyer", cell: (r) => <span className="text-sm">{r.buyers?.name ?? "—"}</span> },
    { header: "Taxable", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.taxable_amount, "INR")}</span> },
    { header: "GST", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.gst_amount, "INR")}</span> },
    { header: "Total", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtMoney(invoiceTotal(r), "INR")}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.invoice_date)}</span> },
    {
      header: "Status",
      cell: (r) =>
        canEdit ? (
          <Select
            value={r.status}
            onChange={(e) => handleStatus(r.id, e.target.value as DgiStatus)}
            disabled={isPending}
            className="h-7 w-24 text-xs"
            aria-label="Invoice status"
          >
            {DGI_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DGI_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={dgiStatusTone(r.status)}>{DGI_STATUS_LABELS[r.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (r: DomesticInvoiceRow) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<DomesticInvoiceRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="domestic_garment_invoices" rows={invoices} canExport={canExport} />

      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New invoice</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New domestic invoice</CardTitle>
            <span className="text-sm text-muted-foreground">
              Total: <strong className="text-foreground">{fmtMoney(previewTotal, "INR")}</strong>
            </span>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="di-buyer">Buyer</Label>
                <Select id="di-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="di-date">Invoice date</Label>
                <Input id="di-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="di-tax">Taxable amount</Label>
                <Input id="di-tax" type="number" min="0" step="0.01" value={taxable} onChange={(e) => setTaxable(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="di-gst">GST amount</Label>
                <Input id="di-gst" type="number" min="0" step="0.01" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="0.00" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="di-rem">Remarks</Label>
                <Input id="di-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating…" : "Create invoice"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={invoices}
        getKey={(r) => r.id}
        empty="No domestic invoices yet."
      />
    </div>
  );
}
