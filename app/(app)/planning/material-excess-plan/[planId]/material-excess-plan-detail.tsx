"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMaterialExcessPlanItem,
  updateMaterialExcessPlanItem,
  deleteMaterialExcessPlanItem,
  submitMaterialExcessPlan,
  approveMaterialExcessPlan,
  deleteMaterialExcessPlan,
} from "@/lib/planning/material-planning-actions";
import type { getMaterialExcessPlan } from "@/lib/planning/material-planning-service";
import type { MaterialExcessPlanItem, MpStatus } from "@/lib/planning/material-planning-types";
import { ALLOWANCE_TYPES, ALLOWANCE_TYPE_LABELS } from "@/lib/planning/material-planning-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type PlanDetail = NonNullable<Awaited<ReturnType<typeof getMaterialExcessPlan>>>;

const STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function statusTone(status: MpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

// ---------- Item form fields ----------

type ItemFields = {
  sno: string;
  item_class_name: string;
  description: string;
  process_name: string;
  uom_id: string;
  qty_for_plan: string;
  wt_for_plan: string;
  allowance_type_to_order: string;
  allowed_to_order: string;
  allowance_type_to_issue: string;
  allowed_to_issue: string;
  allowance_type_to_receive: string;
  allowed_to_receive: string;
};

function emptyItem(): ItemFields {
  return {
    sno: "",
    item_class_name: "",
    description: "",
    process_name: "",
    uom_id: "",
    qty_for_plan: "0",
    wt_for_plan: "0",
    allowance_type_to_order: "P",
    allowed_to_order: "0",
    allowance_type_to_issue: "P",
    allowed_to_issue: "0",
    allowance_type_to_receive: "P",
    allowed_to_receive: "0",
  };
}

function rowToFields(r: MaterialExcessPlanItem): ItemFields {
  return {
    sno: String(r.sno),
    item_class_name: r.item_class_name ?? "",
    description: r.description ?? "",
    process_name: r.process_name ?? "",
    uom_id: r.uom_id ?? "",
    qty_for_plan: String(r.qty_for_plan),
    wt_for_plan: String(r.wt_for_plan),
    allowance_type_to_order: r.allowance_type_to_order,
    allowed_to_order: String(r.allowed_to_order),
    allowance_type_to_issue: r.allowance_type_to_issue,
    allowed_to_issue: String(r.allowed_to_issue),
    allowance_type_to_receive: r.allowance_type_to_receive,
    allowed_to_receive: String(r.allowed_to_receive),
  };
}

function fieldsToData(
  f: ItemFields,
  planId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    excess_plan_id: planId,
    sno: parseInt(f.sno) || fallbackSno,
    item_class_name: f.item_class_name.trim() || null,
    description: f.description.trim() || null,
    process_name: f.process_name.trim() || null,
    uom_id: f.uom_id.trim() || null,
    qty_for_plan: parseFloat(f.qty_for_plan) || 0,
    wt_for_plan: parseFloat(f.wt_for_plan) || 0,
    allowance_type_to_order: f.allowance_type_to_order,
    allowed_to_order: parseFloat(f.allowed_to_order) || 0,
    allowance_type_to_issue: f.allowance_type_to_issue,
    allowed_to_issue: parseFloat(f.allowed_to_issue) || 0,
    allowance_type_to_receive: f.allowance_type_to_receive,
    allowed_to_receive: parseFloat(f.allowed_to_receive) || 0,
    is_size_wise: false,
  };
}

// ---------- Items tab ----------

