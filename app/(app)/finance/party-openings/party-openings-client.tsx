"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createPartyOpening,
  deletePartyOpening,
} from "@/lib/finance/party-openings/actions";
import {
  PARTY_TYPES,
  PARTY_TYPE_LABELS,
  BALANCE_TYPES,
  BALANCE_TYPE_LABELS,
  type PartyType,
  type BalanceType,
} from "@/lib/finance/party-openings/types";
import type { PartyOpeningRow } from "@/lib/finance/party-openings/service";
import type { PartyOption } from "@/lib/finance/notes/service";
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
  openings: PartyOpeningRow[];
  vendors: PartyOption[];
  buyers: PartyOption[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canDelete: boolean;
}

export function PartyOpeningsClient({
  openings,
  vendors,
  buyers,
  currencies,
  canCreate,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [partyType, setPartyType] = useState<PartyType>("vendor");
  const [partyId, setPartyId] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [balance, setBalance] = useState("");
  const [balanceType, setBalanceType] = useState<BalanceType>("dr");
  const [asOf, setAsOf] = useState("");
  const [remarks, setRemarks] = useState("");

  const partyChoices = partyType === "vendor" ? vendors : buyers;

  function resetForm() {
    setPartyType("vendor");
    setPartyId("");
    setCurrency("INR");
    setBalance("");
    setBalanceType("dr");
    setAsOf("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createPartyOpening({
        party_type: partyType,
        vendor_id: partyType === "vendor" ? partyId || null : null,
        buyer_id: partyType === "buyer" ? partyId || null : null,
        currency_code: currency || null,
        opening_balance: Number(balance) || 0,
        balance_type: balanceType,
        as_of_date: asOf || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Opening balance saved");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePartyOpening(id);
      if (result.ok) {
        success("Opening removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<PartyOpeningRow>[] = [
    {
      header: "Party",
      cell: (o) => (
        <span className="text-sm font-medium">
          {o.party_type === "vendor" ? o.vendors?.name : o.buyers?.name}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            ({PARTY_TYPE_LABELS[o.party_type]})
          </span>
        </span>
      ),
    },
    {
      header: "Opening balance",
      align: "right",
      cell: (o) => (
        <span className="tabular-nums text-sm">
          {fmtMoney(o.opening_balance, o.currency_code)}{" "}
          <span className="text-xs text-muted-foreground">{o.balance_type.toUpperCase()}</span>
        </span>
      ),
    },
    { header: "As of", cell: (o) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(o.as_of_date)}</span> },
    { header: "Remarks", cell: (o) => <span className="text-xs text-muted-foreground">{o.remarks ?? "—"}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (o: PartyOpeningRow) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(o.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<PartyOpeningRow>,
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
            <Button onClick={() => setFormOpen(true)}>New opening</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New party opening balance</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="po-ptype">Party type</Label>
                <Select
                  id="po-ptype"
                  value={partyType}
                  onChange={(e) => {
                    setPartyType(e.target.value as PartyType);
                    setPartyId("");
                  }}
                >
                  {PARTY_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PARTY_TYPE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="po-party">{PARTY_TYPE_LABELS[partyType]} *</Label>
                <Select id="po-party" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
                  <option value="">— select —</option>
                  {partyChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="po-cur">Currency</Label>
                <Select id="po-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="po-bal">Opening balance</Label>
                <Input id="po-bal" type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="po-btype">Dr / Cr</Label>
                <Select id="po-btype" value={balanceType} onChange={(e) => setBalanceType(e.target.value as BalanceType)}>
                  {BALANCE_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {BALANCE_TYPE_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="po-asof">As of date</Label>
                <Input id="po-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="po-rem">Remarks</Label>
                <Input id="po-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !partyId}>
                  {isPending ? "Saving…" : "Save opening"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={openings}
        getKey={(o) => o.id}
        empty="No party opening balances yet."
      />
    </div>
  );
}
