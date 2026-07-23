"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createProforma } from "@/lib/logistics/proforma/actions";
import type { BuyerOption, CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

const INCOTERMS = ["FOB", "CIF", "CFR", "EXW", "DDP", "DAP"];

interface Props {
  buyers: BuyerOption[];
  currencies: CurrencyOption[];
}

export function NewProformaForm({ buyers, currencies }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [buyerId, setBuyerId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [incoterm, setIncoterm] = useState("FOB");
  const [issueDate, setIssueDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setBuyerId("");
    setCurrency("USD");
    setIncoterm("FOB");
    setIssueDate("");
    setValidUntil("");
    setRemarks("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createProforma({
        buyer_id: buyerId,
        currency_code: currency || null,
        incoterm: incoterm || null,
        issue_date: issueDate || null,
        valid_until: validUntil || null,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Proforma invoice created");
        router.push(`/logistics/proforma/${result.proformaId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New proforma</Button>
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
          <CardTitle>New proforma invoice</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="pi-buyer">Buyer *</Label>
                <Select
                  id="pi-buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  required
                >
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pi-cur">Currency</Label>
                <Select
                  id="pi-cur"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pi-inco">Incoterm</Label>
                <Input
                  id="pi-inco"
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value.toUpperCase())}
                  list="pi-incoterms"
                  placeholder="FOB"
                />
                <datalist id="pi-incoterms">
                  {INCOTERMS.map((i) => (
                    <option key={i} value={i} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="pi-issue">Issue date</Label>
                <Input
                  id="pi-issue"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pi-valid">Valid until</Label>
                <Input
                  id="pi-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="pi-remarks">Remarks</Label>
                <Textarea
                  id="pi-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Optional…"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create proforma"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