function ItemsTab({
  plan,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  plan: PlanDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<ItemFields>(emptyItem());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm(emptyItem());
    setFormMode("add");
  }

  function openEdit(r: MaterialExcessPlanItem) {
    setForm(rowToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingItem =
    formMode && formMode !== "add"
      ? plan.items.find((r) => r.id === formMode)
      : undefined;

  type ItemRow = PlanDetail["items"][number];
  const columns: Column<ItemRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Item Class",  cell: (r) => <span className="text-sm">{r.item_class_name ?? "--"}</span> },
    { header: "Description", cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "Process",     cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span> },
    { header: "UOM",         cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Qty Plan",    align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty_for_plan)}</span> },
    { header: "Wt Plan",     align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wt_for_plan)}</span> },
    {
      header: "To Order",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {ALLOWANCE_TYPE_LABELS[r.allowance_type_to_order] ?? r.allowance_type_to_order}{" "}
          {fmtNumber(r.allowed_to_order)}
        </span>
      ),
    },
    {
      header: "To Issue",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {ALLOWANCE_TYPE_LABELS[r.allowance_type_to_issue] ?? r.allowance_type_to_issue}{" "}
          {fmtNumber(r.allowed_to_issue)}
        </span>
      ),
    },
    {
      header: "To Receive",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {ALLOWANCE_TYPE_LABELS[r.allowance_type_to_receive] ?? r.allowance_type_to_receive}{" "}
          {fmtNumber(r.allowed_to_receive)}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: ItemRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => (formMode === r.id ? closeForm() : openEdit(r))}
                >
                  {formMode === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDelete(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Items ({plan.items.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add item
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={plan.items}
          getKey={(r) => r.id}
          empty="No items yet. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-bold text-muted-foreground">
              {formMode === "add" ? "Add item" : "Edit item"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>S No</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.sno}
                  onChange={(e) => setForm((f) => ({ ...f, sno: e.target.value }))}
                />
              </div>
              <div>
                <Label>Item Class</Label>
                <Input
                  value={form.item_class_name}
                  onChange={(e) => setForm((f) => ({ ...f, item_class_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>UOM</Label>
                <Input
                  value={form.uom_id}
                  onChange={(e) => setForm((f) => ({ ...f, uom_id: e.target.value }))}
                />
              </div>
              <div>
                <Label>Process</Label>
                <Input
                  value={form.process_name}
                  onChange={(e) => setForm((f) => ({ ...f, process_name: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <Label>Qty for Plan</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.qty_for_plan}
                  onChange={(e) => setForm((f) => ({ ...f, qty_for_plan: e.target.value }))}
                />
              </div>
              <div>
                <Label>Wt for Plan</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.wt_for_plan}
                  onChange={(e) => setForm((f) => ({ ...f, wt_for_plan: e.target.value }))}
                />
              </div>

              {/* To Order band */}
              <div>
                <Label>To Order — Type</Label>
                <Select
                  value={form.allowance_type_to_order}
                  onChange={(e) => setForm((f) => ({ ...f, allowance_type_to_order: e.target.value }))}
                >
                  {ALLOWANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{ALLOWANCE_TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>To Order — Value</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.allowed_to_order}
                  onChange={(e) => setForm((f) => ({ ...f, allowed_to_order: e.target.value }))}
                />
              </div>

              {/* To Issue band */}
              <div>
                <Label>To Issue — Type</Label>
                <Select
                  value={form.allowance_type_to_issue}
                  onChange={(e) => setForm((f) => ({ ...f, allowance_type_to_issue: e.target.value }))}
                >
                  {ALLOWANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{ALLOWANCE_TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>To Issue — Value</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.allowed_to_issue}
                  onChange={(e) => setForm((f) => ({ ...f, allowed_to_issue: e.target.value }))}
                />
              </div>

              {/* To Receive band */}
              <div>
                <Label>To Receive — Type</Label>
                <Select
                  value={form.allowance_type_to_receive}
                  onChange={(e) => setForm((f) => ({ ...f, allowance_type_to_receive: e.target.value }))}
                >
                  {ALLOWANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{ALLOWANCE_TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>To Receive — Value</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.allowed_to_receive}
                  onChange={(e) => setForm((f) => ({ ...f, allowed_to_receive: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const fallbackSno = formMode === "add" ? plan.items.length + 1 : (editingItem?.sno ?? 0);
                  const payload = fieldsToData(form, plan.id, fallbackSno);
                  if (formMode === "add") {
                    onAdd(payload);
                  } else if (editingItem) {
                    onUpdate(editingItem.id, payload);
                  }
                  closeForm();
                }}
              >
                {isPending ? "Saving..." : formMode === "add" ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Main component ----------

export function MaterialExcessPlanDetail({
  plan,
  canEdit,
  canDelete,
  canApprove,
}: {
  plan: PlanDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = plan.status === "draft";
  const isSubmitted = plan.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddItem(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addMaterialExcessPlanItem(data);
      if (res.ok) success("Item added.");
      else toastError(res.error);
    });
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateMaterialExcessPlanItem(itemId, plan.id, data);
      if (res.ok) success("Item updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const res = await deleteMaterialExcessPlanItem(itemId, plan.id);
      if (res.ok) success("Item deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitMaterialExcessPlan(plan.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveMaterialExcessPlan(plan.id);
      if (res.ok) { success("Material Excess Plan approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteMaterialExcessPlan(plan.id);
      if (res.ok) { success("Deleted."); router.push("/planning/material-excess-plan"); }
      else toastError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{plan.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(plan.entry_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{plan.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{plan.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group Description</dt>
              <dd>{plan.group_description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Allowance From Base</dt>
              <dd>{plan.is_allowance_from_base ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={statusTone(plan.status)}>
                  {STATUS_LABELS[plan.status]}
                </StatusPill>
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                {isPending ? "Submitting..." : "Submit for Approval"}
              </Button>
            )}
            {isSubmitted && canApprove && (
              <Button disabled={isPending} onClick={handleApprove}>
                {isPending ? "Approving..." : "Approve"}
              </Button>
            )}
            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">Awaiting approval by an authorised reviewer.</p>
            )}
            {plan.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{plan.approved_at ? ` on ${fmtDate(plan.approved_at)}` : ""}.
              </p>
            )}
            {isDraft && canDelete && (
              <Button
                variant="danger"
                disabled={isPending}
                onClick={handleDelete}
              >
                {isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs
        defaultKey="items"
        items={[
          {
            key: "items",
            label: `Items (${plan.items.length})`,
            content: (
              <ItemsTab
                plan={plan}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddItem}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
