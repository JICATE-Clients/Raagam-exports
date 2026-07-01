"use client";

import { useState, useTransition } from "react";
import {
  addBudgetLine,
  updateBudgetLine,
  deleteBudgetLine,
  pullFromBoms,
  submitBudget,
  approveBudget,
  rejectBudget,
} from "@/lib/planning/budget-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtNumber } from "@/lib/format";
import {
  BUDGET_LINE_SOURCES,
  type Budget,
  type BudgetLine,
  type BudgetLineSource,
} from "@/lib/planning/types";
import type { BudgetOrderRow } from "@/lib/planning/budget-service";
import type { StatusTone } from "@/components/ui/status-pill";

// ---------- helpers ----------

function sourceTone(source: BudgetLineSource): StatusTone {
  switch (source) {
    case "fabric":
      return "info";
    case "material":
      return "success";
    case "other":
      return "neutral";
  }
}

const SOURCE_LABELS: Record<BudgetLineSource, string> = {
  fabric: "Fabric",
  material: "Material",
  other: "Other",
};

// ---------- line form state ----------

type LineFormFields = {
  sales_order_id: string;
  source: BudgetLineSource;
  description: string;
  quantity: string;
  unit_cost: string;
};

function makeEmptyForm(budget: Budget, orders: BudgetOrderRow[]): LineFormFields {
  // for single-order budgets, pre-fill the order ID so the user doesn't need to select
  const defaultOrderId =
    !budget.is_grouped && orders.length > 0
      ? (orders[0]?.sales_order_id ?? "")
      : "";
  return {
    sales_order_id: defaultOrderId,
    source: "other",
    description: "",
    quantity: "0",
    unit_cost: "0",
  };
}

function formToPayload(f: LineFormFields, sortOrder: number) {
  return {
    sales_order_id: f.sales_order_id || null,
    source: f.source,
    description: f.description,
    quantity: parseFloat(f.quantity) || 0,
    unit_cost: parseFloat(f.unit_cost) || 0,
    sort_order: sortOrder,
  };
}

// ---------- component ----------

interface Props {
  budget: Budget;
  orders: BudgetOrderRow[];
  lines: BudgetLine[];
  canApprove: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function BudgetDetail({
  budget,
  orders,
  lines,
  canApprove,
  canEdit,
  canDelete,
}: Props) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // null = closed; "add" = add form; string = line id being edited
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<LineFormFields>(
    makeEmptyForm(budget, orders),
  );

  const isDraft = budget.status === "draft";
  const canMutateLines = isDraft && canEdit;

  function openAdd() {
    setForm(makeEmptyForm(budget, orders));
    setFormMode("add");
  }

