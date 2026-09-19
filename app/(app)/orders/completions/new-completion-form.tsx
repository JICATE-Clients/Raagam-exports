"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { completeOrder } from "@/lib/orders/completions/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid, FieldRow } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption, BuyerOption } from "@/lib/orders/completions/service";

interface Props {
  orders: OrderOption[];
  buyers: BuyerOption[];
}

/**
 * THE ENTRY OPENS OVER THE LISTING, NOT INSIDE IT (client 2026-09-20,
 * screenshot 2965) — the same fix, and the same reasoning, as
 * `cancellations/new-cancellation-form.tsx`. The page is the listing; this is
 * its "+ New completion" button and the `Sheet` it opens.
 *
 * WIDTHS: Completion No range 112 + Date code 144 + RE No party 200 +
 * Customer name 288 + 3 gaps x 12 = 780px; `max-w-[860px]` leaves ~38px of
 * headroom over the card's padding and border.
 */
export function NewCompletionForm({ orders, buyers }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // `Sheet` covers the open state; `isPending` covers a reload landing
  // mid-save (AGENTS.md, "Auto-reload guard").
  useUnsavedGuard(isPending);

  const [orderId, setOrderId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  // The FACTORY's today, not `toISOString()`'s UTC day, which read yesterday
  // for the first 5½ hours of every IST day.
  const [completionDate, setCompletionDate] = useState(() => today());
  const [remarks, setRemarks] = useState("");

  // RE No picker items: {id, code: order_number, name: buyer_name}.
  const orderItems = useMemo(
    () =>
      orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "(no buyer)",
      })),
    [orders],
  );
  const buyerItems = useMemo(
    () => buyers.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    [buyers],
  );

  // Seeded on every OPEN, not once per mount — the page does not remount
  // between entries, so a second "New" would otherwise show the last one.
  function openNew() {
    setOrderId(null);
    setCustomerId(null);
    setOrderNo("");
    setRemarks("");
    setCompletionDate(today());
    setOpen(true);
  }
  useCreateIntent(openNew);

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  // Picking an RE No auto-loads the order's buyer as the Customer.
  function onSelectOrder(id: string | null) {
    setOrderId(id);
    if (id) {
      const o = orders.find((x) => x.id === id);
      if (o?.buyer_id) setCustomerId(o.buyer_id);
    }
  }

  function handleSubmit() {
    if (!orderId) {
      toastError("Select the RE No");
      return;
    }
    startTransition(async () => {
      const result = await completeOrder({
        order_id: orderId,
        customer_id: customerId,
        order_no: orderNo || null,
        completion_date: completionDate,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Order completed");
        setOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openNew}>+ New completion</Button>

      <Sheet
        open={open}
        onClose={handleClose}
        title="Complete a garment order"
        size="md"
        maxWidthClass="max-w-[860px]"
        alignToPane
        footer={
          <>
            <Button variant="outline" size="md" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button size="md" onClick={handleSubmit} disabled={isPending || orders.length === 0}>
              {isPending ? "Completing…" : "Complete order"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldRow>
            <Field label="Completion No" w="range" htmlFor="gcm-complno">
              <Input id="gcm-complno" value="(auto)" readOnly />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the
                same prop draws the star AND holds the cursor on a blank box. */}
            <Field label="Date" required w="code" htmlFor="gcm-date">
              <Input
                id="gcm-date"
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                required
              />
            </Field>
            {/* The picker draws its own label and `*`; `Field` carries the
                width. `identity="code"`: on an RE No the CODE is the identity. */}
            <Field w="party">
              <RecordPicker
                id="gcm-order"
                label="RE No"
                identity="code"
                items={orderItems}
                value={orderId}
                onChange={onSelectOrder}
                required
              />
            </Field>
            <Field w="name">
              <RecordPicker
                label="Customer"
                items={buyerItems}
                value={customerId}
                onChange={setCustomerId}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Order No" w="term" htmlFor="gcm-orderno">
              <Input
                id="gcm-orderno"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="Customer order / PO reference"
              />
            </Field>
          </FieldRow>
          {/* `full` is the row, which is what a textarea takes. */}
          <FieldGrid>
            <Field label="Remarks" size="full" htmlFor="gcm-remarks">
              <Textarea
                id="gcm-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional"
                rows={3}
              />
            </Field>
          </FieldGrid>
        </div>
      </Sheet>
    </>
  );
}
