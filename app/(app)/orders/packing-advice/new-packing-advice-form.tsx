"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createPackingAdvice } from "@/lib/orders/packing-advice/actions";
import {
  PACK_METHODS,
  PACK_METHOD_LABELS,
  type PackMethod,
} from "@/lib/orders/packing-advice/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { OrderWithBuyer } from "@/lib/orders/service";

interface Props {
  orders: OrderWithBuyer[];
}

export function NewPackingAdviceForm({ orders }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [orderId, setOrderId] = useState("");
  const [packMethod, setPackMethod] = useState<PackMethod>("assorted");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setOrderId("");
    setPackMethod("assorted");
    setRemarks("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createPackingAdvice({
        sales_order_id: orderId,
        pack_method: packMethod,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("Packing advice created");
        router.push(`/orders/packing-advice/${result.adviceId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New packing advice</Button>
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
          <CardTitle>New packing advice</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pla-order">Order *</Label>
                <Select
                  id="pla-order"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  required
                >
                  <option value="">— select order —</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number ?? o.id.slice(0, 8)}
                      {o.buyers?.name ? ` — ${o.buyers.name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pla-method">Pack method</Label>
                <Select
                  id="pla-method"
                  value={packMethod}
                  onChange={(e) => setPackMethod(e.target.value as PackMethod)}
                >
                  {PACK_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PACK_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="pla-remarks">Remarks</Label>
                <Textarea
                  id="pla-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="Optional packing notes…"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create packing advice"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
