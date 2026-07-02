"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createBudget } from "@/lib/planning/budget-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { Currency } from "@/lib/masters/types";
import type { OrderForPicker } from "@/lib/planning/budget-service";

interface Props {
  currencies: Currency[];
  orders: OrderForPicker[];
}

export function NewBudgetForm({ currencies, orders }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [name, setName] = useState("");
  const [isGrouped, setIsGrouped] = useState(false);
  const [currencyCode, setCurrencyCode] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [singleOrderId, setSingleOrderId] = useState("");

  function reset() {
    setName("");
    setIsGrouped(false);
    setCurrencyCode("");
    setNotes("");
    setSelectedOrderIds([]);
    setSingleOrderId("");
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  function toggleGrouped() {
    setIsGrouped((v) => !v);
    setSelectedOrderIds([]);
    setSingleOrderId("");
  }

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const sales_order_ids = isGrouped
      ? selectedOrderIds
      : singleOrderId
        ? [singleOrderId]
        : [];

    startTransition(async () => {
      const result = await createBudget({
        name,
        is_grouped: isGrouped,
        currency_code: currencyCode || null,
        notes: notes || null,
        sales_order_ids,
      });
      if (result.ok) {
        success("Budget created");
        router.push(`/planning/budgets/${result.budgetId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New budget</Button>
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
          <CardTitle>New budget</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="bname">Budget name</Label>
                <Input
                  id="bname"
                  placeholder="e.g. Spring 2026 Fabric Budget"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="bcurrency">Currency</Label>
                <Select
                  id="bcurrency"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                >
                  <option value="">— select currency —</option>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Grouped toggle */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={isGrouped}
                onClick={toggleGrouped}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isGrouped ? "bg-primary" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                    isGrouped ? "translate-x-[1.25rem]" : "translate-x-[0.125rem]"
                  }`}
                />
              </button>
              <Label className="mb-0 cursor-pointer" onClick={toggleGrouped}>
                Grouped budget{" "}
                <span className="text-muted-foreground font-normal">
                  (covers multiple orders)
                </span>
              </Label>
            </div>

            {/* Order selection */}
            {isGrouped ? (
              <div>
                <Label>Orders (select one or more)</Label>
                <div className="mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-surface">
                  {orders.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      No orders available
                    </p>
                  ) : (
                    orders.map((o) => (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 hover:bg-surface-muted"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.includes(o.id)}
                          onChange={() => toggleOrder(o.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className="text-sm">
                          <span className="font-medium">
                            {o.order_number ?? o.id.slice(0, 8)}
                          </span>
                          {o.buyer_name && (
                            <span className="ml-1 text-muted-foreground">
                              — {o.buyer_name}
                            </span>
                          )}
                          <span className="ml-1 tabular-nums text-muted-foreground">
                            ({o.order_qty.toLocaleString("en-IN")} pcs)
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {selectedOrderIds.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Select at least one order
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label htmlFor="sorder">Order</Label>
                <Select
                  id="sorder"
                  value={singleOrderId}
                  onChange={(e) => setSingleOrderId(e.target.value)}
                  required
                >
                  <option value="">— select order —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number ?? o.id.slice(0, 8)}
                      {o.buyer_name ? ` — ${o.buyer_name}` : ""}
                      {` (${o.order_qty.toLocaleString("en-IN")} pcs)`}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="bnotes">Notes (optional)</Label>
              <Textarea
                id="bnotes"
                rows={2}
                placeholder="Any remarks…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create budget"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
