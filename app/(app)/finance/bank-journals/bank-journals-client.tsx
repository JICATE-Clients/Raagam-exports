"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createBankJournal, deleteBankJournal } from "@/lib/finance/bank-journals/actions";
import {
  BANK_ENTRY_TYPES,
  BANK_ENTRY_TYPE_LABELS,
  entrySign,
  type BankJournal,
  type BankEntryType,
} from "@/lib/finance/bank-journals/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  journals: BankJournal[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canExport: boolean;
  canDelete: boolean;
}

export function BankJournalsClient({ journals, currencies, canCreate, canExport, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [bankName, setBankName] = useState("");
  const [entryType, setEntryType] = useState<BankEntryType>("deposit");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [entryDate, setEntryDate] = useState("");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");

  function resetForm() {
    setBankName("");
    setEntryType("deposit");
    setAmount("");
    setCurrency("INR");
    setEntryDate("");
    setReference("");
    setNarration("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createBankJournal({
        bank_name: bankName || null,
        entry_type: entryType,
        amount: Number(amount) || 0,
        currency_code: currency || null,
        entry_date: entryDate || null,
        reference: reference || null,
        narration: narration || null,
      });
      if (result.ok) {
        success("Journal entry recorded");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteBankJournal(id);
      if (result.ok) {
        success("Entry removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<BankJournal>[] = [
    { header: "Code", cell: (j) => <span className="font-mono text-xs font-medium">{j.code ?? "—"}</span> },
    { header: "Bank", cell: (j) => <span className="text-sm">{j.bank_name ?? "—"}</span> },
    { header: "Type", cell: (j) => <span className="text-sm">{BANK_ENTRY_TYPE_LABELS[j.entry_type]}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (j) => {
        const sign = entrySign(j.entry_type);
        return (
          <span className={`tabular-nums text-sm ${sign > 0 ? "text-success" : sign < 0 ? "text-danger" : ""}`}>
            {sign > 0 ? "+" : sign < 0 ? "−" : ""}
            {fmtMoney(j.amount, j.currency_code)}
          </span>
        );
      },
    },
    { header: "Date", cell: (j) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(j.entry_date)}</span> },
    { header: "Reference", cell: (j) => <span className="text-xs text-muted-foreground">{j.reference ?? "—"}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (j: BankJournal) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(j.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<BankJournal>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="bank_journals" rows={journals} canExport={canExport} />

      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New entry</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New bank journal entry</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="bj-bank">Bank</Label>
                <Input id="bj-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Current A/C" />
              </div>
              <div>
                <Label htmlFor="bj-type">Type</Label>
                <Select id="bj-type" value={entryType} onChange={(e) => setEntryType(e.target.value as BankEntryType)}>
                  {BANK_ENTRY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BANK_ENTRY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="bj-amt">Amount</Label>
                <Input id="bj-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="bj-cur">Currency</Label>
                <Select id="bj-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="bj-date">Date</Label>
                <Input id="bj-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bj-ref">Reference</Label>
                <Input id="bj-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / UTR" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bj-narr">Narration</Label>
                <Input id="bj-narr" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Saving…" : "Record entry"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={journals}
        getKey={(j) => j.id}
        empty="No bank journal entries yet."
      />
    </div>
  );
}
