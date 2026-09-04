"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFabricConsumptionComponent,
  updateFabricConsumptionComponent,
  deleteFabricConsumptionComponent,
  addFabricConsumptionEntry,
  updateFabricConsumptionEntry,
  deleteFabricConsumptionEntry,
  submitFabricConsumption,
  approveFabricConsumption,
  deleteFabricConsumption,
} from "@/lib/planning/material-planning-actions";
import type { getFabricConsumption } from "@/lib/planning/material-planning-service";
import type {
  FabricConsumptionComponent,
  FabricConsumptionEntry,
  MpStatus,
} from "@/lib/planning/material-planning-types";
import { CATEGORY_TYPES, CATEGORY_TYPE_LABELS } from "@/lib/planning/material-planning-types";
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

type ConsumptionDetail = NonNullable<Awaited<ReturnType<typeof getFabricConsumption>>>;

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

// ---------- Component form fields ----------

type ComponentFields = {
  sno: string;
  coordinate: string;
  component: string;
  category_name: string;
  item_type: string;
  is_main_component: boolean;
};

function emptyComponent(): ComponentFields {
  return {
    sno: "",
    coordinate: "",
    component: "",
    category_name: "",
    item_type: "C",
    is_main_component: false,
  };
}

function componentRowToFields(r: FabricConsumptionComponent): ComponentFields {
  return {
    sno: String(r.sno),
    coordinate: r.coordinate ?? "",
    component: r.component ?? "",
    category_name: r.category_name ?? "",
    item_type: r.item_type ?? "C",
    is_main_component: r.is_main_component,
  };
}

function componentFieldsToData(
  f: ComponentFields,
  consumptionId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    consumption_id: consumptionId,
    sno: parseInt(f.sno) || fallbackSno,
    coordinate: f.coordinate.trim() || null,
    component: f.component.trim() || null,
    category_name: f.category_name.trim() || null,
    item_type: f.item_type || null,
    can_be_sewing_accessories: false,
    sewing_category_name: null,
    is_main_component: f.is_main_component,
  };
}

// ---------- Entry form fields ----------

type EntryFields = {
  sno: string;
  fabric: string;
  multiple_components: string;
  components: string;
  entry_no: string;
};

function emptyEntry(): EntryFields {
  return { sno: "", fabric: "", multiple_components: "", components: "", entry_no: "" };
}

function entryRowToFields(r: FabricConsumptionEntry): EntryFields {
  return {
    sno: String(r.sno),
    fabric: r.fabric ?? "",
    multiple_components: r.multiple_components ?? "",
    components: r.components ?? "",
    entry_no: r.entry_no ?? "",
  };
}

function entryFieldsToData(
  f: EntryFields,
  consumptionId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    consumption_id: consumptionId,
    sno: parseInt(f.sno) || fallbackSno,
    fabric: f.fabric.trim() || null,
    multiple_components: f.multiple_components.trim() || null,
    components: f.components.trim() || null,
    entry_no: f.entry_no.trim() || null,
  };
}

// ---------- Components tab ----------

