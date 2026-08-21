"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createPurchaseOrder,
  fetchBudgetLines,
  fetchBomCeiling,
  raiseOverQuantity,
} from "@/lib/purchase/po-actions";
import { blockedMessage, judgeLine, type BomCeiling } from "@/lib/purchase/bom-ceiling";
import type { PurchaseOrderInput, PoLineInput } from "@/lib/purchase/types";
import type {
  VendorForPicker,
  BudgetForPicker,
  LocationForPicker,
  OrderForPicker,
} from "@/lib/purchase/po-service";
import type { Item } from "@/lib/masters/types";
import type { Currency } from "@/lib/masters/types";
import { Button } from "@/components/ui/button";
import { gridKeyNav } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

type PoLineFields = {
  /** The material, so the BOM ceiling has something to key on (0424). It was
   *  hardcoded `null` on this form until then — the column existed and nothing
   *  ever filled it, so a quantity control keyed on it could never have fired. */
  item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
};

function emptyLine(): PoLineFields {
  return { item_id: "", description: "", quantity: "1", unit_price: "0" };
}

export function NewPoForm({
  vendors,
  budgets,
  currencies,
  locations,
  items,
  orders,
}: {
  vendors: VendorForPicker[];
  budgets: BudgetForPicker[];
  currencies: Currency[];
  locations: LocationForPicker[];
  items: Item[];
  orders: OrderForPicker[];
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
  const [poType, setPoType] = useState<"local" | "import">("local");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");

  /**
   * WHICH ORDER THIS PO BUYS FOR (0424).
   *
   * Held once for the whole form and written onto every line, because the COLUMN
   * is per-line and the common PO is for one order. The grain is right where it
   * matters — the detail editor can vary a line later, and one PO covering two
   * orders is a real thing — while the form asks the question once.
   */
  const [orderId, setOrderId] = useState("");
  /** The BOM's plan for that order, fetched once per order. */
  const [ceiling, setCeiling] = useState<BomCeiling | null>(null);
  const [overReason, setOverReason] = useState("");

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
            // A budget line names no material, so the ceiling cannot judge one
            // prefilled from it until the buyer picks one.
            item_id: "",
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
    setOrderId("");
    setCeiling(null);
    setOverReason("");
    setShow(false);
  }

  /**
   * Lines that exceed the BOM's plan, judged by the one rule both sides read
   * (`judgeLine`). Derived per render rather than held in state, so it cannot
   * disagree with the numbers on screen.
   */
  const judged = ceiling
    ? lines.map((line) => ({
        line,
        verdict: judgeLine(ceiling, {
          itemId: line.item_id || null,
          quantity: parseFloat(line.quantity) || 0,
        }),
      }))
    : [];

  const overLines = judged.flatMap((x) =>
    x.verdict.kind === "over"
      ? [{ line: x.line, planned: x.verdict.planned, ordered: x.verdict.ordered }]
      : [],
  );

  /*
   * REFUSED, not merely over — an approved budget stands behind the plan
   * (client 2026-08-21). The server refuses these too and is the real gate; this
   * is so the operator finds out before a round trip, and so the reason box
   * stops asking for a justification that will not be accepted.
   */
  const blockedLines = judged.flatMap((x) =>
    x.verdict.kind === "blocked" ? [{ line: x.line, verdict: x.verdict }] : [],
  );

  const itemName = (id: string | null) =>
    (id ? items.find((i) => i.id === id)?.name : null) ?? null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return;
    /* THE SERVER IS THE GATE; this is so the operator learns before a round
       trip. Both read the same `judgeLine`, so they cannot disagree about which
       lines are refused. */
    if (blockedLines.length > 0) return;

    const poLines: PoLineInput[] = lines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        description: l.description.trim(),
        quantity: parseFloat(l.quantity) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
        item_id: l.item_id || null,
        sales_order_id: orderId || null,
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
      po_type: poType,
      payment_terms: paymentTerms.trim() || null,
    };

    startTransition(async () => {
      const result = await createPurchaseOrder(payload);
      if (result.ok) {
        /**
         * The overage is recorded AFTER the PO exists, not instead of it — the
         * client chose warn-and-record over a hard block. The confirmation is a
         * justification document routed through submit/approve, exactly as
         * `over_budget_confirmations` is for rate.
         */
        if (overLines.length > 0 && overReason.trim()) {
          const res = await raiseOverQuantity(
            overLines.map((o) => ({
              purchase_order_id: result.poId,
              sales_order_id: orderId || null,
              item_id: o.line.item_id || null,
              description: o.line.description.trim(),
              planned_qty: o.planned,
              ordered_qty: o.ordered,
              reason: overReason.trim(),
            })),
          );
          if (!res.ok) toastError(`Order saved, but the over-quantity note failed: ${res.error}`);
        }
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
                <option value=""></option>
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
                  <option value=""></option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
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
                  <option value=""></option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="po-type">PO Type</Label>
              <Select
                id="po-type"
                value={poType}
                onChange={(e) => setPoType(e.target.value as "local" | "import")}
              >
                <option value="local">Local</option>
                <option value="import">Import</option>
              </Select>
            </div>

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
              <Label htmlFor="po-payment-terms">Payment Terms</Label>
              <Input
                id="po-payment-terms"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
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

            <div>
              {/* THE GARMENT ORDER THIS PO BUYS FOR (0424).
                  Asked once and written onto every line: the COLUMN is per-line,
                  because one PO legitimately covers two orders and the detail
                  editor can vary a line later, but the common PO is for one
                  order and asking per line would be a question repeated down the
                  form. Blank is general stock, and blank means UNCHECKED rather
                  than blocked. */}
              <Label htmlFor="po-order">Garment order</Label>
              <Select
                id="po-order"
                value={orderId}
                onChange={(e) => {
                  const id = e.target.value;
                  setOrderId(id);
                  setCeiling(null);
                  setOverReason("");
                  if (!id) return;
                  startTransition(async () => {
                    const c = await fetchBomCeiling(id);
                    setCeiling({
                      byItem: new Map(c.entries),
                      committedByItem: new Map(c.committed),
                      bomId: c.bomId,
                      bomCode: c.bomCode,
                      unanswered: c.unanswered,
                      enforced: c.enforced,
                      budgetCode: c.budgetCode,
                    });
                  });
                }}
              >
                <option value=""></option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number ?? "(no SC No)"}
                  </option>
                ))}
              </Select>
              {ceiling && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {ceiling.bomCode
                    ? `Checked against Material BOM ${ceiling.bomCode}`
                    : "This order has no recorded Material BOM — nothing to check against"}
                </p>
              )}
            </div>

            <div className="sm:col-span-2 md:col-span-3">
              <Label htmlFor="po-notes">Notes</Label>
              {/* caps-input: exempt -- LC/PO terms are read by a bank and by suppliers; block capitals change how a clause reads, not how a value is stored (client 2026-08-18). */}
              <Textarea
                uppercase={false}
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
            {/* ↓/↑ walk a column across PO lines — gridKeyNav, see
                components/masters/child-grid.tsx. Highest-traffic data-entry
                screen in the app. */}
            <div className="space-y-2" data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
              {lines.map((line, idx) => {
                const verdict = ceiling
                  ? judgeLine(ceiling, {
                      itemId: line.item_id || null,
                      quantity: parseFloat(line.quantity) || 0,
                    })
                  : null;
                return (
                <div key={idx} data-grid-row className="flex flex-wrap items-center gap-2">
                  {/* THE MATERIAL. It was never captured on this form — `item_id`
                      was hardcoded null — so the column existed and nothing
                      filled it, and any control keyed on it could never fire. */}
                  <div className="w-44">
                    <Select
                      value={line.item_id}
                      onChange={(e) => updateLine(idx, "item_id", e.target.value)}
                    >
                      <option value="">Material</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </Select>
                  </div>
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
                  {/* THE CEILING, said on the line it judges. `unchecked` is
                      printed as well as `over` — a control that goes quiet when
                      it cannot measure teaches the operator it is always
                      watching, which is the worst thing a warning can do. */}
                  {verdict && verdict.kind !== "within" && (
                    <p
                      className={
                        verdict.kind === "blocked"
                          ? "w-full text-xs font-medium text-danger"
                          : verdict.kind === "over"
                            ? "w-full text-xs text-warning"
                            : "w-full text-xs text-muted-foreground"
                      }
                    >
                      {verdict.kind === "blocked"
                        ? blockedMessage(verdict, itemName(line.item_id))
                        : verdict.kind === "over"
                          ? `BOM plans ${verdict.planned} — this line is ${verdict.variance} over`
                          : `Not checked — ${verdict.why.toLowerCase()}`}
                    </p>
                  )}
                </div>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              data-row-add
              onClick={addLine}
            >
              + Add line
            </Button>

            {/* WARN AND RECORD, not refuse (client 2026-08-13). The PO still
                saves — a buyer with a real reason should not be stopped by a
                plan — but going past it has to be said out loud and approved,
                exactly as over_budget_confirmations works for rate. Save is
                gated on the reason, not on the overage. */}
            {/* REFUSED — an approved budget stands behind the plan. No reason
                box: asking for a justification that will be refused regardless is
                the worst available shape, and the over-quantity note cannot
                authorise this one because it is written only AFTER a PO exists. */}
            {blockedLines.length > 0 && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
                <p className="text-sm font-medium text-danger">
                  {blockedLines.length === 1
                    ? "1 line is over the approved Material BOM"
                    : `${blockedLines.length} lines are over the approved Material BOM`}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {blockedLines.map((b, i) => (
                    <li key={i} className="text-xs text-danger">
                      {blockedMessage(b.verdict, itemName(b.line.item_id || null))}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-danger/85">
                  Reduce these lines, or revise the budget.
                </p>
              </div>
            )}

            {blockedLines.length === 0 && overLines.length > 0 && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2">
                <p className="text-sm font-medium text-warning">
                  {overLines.length === 1
                    ? "1 line exceeds the Material BOM's plan"
                    : `${overLines.length} lines exceed the Material BOM's plan`}
                </p>
                {/* required-star: exempt -- this form predates the `Field`
                    primitive and uses raw `<Label>` + control throughout (see
                    the Vendor label above, which this check already flags), so
                    one `<Field required>` here would be the odd one out. The
                    star is not decoration: Save is genuinely disabled until the
                    reason is filled, which is the gate this warning exists to
                    impose. Converting the whole form to `Field` is its own job. */}
                <Label htmlFor="po-over-reason" className="mt-2 block">Reason <span className="text-danger">*</span></Label>
                <Textarea
                  id="po-over-reason"
                  rows={2}
                  value={overReason}
                  onChange={(e) => setOverReason(e.target.value)}
                  placeholder="Why is more being bought than the BOM planned?"
                />
              </div>
            )}
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
              /* The overage does not block Save — the REASON does. That is the
                 whole difference between warn-and-record and the hard block
                 that was considered and not chosen: the buyer may proceed, and
                 must say why. */
              disabled={
                isPending ||
                !vendorId ||
                blockedLines.length > 0 ||
                (overLines.length > 0 && !overReason.trim())
              }
            >
              {isPending ? "Creating…" : "Create PO"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
