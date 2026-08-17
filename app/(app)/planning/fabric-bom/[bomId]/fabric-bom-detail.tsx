"use client";

import { useState, useTransition } from "react";
import {
  submitFabricBom,
  approveFabricBom,
  addFabricBomDyeColor,
  updateFabricBomDyeColor,
  deleteFabricBomDyeColor,
  addFabricBomFabric,
  deleteFabricBomFabric,
  addFabricBomCloth,
  updateFabricBomCloth,
  deleteFabricBomCloth,
  addFabricBomComponent,
  deleteFabricBomComponent,
  addFabricBomCombo,
  deleteFabricBomCombo,
} from "@/lib/planning/bom-detail-actions";
import type { BomStatus, DyeColorType } from "@/lib/planning/bom-types";
import {
  DYE_COLOR_TYPES,
  ITEM_SUB_TYPES,
  ITEM_SUB_TYPE_LABELS,
  WARP_WEFT,
  WARP_WEFT_LABELS,
  YARN_REQD_FORMS,
  YARN_REQD_FORM_LABELS,
} from "@/lib/planning/bom-types";
import type { FabricBomDetail as BomDetail } from "@/lib/planning/bom-detail-service";
import type {
  FabricBomDyeColor,
  FabricBomFabric,
  FabricBomCloth,
  FabricBomComponent,
  FabricBomCombo,
} from "@/lib/planning/bom-detail-service";
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

// ---------- helpers ----------

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

const DYE_COLOR_TYPE_LABELS: Record<string, string> = {
  yarn_dye: "Yarn Dye",
  fabric_dye: "Fabric Dye",
  print: "Print",
};

// ============================================================================
// Tab 1: Dye Colors
// ============================================================================

