"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createOtherEntry, deleteOtherEntry } from "@/lib/finance/other-entries/actions";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  entryTypeTone,
  type OtherEntry,
  type EntryType,
} from "@/lib/finance/other-entries/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
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
  entries: OtherEntry[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canExport: boolean;
  canDelete: boolean;
}

export function OtherEntriesClient({ entries, currencies, canCreate, canExport, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [entryDate, setEntryDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setEntryType("expense");
    setCategory("");
    setDescription("");
    setAmount("");
    setCurrency("INR");
    setEntryDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createOtherEntry({
        entry_type: entryType,
        category: category || null,
        description: description.trim(),
        amount: Number(amount) || 0,
        currency_code: currency || null,
        entry_date: entryDate || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Entry recorded");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteOtherEntry(id);
      if (result.ok) {
        success("Entry removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<OtherEntry>[] = [
    { header: "Code", cell: (e) => <span className="font-mono text-xs font-medium">{e.code ?? "—"}</span> },
    {
      header: "Type",
      cell: (e) => <StatusPill tone={entryTypeTone(e.entry_type)}>{ENTRY_TYPE_LABELS[e.entry_type]}</StatusPill>,
    },
    { header: "Category", cell: (e) => <span className="text-sm text-muted-foreground">{e.category ?? "—"}</span> },
    { header: "Description", cell: (e) => <span className="text-sm font-medium">{e.description}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (e) => (
        <span className={`tabular-nums text-sm ${e.entry_type === "income" ? "text-success" : ""}`}>
          {fmtMoney(e.amount, e.currency_code)}
        </span>
      ),
    },
    { header: "Date", cell: (e) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(e.entry_date)}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (e: OtherEntry) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(e.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<OtherEntry>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="other_income_expenses" rows={entries} canExport={canExport} />

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
            <CardTitle>New income / expense entry</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="oe-type">Type</Label>
                <Select id="oe-type" value={entryType} onChange={(e) => setEntryType(e.target.value as EntryType)}>
                  {ENTRY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ENTRY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="oe-cat">Category</Label>
                <Input id="oe-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Bank charges" />
              </div>
              <div>
                <Label htmlFor="oe-desc">Description *</Label>
                <Input id="oe-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="oe-amt">Amount</Label>
                <Input id="oe-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="oe-cur">Currency</Label>
                <Select id="oe-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="oe-date">Date</Label>
                <Input id="oe-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="oe-rem">Remarks</Label>
                <Input id="oe-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !description.trim()}>
                  {isPending ? "Saving…" : "Record entry"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={entries}
        getKey={(e) => e.id}
        empty="No other income / expense entries yet."
      />
    </div>
  );
}
