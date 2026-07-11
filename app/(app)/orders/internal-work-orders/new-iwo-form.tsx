"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { IWO_TYPES, IWO_FOR_OPTIONS } from "@/lib/orders/internal-work-orders/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { PickerRow } from "@/lib/orders/internal-work-orders/service";

interface Props {
  customers: Customer[];
  employees: PickerRow[];
  styles: PickerRow[];
  itemClasses: ConfigLookup[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function NewIwoForm({ customers, employees, styles, itemClasses }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [iwoType, setIwoType] = useState<string>("Non-Order Related");
  const [iwoFor, setIwoFor] = useState("");
  const [iwoDate, setIwoDate] = useState(() => today());
  const [itemClassId, setItemClassId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [styleId, setStyleId] = useState<string | null>(null);
  const [deliDate, setDeliDate] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setIwoType("Non-Order Related");
    setIwoFor("");
    setIwoDate(today());
    setItemClassId(null);
    setOwnerId(null);
    setCustomerId(null);
    setReference("");
    setStyleId(null);
    setDeliDate("");
    setRemarks("");
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createInternalWorkOrder({
        sales_order_id: null,
        location_id: null,
        title: null,
        instructions: null,
        iwo_type: iwoType || null,
        iwo_for: iwoFor || null,
        iwo_date: iwoDate,
        item_class_id: itemClassId,
        owner_of_trial_id: ownerId,
        customer_id: customerId,
        reference: reference || null,
        style_id: styleId,
        deli_date: deliDate || null,
        remarks: remarks || null,
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="iwo-type">Type</Label>
                <Select id="iwo-type" value={iwoType} onChange={(e) => setIwoType(e.target.value)}>
                  {IWO_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="iwo-for">For</Label>
                <Select id="iwo-for" value={iwoFor} onChange={(e) => setIwoFor(e.target.value)}>
                  <option value="">—</option>
                  {IWO_FOR_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="iwo-date">Date *</Label>
                <Input id="iwo-date" type="date" value={iwoDate} onChange={(e) => setIwoDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="iwo-itemclass">Item Class</Label>
                <Select
                  id="iwo-itemclass"
                  value={itemClassId ?? ""}
                  onChange={(e) => setItemClassId(e.target.value || null)}
                >
                  <option value="">—</option>
                  {itemClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <RecordPicker
                label="Owner Of the Trial"
                items={employees}
                value={ownerId}
                onChange={setOwnerId}
              />
              <div />

              <CustomerPicker
                customers={customers}
                value={customerId}
                onChange={setCustomerId}
                label="Customer"
              />
              <div>
                <Label htmlFor="iwo-ref">Reference</Label>
                <Input id="iwo-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
              <RecordPicker
                label="Style"
                items={styles}
                value={styleId}
                onChange={setStyleId}
              />
              <div>
                <Label htmlFor="iwo-deli">Deli Dt</Label>
                <Input id="iwo-deli" type="date" value={deliDate} onChange={(e) => setDeliDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="iwo-remarks">Remarks</Label>
              <Textarea
                id="iwo-remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={4}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !iwoDate}>
                {isPending ? "Creating…" : "Create work order"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
