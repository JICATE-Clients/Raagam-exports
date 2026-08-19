"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addGarmentPpmCancelStyle,
  updateGarmentPpmCancelStyle,
  deleteGarmentPpmCancelStyle,
  submitGarmentPpmCancellation,
  approveGarmentPpmCancellation,
  deleteGarmentPpmCancellation,
} from "@/lib/planning/ppm-actions";
import type { getGarmentPpmCancellation } from "@/lib/planning/ppm-service";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type CancelDetail = NonNullable<Awaited<ReturnType<typeof getGarmentPpmCancellation>>>;

const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppmStatusTone(status: PpmStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

// ---------- Style form fields ----------

type StyleFields = {
  sno: string;
  style_ref_no: string;
  style_no: string;
  article_no: string;
  sc_no: string;
  order_no: string;
  uom_id: string;
  cancel_qty: string;
};

function emptyStyle(): StyleFields {
  return {
    sno: "",
    style_ref_no: "",
    style_no: "",
    article_no: "",
    sc_no: "",
    order_no: "",
    uom_id: "",
    cancel_qty: "0",
  };
}

function styleToFields(r: CancelDetail["styles"][number]): StyleFields {
  return {
    sno: String(r.sno),
    style_ref_no: r.style_ref_no ?? "",
    style_no: r.style_no ?? "",
    article_no: r.article_no ?? "",
    sc_no: r.sc_no ?? "",
    order_no: r.order_no ?? "",
    uom_id: r.uom_id ?? "",
    cancel_qty: String(r.cancel_qty),
  };
}

function fieldsToData(
  fields: StyleFields,
  cancelId: string,
  isAdd: boolean,
  snoFallback: number,
) {
  return {
    cancellation_id: cancelId,
    sno: isAdd ? snoFallback : (parseInt(fields.sno, 10) || snoFallback),
    style_ref_no: fields.style_ref_no.trim() || null,
    style_no: fields.style_no.trim() || null,
    article_no: fields.article_no.trim() || null,
    sc_no: fields.sc_no.trim() || null,
    order_no: fields.order_no.trim() || null,
    uom_id: fields.uom_id.trim() || null,
    cancel_qty: parseFloat(fields.cancel_qty) || 0,
  };
}

// ---------- Styles tab ----------

function StylesTab({
  cancel,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  cancel: CancelDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (styleId: string, data: Record<string, unknown>) => void;
  onDelete: (styleId: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<StyleFields>(emptyStyle());
  const [expandedStyles, setExpandedStyles] = useState<Set<string>>(new Set());

  useUnsavedGuard(formMode !== null);

  function openAdd() {
    setForm(emptyStyle());
    setFormMode("add");
  }

  function openEdit(r: CancelDetail["styles"][number]) {
    setForm(styleToFields(r));
    setFormMode(r.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  function toggleExpand(id: string) {
    setExpandedStyles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const editingStyle =
    formMode && formMode !== "add"
      ? cancel.styles.find((r) => r.id === formMode)
      : undefined;

  const isAdd = formMode === "add";

  type StyleRow = CancelDetail["styles"][number];
  const styleColumns: Column<StyleRow>[] = [
    { header: "S No",       cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Style Ref",  cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Style",      cell: (r) => <span className="text-sm">{r.style_no ?? "--"}</span> },
    { header: "Article",    cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span> },
    { header: "SC No",      cell: (r) => <span className="text-sm">{r.sc_no ?? "--"}</span> },
    { header: "Order No",   cell: (r) => <span className="text-sm">{r.order_no ?? "--"}</span> },
    { header: "UOM",        cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span> },
    { header: "Cancel Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm font-medium">{fmtNumber(r.cancel_qty)}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => {
        const hasCombos = r.combos.length > 0 || r.coordinates.length > 0;
        return (
          <div className="flex items-center justify-end gap-1">
            {hasCombos && (
              <Button size="sm" variant="ghost" onClick={() => toggleExpand(r.id)}>
                {expandedStyles.has(r.id) ? "Hide" : "Details"}
              </Button>
            )}
            {canMutate && (
              <>
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
              </>
            )}
          </div>
        );
      },
    },
  ];

  type ComboRow = StyleRow["combos"][number];
  const comboColumns: Column<ComboRow>[] = [
    { header: "Color",        cell: (r) => <span className="text-sm">{r.item_color ?? "--"}</span> },
    { header: "WO Qty",       align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.wo_qty)}</span> },
    { header: "Received Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span> },
    { header: "Cancel Qty",   align: "right", cell: (r) => <span className="tabular-nums text-sm font-medium">{fmtNumber(r.cancel_qty)}</span> },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Styles ({cancel.styles.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={openAdd}>
            + Add style
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={styleColumns}
          rows={cancel.styles}
          getKey={(r) => r.id}
        />

        {/* Inline form panel */}
        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {isAdd ? "Add style" : "Edit style"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Style Ref No</Label>
                <Input
                  value={form.style_ref_no}
                  onChange={(e) => setForm((f) => ({ ...f, style_ref_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Style No</Label>
                <Input
                  value={form.style_no}
                  onChange={(e) => setForm((f) => ({ ...f, style_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Article No</Label>
                <Input
                  value={form.article_no}
                  onChange={(e) => setForm((f) => ({ ...f, article_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>SC No</Label>
                <Input
                  value={form.sc_no}
                  onChange={(e) => setForm((f) => ({ ...f, sc_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Order No</Label>
                <Input
                  value={form.order_no}
                  onChange={(e) => setForm((f) => ({ ...f, order_no: e.target.value }))}
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
                <Label>Cancel Qty</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.cancel_qty}
                  onChange={(e) => setForm((f) => ({ ...f, cancel_qty: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Coordinates and combos/sizes can be managed in the Details panel after saving.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const payload = fieldsToData(
                    form,
                    cancel.id,
                    isAdd,
                    isAdd ? cancel.styles.length + 1 : (editingStyle?.sno ?? 0),
                  );
                  if (isAdd) {
                    onAdd(payload);
                  } else if (editingStyle) {
                    onUpdate(editingStyle.id, payload);
                  }
                  closeForm();
                }}
              >
                {isPending ? "Saving..." : isAdd ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* Expanded child detail panels (coordinates + combos) — read-only */}
        {cancel.styles
          .filter((s) => expandedStyles.has(s.id))
          .map((style) => (
            <div key={`detail-${style.id}`} className="ml-4 space-y-3 rounded-md border border-border p-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Style #{style.sno} — {style.style_no ?? style.style_ref_no ?? ""}
              </p>
              {style.coordinates.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Coordinates</p>
                  <div className="flex flex-wrap gap-2">
                    {style.coordinates.map((c) => (
                      <span key={c.id} className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs">
                        {c.coordinate ?? "--"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {style.combos.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Combos</p>
                  <DataTable columns={comboColumns} rows={style.combos} getKey={(r) => r.id} />
                </div>
              )}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ---------- main component ----------

export function GarmentPpmCancelDetail({
  cancel,
  canEdit,
  canDelete,
  canApprove,
}: {
  cancel: CancelDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = cancel.status === "draft";
  const isSubmitted = cancel.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddStyle(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addGarmentPpmCancelStyle(data);
      if (res.ok) success("Style added.");
      else toastError(res.error);
    });
  }

  function handleUpdateStyle(styleId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateGarmentPpmCancelStyle(styleId, cancel.id, data);
      if (res.ok) success("Style updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteStyle(styleId: string) {
    startTransition(async () => {
      const res = await deleteGarmentPpmCancelStyle(styleId, cancel.id);
      if (res.ok) success("Style deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitGarmentPpmCancellation(cancel.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveGarmentPpmCancellation(cancel.id);
      if (res.ok) { success("Garment PPM Cancel approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteGarmentPpmCancellation(cancel.id);
      if (res.ok) { success("Deleted."); router.push("/planning/garment-ppm-cancel"); }
      else toastError(res.error);
    });
  }

  const stylesTab = (
    <StylesTab
      cancel={cancel}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddStyle}
      onUpdate={handleUpdateStyle}
      onDelete={handleDeleteStyle}
    />
  );

  return (
    <div className="space-y-4">
      {/* Header summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{cancel.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cancel Date</dt>
              <dd className="tabular-nums">{fmtDate(cancel.cancel_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Reference</dt>
              <dd>{cancel.ppm_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{cancel.customer_name ?? "--"}</dd>
            </div>
            {cancel.description && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">Description</dt>
                <dd className="text-muted-foreground">{cancel.description}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={ppmStatusTone(cancel.status)}>
                  {PPM_STATUS_LABELS[cancel.status]}
                </StatusPill>
              </dd>
            </div>
            {cancel.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved On</dt>
                <dd className="tabular-nums">{fmtDate(cancel.approved_at)}</dd>
              </div>
            )}
          </dl>

          {/* Action buttons */}
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
            {cancel.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{cancel.approved_at ? ` on ${fmtDate(cancel.approved_at)}` : ""}.
              </p>
            )}
            {isDraft && canDelete && (
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isPending}
                onClick={handleDelete}
              >
                {isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Styles tab */}
      <Tabs
        defaultKey="styles"
        items={[
          {
            key: "styles",
            label: `Styles (${cancel.styles.length})`,
            content: stylesTab,
          },
        ]}
      />
    </div>
  );
}
