"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createExchangeRate,
  deleteExchangeRate,
} from "@/lib/finance/exchange-rates/actions";
import { gainLoss, type ExchangeRateDetail } from "@/lib/finance/exchange-rates/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  rates: ExchangeRateDetail[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canExport: boolean;
  canDelete: boolean;
}

export function ExchangeRatesClient({ rates, currencies, canCreate, canExport, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const [foreignAmount, setForeignAmount] = useState("");
  const [bookedRate, setBookedRate] = useState("");
  const [actualRate, setActualRate] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [remarks, setRemarks] = useState("");

  const preview = gainLoss({
    foreign_amount: Number(foreignAmount) || 0,
    booked_rate: Number(bookedRate) || 0,
    actual_rate: Number(actualRate) || 0,
  });

  function resetForm() {
    setCurrency("USD");
    setReference("");
    setForeignAmount("");
    setBookedRate("");
    setActualRate("");
    setRateDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createExchangeRate({
        currency_code: currency || null,
        reference: reference || null,
        foreign_amount: Number(foreignAmount) || 0,
        booked_rate: Number(bookedRate) || 0,
        actual_rate: Number(actualRate) || 0,
        rate_date: rateDate || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Rate detail saved");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteExchangeRate(id);
      if (result.ok) {
        success("Removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ExchangeRateDetail>[] = [
    { header: "Currency", cell: (r) => <span className="text-sm font-medium">{r.currency_code ?? "—"}</span> },
    { header: "Reference", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.reference ?? "—"}</span> },
    { header: "Foreign amt", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.foreign_amount)}</span> },
    { header: "Booked", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.booked_rate)}</span> },
    { header: "Actual", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.actual_rate)}</span> },
    {
      header: "Gain / Loss",
      align: "right",
      cell: (r) => {
        const gl = gainLoss(r);
        return (
          <span className={`tabular-nums text-sm font-semibold ${gl >= 0 ? "text-success" : "text-danger"}`}>
            {gl >= 0 ? "+" : ""}
            {fmtNumber(gl)}
          </span>
        );
      },
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.rate_date)}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (r: ExchangeRateDetail) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<ExchangeRateDetail>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="exchange_rate_details" rows={rates} canExport={canExport} />

      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New rate detail</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New exchange-rate detail</CardTitle>
            <span className="text-sm text-muted-foreground">
              Gain/Loss:{" "}
              <strong className={preview >= 0 ? "text-success" : "text-danger"}>
                {preview >= 0 ? "+" : ""}
                {fmtNumber(preview)}
              </strong>
            </span>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="er-cur">Currency</Label>
                <Select id="er-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="er-ref">Reference</Label>
                <Input id="er-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice / receipt ref" />
              </div>
              <div>
                <Label htmlFor="er-amt">Foreign amount</Label>
                <Input id="er-amt" type="number" min="0" step="0.01" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="er-booked">Booked rate</Label>
                <Input id="er-booked" type="number" min="0" step="0.0001" value={bookedRate} onChange={(e) => setBookedRate(e.target.value)} placeholder="0.0000" />
              </div>
              <div>
                <Label htmlFor="er-actual">Actual rate</Label>
                <Input id="er-actual" type="number" min="0" step="0.0001" value={actualRate} onChange={(e) => setActualRate(e.target.value)} placeholder="0.0000" />
              </div>
              <div>
                <Label htmlFor="er-date">Date</Label>
                <Input id="er-date" type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="er-rem">Remarks</Label>
                <Input id="er-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving…" : "Save detail"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={rates}
        getKey={(r) => r.id}
        empty="No exchange-rate details yet."
      />
    </div>
  );
}
