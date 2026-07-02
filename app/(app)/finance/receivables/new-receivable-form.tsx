"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createReceivable } from "@/lib/finance/ar-actions";
import { forexToInr } from "@/lib/finance/calc";
import { fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

interface Props {
  buyers: { id: string; name: string; currency_code: string | null }[];
  shipments: { id: string; code: string | null; buyer_id: string | null }[];
  currencies: { code: string; name: string }[];
}

export function NewReceivableForm({ buyers, shipments, currencies }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [buyerId, setBuyerId] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currencyCode, setCurrencyCode] = useState(currencies[0]?.code ?? "GBP");
  const [amountFc, setAmountFc] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [notes, setNotes] = useState("");

  const parsedAmount = parseFloat(amountFc) || 0;
  const parsedRate = parseFloat(exchangeRate) || 0;
  const liveInr = parsedAmount > 0 && parsedRate > 0
    ? forexToInr(parsedAmount, parsedRate)
    : null;

  // Narrow shipment list to the selected buyer
  const filteredShipments = buyerId
    ? shipments.filter((s) => s.buyer_id === buyerId)
    : shipments;

  function resetForm() {
    setBuyerId("");
    setShipmentId("");
    setInvoiceNo("");
    setInvoiceDate("");
    setDueDate("");
    setCurrencyCode(currencies[0]?.code ?? "GBP");
    setAmountFc("");
    setExchangeRate("");
    setNotes("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleBuyerChange(id: string) {
    setBuyerId(id);
    setShipmentId(""); // reset shipment when buyer changes
    // Pre-select buyer's default currency if available
    const buyer = buyers.find((b) => b.id === id);
    if (buyer?.currency_code) setCurrencyCode(buyer.currency_code);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createReceivable({
        buyer_id: buyerId || null,
        shipment_id: shipmentId || null,
        invoice_no: invoiceNo || null,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        currency_code: currencyCode || null,
        amount_fc: parseFloat(amountFc) || 0,
        exchange_rate: parseFloat(exchangeRate) || 1,
        location_id: null,
        notes: notes || null,
      });

      if (result.ok) {
        success("Invoice created");
        router.push(`/finance/receivables/${result.receivableId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New invoice</Button>
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
          <CardTitle>New receivable invoice</CardTitle>
        </CardHeader>

        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Buyer + shipment */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="nr-buyer">Buyer</Label>
                <Select
                  id="nr-buyer"
                  value={buyerId}
                  onChange={(e) => handleBuyerChange(e.target.value)}
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
                <Label htmlFor="nr-shipment">Shipment (optional)</Label>
                <Select
                  id="nr-shipment"
                  value={shipmentId}
                  onChange={(e) => setShipmentId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {filteredShipments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code ?? s.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
                {buyerId && filteredShipments.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No shipped/delivered shipments for this buyer.
                  </p>
                )}
              </div>
            </div>

            {/* Invoice reference + dates */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="nr-invoice-no">Invoice no.</Label>
                <Input
                  id="nr-invoice-no"
                  placeholder="e.g. INV-2024-001"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nr-invoice-date">Invoice date</Label>
                <Input
                  id="nr-invoice-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nr-due-date">Due date</Label>
                <Input
                  id="nr-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            {/* Currency + amount + rate with live INR preview */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="nr-currency">Currency</Label>
                <Select
                  id="nr-currency"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="nr-amount">Amount ({currencyCode})</Label>
                <Input
                  id="nr-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amountFc}
                  onChange={(e) => setAmountFc(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nr-rate">
                  Exchange rate (1 {currencyCode} = ? INR)
                </Label>
                <Input
                  id="nr-rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="e.g. 106.50"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                />
              </div>
            </div>

            {liveInr != null && (
              <p className="text-sm text-muted-foreground">
                INR equivalent:{" "}
                <span className="font-semibold text-foreground">
                  {fmtMoney(liveInr)}
                </span>
              </p>
            )}

            {/* Notes */}
            <div>
              <Label htmlFor="nr-notes">Notes</Label>
              <Textarea
                id="nr-notes"
                placeholder="Optional notes…"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create invoice"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
