"use client";

import { useState, useTransition } from "react";
import {
  addMaterialBomProduct,
  updateMaterialBomProduct,
  deleteMaterialBomProduct,
  addMaterialBomProcessSequence,
  deleteMaterialBomProcessSequence,
  addMaterialBomProcessStage,
  updateMaterialBomProcessStage,
  deleteMaterialBomProcessStage,
  submitMaterialBom,
  approveMaterialBom,
} from "@/lib/planning/bom-actions";
import type {
  MaterialBomProduct,
  MaterialBomProcessSequence,
  MaterialBomProcessStage,
  BomStatus,
  YarnReqdForm,
  ProcessStageYarn,
  ProcessStageFabric,
  LossForYarn,
  LossForFabric,
} from "@/lib/planning/bom-types";
import {
  YARN_REQD_FORMS,
  YARN_REQD_FORM_LABELS,
  PROCESS_STAGES_YARN,
  PROCESS_STAGES_FABRIC,
  LOSS_FOR_YARN,
  LOSS_FOR_YARN_LABELS,
  LOSS_FOR_FABRIC,
  LOSS_FOR_FABRIC_LABELS,
} from "@/lib/planning/bom-types";
import type { getMaterialBom } from "@/lib/planning/bom-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

// ---------- types ----------

type BomDetail = NonNullable<Awaited<ReturnType<typeof getMaterialBom>>>;

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

// ---------- Product (Cloths) line form ----------

type ProductFields = {
  item_id: string;
  order_qty: string;
  excess_pct: string;
  extra_qty: string;
  additional_qty: string;
  total_qty: string;
  rate: string;
  inr_rate: string;
  yarn_reqd_form: string;
  description: string;
};

function emptyProduct(): ProductFields {
  return {
    item_id: "",
    order_qty: "0",
    excess_pct: "0",
    extra_qty: "0",
    additional_qty: "0",
    total_qty: "0",
    rate: "0",
    inr_rate: "0",
    yarn_reqd_form: "",
    description: "",
  };
}

function productToFields(p: MaterialBomProduct): ProductFields {
  return {
    item_id: p.item_id ?? "",
    order_qty: String(p.order_qty),
    excess_pct: String(p.excess_pct),
    extra_qty: String(p.extra_qty),
    additional_qty: String(p.additional_qty),
    total_qty: String(p.total_qty),
    rate: String(p.rate),
    inr_rate: String(p.inr_rate),
    yarn_reqd_form: p.yarn_reqd_form ?? "",
    description: p.description ?? "",
  };
}

// ---------- Product line form component ----------

