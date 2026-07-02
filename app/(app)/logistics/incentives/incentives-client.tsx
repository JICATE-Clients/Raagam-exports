"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createIncentive,
  setIncentiveStatus,
  deleteIncentive,
} from "@/lib/logistics/incentives/actions";
import {
  INCENTIVE_SCHEMES,
  SCHEME_LABELS,
  INCENTIVE_STATUSES,
  INCENTIVE_STATUS_LABELS,
  incentiveStatusTone,
  type ExportIncentiveFile,
  type IncentiveScheme,
  type IncentiveStatus,
} from "@/lib/logistics/incentives/types";
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
  files: ExportIncentiveFile[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function IncentivesClient({ files, currencies, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [scheme, setScheme] = useState<IncentiveScheme>("rodtep");
  const [shippingBill, setShippingBill] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [fobValue, setFobValue] = useState("");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [filingDate, setFilingDate] = useState("");
  const [refNo, setRefNo] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setScheme("rodtep");
    setShippingBill("");
    setInvoiceRef("");
    setCurrency("INR");
    setFobValue("");
    setRate("");
    setAmount("");
    setFilingDate("");
    setRefNo("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createIncentive({
        scheme,
        shipping_bill_no: shippingBill || null,
        invoice_ref: invoiceRef || null,
        currency_code: currency || null,
        fob_value: Number(fobValue) || 0,
        incentive_rate: Number(rate) || 0,
        incentive_amount: Number(amount) || 0,
        filing_date: filingDate || null,
        reference_no: refNo || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Incentive claim created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: IncentiveStatus) {
    startTransition(async () => {
      const result = await setIncentiveStatus(id, status);
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
      const result = await deleteIncentive(id);
      if (result.ok) {
        success("Claim removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ExportIncentiveFile>[] = [
    { header: "Code", cell: (f) => <span className="font-mono text-xs font-medium">{f.code ?? "—"}</span> },
    { header: "Scheme", cell: (f) => <span className="text-sm">{SCHEME_LABELS[f.scheme]}</span> },
    { header: "Shipping bill", cell: (f) => <span className="font-mono text-xs text-muted-foreground">{f.shipping_bill_no ?? "—"}</span> },
    {
      header: "Incentive",
      align: "right",
      cell: (f) => (
        <span className="tabular-nums text-sm">
          {fmtMoney(f.incentive_amount, f.currency_code)}
          {f.incentive_rate ? <span className="ml-1 text-xs text-muted-foreground">@{f.incentive_rate}%</span> : null}
        </span>
      ),
    },
    { header: "Filed", cell: (f) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(f.filing_date)}</span> },
    {
      header: "Status",
      cell: (f) =>
        canEdit ? (
          <Select
            value={f.status}
            onChange={(e) => handleStatus(f.id, e.target.value as IncentiveStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Incentive status"
          >
            {INCENTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INCENTIVE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={incentiveStatusTone(f.status)}>{INCENTIVE_STATUS_LABELS[f.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (f: ExportIncentiveFile) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(f.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<ExportIncentiveFile>,
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
            <Button onClick={() => setFormOpen(true)}>New claim</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New export-incentive claim</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="in-scheme">Scheme</Label>
                <Select id="in-scheme" value={scheme} onChange={(e) => setScheme(e.target.value as IncentiveScheme)}>
                  {INCENTIVE_SCHEMES.map((s) => (
                    <option key={s} value={s}>
                      {SCHEME_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-sb">Shipping bill no.</Label>
                <Input id="in-sb" value={shippingBill} onChange={(e) => setShippingBill(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="in-inv">Invoice ref</Label>
                <Input id="in-inv" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="in-cur">Currency</Label>
                <Select id="in-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="in-fob">FOB value</Label>
                <Input id="in-fob" type="number" min="0" step="0.01" value={fobValue} onChange={(e) => setFobValue(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="in-rate">Rate %</Label>
                <Input id="in-rate" type="number" min="0" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="in-amt">Incentive amount</Label>
                <Input id="in-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="in-file">Filing date</Label>
                <Input id="in-file" type="date" value={filingDate} onChange={(e) => setFilingDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="in-ref">Reference no.</Label>
                <Input id="in-ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="in-rem">Remarks</Label>
                <Input id="in-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating…" : "Create claim"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={files}
        getKey={(f) => f.id}
        empty="No export-incentive claims yet."
      />
    </div>
  );
}