function ComponentsTab({
  consumption,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  consumption: ConsumptionDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<ComponentFields>(emptyComponent());

  useUnsavedGuard(formMode !== null);

  const editingItem =
    formMode && formMode !== "add"
      ? consumption.components.find((r) => r.id === formMode)
      : undefined;

  type ComponentRow = ConsumptionDetail["components"][number];
  const columns: Column<ComponentRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Coordinate",  cell: (r) => <span className="text-sm">{r.coordinate ?? "--"}</span> },
    { header: "Component",   cell: (r) => <span className="text-sm">{r.component ?? "--"}</span> },
    { header: "Category",    cell: (r) => <span className="text-sm">{r.category_name ?? "--"}</span> },
    {
      header: "Item Type",
      cell: (r) => (
        <span className="text-sm">
          {r.item_type ? (CATEGORY_TYPE_LABELS[r.item_type] ?? r.item_type) : "--"}
        </span>
      ),
    },
    {
      header: "Main",
      cell: (r) => (
        <span className="text-sm">{r.is_main_component ? "Yes" : "No"}</span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: ComponentRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (formMode === r.id) { setFormMode(null); }
                    else { setForm(componentRowToFields(r)); setFormMode(r.id); }
                  }}
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
        <CardTitle>Components ({consumption.components.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={() => { setForm(emptyComponent()); setFormMode("add"); }}>
            + Add component
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={consumption.components}
          getKey={(r) => r.id}
          empty="No components yet. Add one to get started."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-bold text-muted-foreground">
              {formMode === "add" ? "Add component" : "Edit component"}
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
                <Label>Coordinate</Label>
                <Input
                  value={form.coordinate}
                  onChange={(e) => setForm((f) => ({ ...f, coordinate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Component</Label>
                <Input
                  value={form.component}
                  onChange={(e) => setForm((f) => ({ ...f, component: e.target.value }))}
                />
              </div>
              <div>
                <Label>Category Name</Label>
                <Input
                  value={form.category_name}
                  onChange={(e) => setForm((f) => ({ ...f, category_name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Item Type</Label>
                <Select
                  value={form.item_type}
                  onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value }))}
                >
                  {CATEGORY_TYPES.map((t) => (
                    <option key={t} value={t}>{CATEGORY_TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="is_main_component"
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={form.is_main_component}
                  onChange={(e) => setForm((f) => ({ ...f, is_main_component: e.target.checked }))}
                />
                <Label htmlFor="is_main_component">Main Component</Label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setFormMode(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const fallbackSno = formMode === "add" ? consumption.components.length + 1 : (editingItem?.sno ?? 0);
                  const payload = componentFieldsToData(form, consumption.id, fallbackSno);
                  if (formMode === "add") onAdd(payload);
                  else if (editingItem) onUpdate(editingItem.id, payload);
                  setFormMode(null);
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

// ---------- Consumptions (entries) tab ----------

function ConsumptionsTab({
  consumption,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  consumption: ConsumptionDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<EntryFields>(emptyEntry());

  useUnsavedGuard(formMode !== null);

  const editingItem =
    formMode && formMode !== "add"
      ? consumption.entries.find((r) => r.id === formMode)
      : undefined;

  type EntryRow = ConsumptionDetail["entries"][number];
  const columns: Column<EntryRow>[] = [
    { header: "S No",               cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Fabric",             cell: (r) => <span className="text-sm">{r.fabric ?? "--"}</span> },
    { header: "Multi Components",   cell: (r) => <span className="text-sm">{r.multiple_components ?? "--"}</span> },
    { header: "Components",         cell: (r) => <span className="max-w-xs truncate text-sm">{r.components ?? "--"}</span> },
    { header: "Entry No",           cell: (r) => <span className="text-sm">{r.entry_no ?? "--"}</span> },
    { header: "Sizes",              align: "right", cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.sizes.length} rows</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: EntryRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (formMode === r.id) { setFormMode(null); }
                    else { setForm(entryRowToFields(r)); setFormMode(r.id); }
                  }}
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
        <CardTitle>Consumptions ({consumption.entries.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={() => { setForm(emptyEntry()); setFormMode("add"); }}>
            + Add entry
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={consumption.entries}
          getKey={(r) => r.id}
          empty="No consumption entries yet. Add one to get started."
        />

        {/* Sizes nested read-only under each entry */}
        {consumption.entries.some((e) => e.sizes.length > 0) && (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-bold text-muted-foreground">Sizes (read-only)</p>
            {consumption.entries.map((entry) =>
              entry.sizes.length > 0 ? (
                <div key={entry.id} className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Entry: {entry.fabric ?? "--"} / {entry.entry_no ?? "--"}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-1.5 pr-3">S No</th>
                          <th className="pb-1.5 pr-3">Size</th>
                          <th className="pb-1.5 pr-3">Dia</th>
                          <th className="pb-1.5 pr-3 text-right">Qty</th>
                          <th className="pb-1.5 text-right">Wt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.sizes.map((s) => (
                          <tr key={s.id} className="border-b border-border/30">
                            <td className="py-1 pr-3 tabular-nums">{s.sno}</td>
                            <td className="py-1 pr-3">{s.item_size ?? "--"}</td>
                            <td className="py-1 pr-3">{s.dia ?? "--"}</td>
                            <td className="py-1 pr-3 text-right tabular-nums">{fmtNumber(s.qty)}</td>
                            <td className="py-1 text-right tabular-nums">{fmtNumber(s.wt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-bold text-muted-foreground">
              {formMode === "add" ? "Add entry" : "Edit entry"}
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
                <Label>Fabric</Label>
                <Input
                  value={form.fabric}
                  onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                />
              </div>
              <div>
                <Label>Entry No</Label>
                <Input
                  value={form.entry_no}
                  onChange={(e) => setForm((f) => ({ ...f, entry_no: e.target.value }))}
                />
              </div>
              <div>
                <Label>Multiple Components</Label>
                <Input
                  value={form.multiple_components}
                  onChange={(e) => setForm((f) => ({ ...f, multiple_components: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 md:col-span-4">
                <Label>Components</Label>
                <Input
                  value={form.components}
                  onChange={(e) => setForm((f) => ({ ...f, components: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setFormMode(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const fallbackSno = formMode === "add" ? consumption.entries.length + 1 : (editingItem?.sno ?? 0);
                  const payload = entryFieldsToData(form, consumption.id, fallbackSno);
                  if (formMode === "add") onAdd(payload);
                  else if (editingItem) onUpdate(editingItem.id, payload);
                  setFormMode(null);
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

export function FabricConsumptionDetail({
  consumption,
  canEdit,
  canDelete,
  canApprove,
}: {
  consumption: ConsumptionDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = consumption.status === "draft";
  const isSubmitted = consumption.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddComponent(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addFabricConsumptionComponent(data);
      if (res.ok) success("Component added.");
      else toastError(res.error);
    });
  }

  function handleUpdateComponent(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateFabricConsumptionComponent(id, consumption.id, data);
      if (res.ok) success("Component updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteComponent(id: string) {
    startTransition(async () => {
      const res = await deleteFabricConsumptionComponent(id, consumption.id);
      if (res.ok) success("Component deleted.");
      else toastError(res.error);
    });
  }

  function handleAddEntry(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addFabricConsumptionEntry(data);
      if (res.ok) success("Entry added.");
      else toastError(res.error);
    });
  }

  function handleUpdateEntry(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateFabricConsumptionEntry(id, consumption.id, data);
      if (res.ok) success("Entry updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteEntry(id: string) {
    startTransition(async () => {
      const res = await deleteFabricConsumptionEntry(id, consumption.id);
      if (res.ok) success("Entry deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitFabricConsumption(consumption.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveFabricConsumption(consumption.id);
      if (res.ok) { success("Fabric Consumption approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteFabricConsumption(consumption.id);
      if (res.ok) { success("Deleted."); router.push("/planning/fabric-consumption"); }
      else toastError(res.error);
    });
  }

  // Coordinates list
  const coordinates = [
    consumption.coordinate_1,
    consumption.coordinate_2,
    consumption.coordinate_3,
    consumption.coordinate_4,
    consumption.coordinate_5,
    consumption.coordinate_6,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{consumption.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">UOM</dt>
              <dd>{consumption.uom_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stock UOM</dt>
              <dd>{consumption.stock_uom_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prod UOM</dt>
              <dd>{consumption.prod_uom_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sales UOM</dt>
              <dd>{consumption.sales_uom_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">HSN Code</dt>
              <dd>{consumption.hsn_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Size Group No</dt>
              <dd>{consumption.size_group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">No of Coordinates</dt>
              <dd className="tabular-nums">{consumption.no_of_coordinates}</dd>
            </div>
            {coordinates && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">Coordinates</dt>
                <dd>{coordinates}</dd>
              </div>
            )}
            {consumption.customer_style_description && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-xs text-muted-foreground">Customer Style Description</dt>
                <dd className="text-muted-foreground">{consumption.customer_style_description}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={statusTone(consumption.status)}>
                  {STATUS_LABELS[consumption.status]}
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
            {consumption.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{consumption.approved_at ? ` on ${fmtDate(consumption.approved_at)}` : ""}.
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
        defaultKey="components"
        items={[
          {
            key: "components",
            label: `Components (${consumption.components.length})`,
            content: (
              <ComponentsTab
                consumption={consumption}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddComponent}
                onUpdate={handleUpdateComponent}
                onDelete={handleDeleteComponent}
              />
            ),
          },
          {
            key: "consumptions",
            label: `Consumptions (${consumption.entries.length})`,
            content: (
              <ConsumptionsTab
                consumption={consumption}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddEntry}
                onUpdate={handleUpdateEntry}
                onDelete={handleDeleteEntry}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
