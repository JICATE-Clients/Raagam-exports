"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { IWO_TYPES, IWO_FOR_OPTIONS } from "@/lib/orders/internal-work-orders/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
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
  styles: PickerRow[];
  itemClasses: ConfigLookup[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function NewIwoForm({ customers, styles, itemClasses }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(open || isPending);
  useCreateIntent(() => setOpen(true));

  const [iwoType, setIwoType] = useState<string>("Non-Order Related");
  const [iwoFor, setIwoFor] = useState("");
  const [iwoDate, setIwoDate] = useState(() => today());
  const [itemClassId, setItemClassId] = useState<string | null>(null);
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
          <form
            onSubmit={handleSubmit}
            // ONE MARKER, NEVER A HANDLER — without it `isEditorScope()` is
            // false, Tab keeps native order and leaves the form. See the
            // `raagam-keyboard-contract` skill.
            data-focus-scope
            className="space-y-4"
          >
            {/* `FieldGrid`, not a hand-rolled `grid-cols-*` — a screen composes
                primitives, it does not draw (LAYOUT.md §3). */}
            <FieldGrid>
              <Field label="Type" size="sm" htmlFor="iwo-type">
                <Select id="iwo-type" value={iwoType} onChange={(e) => setIwoType(e.target.value)}>
                  {IWO_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="For" size="sm" htmlFor="iwo-for">
                <Select id="iwo-for" value={iwoFor} onChange={(e) => setIwoFor(e.target.value)}>
                  <option value="">—</option>
                  {IWO_FOR_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              </Field>
              {/* `required` on the Field, not a `*` typed into the label — the
                  same prop draws the star AND holds the cursor on a blank box.
                  Typed by hand it was decoration and Tab walked straight past. */}
              <Field label="Date" required size="sm" htmlFor="iwo-date">
                <Input id="iwo-date" type="date" value={iwoDate} onChange={(e) => setIwoDate(e.target.value)} />
              </Field>
              <Field label="Item Class" size="sm" htmlFor="iwo-itemclass">
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
              </Field>
              {/* "Owner Of the Trial" stood here, a RecordPicker over the
                  Employee master. That master was removed (2026-08-01, client),
                  so nothing could ever fill the list again. The
                  `internal_work_orders.owner_of_trial_id` column survives and
                  keeps whatever earlier work orders recorded. */}
              {/* The pickers draw their own labels; `Field` carries the span. */}
              <Field size="sm">
                <CustomerPicker
                  customers={customers}
                  value={customerId}
                  onChange={setCustomerId}
                  label="Customer"
                />
              </Field>
              <Field label="Reference" size="sm" htmlFor="iwo-ref">
                <Input id="iwo-ref" uppercase value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field size="sm">
                <RecordPicker
                  label="Style"
                  items={styles}
                  value={styleId}
                  onChange={setStyleId}
                />
              </Field>
              <Field label="Deli Dt" size="sm" htmlFor="iwo-deli">
                <Input id="iwo-deli" type="date" value={deliDate} onChange={(e) => setDeliDate(e.target.value)} />
              </Field>
              {/* `full` is the row, which is what a textarea takes. */}
              <Field label="Remarks" size="full" htmlFor="iwo-remarks">
                <Textarea
                  id="iwo-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={4}
                />
              </Field>
            </FieldGrid>

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
