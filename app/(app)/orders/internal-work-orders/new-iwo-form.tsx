"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import { IWO_TYPES, IWO_FOR_OPTIONS } from "@/lib/orders/internal-work-orders/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { PickerRow } from "@/lib/orders/internal-work-orders/service";
import type { FieldWidth } from "@/lib/ui/sizes";

interface Props {
  customers: Customer[];
  styles: PickerRow[];
  itemClasses: ConfigLookup[];
  /**
   * THE LIST BELOW THE BUTTON, SHOWN ONLY WHILE THE FORM IS CLOSED (operator,
   * 2026-09-15). The page is a server component and `open` lives here, so the
   * table it renders is handed in as children rather than the page being turned
   * into a client component to read one flag. Opening the form replaces the
   * list; Cancel or a successful create brings it back.
   */
  children?: ReactNode;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * COMPACT, BY WIDTH RATHER THAN BY TWELFTHS (operator, 2026-09-15: the fields
 * on this tab were "huge"). Every cell was `size="sm"` — a quarter of the card,
 * ~300px on a wide pane — so a four-option "For" and a `dd/mm/yyyy` each sat
 * in a box built for a customer name. `erp-form-compact`: an input is as wide
 * as the kind of value it holds, never as wide as the column it lands in.
 *
 * One `FieldRow` wrapping, `FORM_W` below fixing where it folds:
 *
 *   176 + 112 + 144 + 176  =  608 + 3 x 12 = 644   type · for · date · class
 *   288 + 144 + 200 + 144  =  776 + 3 x 12 = 812   customer · ref · style · deli
 *   Remarks takes its own line (`basis-full`).
 *
 * The JSX order is unchanged, so Tab still runs the same path it always did.
 */
const IWO_W = {
  type: "term", //       "Non-Order Related"
  for: "range", //       Garments / Fabric / Yarn / Made-ups
  date: "code", //       dd/mm/yyyy + the picker glyph
  item_class: "term", // "PACKING ACCESSORIES"
  customer: "name", //   a party name — no schema maximum
  reference: "code", //  a short free code
  style: "party", //     code — style name, in a picker trigger
  deli_date: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE FORM'S WIDTH — `erp-form-compact` rule 4. Narrowing the fields does not
 * narrow the `Card`, which is a block box and goes on filling the pane, so the
 * Create / Cancel buttons in its footer would end inches right of the last
 * field. Capping the card puts both where the widest line ends.
 *
 *   812        the wider of the two lines above
 *   + 2 x 16   `CardBody`'s `p-4`
 *   + 2 x 1    the card's border
 *   = 846  ->  54rem (864), 18px of slack
 *
 * IT DECIDES THE FOLD: Customer joining line 1 would need 644 + 12 + 288 = 944,
 * so the two lines hold at any cap from 846 up to ~976. Check that before
 * widening it.
 */
const FORM_W = "max-w-[54rem]";

export function NewIwoForm({ customers, styles, itemClasses, children }: Props) {
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
      <>
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>New work order</Button>
        </div>
        {children}
      </>
    );
  }

  return (
    // `@container/editor` is the DENSITY container (input.tsx, button.tsx):
    // inside it every control is `h-8` and a `md` button stops standing 4px
    // proud of the inputs beside it. A page-level expand-in-place form has no
    // Sheet or MasterFullScreen to declare it, so it does so itself — the same
    // shape `default-account-head-screen.tsx` takes.
    <div className="@container/editor">
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </div>

      {/* Capped to the FORM's width, not the pane's — `FORM_W` above. */}
      <Card className={FORM_W}>
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
            {/* `FieldRow`, laid out by WIDTHS — `IWO_W` at the top of this file
                carries the arithmetic and `FORM_W` fixes the fold. Not a
                hand-rolled `grid-cols-*` and no longer `FieldGrid`: a fraction
                cannot be made compact, because the CELL keeps its column
                however narrow the control inside it is. */}
            <FieldRow>
              <Field label="Type" w={IWO_W.type} htmlFor="iwo-type">
                <Select id="iwo-type" value={iwoType} onChange={(e) => setIwoType(e.target.value)}>
                  {IWO_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="For" w={IWO_W.for} htmlFor="iwo-for">
                <Select id="iwo-for" value={iwoFor} onChange={(e) => setIwoFor(e.target.value)}>
                  <option value=""></option>
                  {IWO_FOR_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              </Field>
              {/* `required` on the Field, not a `*` typed into the label — the
                  same prop draws the star AND holds the cursor on a blank box.
                  Typed by hand it was decoration and Tab walked straight past. */}
              <Field label="Date" required w={IWO_W.date} htmlFor="iwo-date">
                <Input id="iwo-date" type="date" value={iwoDate} onChange={(e) => setIwoDate(e.target.value)} />
              </Field>
              <Field label="Item Class" w={IWO_W.item_class} htmlFor="iwo-itemclass">
                <Select
                  id="iwo-itemclass"
                  value={itemClassId ?? ""}
                  onChange={(e) => setItemClassId(e.target.value || null)}
                >
                  <option value=""></option>
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
              {/* The pickers draw their own labels; `Field` carries the width. */}
              <Field w={IWO_W.customer}>
                <CustomerPicker
                  customers={customers}
                  value={customerId}
                  onChange={setCustomerId}
                  label="Customer"
                />
              </Field>
              <Field label="Reference" w={IWO_W.reference} htmlFor="iwo-ref">
                <Input id="iwo-ref" uppercase value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field w={IWO_W.style}>
                <RecordPicker
                  label="Style"
                  items={styles}
                  value={styleId}
                  onChange={setStyleId}
                />
              </Field>
              <Field label="Deli Dt" w={IWO_W.deli_date} htmlFor="iwo-deli">
                <Input id="iwo-deli" type="date" value={deliDate} onChange={(e) => setDeliDate(e.target.value)} />
              </Field>
              {/* A textarea takes the row. In a flex row that is `basis-full`,
                  not `size="full"` — the spans are grid columns and resolve to
                  nothing here. */}
              <Field label="Remarks" className="basis-full" htmlFor="iwo-remarks">
                <Textarea
                  id="iwo-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={4}
                />
              </Field>
            </FieldRow>

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