function ProductLineForm({
  form,
  setForm,
  isAdd,
  isPending,
  onSave,
  onCancel,
}: {
  form: ProductFields;
  setForm: React.Dispatch<React.SetStateAction<ProductFields>>;
  isAdd: boolean;
  isPending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add product" : "Edit product"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <Label>Order Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.order_qty}
            onChange={(e) => setForm((f) => ({ ...f, order_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Excess %</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.excess_pct}
            onChange={(e) => setForm((f) => ({ ...f, excess_pct: e.target.value }))}
          />
        </div>
        <div>
          <Label>Ex. Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.extra_qty}
            onChange={(e) => setForm((f) => ({ ...f, extra_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Appr. Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.additional_qty}
            onChange={(e) => setForm((f) => ({ ...f, additional_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Total Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.001"
            value={form.total_qty}
            onChange={(e) => setForm((f) => ({ ...f, total_qty: e.target.value }))}
          />
        </div>
        <div>
          <Label>Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.rate}
            onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
          />
        </div>
        <div>
          <Label>Price (INR)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.inr_rate}
            onChange={(e) => setForm((f) => ({ ...f, inr_rate: e.target.value }))}
          />
        </div>
        <div>
          <Label>Yarn Form</Label>
          <Select
            value={form.yarn_reqd_form}
            onChange={(e) => setForm((f) => ({ ...f, yarn_reqd_form: e.target.value }))}
          >
            <option value="">-- None --</option>
            {YARN_REQD_FORMS.map((v) => (
              <option key={v} value={v}>
                {YARN_REQD_FORM_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2 md:col-span-4">
          <Label>Specification</Label>
          <Textarea
            rows={2}
            maxLength={250}
            placeholder="Max 250 characters"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={isPending} onClick={onSave}>
          {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Cloths (Products) tab ----------

function ClothsTab({
  bom,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  onDelete: (itemId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<ProductFields>(emptyProduct());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm(emptyProduct());
    setFormMode("add");
  }

  function openEdit(p: MaterialBomProduct) {
    setForm(productToFields(p));
    setFormMode(p.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const editingProduct =
    formMode && formMode !== "add"
      ? bom.products.find((p) => p.id === formMode)
      : undefined;

  const productColumns: Column<MaterialBomProduct>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Product Code",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.item_id ? r.item_id.slice(0, 8) : "--"}</span>
      ),
    },
    {
      header: "Uom",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>
      ),
    },
    {
      header: "Order Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span>,
    },
    {
      header: "Excess %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.excess_pct)}</span>,
    },
    {
      header: "Ex. Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.extra_qty)}</span>,
    },
    {
      header: "Appr. Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.additional_qty)}</span>,
    },
    {
      header: "Total Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.total_qty)}</span>
      ),
    },
    {
      header: "Price",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span>,
    },
    {
      header: "Price (INR)",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.inr_rate)}</span>,
    },
    {
      header: "Yarn Form",
      cell: (r) => (
        <span className="text-sm">
          {r.yarn_reqd_form
            ? YARN_REQD_FORM_LABELS[r.yarn_reqd_form as YarnReqdForm] ?? r.yarn_reqd_form
            : "--"}
        </span>
      ),
    },
    {
      header: "Specification",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.description ?? "--"}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: MaterialBomProduct) => (
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
        <CardTitle>Products ({bom.products.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add product
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={productColumns}
          rows={bom.products}
          getKey={(r) => r.id}
          empty="No products yet. Add one to get started."
        />

        {formMode !== null && (
          <ProductLineForm
            form={form}
            setForm={setForm}
            isAdd={formMode === "add"}
            isPending={isPending}
            onSave={() => {
              const payload = {
                material_bom_id: bom.id,
                sno: formMode === "add" ? bom.products.length + 1 : editingProduct?.sno ?? 0,
                item_id: form.item_id || null,
                order_qty: parseFloat(form.order_qty) || 0,
                excess_pct: parseFloat(form.excess_pct) || 0,
                extra_qty: parseFloat(form.extra_qty) || 0,
                additional_qty: parseFloat(form.additional_qty) || 0,
                total_qty: parseFloat(form.total_qty) || 0,
                rate: parseFloat(form.rate) || 0,
                inr_rate: parseFloat(form.inr_rate) || 0,
                yarn_reqd_form: form.yarn_reqd_form || null,
                description: form.description.trim() || null,
                sort_order: formMode === "add" ? bom.products.length : (editingProduct?.sort_order ?? 0),
              };
              if (formMode === "add") {
                onAdd(payload);
              } else if (editingProduct) {
                onUpdate(editingProduct.id, payload);
              }
              closeForm();
            }}
            onCancel={closeForm}
          />
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Process Sequence tab (shared for Yarn and Fabric) ----------

type SequenceWithStages = MaterialBomProcessSequence & {
  stages: MaterialBomProcessStage[];
};

function ProcessSequenceTab({
  title,
  processType,
  sequences,
  bomId,
  canMutate,
  isPending,
  stageOptions,
  lossForOptions,
  lossForLabels,
  onAddSequence,
  onDeleteSequence,
  onAddStage,
  onUpdateStage,
  onDeleteStage,
}: {
  title: string;
  processType: "yarn" | "fabric";
  sequences: SequenceWithStages[];
  bomId: string;
  canMutate: boolean;
  isPending: boolean;
  stageOptions: readonly string[];
  lossForOptions: readonly string[];
  lossForLabels: Record<string, string>;
  onAddSequence: (data: {
    process_type: "yarn" | "fabric";
    sno: number;
    process_seq_name?: string | null;
    item_process_type?: string | null;
    sort_order?: number;
  }) => void;
  onDeleteSequence: (seqId: string) => void;
  onAddStage: (
    sequenceId: string,
    data: {
      sno: number;
      stage?: string | null;
      process_name?: string | null;
      loss_for?: string | null;
      loss_pct?: number;
      description?: string | null;
      sort_order?: number;
    },
  ) => void;
  onUpdateStage: (
    stageId: string,
    data: {
      stage?: string | null;
      process_name?: string | null;
      loss_for?: string | null;
      loss_pct?: number;
      description?: string | null;
    },
  ) => void;
  onDeleteStage: (stageId: string) => void;
}) {
  const [expandedSeqs, setExpandedSeqs] = useState<Set<string>>(new Set());
  const [addStageFor, setAddStageFor] = useState<string | null>(null);
  const [editStageId, setEditStageId] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState({
    stage: "",
    process_name: "",
    loss_for: "",
    loss_pct: "0",
    description: "",
  });

  useUnsavedGuard(addStageFor !== null || editStageId !== null);

  function toggleSeq(id: string) {
    setExpandedSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddStage(seqId: string) {
    setStageForm({ stage: "", process_name: "", loss_for: "", loss_pct: "0", description: "" });
    setAddStageFor(seqId);
    setEditStageId(null);
  }

  function openEditStage(s: MaterialBomProcessStage) {
    setStageForm({
      stage: s.stage ?? "",
      process_name: s.process_name ?? "",
      loss_for: s.loss_for ?? "",
      loss_pct: String(s.loss_pct),
      description: s.description ?? "",
    });
    setEditStageId(s.id);
    setAddStageFor(null);
  }

  function closeStageForm() {
    setAddStageFor(null);
    setEditStageId(null);
  }

  // Parent grid columns
  const parentColumns: Column<SequenceWithStages>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: processType === "yarn" ? "Yarn" : "Fabric Description",
      cell: (r) => <span className="text-sm">{r.process_seq_name ?? "--"}</span>,
    },
    ...(processType === "fabric"
      ? [
          {
            header: "Type",
            cell: (r: SequenceWithStages) => (
              <span className="text-sm capitalize">{r.item_process_type ?? "--"}</span>
            ),
          },
        ]
      : []),
    {
      header: processType === "yarn" ? "Yarn Form" : "Yarn Form",
      cell: (r) => (
        <span className="text-sm">
          {r.item_process_type && processType === "yarn"
            ? r.item_process_type
            : "--"}
        </span>
      ),
    },
    {
      header: "Stages",
      cell: (r) => <span className="tabular-nums text-sm">{r.stages.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleSeq(r.id)}
          >
            {expandedSeqs.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteSequence(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Child (stage) grid columns
  const stageColumns: Column<MaterialBomProcessStage>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Stage",
      cell: (r) => (
        <span className="text-sm uppercase">{r.stage ?? "--"}</span>
      ),
    },
    {
      header: "Process",
      cell: (r) => <span className="text-sm">{r.process_name ?? "--"}</span>,
    },
    {
      header: "For",
      cell: (r) => (
        <span className="text-sm">
          {r.loss_for ? (lossForLabels[r.loss_for] ?? r.loss_for) : "--"}
        </span>
      ),
    },
    {
      header: "Loss %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.loss_pct)}</span>,
    },
    {
      header: "Instruction",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.description ?? "--"}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: MaterialBomProcessStage) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    editStageId === r.id ? closeStageForm() : openEditStage(r)
                  }
                >
                  {editStageId === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteStage(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const stageFormUI = (
    seqId: string,
    seq: SequenceWithStages,
    isAdd: boolean,
  ) => (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add stage" : "Edit stage"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>Stage</Label>
          <Select
            value={stageForm.stage}
            onChange={(e) => setStageForm((f) => ({ ...f, stage: e.target.value }))}
          >
            <option value="">-- Select --</option>
            {stageOptions.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Process</Label>
          <Input
            value={stageForm.process_name}
            onChange={(e) =>
              setStageForm((f) => ({ ...f, process_name: e.target.value }))
            }
          />
        </div>
        <div>
          <Label>For</Label>
          <Select
            value={stageForm.loss_for}
            onChange={(e) => setStageForm((f) => ({ ...f, loss_for: e.target.value }))}
          >
            <option value="">-- Select --</option>
            {lossForOptions.map((v) => (
              <option key={v} value={v}>
                {lossForLabels[v] ?? v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Loss %</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={stageForm.loss_pct}
            onChange={(e) => setStageForm((f) => ({ ...f, loss_pct: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Instruction</Label>
          <Input
            value={stageForm.description}
            onChange={(e) =>
              setStageForm((f) => ({ ...f, description: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={closeStageForm}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            const payload = {
              stage: stageForm.stage || null,
              process_name: stageForm.process_name.trim() || null,
              loss_for: stageForm.loss_for || null,
              loss_pct: parseFloat(stageForm.loss_pct) || 0,
              description: stageForm.description.trim() || null,
            };
            if (isAdd) {
              onAddStage(seqId, {
                sno: seq.stages.length + 1,
                ...payload,
                sort_order: seq.stages.length,
              });
            } else if (editStageId) {
              onUpdateStage(editStageId, payload);
            }
            closeStageForm();
          }}
        >
          {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({sequences.length})
        </CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddSequence({
                process_type: processType,
                sno: sequences.length + 1,
                sort_order: sequences.length,
              })
            }
          >
            + Add sequence
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={parentColumns}
          rows={sequences}
          getKey={(r) => r.id}
          empty={`No ${processType} process sequences yet.`}
        />

        {/* Expanded child grids */}
        {sequences
          .filter((s) => expandedSeqs.has(s.id))
          .map((seq) => (
            <div key={`child-${seq.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Stages for: {seq.process_seq_name ?? `Sequence ${seq.sno}`}
                </p>
                {canMutate && addStageFor !== seq.id && (
                  <Button size="sm" variant="outline" onClick={() => openAddStage(seq.id)}>
                    + Add stage
                  </Button>
                )}
              </div>

              <DataTable
                columns={stageColumns}
                rows={seq.stages}
                getKey={(r) => r.id}
                empty="No stages."
              />

              {/* Edit form for a stage belonging to this sequence */}
              {editStageId &&
                seq.stages.some((s) => s.id === editStageId) &&
                stageFormUI(seq.id, seq, false)}

              {/* Add form */}
              {addStageFor === seq.id && stageFormUI(seq.id, seq, true)}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ---------- main component ----------

export function MaterialBomDetail({
  bom,
  canEdit,
  canDelete,
  canApprove,
}: {
  bom: BomDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = bom.status === "draft";
  const isSubmitted = bom.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  // ---------- Product (Cloths) handlers ----------

  function handleAddProduct(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addMaterialBomProduct(data as never);
      if (result.ok) success("Product added.");
      else toastError(result.error);
    });
  }

  function handleUpdateProduct(itemId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateMaterialBomProduct(itemId, bom.id, data as never);
      if (result.ok) success("Product updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteProduct(itemId: string) {
    startTransition(async () => {
      const result = await deleteMaterialBomProduct(itemId, bom.id);
      if (result.ok) success("Product deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Process Sequence handlers ----------

  function handleAddSequence(data: {
    process_type: "yarn" | "fabric";
    sno: number;
    process_seq_name?: string | null;
    item_process_type?: string | null;
    sort_order?: number;
  }) {
    startTransition(async () => {
      const result = await addMaterialBomProcessSequence(bom.id, data);
      if (result.ok) success("Sequence added.");
      else toastError(result.error);
    });
  }

  function handleDeleteSequence(seqId: string) {
    startTransition(async () => {
      const result = await deleteMaterialBomProcessSequence(seqId, bom.id);
      if (result.ok) success("Sequence deleted.");
      else toastError(result.error);
    });
  }

  function handleAddStage(
    sequenceId: string,
    data: {
      sno: number;
      stage?: string | null;
      process_name?: string | null;
      loss_for?: string | null;
      loss_pct?: number;
      description?: string | null;
      sort_order?: number;
    },
  ) {
    startTransition(async () => {
      const result = await addMaterialBomProcessStage(sequenceId, bom.id, data);
      if (result.ok) success("Stage added.");
      else toastError(result.error);
    });
  }

  function handleUpdateStage(
    stageId: string,
    data: {
      stage?: string | null;
      process_name?: string | null;
      loss_for?: string | null;
      loss_pct?: number;
      description?: string | null;
    },
  ) {
    startTransition(async () => {
      const result = await updateMaterialBomProcessStage(stageId, bom.id, data);
      if (result.ok) success("Stage updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteStage(stageId: string) {
    startTransition(async () => {
      const result = await deleteMaterialBomProcessStage(stageId, bom.id);
      if (result.ok) success("Stage deleted.");
      else toastError(result.error);
    });
  }

  // ---------- Workflow handlers ----------

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitMaterialBom(bom.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMaterialBom(bom.id);
      if (result.ok) success("Material BOM approved.");
      else toastError(result.error);
    });
  }

  // ---------- Tab 1: Cloths ----------

  const clothsTab = (
    <ClothsTab
      bom={bom}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddProduct}
      onUpdate={handleUpdateProduct}
      onDelete={handleDeleteProduct}
    />
  );

  // ---------- Tab 2: Yarn Process ----------

  const yarnProcessTab = (
    <ProcessSequenceTab
      title="Yarn Process"
      processType="yarn"
      sequences={bom.yarn_sequences}
      bomId={bom.id}
      canMutate={canMutate}
      isPending={isPending}
      stageOptions={PROCESS_STAGES_YARN}
      lossForOptions={LOSS_FOR_YARN}
      lossForLabels={LOSS_FOR_YARN_LABELS}
      onAddSequence={handleAddSequence}
      onDeleteSequence={handleDeleteSequence}
      onAddStage={handleAddStage}
      onUpdateStage={handleUpdateStage}
      onDeleteStage={handleDeleteStage}
    />
  );

  // ---------- Tab 3: Fabric Process ----------

  const fabricProcessTab = (
    <ProcessSequenceTab
      title="Fabric Process"
      processType="fabric"
      sequences={bom.fabric_sequences}
      bomId={bom.id}
      canMutate={canMutate}
      isPending={isPending}
      stageOptions={PROCESS_STAGES_FABRIC}
      lossForOptions={LOSS_FOR_FABRIC}
      lossForLabels={LOSS_FOR_FABRIC_LABELS}
      onAddSequence={handleAddSequence}
      onDeleteSequence={handleDeleteSequence}
      onAddStage={handleAddStage}
      onUpdateStage={handleUpdateStage}
      onDeleteStage={handleDeleteStage}
    />
  );

  // ---------- render ----------

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Entry No</dt>
              <dd className="font-medium">{bom.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd>{fmtDate(bom.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{bom.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">SC No</dt>
              <dd>{bom.order_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order No</dt>
              <dd>{bom.order_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={bomStatusTone(bom.status)}>
                  {BOM_STATUS_LABELS[bom.status]}
                </StatusPill>
              </dd>
            </div>
          </dl>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                {isPending ? "Submitting..." : "Submit for approval"}
              </Button>
            )}

            {isSubmitted && canApprove && (
              <Button disabled={isPending} onClick={handleApprove}>
                {isPending ? "Approving..." : "Approve"}
              </Button>
            )}

            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">
                Awaiting approval by an authorised reviewer.
              </p>
            )}

            {bom.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{bom.approved_at ? ` on ${fmtDate(bom.approved_at)}` : ""}.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Tabs — 3 tabs for Raagam company 38 */}
      <Tabs
        items={[
          { key: "cloths", label: "Cloths", content: clothsTab },
          { key: "yarn_process", label: "Yarn Process", content: yarnProcessTab },
          { key: "fabric_process", label: "Fabric Process", content: fabricProcessTab },
        ]}
      />
    </div>
  );
}
