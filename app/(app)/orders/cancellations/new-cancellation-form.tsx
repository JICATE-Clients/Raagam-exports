"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { cancelOrder } from "@/lib/orders/cancellations/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid, FieldRow } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption, BuyerOption } from "@/lib/orders/cancellations/service";

interface Props {
  orders: OrderOption[];
  buyers: BuyerOption[];
}

/**
 * THE ENTRY OPENS OVER THE LISTING, NOT INSIDE IT (client 2026-09-20,
 * screenshot 2965: "the form layout inside the entry listings show, please fix
 * it"). It used to expand in place as a full-width card between the header and
 * the table, pushing the list down and stretching five short fields across the
 * whole pane. Now the page is the listing and this is its "+ New cancellation"
 * button and the `Sheet` it opens. `Sheet` registers with the reload guard
 * itself.
 *
 * WIDTHS (LAYOUT.md, "build it compact the first time"):
 *   Cancel No range 112 + Date code 144 + RE No party 200 + Customer name 288
 *   + 3 gaps x 12 = 780px of fields; + `px-5` x 2 + border ≈ 822px of card.
 *   `max-w-[860px]` leaves ~38px of headroom so the row never wraps.
 */
export function NewCancellationForm({ orders, buyers }: Props) {
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
  // The FACTORY's today, not `toISOString()`'s UTC day — which read
  // yesterday for the first 5½ hours of every IST day (screenshot 2965 shows
  // 19-09 at 00:27 on the 20th).
  const [cancelledDate, setCancelledDate] = useState(() => today());
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
    setCancelledDate(today());
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
      const result = await cancelOrder({
        order_id: orderId,
        customer_id: customerId,
        order_no: orderNo || null,
        cancelled_date: cancelledDate,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Order cancelled");
        setOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={openNew}>+ New cancellation</Button>

      <Sheet
        open={open}
        onClose={handleClose}
        title="Cancel a garment order"
        size="md"
        maxWidthClass="max-w-[860px]"
        alignToPane
        footer={
          <>
            <Button variant="outline" size="md" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button size="md" onClick={handleSubmit} disabled={isPending || orders.length === 0}>
              {isPending ? "Cancelling…" : "Cancel order"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldRow>
            <Field label="Cancel No" w="range" htmlFor="goc-cancelno">
              <Input id="goc-cancelno" value="(auto)" readOnly />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the
                same prop draws the star AND holds the cursor on a blank box. */}
            <Field label="Date" required w="code" htmlFor="goc-date">
              <Input
                id="goc-date"
                type="date"
                value={cancelledDate}
                onChange={(e) => setCancelledDate(e.target.value)}
                required
              />
            </Field>
            {/* The picker draws its own label and `*`; `Field` carries the
                width. `identity="code"`: on an RE No the CODE is the identity
                and the name is the customer, so without it five orders for one
                buyer all read alike. */}
            <Field w="party">
              <RecordPicker
                id="goc-order"
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
            <Field label="Order No" w="term" htmlFor="goc-orderno">
              <Input
                id="goc-orderno"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="Customer order / PO reference"
              />
            </Field>
          </FieldRow>
          {/* `full` is the row, which is what a textarea takes. */}
          <FieldGrid>
            <Field label="Remarks" size="full" htmlFor="goc-remarks">
              <Textarea
                id="goc-remarks"
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
