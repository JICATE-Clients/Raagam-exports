"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createPurchaseOrder, fetchBudgetLines } from "@/lib/purchase/po-actions";
import type { PurchaseOrderInput, PoLineInput } from "@/lib/purchase/types";
import type {
  VendorForPicker,
  BudgetForPicker,
  LocationForPicker,
} from "@/lib/purchase/po-service";
import type { Currency } from "@/lib/masters/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

type PoLineFields = {
  description: string;
  quantity: string;
  unit_price: string;
};

function emptyLine(): PoLineFields {
  return { description: "", quantity: "1", unit_price: "0" };
}

export function NewPoForm({
  vendors,
  budgets,
  currencies,
  locations,
}: {
  vendors: VendorForPicker[];
  budgets: BudgetForPicker[];
  currencies: Currency[];
  locations: LocationForPicker[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [show, setShow] = useState(false);
  useCreateIntent(() => setShow(true));

  // header fields
  const [vendorId, setVendorId] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");

  // lines
  const [lines, setLines] = useState<PoLineFields[]>([emptyLine()]);
  const [loadingBudgetLines, setLoadingBudgetLines] = useState(false);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof PoLineFields, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
    );
  }

  async function handleBudgetChange(newBudgetId: string) {
    setBudgetId(newBudgetId);
    if (!newBudgetId) {
      setLines([emptyLine()]);
      return;
    }

    // prefill lines from approved budget
    setLoadingBudgetLines(true);
    try {
      const budgetLines = await fetchBudgetLines(newBudgetId);
      if (budgetLines.length > 0) {
        setLines(
          budgetLines.map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unit_price: String(l.unit_cost),
          })),
        );
      }
    } finally {
      setLoadingBudgetLines(false);
    }
  }

  function reset() {
    setVendorId("");
    setBudgetId("");
    setLocationId("");
    setCurrencyCode("INR");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setExpectedDate("");
    setNotes("");
    setLines([emptyLine()]);
    setShow(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return;

    const poLines: PoLineInput[] = lines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        description: l.description.trim(),
        quantity: parseFloat(l.quantity) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
        item_id: null,
        uom_id: null,
        sort_order: i,
      }));

    const payload: PurchaseOrderInput = {
      vendor_id: vendorId,
      budget_id: budgetId || null,
      rfq_id: null,
      location_id: locationId || null,
      currency_code: currencyCode || null,
      order_date: orderDate || null,
      expected_date: expectedDate || null,
      notes: notes.trim() || null,
      lines: poLines,
    };

    startTransition(async () => {
      const result = await createPurchaseOrder(payload);
      if (result.ok) {
        success("Purchase order created.");
        reset();
        router.push(`/purchase/orders/${result.poId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!show) {
    return (
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShow(true)}>
          + New PO
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Purchase Order</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header fields */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <Label htmlFor="po-vendor">Vendor *</Label>
              <Select
                id="po-vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                required
              >
                <option value="">— Select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>

            {budgets.length > 0 && (
              <div>
                <Label htmlFor="po-budget">From budget (optional)</Label>
                <Select
                  id="po-budget"
                  value={budgetId}
                  onChange={(e) => {
                    void handleBudgetChange(e.target.value);
                  }}
                  disabled={loadingBudgetLines}
                >
                  <option value="">— None —</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code ? `${b.code} — ` : ""}
                      {b.name}
                    </option>
                  ))}
                </Select>
                {loadingBudgetLines && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Loading lines…
                  </p>
                )}
              </div>
            )}

            {locations.length > 0 && (
              <div>
                <Label htmlFor="po-location">Location</Label>
                <Select
                  id="po-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">— Select location —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="po-currency">Currency</Label>
              <Select
                id="po-currency"
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
              <Label htmlFor="po-order-date">Order date</Label>
              <Input
                id="po-order-date"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="po-expected-date">Expected delivery</Label>
              <Input
                id="po-expected-date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2 md:col-span-3">
              <Label htmlFor="po-notes">Notes</Label>
              <Textarea
                id="po-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Terms, delivery instructions…"
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Line items
            </p>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Description *"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(idx, "description", e.target.value)
                      }
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(idx, "quantity", e.target.value)
                      }
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Unit price"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(idx, "unit_price", e.target.value)
                      }
                    />
                  </div>
                  <div className="w-24 text-right tabular-nums text-sm text-muted-foreground">
                    {(
                      (parseFloat(line.quantity) || 0) *
                      (parseFloat(line.unit_price) || 0)
                    ).toFixed(2)}
                  </div>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-danger hover:text-danger"
                      onClick={() => removeLine(idx)}
                    >
                      ×
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={addLine}
            >
              + Add line
            </Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reset}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !vendorId}
            >
              {isPending ? "Creating…" : "Create PO"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
