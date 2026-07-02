"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProcessRfq } from "@/lib/process/rfq/actions";
import { PROCESS_TYPES, type ProcessType } from "@/lib/process/rfq/types";
import type { OrderOption } from "@/lib/process/rfq/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

interface Props {
  orders: OrderOption[];
}

export function NewProcessRfqForm({ orders }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [orderId, setOrderId] = useState("");
  const [processType, setProcessType] = useState<ProcessType>("dyeing");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [uom, setUom] = useState("Kg");
  const [budgetRate, setBudgetRate] = useState("");
  const [remarks, setRemarks] = useState("");

  function handleClose() {
    setOpen(false);
    setOrderId("");
    setProcessType("dyeing");
    setDescription("");
    setQuantity("");
    setUom("Kg");
    setBudgetRate("");
    setRemarks("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createProcessRfq({
        sales_order_id: orderId || null,
        process_type: processType,
        description: description || null,
        quantity: Number(quantity) || 0,
        uom: uom || null,
        budget_rate: Number(budgetRate) || 0,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("RFQ created");
        router.push(`/process/rfq/${result.rfqId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New RFQ</Button>
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
          <CardTitle>New process RFQ</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="pr-order">Order</Label>
              <Select id="pr-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">— none —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.order_number ?? o.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pr-type">Process type</Label>
              <Select id="pr-type" value={processType} onChange={(e) => setProcessType(e.target.value as ProcessType)}>
                {PROCESS_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pr-desc">Description</Label>
              <Input id="pr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Reactive dyeing navy" />
            </div>
            <div>
              <Label htmlFor="pr-qty">Quantity</Label>
              <Input id="pr-qty" type="number" min="0" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="pr-uom">UOM</Label>
              <Input id="pr-uom" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="Kg" />
            </div>
            <div>
              <Label htmlFor="pr-budget">Budget rate</Label>
              <Input id="pr-budget" type="number" min="0" step="0.0001" value={budgetRate} onChange={(e) => setBudgetRate(e.target.value)} placeholder="0.00" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="pr-rem">Remarks</Label>
              <Textarea id="pr-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={1} placeholder="Optional" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create RFQ"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
