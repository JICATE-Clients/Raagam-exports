"use client";

import { useState, useTransition } from "react";
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
} from "@/lib/orders/advised-items/types";
import type { AdvisedItemWithOrder } from "@/lib/orders/advised-items/service";
import type { OrderWithBuyer } from "@/lib/orders/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber } from "@/lib/format";

interface Props {
  items: AdvisedItemWithOrder[];
  orders: OrderWithBuyer[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function AdvisedItemsClient({
  items,
  orders,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [attribute, setAttribute] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setOrderId("");
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
        sales_order_id: orderId,
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

  const columns: Column<AdvisedItemWithOrder>[] = [
    {
      header: "Order",
      cell: (i) => (
        <span className="font-mono text-xs">
          {i.sales_orders?.order_number ?? "—"}
        </span>
      ),
    },
    {
      header: "Buyer",
      cell: (i) => (
        <span className="text-sm">{i.sales_orders?.buyers?.name ?? "—"}</span>
      ),
    },
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
          {
            header: "",
            align: "right",
            cell: (i: AdvisedItemWithOrder) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(i.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Delete
              </Button>
            ),
          } satisfies Column<AdvisedItemWithOrder>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
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
              onSubmit={handleAdd}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="ai-order">Order *</Label>
                <Select
                  id="ai-order"
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
                <Label htmlFor="ai-desc">Item *</Label>
                <Input
                  id="ai-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Main label"
                  required
                />
              </div>
              <div>
                <Label htmlFor="ai-attr">Attribute</Label>
                <Input
                  id="ai-attr"
                  value={attribute}
                  onChange={(e) => setAttribute(e.target.value)}
                  placeholder="e.g. woven, red"
                />
              </div>
              <div>
                <Label htmlFor="ai-qty">Quantity</Label>
                <Input
                  id="ai-qty"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="ai-unit">Unit</Label>
                <Input
                  id="ai-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="pcs / m / kg"
                />
              </div>
              <div>
                <Label htmlFor="ai-supp">Suggested supplier</Label>
                <Input
                  id="ai-supp"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label htmlFor="ai-rem">Remarks</Label>
                <Input
                  id="ai-rem"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                />
              </div>
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
        columns={columns}
        rows={items}
        getKey={(i) => i.id}
        empty="No advised items yet."
      />
    </div>
  );
}
