"use client";

import { useRef, useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createOrder } from "@/lib/orders/actions";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { QuoteWithContext } from "@/lib/orders/service";
import type { Buyer } from "@/lib/masters/types";

type Location = { id: string; code: string; name: string };

type LineRow = { key: string; color: string; size: string; quantity: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

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

  // An expand-in-place form, not an overlay — the reload guard's DOM scan looks
  // for role="dialog" and would never see it. `open` is the dirty signal for the
  // same reason `mode === "edit"` is elsewhere in this module: the operator only
  // opens it to type into it.
  useUnsavedGuard(open || isPending);
  useCreateIntent(() => setOpen(true));

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
  const [orderDate, setOrderDate] = useState(today());
  const [shipDate, setShipDate] = useState("");

  // line items
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const blankLine = (): LineRow => ({
    key: `k${keySeq.current++}`,
    color: "",
    size: "",
    quantity: "",
  });

  function resetForm() {
    setMode("quote");
    setSelectedQuoteId("");
    setBuyerId("");
    setFobPrice("");
    setOrderQty("");
    setCurrencyCode("USD");
    setLocationId("");
    setOrderDate(today());
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
    setLines((ls) => [...ls, blankLine()]);
  }

  function removeLine(row: LineRow) {
    setLines((ls) => ls.filter((l) => l.key !== row.key));
  }

  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /* One declaration per column, read by the table AND by the card layout — so a
     fourth column cannot leave the two disagreeing. `ChildGrid` draws the row ✕
     itself with `data-row-remove`, which is what puts Ctrl+Del on these rows;
     the hand-rolled `×` this replaces was on no key at all, and since Tab began
     landing on fields only it was mouse-only. */
  const lineColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Colour",
      cell: (l) => (
        <Input
          uppercase
          value={l.color}
          onChange={(e) => updateLine(l.key, { color: e.target.value })}
        />
      ),
    },
    {
      header: "Size",
      width: "8rem",
      cell: (l) => (
        <Input
          uppercase
          value={l.size}
          onChange={(e) => updateLine(l.key, { size: e.target.value })}
        />
      ),
    },
    {
      header: "Qty",
      align: "right",
      width: "8rem",
      cell: (l) => (
        <Input
          type="number"
          min="0"
          placeholder="0"
          className="text-right"
          value={l.quantity}
          onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
        />
      ),
    },
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const selectedQuote = quotes.find((q) => q.id === selectedQuoteId);

    const payload = {
      buyer_id: buyerId,
      opportunity_id: selectedQuote?.opportunity_id ?? null,
      quote_id: mode === "quote" && selectedQuoteId ? selectedQuoteId : null,
      location_id: locationId,
      order_date: orderDate,
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
          <form
            // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
            // false, so Tab keeps native order, leaves the form and stops on
            // buttons — one of the ~51 page-level editors AGENTS.md counts as
            // missing this. See the `raagam-keyboard-contract` skill.
            data-focus-scope onSubmit={handleSubmit} className="space-y-4">
            {/* ONE FIELD TRACK for the whole form, in place of a lone quote row
                above a `grid-cols-1 sm:grid-cols-2`. Two tracks meant the quote
                box ran the full card width while everything under it was half of
                it, so nothing shared a left edge with anything — LAYOUT.md §3
                fixes a field at ~280px precisely so a form reads as columns
                rather than as boxes sized to their own data. */}
            <FieldGrid>
              {mode === "quote" && (
                // `lg`, not `full`: a quote option carries its code, buyer,
                // currency and price on one line and reads badly in a quarter row.
                <Field label="Accepted quote" required size="lg" htmlFor="quote">
                  <Select
                    id="quote"
                    value={selectedQuoteId}
                    onChange={(e) => handleQuoteSelect(e.target.value)}
                    required
                  >
                    <option value=""></option>
                    {quotes.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.code ?? q.id.slice(0, 8)} — {q.buyers?.name ?? "?"} (
                        {q.currency_code} {q.fob_price})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {/* The document date. Required because `sales_orders.order_date`
                  is NOT NULL (0395) — it is also what decides the order
                  number's financial year, but that belongs to the DB, not to a
                  caption on this generic form.

                  `required` on the FIELD, never a `*` typed into the label: the
                  one prop draws the star AND stamps `data-required-empty`, so
                  the star and the cursor hold cannot disagree. Typed by hand it
                  was decoration — the red star was there, and Tab walked
                  straight past a blank box. */}
              <Field label="Date" required size="sm" htmlFor="order-date">
                <Input
                  id="order-date"
                  type="date"
                  required
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                />
              </Field>

              {/* Buyer (editable even when quote mode). `buyer_id` is a uuid in
                  `salesOrderInput` — a blank one fails the schema, so this has
                  always been mandatory and simply never said so. */}
              <Field label="Buyer" required size="sm" htmlFor="buyer">
                <Select
                  id="buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  required
                >
                  <option value=""></option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* MANDATORY since 0395 — not a style choice. The SC No's running
                  number counts per (location, financial year), so an order with
                  no location has no counter to draw from and the DB refuses to
                  number it. The `*` holds the cursor here (useRequiredHold),
                  which is right: leaving it blank is not a save that fails
                  validation, it is a save that cannot produce an identifier. */}
              <Field label="Location" required size="sm" htmlFor="location">
                <Select
                  id="location"
                  required
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value=""></option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* FOB and Qty carried a native `required` and no star, which is
                  the drift in the other direction: the browser refused the save
                  and nothing on screen said why. Declared here they get the
                  star, the hold and the Save gate from the same prop. */}
              <Field label="FOB price" required size="sm" htmlFor="fob">
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
              </Field>

              <Field label="Order quantity" required size="sm" htmlFor="qty">
                <Input
                  id="qty"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={orderQty}
                  onChange={(e) => setOrderQty(e.target.value)}
                  required
                />
              </Field>

              <Field label="Currency" size="sm" htmlFor="currency">
                <Input
                  uppercase
                  id="currency"
                  placeholder="USD"
                  maxLength={3}
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                />
              </Field>

              <Field label="Ship date" size="sm" htmlFor="ship">
                <Input
                  id="ship"
                  type="date"
                  value={shipDate}
                  onChange={(e) => setShipDate(e.target.value)}
                />
              </Field>
            </FieldGrid>

            {/* `seedRow` — the grid opens holding one blank line rather than an
                empty frame behind an "+ Add line" button. The lines stay
                genuinely optional: a blank row is dropped by the
                `Number(l.quantity) > 0` filter in `handleSubmit`, so seeding one
                cannot post an empty line. */}
            <ChildGrid
              label="Line items (optional)"
              addLabel="+ Add line"
              columns={lineColumns}
              rows={lines}
              onAdd={addLine}
              onRemove={removeLine}
              seedRow
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {/* One declaration, four enforcers: the `*`, the cursor hold, THIS
                  button, and `salesOrderInput`. Location and Date are the two
                  the SC No is built from, so a save without them has no
                  identifier to produce; Buyer is the uuid the schema rejects
                  blank; FOB and Qty are what the form's own `required` has
                  always refused to submit without. The list reads off the
                  starred fields above — every one of them, or the button and
                  the stars disagree about what "mandatory" means. */}
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !orderDate ||
                  !buyerId ||
                  !locationId ||
                  !fobPrice ||
                  !orderQty ||
                  (mode === "quote" && !selectedQuoteId)
                }
              >
                {isPending ? "Creating…" : "Create order"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
