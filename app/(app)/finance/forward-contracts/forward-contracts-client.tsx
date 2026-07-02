"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createForwardContract,
  setForwardContractStatus,
  deleteForwardContract,
} from "@/lib/finance/forward-contracts/actions";
import {
  FC_STATUSES,
  FC_STATUS_LABELS,
  fcStatusTone,
  utilisedPct,
  type ForwardContract,
  type FcStatus,
} from "@/lib/finance/forward-contracts/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";

interface Props {
  contracts: ForwardContract[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function ForwardContractsClient({
  contracts,
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
  const [contractNumber, setContractNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [utilised, setUtilised] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setContractNumber("");
    setBankName("");
    setCurrency("USD");
    setAmount("");
    setRate("");
    setUtilised("");
    setBookingDate("");
    setMaturityDate("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createForwardContract({
        contract_number: contractNumber || null,
        bank_name: bankName || null,
        currency_code: currency || null,
        amount: Number(amount) || 0,
        forward_rate: Number(rate) || 0,
        utilised_amount: Number(utilised) || 0,
        booking_date: bookingDate || null,
        maturity_date: maturityDate || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Forward contract booked");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: FcStatus) {
    startTransition(async () => {
      const result = await setForwardContractStatus(id, status);
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
      const result = await deleteForwardContract(id);
      if (result.ok) {
        success("Contract removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<ForwardContract>[] = [
    { header: "Code", cell: (c) => <span className="font-mono text-xs font-medium">{c.code ?? "—"}</span> },
    { header: "Contract", cell: (c) => <span className="font-mono text-xs">{c.contract_number ?? "—"}</span> },
    { header: "Bank", cell: (c) => <span className="text-sm text-muted-foreground">{c.bank_name ?? "—"}</span> },
    {
      header: "Cover",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-sm">
          {c.currency_code ?? ""} {fmtNumber(c.amount)}
          {c.forward_rate ? <span className="ml-1 text-xs text-muted-foreground">@{c.forward_rate}</span> : null}
        </span>
      ),
    },
    {
      header: "Utilised",
      cell: (c) => {
        const pct = utilisedPct(c);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">{pct}%</span>
          </div>
        );
      },
    },
    { header: "Maturity", cell: (c) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(c.maturity_date)}</span> },
    {
      header: "Status",
      cell: (c) =>
        canEdit ? (
          <Select
            value={c.status}
            onChange={(e) => handleStatus(c.id, e.target.value as FcStatus)}
            disabled={isPending}
            className="h-7 w-36 text-xs"
            aria-label="Forward contract status"
          >
            {FC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FC_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={fcStatusTone(c.status)}>{FC_STATUS_LABELS[c.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (c: ForwardContract) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<ForwardContract>,
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
            <Button onClick={() => setFormOpen(true)}>New contract</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New forward contract</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="fc-no">Contract number</Label>
                <Input id="fc-no" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fc-bank">Bank</Label>
                <Input id="fc-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fc-cur">Currency</Label>
                <Select id="fc-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="fc-amt">Cover amount</Label>
                <Input id="fc-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="fc-rate">Forward rate</Label>
                <Input id="fc-rate" type="number" min="0" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.0000" />
              </div>
              <div>
                <Label htmlFor="fc-util">Utilised amount</Label>
                <Input id="fc-util" type="number" min="0" step="0.01" value={utilised} onChange={(e) => setUtilised(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="fc-book">Booking date</Label>
                <Input id="fc-book" type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fc-mat">Maturity date</Label>
                <Input id="fc-mat" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fc-rem">Remarks</Label>
                <Input id="fc-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Booking…" : "Book contract"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={contracts}
        getKey={(c) => c.id}
        empty="No forward contracts yet."
      />
    </div>
  );
}