  function openEdit(line: BudgetLine) {
    setForm({
      sales_order_id: line.sales_order_id ?? "",
      source: line.source,
      description: line.description,
      quantity: String(line.quantity),
      unit_cost: String(line.unit_cost),
    });
    setFormMode(line.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  // ---------- action handlers ----------

  function handleAdd() {
    const data = formToPayload(form, lines.length);
    startTransition(async () => {
      const result = await addBudgetLine(budget.id, data);
      if (result.ok) {
        success("Line added");
        closeForm();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleUpdate(lineId: string, sortOrder: number) {
    const data = formToPayload(form, sortOrder);
    startTransition(async () => {
      const result = await updateBudgetLine(lineId, budget.id, data);
      if (result.ok) {
        success("Line updated");
        closeForm();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(lineId: string) {
    startTransition(async () => {
      const result = await deleteBudgetLine(lineId, budget.id);
      if (result.ok) {
        success("Line deleted");
      } else {
        toastError(result.error);
      }
    });
  }

  function handlePullFromBoms() {
    startTransition(async () => {
      const result = await pullFromBoms(budget.id);
      if (result.ok) {
        success("Lines pulled from BOMs");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitBudget(budget.id);
      if (result.ok) {
        success("Budget submitted for approval");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveBudget(budget.id);
      if (result.ok) {
        success("Budget approved");
      } else {
        toastError(result.error);
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectBudget(budget.id);
      if (result.ok) {
        success("Budget rejected");
      } else {
        toastError(result.error);
      }
    });
  }

  // ---------- line table columns ----------

  const editingLine =
    formMode && formMode !== "add"
      ? lines.find((l) => l.id === formMode)
      : undefined;

  const lineColumns: Column<BudgetLine>[] = [
    {
      header: "Source",
      cell: (row) => (
        <StatusPill tone={sourceTone(row.source)}>
          {SOURCE_LABELS[row.source]}
        </StatusPill>
      ),
    },
    {
      header: "Description",
      cell: (row) => (
        <span className="max-w-xs truncate text-sm">{row.description}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-sm">{fmtNumber(row.quantity)}</span>
      ),
    },
    {
      header: "Unit cost",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-sm">
          {fmtMoney(row.unit_cost, budget.currency_code)}
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtMoney(row.amount, budget.currency_code)}
        </span>
      ),
    },
    ...(canMutateLines || (isDraft && canDelete)
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (row: BudgetLine) => (
              <div className="flex items-center justify-end gap-1">
                {canMutateLines && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      formMode === row.id ? closeForm() : openEdit(row)
                    }
                  >
                    {formMode === row.id ? "Cancel" : "Edit"}
                  </Button>
                )}
                {isDraft && canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    disabled={isPending}
                    onClick={() => handleDelete(row.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* --- Covered orders --- */}
      <Card>
        <CardHeader>
          <CardTitle>Covered orders</CardTitle>
        </CardHeader>
        <CardBody>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders linked.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Order #
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Buyer
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Qty (pcs)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.sales_order_id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 font-mono text-xs font-medium">
                        {o.order_number ?? o.sales_order_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">{o.buyer_name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNumber(o.order_qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* --- Budget lines --- */}
      <Card>
        <CardHeader>
          <CardTitle>Budget lines</CardTitle>
          {canMutateLines && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handlePullFromBoms}
              >
                Pull from BOMs
              </Button>
              {formMode !== "add" && (
                <Button size="sm" onClick={openAdd}>
                  Add line
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <DataTable
            columns={lineColumns}
            rows={lines}
            getKey={(row) => row.id}
            empty="No lines yet. Add manually or use 'Pull from BOMs'."
          />

          {/* Inline form — shown for both add and edit modes */}
          {formMode !== null && (
            <LineForm
              form={form}
              setForm={setForm}
              budget={budget}
              orders={orders}
              isAdd={formMode === "add"}
              isPending={isPending}
              onSave={() => {
                if (formMode === "add") {
                  handleAdd();
                } else if (editingLine) {
                  handleUpdate(editingLine.id, editingLine.sort_order);
                }
              }}
              onCancel={closeForm}
            />
          )}
        </CardBody>
      </Card>

      {/* --- Actions --- */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            {budget.status === "draft" && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                Submit for approval
              </Button>
            )}

            {budget.status === "submitted" && canApprove && (
              <>
                <Button disabled={isPending} onClick={handleApprove}>
                  Approve
                </Button>
                <Button
                  variant="danger"
                  disabled={isPending}
                  onClick={handleReject}
                >
                  Reject
                </Button>
              </>
            )}

            {budget.status === "submitted" && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Awaiting approval by an authorised reviewer.
              </p>
            )}

            {budget.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Budget approved
                {budget.approved_at
                  ? ` on ${new Date(budget.approved_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                  : ""}
                .
              </p>
            )}

            {budget.status === "rejected" && (
              <p className="text-sm text-muted-foreground">
                Budget was rejected. Create a new budget or contact your reviewer.
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------- LineForm sub-component ----------

function LineForm({
  form,
  setForm,
  budget,
  orders,
  isAdd,
  isPending,
  onSave,
  onCancel,
}: {
  form: LineFormFields;
  setForm: React.Dispatch<React.SetStateAction<LineFormFields>>;
  budget: Budget;
  orders: BudgetOrderRow[];
  isAdd: boolean;
  isPending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const amountPreview =
    (parseFloat(form.quantity) || 0) * (parseFloat(form.unit_cost) || 0);

  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add line" : "Edit line"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>Source</Label>
          <Select
            value={form.source}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                source: e.target.value as BudgetLineSource,
              }))
            }
          >
            {BUDGET_LINE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>

        {/* Order picker: only for grouped budgets */}
        {budget.is_grouped && orders.length > 0 && (
          <div>
            <Label>Order (optional)</Label>
            <Select
              value={form.sales_order_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, sales_order_id: e.target.value }))
              }
            >
              <option value="">— all covered orders —</option>
              {orders.map((o) => (
                <option key={o.sales_order_id} value={o.sales_order_id}>
                  {o.order_number ?? o.sales_order_id.slice(0, 8)}
                  {o.buyer_name ? ` — ${o.buyer_name}` : ""}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div
          className={
            budget.is_grouped && orders.length > 0
              ? ""
              : "sm:col-span-2 md:col-span-2"
          }
        >
          <Label>Description</Label>
          <Input
            placeholder="e.g. Cotton jersey fabric"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div>
          <Label>Quantity</Label>
          <Input
            type="number"
            step="0.001"
            min="0"
            placeholder="0"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
          />
        </div>

        <div>
          <Label>
            Unit cost{budget.currency_code ? ` (${budget.currency_code})` : ""}
          </Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.unit_cost}
            onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
          />
        </div>

        <div className="flex items-end pb-0.5">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Amount preview
            </p>
            <p className="tabular-nums text-sm font-semibold">
              {fmtMoney(amountPreview, budget.currency_code)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending || !form.description.trim()}
          onClick={onSave}
        >
          {isPending ? "Saving…" : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}
