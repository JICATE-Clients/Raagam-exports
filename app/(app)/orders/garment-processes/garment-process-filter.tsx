"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardBody } from "@/components/ui/card";

const BASE = "/orders/garment-processes";

interface Props {
  /** Accepted orders as {id, code: order_number, name: buyer} for the SC No picker. */
  orders: PickerItem[];
  /** Current filter values from the URL, to keep the bar in sync. */
  current: { order: string | null; status: string };
}

export function GarmentProcessFilter({ orders, current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [orderId, setOrderId] = useState<string | null>(current.order);
  const [status, setStatus] = useState(current.status);

  function find() {
    const params = new URLSearchParams();
    if (orderId) params.set("order", orderId);
    if (status) params.set("status", status);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${BASE}?${qs}` : BASE));
  }

  function clear() {
    setOrderId(null);
    setStatus("");
    startTransition(() => router.push(BASE));
  }

  return (
    <Card>
      <CardBody>
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RecordPicker
            label="Order (SC No)"
            items={orders}
            value={orderId}
            onChange={setOrderId}
          />
          <div>
            <Label htmlFor="gp-status">Status</Label>
            <Select
              id="gp-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All accepted</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_production">In Production</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={find} disabled={isPending}>
              {isPending ? "Finding…" : "Find"}
            </Button>
            <Button variant="outline" onClick={clear} disabled={isPending}>
              Clear
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
