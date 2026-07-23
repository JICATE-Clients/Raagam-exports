"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLc, setLcStatus, deleteLc } from "@/lib/logistics/lc/actions";
import {
  LC_STATUS_LABELS,
  lcStatusTone,
  type LcStatus,
} from "@/lib/logistics/lc/types";
import type { LcWithBuyer } from "@/lib/logistics/lc/service";
import type { BuyerOption, CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  lc: LcWithBuyer;
  buyers: BuyerOption[];
  currencies: CurrencyOption[];
  canEdit: boolean;
  canDelete: boolean;
}

export function LcDetailClient({ lc, buyers, currencies, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const [lcNumber, setLcNumber] = useState(lc.lc_number ?? "");
  const [buyerId, setBuyerId] = useState(lc.buyer_id ?? "");
  const [bankName, setBankName] = useState(lc.bank_name ?? "");
  const [amount, setAmount] = useState(String(lc.amount ?? ""));
  const [currency, setCurrency] = useState(lc.currency_code ?? "USD");
  const [issueDate, setIssueDate] = useState(lc.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(lc.expiry_date ?? "");
  const [latestShip, setLatestShip] = useState(lc.latest_shipment_date ?? "");
  const [terms, setTerms] = useState(lc.terms ?? "");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateLc(lc.id, {
        lc_number: lcNumber || null,
        buyer_id: buyerId || null,
        bank_name: bankName || null,
        amount: Number(amount) || 0,
        currency_code: currency || null,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
        latest_shipment_date: latestShip || null,
        terms: terms || null,
      });
      if (result.ok) {
        success("LC updated");
        setEditing(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function changeStatus(status: LcStatus, msg: string) {
    startTransition(async () => {
      const result = await setLcStatus(lc.id, status);
      if (result.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLc(lc.id);
      if (result.ok) {
        success("LC deleted");
        router.push("/logistics/lc");
      } else {
        toastError(result.error);
      }
    });
  }

  const isOpen = lc.status === "active" || lc.status === "amended";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Letter of Credit</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={lcStatusTone(lc.status)}>
            {LC_STATUS_LABELS[lc.status]}
          </StatusPill>
          {canEdit && lc.status === "draft" && (
            <Button size="sm" onClick={() => changeStatus("active", "LC activated")} disabled={isPending}>
              Activate
            </Button>
          )}
          {canEdit && isOpen && (
            <>
              <Button size="sm" variant="subtle" onClick={() => changeStatus("amended", "Marked amended")} disabled={isPending}>
                Mark amended
              </Button>
              <Button size="sm" variant="outline" onClick={() => changeStatus("closed", "LC closed")} disabled={isPending}>
                Close
              </Button>
              <Button size="sm" variant="danger" onClick={() => changeStatus("expired", "Marked expired")} disabled={isPending}>
                Expired
              </Button>
            </>
          )}
          {canEdit && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={isPending}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" onClick={handleDelete} disabled={isPending} className="text-danger hover:opacity-80">
              Delete
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="e-no">LC number</Label>
                <Input id="e-no" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="e-buyer">Buyer</Label>
                <Select id="e-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">— select —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="e-bank">Issuing bank</Label>
                <Input id="e-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="e-amt">Amount</Label>
                <Input id="e-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="e-cur">Currency</Label>
                <Select id="e-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="e-issue">Issue date</Label>
                <Input id="e-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="e-exp">Expiry date</Label>
                <Input id="e-exp" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="e-ship">Latest shipment</Label>
                <Input id="e-ship" type="date" value={latestShip} onChange={(e) => setLatestShip(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="e-terms">Terms</Label>
                <Textarea id="e-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">LC number</dt>
              <dd className="font-mono font-medium">{lc.lc_number ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{lc.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Issuing bank</dt>
              <dd className="font-medium">{lc.bank_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(lc.amount, lc.currency_code)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Issue date</dt>
              <dd className="tabular-nums font-medium">{fmtDate(lc.issue_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expiry date</dt>
              <dd className="tabular-nums font-medium">{fmtDate(lc.expiry_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Latest shipment</dt>
              <dd className="tabular-nums font-medium">{fmtDate(lc.latest_shipment_date)}</dd>
            </div>
            {lc.terms && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Terms</dt>
                <dd className="text-sm">{lc.terms}</dd>
              </div>
            )}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
