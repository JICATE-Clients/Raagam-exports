"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cancelOrder } from "@/lib/orders/cancellations/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption, BuyerOption } from "@/lib/orders/cancellations/service";

interface Props {
  orders: OrderOption[];
  buyers: BuyerOption[];
}

export function NewCancellationForm({ orders, buyers }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(open || isPending);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  // The form only ever mounts client-side (starts collapsed), so a `new Date()`
  // initializer can't cause a hydration mismatch.
  const [cancelledDate, setCancelledDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [remarks, setRemarks] = useState("");

  // SC No picker items: {id, code: order_number, name: buyer_name}.
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

  function resetForm() {
    setOrderId(null);
    setCustomerId(null);
    setOrderNo("");
    setRemarks("");
    setCancelledDate(new Date().toISOString().slice(0, 10));
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  // Picking an SC No auto-loads the order's buyer as the Customer.
  function onSelectOrder(id: string | null) {
    setOrderId(id);
    if (id) {
      const o = orders.find((x) => x.id === id);
      if (o?.buyer_id) setCustomerId(o.buyer_id);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) {
      toastError("Select the SC No");
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
        handleClose();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New cancellation</Button>
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
          <CardTitle>Cancel a garment order</CardTitle>
        </CardHeader>
        <CardBody>
          <form
            onSubmit={handleSubmit}
            // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is false,
            // so Tab keeps native order, leaves the form and stops on the buttons
            // below — one of the ~51 page-level editors AGENTS.md counts as
            // missing this. See the `raagam-keyboard-contract` skill.
            data-focus-scope
            className="space-y-4"
          >
            {/* `FieldGrid`, not a hand-rolled `grid-cols-1 sm:grid-cols-2
                lg:grid-cols-3` — a screen composes primitives, it does not draw
                (LAYOUT.md §3). Every field is `sm`: 3 of 12, four per row. */}
            <FieldGrid>
              <Field label="Cancel No" size="sm" htmlFor="goc-cancelno">
                <Input id="goc-cancelno" value="(auto)" readOnly />
              </Field>
              {/* `required` on the Field, not a `*` typed into the label. The
                  same prop draws the star AND stamps `data-required-empty`, so
                  the cursor actually holds on a blank box — typed by hand it was
                  decoration and Tab walked straight past. */}
              <Field label="Date" required size="sm" htmlFor="goc-date">
                <Input
                  id="goc-date"
                  type="date"
                  value={cancelledDate}
                  onChange={(e) => setCancelledDate(e.target.value)}
                  required
                />
              </Field>
              {/* The picker draws its own label and its own `*`; `Field` is here
                  for the span only, which is what its optional `label` is for. */}
              <Field size="sm">
                <RecordPicker
                  id="goc-order"
                  label="SC No"
                  items={orderItems}
                  value={orderId}
                  onChange={onSelectOrder}
                  required
                />
              </Field>
              <Field size="sm">
                <RecordPicker
                  label="Customer"
                  items={buyerItems}
                  value={customerId}
                  onChange={setCustomerId}
                />
              </Field>
              <Field label="Order No" size="sm" htmlFor="goc-orderno">
                <Input
                  id="goc-orderno"
                  uppercase
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                  placeholder="Customer order / PO reference"
                />
              </Field>
              {/* `full` is not a field width — it is the row, which is what a
                  textarea takes. */}
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

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || orders.length === 0}>
                {isPending ? "Cancelling…" : "Cancel order"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
