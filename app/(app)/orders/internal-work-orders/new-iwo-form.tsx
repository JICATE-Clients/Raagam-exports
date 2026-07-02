"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { OrderWithBuyer } from "@/lib/orders/service";

type Location = { id: string; code: string; name: string };

interface Props {
  orders: OrderWithBuyer[];
  locations: Location[];
}

export function NewIwoForm({ orders, locations }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [orderId, setOrderId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");

  function resetForm() {
    setOrderId("");
    setLocationId("");
    setTitle("");
    setInstructions("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createInternalWorkOrder({
        sales_order_id: orderId,
        location_id: locationId || null,
        title,
        instructions: instructions || null,
      });
      if (result.ok) {
        success("Work order created");
        router.push(`/orders/internal-work-orders/${result.iwoId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New work order</Button>
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
          <CardTitle>New internal work order</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="iwo-order">Order *</Label>
                <Select
                  id="iwo-order"
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
                <Label htmlFor="iwo-loc">Unit / Location</Label>
                <Select
                  id="iwo-loc"
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
              <div className="sm:col-span-2">
                <Label htmlFor="iwo-title">Title *</Label>
                <Input
                  id="iwo-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Cut & sew — Unit 2"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="iwo-instr">Instructions</Label>
                <Textarea
                  id="iwo-instr"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  placeholder="Optional production instructions…"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create work order"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
