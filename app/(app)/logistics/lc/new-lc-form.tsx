"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createLc } from "@/lib/logistics/lc/actions";
import type { BuyerOption, CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

interface Props {
  buyers: BuyerOption[];
  currencies: CurrencyOption[];
}

export function NewLcForm({ buyers, currencies }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [lcNumber, setLcNumber] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [latestShip, setLatestShip] = useState("");
  const [terms, setTerms] = useState("");

  function handleClose() {
    setOpen(false);
    setLcNumber("");
    setBuyerId("");
    setBankName("");
    setAmount("");
    setCurrency("USD");
    setIssueDate("");
    setExpiryDate("");
    setLatestShip("");
    setTerms("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLc({
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
        success("LC created");
        router.push(`/logistics/lc/${result.lcId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New LC</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Letter of Credit</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="lc-no">LC number</Label>
                <Input id="lc-no" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} placeholder="e.g. LC0012345" />
              </div>
              <div>
                <Label htmlFor="lc-buyer">Buyer</Label>
                <Select id="lc-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lc-bank">Issuing bank</Label>
                <Input id="lc-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HSBC London" />
              </div>
              <div>
                <Label htmlFor="lc-amt">Amount</Label>
                <Input id="lc-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="lc-cur">Currency</Label>
                <Select id="lc-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lc-issue">Issue date</Label>
                <Input id="lc-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lc-exp">Expiry date</Label>
                <Input id="lc-exp" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lc-ship">Latest shipment date</Label>
                <Input id="lc-ship" type="date" value={latestShip} onChange={(e) => setLatestShip(e.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="lc-terms">Terms</Label>
                <Textarea id="lc-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} placeholder="Optional terms…" />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create LC"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
