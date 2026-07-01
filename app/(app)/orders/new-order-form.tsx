"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrder } from "@/lib/orders/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { QuoteWithContext } from "@/lib/orders/service";
import type { Buyer } from "@/lib/masters/types";

type Location = { id: string; code: string; name: string };

type LineRow = { color: string; size: string; quantity: string };

interface Props {
  quotes: QuoteWithContext[];
  buyers: Pick<Buyer, "id" | "name" | "code" | "currency_code">[];
  locations: Location[];
}

export function NewOrderForm({ quotes, buyers, locations }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // form mode
  const [mode, setMode] = useState<"quote" | "manual">("quote");

  // quote-based fields
  const [selectedQuoteId, setSelectedQuoteId] = useState("");

  // manual / common fields
  const [buyerId, setBuyerId] = useState("");
  const [fobPrice, setFobPrice] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [locationId, setLocationId] = useState("");
  const [shipDate, setShipDate] = useState("");

  // line items
  const [lines, setLines] = useState<LineRow[]>([]);

  function resetForm() {
    setMode("quote");
    setSelectedQuoteId("");
    setBuyerId("");
    setFobPrice("");
    setOrderQty("");
    setCurrencyCode("USD");
    setLocationId("");
    setShipDate("");
    setLines([]);
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  // When a quote is picked, prefill editable fields
  function handleQuoteSelect(quoteId: string) {
    setSelectedQuoteId(quoteId);
    const q = quotes.find((q) => q.id === quoteId);
    if (!q) return;
    setBuyerId(q.buyer_id);
    setFobPrice(String(q.fob_price));
    setOrderQty(String(q.quantity ?? ""));
    setCurrencyCode(q.currency_code ?? "USD");
  }

  function addLine() {
    setLines((ls) => [...ls, { color: "", size: "", quantity: "" }]);
  }

  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof LineRow, val: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const selectedQuote = quotes.find((q) => q.id === selectedQuoteId);

    const payload = {
      buyer_id: buyerId,
      opportunity_id: selectedQuote?.opportunity_id ?? null,
      quote_id: mode === "quote" && selectedQuoteId ? selectedQuoteId : null,
      location_id: locationId || null,
      currency_code: currencyCode || null,
      fob_price: parseFloat(fobPrice) || 0,
      order_qty: parseFloat(orderQty) || 0,
      ship_date: shipDate || null,
      baseline_fob: selectedQuote ? selectedQuote.fob_price : undefined,
      lines: lines
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          color: l.color || null,
          size: l.size || null,
          quantity: Number(l.quantity),
        })),
    };

    startTransition(async () => {
      const result = await createOrder(payload);
      if (result.ok) {
        success("Order created");
        router.push(`/orders/${result.orderId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New order</Button>
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
          <CardTitle>New sales order</CardTitle>
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("quote")}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                mode === "quote"
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              From accepted quote
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                mode === "manual"
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Manual entry
            </button>
          </div>
        </CardHeader>

        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "quote" && (
              <div>
                <Label htmlFor="quote">Accepted quote</Label>
                <Select
                  id="quote"
                  value={selectedQuoteId}
                  onChange={(e) => handleQuoteSelect(e.target.value)}
                  required
                >
                  <option value="">— select quote —</option>
                  {quotes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.code ?? q.id.slice(0, 8)} — {q.buyers?.name ?? "?"} (
                      {q.currency_code} {q.fob_price})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Buyer (editable even when quote mode) */}
              <div>
                <Label htmlFor="buyer">Buyer</Label>
                <Select
                  id="buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  required
                >
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="location">Location</Label>
                <Select
                  id="location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">— select location —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="fob">FOB price</Label>
                <Input
                  id="fob"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={fobPrice}
                  onChange={(e) => setFobPrice(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="qty">Order quantity</Label>
                <Input
                  id="qty"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={orderQty}
                  onChange={(e) => setOrderQty(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  placeholder="USD"
                  maxLength={3}
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                />
              </div>

              <div>
                <Label htmlFor="ship">Ship date</Label>
                <Input
                  id="ship"
                  type="date"
                  value={shipDate}
                  onChange={(e) => setShipDate(e.target.value)}
                />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">Line items (optional)</Label>
                <Button type="button" variant="subtle" size="sm" onClick={addLine}>
                  + Add line
                </Button>
              </div>

              {lines.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                          Colour
                        </th>
                        <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                          Size
                        </th>
                        <th className="px-3 py-1.5 text-right text-xs font-semibold text-muted-foreground">
                          Qty
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-1">
                            <Input
                              placeholder="e.g. Navy"
                              value={l.color}
                              onChange={(e) => updateLine(i, "color", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              placeholder="e.g. M"
                              value={l.size}
                              onChange={(e) => updateLine(i, "size", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </td>
                          <td className="px-3 py-1">
                            <Input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={l.quantity}
                              onChange={(e) => updateLine(i, "quantity", e.target.value)}
                              className="h-7 text-right text-xs"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              onClick={() => removeLine(i)}
                              className="text-muted-foreground hover:text-danger"
                              aria-label="Remove line"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create order"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
