"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCreateIntent } from "@/lib/use-create-intent";
import { createTaCompletion } from "@/lib/orders/ta-completion/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { RecordPicker } from "@/components/masters/record-picker";
import type { OrderOption, BuyerOption } from "@/lib/orders/ta-completion/service";

interface Props {
  orders: OrderOption[];
  buyers: BuyerOption[];
}

export function NewTaCompletionForm({ orders, buyers }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  // The form only ever mounts client-side (starts collapsed), so a `new Date()`
  // initializer can't cause a hydration mismatch.
  const [completionDate, setCompletionDate] = useState(() =>
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
    setCompletionDate(new Date().toISOString().slice(0, 10));
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
      const result = await createTaCompletion({
        order_id: orderId,
        customer_id: customerId,
        order_no: orderNo || null,
        completion_date: completionDate,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("TA completion recorded");
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
        <Button onClick={() => setOpen(true)}>New TA completion</Button>
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
          <CardTitle>Record a TA completion</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="tac-complno">Completion No</Label>
                <Input id="tac-complno" value="(auto)" disabled />
              </div>
              <div>
                <Label htmlFor="tac-date">Date *</Label>
                <Input
                  id="tac-date"
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  required
                />
              </div>
              <RecordPicker
                label="SC No"
                items={orderItems}
                value={orderId}
                onChange={onSelectOrder}
                required
              />
              <RecordPicker
                label="Customer"
                items={buyerItems}
                value={customerId}
                onChange={setCustomerId}
              />
              <div>
                <Label htmlFor="tac-orderno">Order No</Label>
                <Input
                  id="tac-orderno"
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                  placeholder="Customer order / PO reference"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="tac-remarks">Remarks</Label>
              <Textarea
                id="tac-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || orders.length === 0}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
