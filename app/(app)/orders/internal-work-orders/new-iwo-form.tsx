"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import { createInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import {
  IWO_TYPES,
  IWO_FOR_OPTIONS,
} from "@/lib/orders/internal-work-orders/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { PickerRow } from "@/lib/orders/internal-work-orders/service";
import type { FieldWidth } from "@/lib/ui/sizes";
import { cn } from "@/lib/utils";

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
 * One `FieldRow` wrapping at the 8px `pack` gap (operator, 2026-09-15: "reduce
 * the horizontal gap between grid columns to gap-2"), `FORM_W` below fixing
 * where it folds. TWO LINES, NINE FIELDS (operator, 2026-09-15: "ultra-compact
 * 1 or 2-row layout … move Remarks into the same grid row"):
 *
 *   176 + 112 + 144 + 176 + 288  =  896 + 4 x 8 = 928   type · for · date · class · customer
 *   144 + 200 + 144 + 288        =  776 + 3 x 8 = 800   ref · style · deli · remarks
 *
 * Remarks is a one-line `Input` at `name`, not a textarea on a line of its own
 * any more — see the field. Still a `FieldRow`, NOT a `grid-cols-6`: six equal
 * columns would hand "For" (four short words) the same 150px as a customer
 * name, which is the twelfths defect one size smaller.
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
  remarks: "name", //    one line of free text — see the field
} satisfies Record<string, FieldWidth>;

/**
 * THE FORM'S WIDTH — `erp-form-compact` rule 4. Narrowing the fields does not
 * narrow the section, which is a block box and goes on filling the pane, so the
 * Create / Cancel buttons in its footer would end inches right of the last
 * field. Capping the section puts both where the widest line ends.
 *
 *   928        the wider of the two lines above
 *   -> 60rem (960), 32px of slack. No card padding or border to add any more —
 *      the `Card` this used to be wrapped in is gone (below).
 *
 * IT DECIDES THE FOLD: Reference joining line 1 would need 928 + 8 + 144 = 1080,
 * so the two lines hold at any cap from 928 up to ~1072. Check that before
 * widening it. Below 928 the first line folds after Item Class and the form
 * is three lines — a laptop pane, not a defect.
 */
const FORM_W = "max-w-[60rem]";

/**
 * DENSE CONTROLS (operator, 2026-09-15: "highly compact, enterprise-level").
 * `Input` and the native `Select` set no vertical padding — their height IS
 * the `h-9 @2xl/editor:h-8` pair — so `py-1` alone would change nothing;
 * `h-7` (28px) is what actually shrinks the box, `py-1` + `text-sm` (20px
 * line) fill it exactly, and `px-2` sits under the primitive's `px-2.5`.
 * `@2xl/editor:h-7` is the twin the container query needs: `cn` drops the
 * bare `h-9` for ours, but `@2xl/editor:h-8` is a different variant, survives
 * the merge and sorts after — without the twin the box would be 28px on a
 * phone and 32px on the desktop the request was made about.
 *
 * Same string as `COMPACT_INPUT` in advised-items-editor.tsx, on purpose:
 * these two forms are the operator's "dense" pair and must not drift apart.
 */
const COMPACT_INPUT = "h-7 @2xl/editor:h-7 py-1 px-2 text-sm";

/**
 * THE SELECTS TAKE NO PADDING, and that is `select.tsx`'s own rule, not a
 * lapse: its enhanced branch sends `className` to BOTH a wrapper `<div>` and
 * the `<input>` inside it, so `py-1 px-2` would inset the input by its own
 * padding inside a 28px wrapper and overflow it. Height and text size are
 * what that branch is built to receive (`<Select className="h-8">` is the
 * example in its comment); the primitive's `px-2.5` stays, 2px wider than
 * the inputs beside it.
 */
const COMPACT_SELECT = "h-7 @2xl/editor:h-7 text-sm";

/**
 * THE PICKERS, THROUGH THEIR `Field`. `CustomerPicker` and `RecordPicker` take
 * no class for the trigger `<input>` — `DataPicker`'s `className` lands on the
 * root wrapper — so the cell reaches the control with a descendant selector.
 * `pl-2` rather than `px-2`: the trigger's right padding is the chevron's
 * reserved slot (`AFFORDANCE_PAD`), and shrinking it puts the value under the
 * glyph. `.cell input` outranks `.h-9` AND the container-query `.h-8` on
 * specificity alone, so no `@2xl/editor:` twin is needed here.
 */
const COMPACT_PICKER =
  "[&_input]:h-7 [&_input]:py-1 [&_input]:pl-2 [&_input]:text-sm";

export function NewIwoForm({
  customers,
  styles,
  itemClasses,
  children,
}: Props) {
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

      {/* FLAT, NOT A CARD (operator, 2026-09-15: "blends flat and seamlessly
          with the page background"). This was `Card` › `CardHeader` ›
          `CardBody` — the app's raised panel: `rounded-xl border bg-surface`,
          the smoke wash, `shadow-elev` and `inset-shadow-sheen`, five
          utilities across two layers. A plain `<section>` has nothing to
          undo. Still capped to the FORM's width, not the pane's — `FORM_W`
          above — and the title keeps `CardTitle`'s own type scale. */}
      <section
        className={cn("space-y-3", FORM_W)}
        aria-labelledby="iwo-form-title"
      >
        <h3
          id="iwo-form-title"
          className="text-sm font-semibold text-foreground"
        >
          New internal work order
        </h3>
        <form
          onSubmit={handleSubmit}
          // ONE MARKER, NEVER A HANDLER — without it `isEditorScope()` is
          // false, Tab keeps native order and leaves the form. See the
          // `raagam-keyboard-contract` skill.
          data-focus-scope
          className="space-y-3"
        >
          {/* `FieldRow`, laid out by WIDTHS — `IWO_W` at the top of this file
                carries the arithmetic and `FORM_W` fixes the fold. Not a
                hand-rolled `grid-cols-*` and no longer `FieldGrid`: a fraction
                cannot be made compact, because the CELL keeps its column
                however narrow the control inside it is. */}
          <FieldRow gap="pack">
            <Field label="Type" w={IWO_W.type} htmlFor="iwo-type">
              <Select
                id="iwo-type"
                className={COMPACT_SELECT}
                value={iwoType}
                onChange={(e) => setIwoType(e.target.value)}
              >
                {IWO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="For" w={IWO_W.for} htmlFor="iwo-for">
              <Select
                id="iwo-for"
                className={COMPACT_SELECT}
                value={iwoFor}
                onChange={(e) => setIwoFor(e.target.value)}
              >
                <option value=""></option>
                {IWO_FOR_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the
                  same prop draws the star AND holds the cursor on a blank box.
                  Typed by hand it was decoration and Tab walked straight past. */}
            <Field label="Date" required w={IWO_W.date} htmlFor="iwo-date">
              <Input
                id="iwo-date"
                className={COMPACT_INPUT}
                type="date"
                value={iwoDate}
                onChange={(e) => setIwoDate(e.target.value)}
              />
            </Field>
            <Field
              label="Item Class"
              w={IWO_W.item_class}
              htmlFor="iwo-itemclass"
            >
              <Select
                id="iwo-itemclass"
                className={COMPACT_SELECT}
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
            <Field w={IWO_W.customer} className={COMPACT_PICKER}>
              <CustomerPicker
                customers={customers}
                value={customerId}
                onChange={setCustomerId}
                label="Customer"
              />
            </Field>
            <Field label="Reference" w={IWO_W.reference} htmlFor="iwo-ref">
              <Input
                id="iwo-ref"
                className={COMPACT_INPUT}
                uppercase
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Field w={IWO_W.style} className={COMPACT_PICKER}>
              <RecordPicker
                label="Style"
                items={styles}
                value={styleId}
                onChange={setStyleId}
              />
            </Field>
            <Field label="Deli Dt" w={IWO_W.deli_date} htmlFor="iwo-deli">
              <Input
                id="iwo-deli"
                className={COMPACT_INPUT}
                type="date"
                value={deliDate}
                onChange={(e) => setDeliDate(e.target.value)}
              />
            </Field>
            {/* ONE LINE, IN THE ROW (operator, 2026-09-15). This was a
                `Textarea` on a `basis-full` line of its own — four rows, then
                two, then capped at `max-w-md` — and each step was the same
                request: a remark is a sentence, and the form should not spend
                a line saying so. An `Input` at `name` sits at the end of the
                second line like any other field; a long remark scrolls inside
                the box rather than growing it. The stored value is the same
                `remarks` string, so nothing on the save side changes. */}
            <Field label="Remarks" w={IWO_W.remarks} htmlFor="iwo-remarks">
              <Input
                id="iwo-remarks"
                className={COMPACT_INPUT}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
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
      </section>
    </div>
  );
}
