"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  assignCategory,
  unassignCategory,
} from "@/lib/logistics/export-categories/actions";
import type {
  AssignmentRow,
  OrderOption,
} from "@/lib/logistics/export-categories/service";
import type { ExportCategory } from "@/lib/logistics/export-categories/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";

interface Props {
  assignments: AssignmentRow[];
  categories: Pick<ExportCategory, "id" | "name">[];
  orders: OrderOption[];
  canCreate: boolean;
  canDelete: boolean;
}

export function OrderCategoriesClient({
  assignments,
  categories,
  orders,
  canCreate,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [orderId, setOrderId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setOrderId("");
    setCategoryId("");
    setNotes("");
    setFormOpen(false);
  }

  function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await assignCategory({
        sales_order_id: orderId,
        category_id: categoryId,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        success("Category assigned");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleUnassign(id: string) {
    startTransition(async () => {
      const result = await unassignCategory(id);
      if (result.ok) {
        success("Assignment removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<AssignmentRow>[] = [
    {
      header: "Order",
      cell: (a) => (
        <span className="font-mono text-xs">{a.sales_orders?.order_number ?? "—"}</span>
      ),
    },
    {
      header: "Buyer",
      cell: (a) => <span className="text-sm">{a.sales_orders?.buyers?.name ?? "—"}</span>,
    },
    {
      header: "Category",
      cell: (a) => <span className="text-sm font-medium">{a.export_categories?.name ?? "—"}</span>,
    },
    {
      header: "Notes",
      cell: (a) => <span className="text-sm text-muted-foreground">{a.notes ?? "—"}</span>,
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (a: AssignmentRow) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleUnassign(a.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Remove
              </Button>
            ),
          } satisfies Column<AssignmentRow>,
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
            <Button onClick={() => setFormOpen(true)}>Assign category</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Assign category to order</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleAssign} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="oc-order">Order *</Label>
                <Select id="oc-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
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
                <Label htmlFor="oc-cat">Category *</Label>
                <Select id="oc-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                  <option value="">— select category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="oc-notes">Notes</Label>
                <Input id="oc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !orderId || !categoryId}>
                  {isPending ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={assignments}
        getKey={(a) => a.id}
        empty="No category assignments yet."
      />
    </div>
  );
}
