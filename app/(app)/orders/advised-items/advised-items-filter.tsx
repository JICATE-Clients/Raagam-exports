"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

const BASE = "/orders/advised-items";

interface Props {
  /** Buyers as {id, code, name} for the Customer picker. */
  customers: PickerItem[];
  /** Accepted orders as {id, code: order_number, name: buyer} for the SC No picker. */
  orders: PickerItem[];
  current: { customer: string | null; order: string | null };
}

export function AdvisedItemsFilter({ customers, orders, current }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [customer, setCustomer] = useState<string | null>(current.customer);
  const [order, setOrder] = useState<string | null>(current.order);

  function find() {
    const params = new URLSearchParams();
    if (customer) params.set("customer", customer);
    if (order) params.set("order", order);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${BASE}?${qs}` : BASE));
  }

  function clear() {
    setCustomer(null);
    setOrder(null);
    startTransition(() => router.push(BASE));
  }

  return (
    <Card>
      <CardBody>
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RecordPicker
            label="Customer"
            items={customers}
            value={customer}
            onChange={setCustomer}
          />
          <RecordPicker
            label="Order (SC No)"
            items={orders}
            value={order}
            onChange={setOrder}
          />
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