function DyeColorsTab({
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
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [filterType, setFilterType] = useState<string>("");
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState({
    color_type: "yarn_dye",
    description: "",
    process_loss_pct: "0",
    sub_type: "",
  });

  useUnsavedGuard(formMode !== null);

  const filtered = filterType
    ? bom.dye_colors.filter((c) => c.color_type === filterType)
    : bom.dye_colors;

  function openAdd() {
    setForm({ color_type: filterType || "yarn_dye", description: "", process_loss_pct: "0", sub_type: "" });
    setFormMode("add");
  }

  function openEdit(c: FabricBomDyeColor) {
    setForm({
      color_type: c.color_type,
      description: c.description,
      process_loss_pct: String(c.process_loss_pct),
      sub_type: c.sub_type ?? "",
    });
    setFormMode(c.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  const columns: Column<FabricBomDyeColor>[] = [
    {
      header: "Type",
      cell: (r) => (
        <span className="text-sm">{DYE_COLOR_TYPE_LABELS[r.color_type] ?? r.color_type}</span>
      ),
    },
    {
      header: "Description",
      cell: (r) => <span className="text-sm">{r.description}</span>,
    },
    {
      header: "Process Loss %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.process_loss_pct)}</span>,
    },
    {
      header: "Sub Type",
      cell: (r) => <span className="text-sm">{r.sub_type ?? "--"}</span>,
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: FabricBomDyeColor) => (
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
        <CardTitle>Dye Colors ({filtered.length})</CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All types</option>
            {DYE_COLOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {DYE_COLOR_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          {canMutate && formMode !== "add" && (
            <Button size="sm" onClick={openAdd}>
              + Add color
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={filtered}
          getKey={(r) => r.id}
          empty="No dye colors yet."
        />

        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add dye color" : "Edit dye color"}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <Label>Type</Label>
                <Select
                  value={form.color_type}
                  onChange={(e) => setForm((f) => ({ ...f, color_type: e.target.value }))}
                  disabled={formMode !== "add"}
                >
                  {DYE_COLOR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DYE_COLOR_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <Label>Process Loss %</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.process_loss_pct}
                  onChange={(e) => setForm((f) => ({ ...f, process_loss_pct: e.target.value }))}
                />
              </div>
              <div>
                <Label>Sub Type</Label>
                <Input
                  value={form.sub_type}
                  onChange={(e) => setForm((f) => ({ ...f, sub_type: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isPending || !form.description.trim()}
                onClick={() => {
                  const payload = {
                    color_type: form.color_type,
                    description: form.description.trim(),
                    process_loss_pct: parseFloat(form.process_loss_pct) || 0,
                    sub_type: form.sub_type.trim() || null,
                    sort_order: formMode === "add" ? filtered.length : undefined,
                  };
                  if (formMode === "add") {
                    onAdd(payload);
                  } else {
                    onUpdate(formMode, payload);
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

// ============================================================================
// Tab 2: Fabrics (parent) with Cloths (child)
// ============================================================================

function FabricsTab({
  bom,
  canMutate,
  isPending,
  onAddFabric,
  onDeleteFabric,
  onAddCloth,
  onUpdateCloth,
  onDeleteCloth,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAddFabric: (data: Record<string, unknown>) => void;
  onDeleteFabric: (id: string) => void;
  onAddCloth: (fabricId: string, data: Record<string, unknown>) => void;
  onUpdateCloth: (clothId: string, data: Record<string, unknown>) => void;
  onDeleteCloth: (clothId: string) => void;
}) {
  const [expandedFabrics, setExpandedFabrics] = useState<Set<string>>(new Set());
  const [addClothFor, setAddClothFor] = useState<string | null>(null);
  const [editClothId, setEditClothId] = useState<string | null>(null);
  const [clothForm, setClothForm] = useState({
    cloth_name: "",
    fabric_short_name: "",
    yarn_short_name: "",
    shade_id: "",
    warp_weft: "",
    yarn_reqd_form: "",
  });

  useUnsavedGuard(addClothFor !== null || editClothId !== null);

  function toggleFabric(id: string) {
    setExpandedFabrics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddCloth(fabricId: string) {
    setClothForm({ cloth_name: "", fabric_short_name: "", yarn_short_name: "", shade_id: "", warp_weft: "", yarn_reqd_form: "" });
    setAddClothFor(fabricId);
    setEditClothId(null);
  }

  function openEditCloth(c: FabricBomCloth) {
    setClothForm({
      cloth_name: c.cloth_name ?? "",
      fabric_short_name: c.fabric_short_name ?? "",
      yarn_short_name: c.yarn_short_name ?? "",
      shade_id: c.shade_id ?? "",
      warp_weft: c.warp_weft ?? "",
      yarn_reqd_form: c.yarn_reqd_form ?? "",
    });
    setEditClothId(c.id);
    setAddClothFor(null);
  }

  function closeClothForm() {
    setAddClothFor(null);
    setEditClothId(null);
  }

  const parentColumns: Column<FabricBomFabric>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm">{r.category_id ? r.category_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Item",
      cell: (r) => <span className="text-sm">{r.item_id ? r.item_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Sub Type",
      cell: (r) => (
        <span className="text-sm">
          {r.item_sub_type ? (ITEM_SUB_TYPE_LABELS[r.item_sub_type as keyof typeof ITEM_SUB_TYPE_LABELS] ?? r.item_sub_type) : "--"}
        </span>
      ),
    },
    {
      header: "GSM Range",
      cell: (r) => <span className="text-sm">{r.gsm_range ?? "--"}</span>,
    },
    {
      header: "No of Colors",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.no_of_colors}</span>,
    },
    {
      header: "Cloths",
      cell: (r) => <span className="tabular-nums text-sm">{r.cloths.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleFabric(r.id)}>
            {expandedFabrics.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteFabric(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const clothColumns: Column<FabricBomCloth>[] = [
    {
      header: "Cloth Name",
      cell: (r) => <span className="text-sm">{r.cloth_name ?? "--"}</span>,
    },
    {
      header: "Fabric",
      cell: (r) => <span className="text-sm">{r.fabric_short_name ?? "--"}</span>,
    },
    {
      header: "UOM",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.uom_id ?? "--"}</span>,
    },
    {
      header: "Yarn",
      cell: (r) => <span className="text-sm">{r.yarn_short_name ?? "--"}</span>,
    },
    {
      header: "Shade",
      cell: (r) => <span className="text-sm">{r.shade_id ?? "--"}</span>,
    },
    {
      header: "Warp/Weft",
      cell: (r) => (
        <span className="text-sm">
          {r.warp_weft ? (WARP_WEFT_LABELS[r.warp_weft as keyof typeof WARP_WEFT_LABELS] ?? r.warp_weft) : "--"}
        </span>
      ),
    },
    {
      header: "Yarn Form",
      cell: (r) => (
        <span className="text-sm">
          {r.yarn_reqd_form ? (YARN_REQD_FORM_LABELS[r.yarn_reqd_form as keyof typeof YARN_REQD_FORM_LABELS] ?? r.yarn_reqd_form) : "--"}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: FabricBomCloth) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => (editClothId === r.id ? closeClothForm() : openEditCloth(r))}
                >
                  {editClothId === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteCloth(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const clothFormUI = (fabricId: string, fabric: FabricBomFabric, isAdd: boolean) => (
    <div className="rounded-md border border-border bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {isAdd ? "Add cloth" : "Edit cloth"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <Label>Cloth Name</Label>
          <Input
            value={clothForm.cloth_name}
            onChange={(e) => setClothForm((f) => ({ ...f, cloth_name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Fabric</Label>
          <Input
            value={clothForm.fabric_short_name}
            onChange={(e) => setClothForm((f) => ({ ...f, fabric_short_name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Yarn</Label>
          <Input
            value={clothForm.yarn_short_name}
            onChange={(e) => setClothForm((f) => ({ ...f, yarn_short_name: e.target.value }))}
          />
        </div>
        <div>
          <Label>Shade</Label>
          <Input
            value={clothForm.shade_id}
            onChange={(e) => setClothForm((f) => ({ ...f, shade_id: e.target.value }))}
          />
        </div>
        <div>
          <Label>Warp/Weft</Label>
          <Select
            value={clothForm.warp_weft}
            onChange={(e) => setClothForm((f) => ({ ...f, warp_weft: e.target.value }))}
          >
            <option value=""></option>
            {WARP_WEFT.map((v) => (
              <option key={v} value={v}>
                {WARP_WEFT_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Yarn Form</Label>
          <Select
            value={clothForm.yarn_reqd_form}
            onChange={(e) => setClothForm((f) => ({ ...f, yarn_reqd_form: e.target.value }))}
          >
            <option value=""></option>
            {YARN_REQD_FORMS.map((v) => (
              <option key={v} value={v}>
                {YARN_REQD_FORM_LABELS[v]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={closeClothForm}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            const payload = {
              cloth_name: clothForm.cloth_name.trim() || null,
              fabric_short_name: clothForm.fabric_short_name.trim() || null,
              yarn_short_name: clothForm.yarn_short_name.trim() || null,
              shade_id: clothForm.shade_id.trim() || null,
              warp_weft: clothForm.warp_weft || null,
              yarn_reqd_form: clothForm.yarn_reqd_form || null,
            };
            if (isAdd) {
              onAddCloth(fabricId, {
                sno: fabric.cloths.length + 1,
                ...payload,
                sort_order: fabric.cloths.length,
              });
            } else if (editClothId) {
              onUpdateCloth(editClothId, payload);
            }
            closeClothForm();
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
        <CardTitle>Fabrics ({bom.fabrics.length})</CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddFabric({
                sno: bom.fabrics.length + 1,
                sort_order: bom.fabrics.length,
              })
            }
          >
            + Add fabric
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={parentColumns}
          rows={bom.fabrics}
          getKey={(r) => r.id}
          empty="No fabrics yet."
        />

        {bom.fabrics
          .filter((f) => expandedFabrics.has(f.id))
          .map((fab) => (
            <div key={`child-${fab.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Cloths for: Fabric {fab.sno}
                </p>
                {canMutate && addClothFor !== fab.id && (
                  <Button size="sm" variant="outline" onClick={() => openAddCloth(fab.id)}>
                    + Add cloth
                  </Button>
                )}
              </div>

              <DataTable
                columns={clothColumns}
                rows={fab.cloths}
                getKey={(r) => r.id}
                empty="No cloths."
              />

              {editClothId &&
                fab.cloths.some((c) => c.id === editClothId) &&
                clothFormUI(fab.id, fab, false)}

              {addClothFor === fab.id && clothFormUI(fab.id, fab, true)}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Tab 3: Components (parent) with Combos (child)
// ============================================================================

function ComponentsTab({
  bom,
  canMutate,
  isPending,
  onAddComponent,
  onDeleteComponent,
  onAddCombo,
  onDeleteCombo,
}: {
  bom: BomDetail;
  canMutate: boolean;
  isPending: boolean;
  onAddComponent: (data: Record<string, unknown>) => void;
  onDeleteComponent: (id: string) => void;
  onAddCombo: (componentId: string, data: Record<string, unknown>) => void;
  onDeleteCombo: (comboId: string) => void;
}) {
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());
  const [addComboFor, setAddComboFor] = useState<string | null>(null);
  const [comboForm, setComboForm] = useState({
    assort_color: "",
    gsm: "0",
    item_process_type: "",
    item_color: "",
    print_name: "",
    specifications: "",
  });

  useUnsavedGuard(addComboFor !== null);

  function toggleComp(id: string) {
    setExpandedComps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const parentColumns: Column<FabricBomComponent>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Component",
      cell: (r) => <span className="text-sm">{r.component_id ? r.component_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Coordinate",
      cell: (r) => <span className="text-sm">{r.coordinate ?? "--"}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm">{r.category_id ? r.category_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Item Type",
      cell: (r) => <span className="text-sm">{r.item_type ?? "--"}</span>,
    },
    {
      header: "GSM",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.gsm != null ? fmtNumber(r.gsm) : "--"}</span>,
    },
    {
      header: "Combos",
      cell: (r) => <span className="tabular-nums text-sm">{r.combos.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleComp(r.id)}>
            {expandedComps.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteComponent(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const comboColumns: Column<FabricBomCombo>[] = [
    {
      header: "Assort Color",
      cell: (r) => <span className="text-sm">{r.assort_color ?? "--"}</span>,
    },
    {
      header: "Item",
      cell: (r) => <span className="text-sm">{r.item_id ? r.item_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "GSM",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.gsm != null ? fmtNumber(r.gsm) : "--"}</span>,
    },
    {
      header: "Process Type",
      cell: (r) => <span className="text-sm">{r.item_process_type ?? "--"}</span>,
    },
    {
      header: "Color",
      cell: (r) => <span className="text-sm">{r.item_color ?? "--"}</span>,
    },
    {
      header: "Print",
      cell: (r) => <span className="text-sm">{r.print_name ?? "--"}</span>,
    },
    {
      header: "Specifications",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.specifications ?? "--"}
        </span>
      ),
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: FabricBomCombo) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={isPending}
                onClick={() => onDeleteCombo(r.id)}
              >
                Delete
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Components ({bom.components.length})</CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddComponent({
                sno: bom.components.length + 1,
                sort_order: bom.components.length,
              })
            }
          >
            + Add component
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={parentColumns}
          rows={bom.components}
          getKey={(r) => r.id}
          empty="No components yet."
        />

        {bom.components
          .filter((c) => expandedComps.has(c.id))
          .map((comp) => (
            <div key={`child-${comp.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">
                  Combos for: Component {comp.sno}
                </p>
                {canMutate && addComboFor !== comp.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setComboForm({
                        assort_color: "",
                        gsm: "0",
                        item_process_type: "",
                        item_color: "",
                        print_name: "",
                        specifications: "",
                      });
                      setAddComboFor(comp.id);
                    }}
                  >
                    + Add combo
                  </Button>
                )}
              </div>

              <DataTable
                columns={comboColumns}
                rows={comp.combos}
                getKey={(r) => r.id}
                empty="No combos."
              />

              {addComboFor === comp.id && (
                <div className="rounded-md border border-border bg-surface-muted p-4">
                  <p className="mb-3 text-xs font-semibold text-muted-foreground">Add combo</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                    <div>
                      <Label>Assort Color</Label>
                      <Input
                        value={comboForm.assort_color}
                        onChange={(e) => setComboForm((f) => ({ ...f, assort_color: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>GSM</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={comboForm.gsm}
                        onChange={(e) => setComboForm((f) => ({ ...f, gsm: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Process Type</Label>
                      <Input
                        value={comboForm.item_process_type}
                        onChange={(e) => setComboForm((f) => ({ ...f, item_process_type: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Color</Label>
                      <Input
                        value={comboForm.item_color}
                        onChange={(e) => setComboForm((f) => ({ ...f, item_color: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Print</Label>
                      <Input
                        value={comboForm.print_name}
                        onChange={(e) => setComboForm((f) => ({ ...f, print_name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Specifications</Label>
                      <Input
                        value={comboForm.specifications}
                        onChange={(e) => setComboForm((f) => ({ ...f, specifications: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddComboFor(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        onAddCombo(comp.id, {
                          sno: comp.combos.length + 1,
                          assort_color: comboForm.assort_color.trim() || null,
                          gsm: parseFloat(comboForm.gsm) || null,
                          item_process_type: comboForm.item_process_type.trim() || null,
                          item_color: comboForm.item_color.trim() || null,
                          print_name: comboForm.print_name.trim() || null,
                          specifications: comboForm.specifications.trim() || null,
                          sort_order: comp.combos.length,
                        });
                        setAddComboFor(null);
                      }}
                    >
                      {isPending ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function FabricBomDetail({
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

  // --- Workflow ---
  function handleSubmit() {
    startTransition(async () => {
      const result = await submitFabricBom(bom.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveFabricBom(bom.id);
      if (result.ok) success("Fabric BOM approved.");
      else toastError(result.error);
    });
  }

  // --- Dye Colors ---
  function handleAddDyeColor(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addFabricBomDyeColor(bom.id, data as never);
      if (result.ok) success("Dye color added.");
      else toastError(result.error);
    });
  }

  function handleUpdateDyeColor(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateFabricBomDyeColor(id, bom.id, data as never);
      if (result.ok) success("Dye color updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteDyeColor(id: string) {
    startTransition(async () => {
      const result = await deleteFabricBomDyeColor(id, bom.id);
      if (result.ok) success("Dye color deleted.");
      else toastError(result.error);
    });
  }

  // --- Fabrics ---
  function handleAddFabric(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addFabricBomFabric(bom.id, data as never);
      if (result.ok) success("Fabric added.");
      else toastError(result.error);
    });
  }

  function handleDeleteFabric(id: string) {
    startTransition(async () => {
      const result = await deleteFabricBomFabric(id, bom.id);
      if (result.ok) success("Fabric deleted.");
      else toastError(result.error);
    });
  }

  // --- Cloths ---
  function handleAddCloth(fabricId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addFabricBomCloth(fabricId, bom.id, data as never);
      if (result.ok) success("Cloth added.");
      else toastError(result.error);
    });
  }

  function handleUpdateCloth(clothId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateFabricBomCloth(clothId, bom.id, data as never);
      if (result.ok) success("Cloth updated.");
      else toastError(result.error);
    });
  }

  function handleDeleteCloth(clothId: string) {
    startTransition(async () => {
      const result = await deleteFabricBomCloth(clothId, bom.id);
      if (result.ok) success("Cloth deleted.");
      else toastError(result.error);
    });
  }

  // --- Components ---
  function handleAddComponent(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addFabricBomComponent(bom.id, data as never);
      if (result.ok) success("Component added.");
      else toastError(result.error);
    });
  }

  function handleDeleteComponent(id: string) {
    startTransition(async () => {
      const result = await deleteFabricBomComponent(id, bom.id);
      if (result.ok) success("Component deleted.");
      else toastError(result.error);
    });
  }

  // --- Combos ---
  function handleAddCombo(componentId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addFabricBomCombo(componentId, bom.id, data as never);
      if (result.ok) success("Combo added.");
      else toastError(result.error);
    });
  }

  function handleDeleteCombo(comboId: string) {
    startTransition(async () => {
      const result = await deleteFabricBomCombo(comboId, bom.id);
      if (result.ok) success("Combo deleted.");
      else toastError(result.error);
    });
  }

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
              <dt className="text-xs text-muted-foreground">Style</dt>
              <dd className="font-medium">{bom.style_code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{bom.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amendment</dt>
              <dd>{bom.amendment_no}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Catalogue No</dt>
              <dd>{bom.catalogue_no ?? "--"}</dd>
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

      <Tabs
        items={[
          {
            key: "dye_colors",
            label: "Dye Colors",
            content: (
              <DyeColorsTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAdd={handleAddDyeColor}
                onUpdate={handleUpdateDyeColor}
                onDelete={handleDeleteDyeColor}
              />
            ),
          },
          {
            key: "fabrics",
            label: "Fabrics",
            content: (
              <FabricsTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAddFabric={handleAddFabric}
                onDeleteFabric={handleDeleteFabric}
                onAddCloth={handleAddCloth}
                onUpdateCloth={handleUpdateCloth}
                onDeleteCloth={handleDeleteCloth}
              />
            ),
          },
          {
            key: "components",
            label: "Components",
            content: (
              <ComponentsTab
                bom={bom}
                canMutate={canMutate}
                isPending={isPending}
                onAddComponent={handleAddComponent}
                onDeleteComponent={handleDeleteComponent}
                onAddCombo={handleAddCombo}
                onDeleteCombo={handleDeleteCombo}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
