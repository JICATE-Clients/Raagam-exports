"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createBankLimit, deleteBankLimit } from "@/lib/finance/bank-limits/actions";
import {
  FACILITY_TYPES,
  FACILITY_TYPE_LABELS,
  type BankLimit,
  type FacilityType,
} from "@/lib/finance/bank-limits/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  limits: BankLimit[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canDelete: boolean;
}

export function BankLimitsClient({ limits, currencies, canCreate, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [bankName, setBankName] = useState("");
  const [facilityType, setFacilityType] = useState<FacilityType>("cc");
  const [limitAmount, setLimitAmount] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [validUntil, setValidUntil] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setBankName("");
    setFacilityType("cc");
    setLimitAmount("");
    setInterestRate("");
    setCurrency("INR");
    setValidUntil("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createBankLimit({
        bank_name: bankName.trim(),
        facility_type: facilityType,
        limit_amount: Number(limitAmount) || 0,
        interest_rate: Number(interestRate) || 0,
        currency_code: currency || null,
        valid_until: validUntil || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Bank limit saved");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteBankLimit(id);
      if (result.ok) {
        success("Removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<BankLimit>[] = [
    { header: "Bank", cell: (l) => <span className="text-sm font-medium">{l.bank_name}</span> },
    { header: "Facility", cell: (l) => <span className="text-sm">{FACILITY_TYPE_LABELS[l.facility_type]}</span> },
    { header: "Limit", align: "right", cell: (l) => <span className="tabular-nums text-sm">{fmtMoney(l.limit_amount, l.currency_code)}</span> },
    { header: "Interest", align: "right", cell: (l) => <span className="tabular-nums text-sm">{l.interest_rate}%</span> },
    { header: "Valid until", cell: (l) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(l.valid_until)}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (l: BankLimit) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(l.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<BankLimit>,
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
            <Button onClick={() => setFormOpen(true)}>New limit</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New bank limit</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="bl-bank">Bank *</Label>
                <Input id="bl-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} required placeholder="e.g. HDFC Bank" />
              </div>
              <div>
                <Label htmlFor="bl-type">Facility</Label>
                <Select id="bl-type" value={facilityType} onChange={(e) => setFacilityType(e.target.value as FacilityType)}>
                  {FACILITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FACILITY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="bl-limit">Limit amount</Label>
                <Input id="bl-limit" type="number" min="0" step="0.01" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="bl-int">Interest rate %</Label>
                <Input id="bl-int" type="number" min="0" step="0.001" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="bl-cur">Currency</Label>
                <Select id="bl-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="bl-valid">Valid until</Label>
                <Input id="bl-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bl-rem">Remarks</Label>
                <Input id="bl-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !bankName.trim()}>
                  {isPending ? "Saving…" : "Save limit"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={limits}
        getKey={(l) => l.id}
        empty="No bank limits yet."
      />
    </div>
  );
}
