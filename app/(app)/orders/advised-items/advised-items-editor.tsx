"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRouter } from "next/navigation";
import {
  addAdvisedItem,
  setAdvisedItemStatus,
  deleteAdvisedItem,
} from "@/lib/orders/advised-items/actions";
import {
  ADVISED_STATUSES,
  ADVISED_STATUS_LABELS,
  advisedStatusTone,
  type AdvisedStatus,
  type OrderAdvisedItem,
} from "@/lib/orders/advised-items/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber } from "@/lib/format";
import { withCreatedColumns } from "@/components/ui/created-columns";

interface Props {
  /** The order these advised items belong to — fixed for this page. */
  fixedOrder: { id: string; order_number: string | null };
  items: OrderAdvisedItem[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * DENSE INPUTS (operator, 2026-09-15: "much more compact and tight … a dense,
 * enterprise UI look"). `Input` sets no vertical padding — its height IS the
 * `h-9 @2xl/editor:h-8` pair — so `py-1` alone would change nothing; `h-7`
 * (28px) is what actually shrinks the box, with `py-1` + `text-sm` (20px line)
 * filling it exactly. `px-2` sits under the primitive's `px-2.5`. One const,
 * six readers, so the form's boxes cannot drift apart from each other.
 *
 * `@2xl/editor:h-7` is not redundant: `cn` drops the primitive's bare `h-9`
 * for ours, but its `@2xl/editor:h-8` is a different variant and survives the
 * merge — and a container-query utility sorts AFTER a bare one, so without the
 * twin the box would be 28px on a phone and back to 32px on the desktop the
 * request was made about.
 */
const COMPACT_INPUT = "h-7 @2xl/editor:h-7 py-1 px-2 text-sm";

/**
 * COMPACT, BY WIDTH RATHER THAN BY TWELFTHS (operator, 2026-09-15: "reduce the
 * width of the input boxes so they don't stretch so far"). Every cell was
 * `size="sm"` — a quarter of the pane, ~300px wide — so a Unit of "PCS" and a
 * two-decimal Quantity each sat in a box built for a customer name.
 * `erp-form-compact`: an input is as wide as the kind of value it holds, never
 * as wide as the column it lands in — and a fraction cannot be made compact,
 * so the answer is leaving `FieldGrid` for `FieldRow` + `w=`, not a
 * `max-w-[200px]` on each control inside the same twelfth.
 *
 * One `FieldRow` wrapping at the 8px `pack` gap the operator asked for:
 *
 *   288 + 176 + 112 + 144 + 200 + 288  =  1208 + 5 x 8 = 1248
 *   item · attribute · qty · unit · supplier · remarks
 *
 * That is one line on a wide pane and two on a laptop, folding after Unit.
 * The JSX order is unchanged, so Tab still runs the same path it always did.
 */
const AI_W = {
  item: "name", //      free text — no schema maximum
  attribute: "term", // "YARN DYED", a two-word attribute
  quantity: "range", // "1,234.50" — number + 2 decimals + the spinner gutter
  unit: "code", //      PCS / M / KG, and the "pcs / m / kg" placeholder
  supplier: "party", // a party name in a short box — `term` clips, `name` oversizes
  remarks: "name", //   free text
} satisfies Record<string, FieldWidth>;

export function AdvisedItemsEditor({
  fixedOrder,
  items,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [description, setDescription] = useState("");
  const [attribute, setAttribute] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [remarks, setRemarks] = useState("");

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(formOpen || isPending);

  function resetForm() {
    setDescription("");
    setAttribute("");
    setQuantity("");
    setUnit("");
    setSupplier("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addAdvisedItem({
        sales_order_id: fixedOrder.id,
        description: description.trim(),
        attribute: attribute.trim() || null,
        quantity: Number(quantity) || 0,
        unit: unit.trim() || null,
        supplier: supplier.trim() || null,
        remarks: remarks.trim() || null,
      });
      if (result.ok) {
        success("Advised item added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(itemId: string, status: AdvisedStatus) {
    startTransition(async () => {
      const result = await setAdvisedItemStatus(itemId, status);
      if (result.ok) {
        success("Status updated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(itemId: string) {
    startTransition(async () => {
      const result = await deleteAdvisedItem(itemId);
      if (result.ok) {
        success("Item removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<OrderAdvisedItem>[] = [
    {
      header: "Item",
      cell: (i) => <span className="font-medium">{i.description}</span>,
    },
    {
      header: "Attribute",
      cell: (i) => (
        <span className="text-muted-foreground">{i.attribute ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums">
          {fmtNumber(i.quantity)}
          {i.unit ? ` ${i.unit}` : ""}
        </span>
      ),
    },
    {
      header: "Supplier",
      cell: (i) => (
        <span className="text-muted-foreground">{i.supplier ?? "—"}</span>
      ),
    },
    {
      header: "Status",
      cell: (i) =>
        canEdit ? (
          <Select
            value={i.status}
            onChange={(e) =>
              handleStatus(i.id, e.target.value as AdvisedStatus)
            }
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Advised item status"
          >
            {ADVISED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ADVISED_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={advisedStatusTone(i.status)}>
            {ADVISED_STATUS_LABELS[i.status]}
          </StatusPill>
        ),
    },
    ...(canDelete
      ? [
          rowActionsColumn<OrderAdvisedItem>((i) => (
            <RowActions
              onDelete={() => handleDelete(i.id)}
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="md" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New advised item</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        /* FLAT, NOT A CARD (operator, 2026-09-15: "no shadow, no borders …
           blend completely flat and seamlessly with the page's background").
           This used to be `Card` › `CardHeader` › `CardBody`, and `Card` is
           the app's raised surface panel — `rounded-xl border bg-surface`
           plus the smoke wash, `shadow-elev` and `inset-shadow-sheen`. Those
           are five utilities across two layers, so "override them with
           className" is five overrides that each have to be re-found the
           day the primitive changes; a plain `<section>` has nothing to
           undo. The title keeps `CardTitle`'s own type scale so the heading
           reads the same as every other panel's. */
        <section className="space-y-3" aria-labelledby="ai-form-title">
          <h3
            id="ai-form-title"
            className="text-sm font-semibold text-foreground"
          >
            New advised item
          </h3>
          <form
            // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
            // false, so Tab keeps native order, leaves the form and stops on
            // buttons — one of the ~51 page-level editors AGENTS.md counts as
            // missing this. See the `raagam-keyboard-contract` skill.
            data-focus-scope
            onSubmit={handleAdd}
            // `@container/editor` is the DENSITY container. `Input`, `Select`
            // and `Button` are each `h-9 @2xl/editor:h-8`, and a page-level
            // form declares no such container of its own (a Sheet or
            // MasterFullScreen does) — so this form sat at the 36px mobile
            // height on every desktop. Same move `default-account-head-
            // screen.tsx` makes for the same reason.
            className="@container/editor space-y-3"
          >
            {/* `FieldRow`, not a hand-rolled flex row and not `FieldGrid` —
                see `AI_W` above for why the twelfths track was left. The
                8px `pack` gap is the operator's own number ("change gap-6 or
                gap-4 to gap-2"). */}
            <FieldRow gap="pack">
              {/* `required` on the Field, not a `*` typed into the label — the
                  same prop draws the star AND stamps `data-required-empty`, so
                  the cursor holds on a blank box. */}
              <Field label="Item" required w={AI_W.item} htmlFor="ai-desc">
                <Input
                  id="ai-desc"
                  className={COMPACT_INPUT}
                  uppercase
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </Field>
              <Field label="Attribute" w={AI_W.attribute} htmlFor="ai-attr">
                <Input
                  id="ai-attr"
                  className={COMPACT_INPUT}
                  uppercase
                  value={attribute}
                  onChange={(e) => setAttribute(e.target.value)}
                />
              </Field>
              <Field label="Quantity" w={AI_W.quantity} htmlFor="ai-qty">
                <Input
                  id="ai-qty"
                  className={COMPACT_INPUT}
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Unit" w={AI_W.unit} htmlFor="ai-unit">
                <Input
                  id="ai-unit"
                  className={COMPACT_INPUT}
                  uppercase
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="pcs / m / kg"
                />
              </Field>
              <Field
                label="Suggested supplier"
                w={AI_W.supplier}
                htmlFor="ai-supp"
              >
                <Input
                  id="ai-supp"
                  className={COMPACT_INPUT}
                  uppercase
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Remarks" w={AI_W.remarks} htmlFor="ai-rem">
                <Input
                  id="ai-rem"
                  className={COMPACT_INPUT}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </FieldRow>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending || !description.trim()}>
                {isPending ? "Adding…" : "Add advised item"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* The list stands down while the form is open — the operator is typing a
          new line, not reading the existing ones, and the table beneath the
          expand-in-place form only pushed the Add button out of view. It
          returns the moment the form closes (Cancel, or a successful add). */}
      {!formOpen && (
        <DataTable
          columns={withCreatedColumns(columns, items)}
          rows={items}
          getKey={(i) => i.id}
          /* TIGHT (operator, 2026-09-15: "compact, tighten properly"). The
             cells above pin no `text-sm` of their own so the table's `dense`
             size reaches them; the Status `<Select>` is already `h-7`. */
          dense
          empty="No advised items for this order yet. Use 'New advised item' above."
        />
      )}
    </div>
  );
}
