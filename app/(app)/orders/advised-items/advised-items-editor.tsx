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
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
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
      cell: (i) => <span className="text-sm font-medium">{i.description}</span>,
    },
    {
      header: "Attribute",
      cell: (i) => (
        <span className="text-sm text-muted-foreground">{i.attribute ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(i.quantity)}
          {i.unit ? ` ${i.unit}` : ""}
        </span>
      ),
    },
    {
      header: "Supplier",
      cell: (i) => (
        <span className="text-sm text-muted-foreground">{i.supplier ?? "—"}</span>
      ),
    },
    {
      header: "Status",
      cell: (i) =>
        canEdit ? (
          <Select
            value={i.status}
            onChange={(e) => handleStatus(i.id, e.target.value as AdvisedStatus)}
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
        <Card>
          <CardHeader>
            <CardTitle>New advised item</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
              // false, so Tab keeps native order, leaves the form and stops on
              // buttons — one of the ~51 page-level editors AGENTS.md counts as
              // missing this. See the `raagam-keyboard-contract` skill.
              data-focus-scope
              onSubmit={handleAdd}
              className="space-y-4"
            >
              {/* `FieldGrid`, not a hand-rolled `lg:grid-cols-3` with a
                  `col-span-*` on Remarks — a screen composes primitives, it does
                  not draw (LAYOUT.md §3). */}
              <FieldGrid>
                {/* `required` on the Field, not a `*` typed into the label — the
                    same prop draws the star AND stamps `data-required-empty`, so
                    the cursor holds on a blank box. */}
                <Field label="Item" required size="sm" htmlFor="ai-desc">
                  <Input
                    id="ai-desc"
                    uppercase
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Main label"
                    required
                  />
                </Field>
                <Field label="Attribute" size="sm" htmlFor="ai-attr">
                  <Input
                    id="ai-attr"
                    uppercase
                    value={attribute}
                    onChange={(e) => setAttribute(e.target.value)}
                    placeholder="e.g. woven, red"
                  />
                </Field>
                <Field label="Quantity" size="sm" htmlFor="ai-qty">
                  <Input
                    id="ai-qty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Unit" size="sm" htmlFor="ai-unit">
                  <Input
                    id="ai-unit"
                    uppercase
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="pcs / m / kg"
                  />
                </Field>
                <Field label="Suggested supplier" size="sm" htmlFor="ai-supp">
                  <Input
                    id="ai-supp"
                    uppercase
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Remarks" size="sm" htmlFor="ai-rem">
                  <Input
                    id="ai-rem"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </FieldGrid>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !description.trim()}>
                  {isPending ? "Adding…" : "Add advised item"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={withCreatedColumns(columns, items)}
        rows={items}
        getKey={(i) => i.id}
        empty="No advised items for this order yet. Use 'New advised item' above."
      />
    </div>
  );
}
