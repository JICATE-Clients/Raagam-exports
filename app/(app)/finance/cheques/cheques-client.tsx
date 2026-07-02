"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCheque, setChequeStatus, deleteCheque } from "@/lib/finance/cheques/actions";
import {
  CHEQUE_DIRECTIONS,
  CHEQUE_DIRECTION_LABELS,
  CHEQUE_STATUSES,
  CHEQUE_STATUS_LABELS,
  chequeStatusTone,
  type Cheque,
  type ChequeDirection,
  type ChequeStatus,
} from "@/lib/finance/cheques/types";
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
  cheques: Cheque[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ChequesClient({ cheques, currencies, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [partyName, setPartyName] = useState("");
  const [direction, setDirection] = useState<ChequeDirection>("outgoing");
  const [currency, setCurrency] = useState("INR");
  const [amount, setAmount] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setChequeNumber("");
    setBankName("");
    setPartyName("");
    setDirection("outgoing");
    setCurrency("INR");
    setAmount("");
    setChequeDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createCheque({
        cheque_number: chequeNumber || null,
        bank_name: bankName || null,
        party_name: partyName || null,
        direction,
        currency_code: currency || null,
        amount: Number(amount) || 0,
        cheque_date: chequeDate || null,
        cleared_date: null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Cheque added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: ChequeStatus) {
    startTransition(async () => {
      const result = await setChequeStatus(id, status);
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
      const result = await deleteCheque(id);
      if (result.ok) {
        success("Cheque removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<Cheque>[] = [
    { header: "Code", cell: (c) => <span className="font-mono text-xs font-medium">{c.code ?? "—"}</span> },
    { header: "Cheque no.", cell: (c) => <span className="font-mono text-xs">{c.cheque_number ?? "—"}</span> },
    { header: "Party", cell: (c) => <span className="text-sm">{c.party_name ?? "—"}</span> },
    {
      header: "Dir.",
      cell: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.direction === "outgoing" ? "Out" : "In"}
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (c) => <span className="tabular-nums text-sm">{fmtMoney(c.amount, c.currency_code)}</span>,
    },
    { header: "Cheque date", cell: (c) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(c.cheque_date)}</span> },
    {
      header: "Status",
      cell: (c) =>
        canEdit ? (
          <Select
            value={c.status}
            onChange={(e) => handleStatus(c.id, e.target.value as ChequeStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Cheque status"
          >
            {CHEQUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CHEQUE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={chequeStatusTone(c.status)}>{CHEQUE_STATUS_LABELS[c.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (c: Cheque) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<Cheque>,
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
            <Button onClick={() => setFormOpen(true)}>New cheque</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New cheque</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="ch-no">Cheque number</Label>
                <Input id="ch-no" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ch-bank">Bank</Label>
                <Input id="ch-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ch-party">Party (payee / drawer)</Label>
                <Input id="ch-party" value={partyName} onChange={(e) => setPartyName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ch-dir">Direction</Label>
                <Select id="ch-dir" value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection)}>
                  {CHEQUE_DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {CHEQUE_DIRECTION_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ch-cur">Currency</Label>
                <Select id="ch-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ch-amt">Amount</Label>
                <Input id="ch-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="ch-date">Cheque date</Label>
                <Input id="ch-date" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ch-rem">Remarks</Label>
                <Input id="ch-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Adding…" : "Add cheque"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={cheques}
        getKey={(c) => c.id}
        empty="No cheques recorded yet."
      />
    </div>
  );
}
