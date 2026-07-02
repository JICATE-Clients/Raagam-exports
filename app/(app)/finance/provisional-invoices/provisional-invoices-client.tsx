"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createProvisionalInvoice,
  setProvisionalInvoiceStatus,
  deleteProvisionalInvoice,
} from "@/lib/finance/provisional-invoices/actions";
import {
  PRV_STATUSES,
  PRV_STATUS_LABELS,
  prvStatusTone,
  type PrvStatus,
} from "@/lib/finance/provisional-invoices/types";
import type { ProvisionalInvoiceRow } from "@/lib/finance/provisional-invoices/service";
import type { PartyOption } from "@/lib/finance/notes/service";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  invoices: ProvisionalInvoiceRow[];
  buyers: PartyOption[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ProvisionalInvoicesClient({
  invoices,
  buyers,
  currencies,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [buyerId, setBuyerId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setBuyerId("");
    setCurrency("USD");
    setAmount("");
    setInvoiceDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createProvisionalInvoice({
        buyer_id: buyerId || null,
        currency_code: currency || null,
        amount: Number(amount) || 0,
        invoice_date: invoiceDate || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Provisional invoice created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: PrvStatus) {
    startTransition(async () => {
      const result = await setProvisionalInvoiceStatus(id, status);
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
      const result = await deleteProvisionalInvoice(id);
      if (result.ok) {
        success("Invoice removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ProvisionalInvoiceRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Buyer", cell: (r) => <span className="text-sm">{r.buyers?.name ?? "—"}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.amount, r.currency_code)}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.invoice_date)}</span> },
    {
      header: "Status",
      cell: (r) =>
        canEdit ? (
          <Select
            value={r.status}
            onChange={(e) => handleStatus(r.id, e.target.value as PrvStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Provisional invoice status"
          >
            {PRV_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PRV_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={prvStatusTone(r.status)}>{PRV_STATUS_LABELS[r.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (r: ProvisionalInvoiceRow) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<ProvisionalInvoiceRow>,
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
            <Button onClick={() => setFormOpen(true)}>New provisional</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New provisional invoice</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="pv-buyer">Buyer</Label>
                <Select id="pv-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pv-cur">Currency</Label>
                <Select id="pv-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pv-amt">Amount</Label>
                <Input id="pv-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="pv-date">Invoice date</Label>
                <Input id="pv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="pv-rem">Remarks</Label>
                <Input id="pv-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
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
        empty="No provisional invoices yet."
      />
    </div>
  );
}
