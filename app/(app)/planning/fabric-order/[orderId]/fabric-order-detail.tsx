"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFabricOrderColor,
  updateFabricOrderColor,
  deleteFabricOrderColor,
  addFabricOrderStructure,
  updateFabricOrderStructure,
  deleteFabricOrderStructure,
  addFabricOrderStyle,
  updateFabricOrderStyle,
  deleteFabricOrderStyle,
  submitFabricOrder,
  approveFabricOrder,
  deleteFabricOrder,
} from "@/lib/planning/material-planning-actions";
import type { getFabricOrder } from "@/lib/planning/material-planning-service";
import type {
  FabricOrderColor,
  FabricOrderStructure,
  FabricOrderStyle,
  MpStatus,
} from "@/lib/planning/material-planning-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type OrderDetail = NonNullable<Awaited<ReturnType<typeof getFabricOrder>>>;

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

// ---------- Colors / Structures tab ----------

type ColorFields = {
  sno: string;
  color_type: string;
  type_code: string;
  description: string;
  process_loss_pct: string;
};

function emptyColor(): ColorFields {
  return { sno: "", color_type: "", type_code: "", description: "", process_loss_pct: "0" };
}

function colorRowToFields(r: FabricOrderColor): ColorFields {
  return {
    sno: String(r.sno),
    color_type: r.color_type,
    type_code: r.type_code ?? "",
    description: r.description ?? "",
    process_loss_pct: String(r.process_loss_pct),
  };
}

function colorFieldsToData(
  f: ColorFields,
  orderId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    fabric_order_id: orderId,
    sno: parseInt(f.sno) || fallbackSno,
    color_type: f.color_type.trim() || "BODY",
    type_code: f.type_code.trim() || null,
    description: f.description.trim() || null,
    process_loss_pct: parseFloat(f.process_loss_pct) || 0,
  };
}

type StructureFields = {
  sno: string;
  category_name: string;
};

function emptyStructure(): StructureFields {
  return { sno: "", category_name: "" };
}

function structureRowToFields(r: FabricOrderStructure): StructureFields {
  return { sno: String(r.sno), category_name: r.category_name ?? "" };
}

function structureFieldsToData(
  f: StructureFields,
  orderId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    fabric_order_id: orderId,
    sno: parseInt(f.sno) || fallbackSno,
    category_name: f.category_name.trim() || null,
  };
}

function ColorPrintTab({
  order,
  canMutate,
  isPending,
  onAddColor,
  onUpdateColor,
  onDeleteColor,
  onAddStructure,
  onUpdateStructure,
  onDeleteStructure,
}: {
  order: OrderDetail;
  canMutate: boolean;
  isPending: boolean;
  onAddColor: (data: Record<string, unknown>) => void;
  onUpdateColor: (id: string, data: Record<string, unknown>) => void;
  onDeleteColor: (id: string) => void;
  onAddStructure: (data: Record<string, unknown>) => void;
  onUpdateStructure: (id: string, data: Record<string, unknown>) => void;
  onDeleteStructure: (id: string) => void;
}) {
  const [colorMode, setColorMode] = useState<"add" | string | null>(null);
  const [colorForm, setColorForm] = useState<ColorFields>(emptyColor());
  const [structureMode, setStructureMode] = useState<"add" | string | null>(null);
  const [structureForm, setStructureForm] = useState<StructureFields>(emptyStructure());

  useUnsavedGuard(colorMode !== null || structureMode !== null);

  const editingColor =
    colorMode && colorMode !== "add"
      ? order.colors.find((r) => r.id === colorMode)
      : undefined;

  const editingStructure =
    structureMode && structureMode !== "add"
      ? order.structures.find((r) => r.id === structureMode)
      : undefined;

  type ColorRow = OrderDetail["colors"][number];
  const colorColumns: Column<ColorRow>[] = [
    { header: "S No",        cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Color Type",  cell: (r) => <span className="text-sm">{r.color_type}</span> },
    { header: "Code",        cell: (r) => <span className="text-sm">{r.type_code ?? "--"}</span> },
    { header: "Description", cell: (r) => <span className="max-w-xs truncate text-sm">{r.description ?? "--"}</span> },
    { header: "Process Loss %", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.process_loss_pct)}%</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: ColorRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (colorMode === r.id) { setColorMode(null); }
                    else { setColorForm(colorRowToFields(r)); setColorMode(r.id); }
                  }}
                >
                  {colorMode === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteColor(r.id)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  type StructureRow = OrderDetail["structures"][number];
  const structureColumns: Column<StructureRow>[] = [
    { header: "S No",          cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Category Name", cell: (r) => <span className="text-sm">{r.category_name ?? "--"}</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: StructureRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (structureMode === r.id) { setStructureMode(null); }
                    else { setStructureForm(structureRowToFields(r)); setStructureMode(r.id); }
                  }}
                >
                  {structureMode === r.id ? "Cancel" : "Edit"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  disabled={isPending}
                  onClick={() => onDeleteStructure(r.id)}
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
    <div className="space-y-4">
      {/* Colors grid */}
      <Card>
        <CardHeader>
          <CardTitle>Colors / Print ({order.colors.length})</CardTitle>
          {canMutate && colorMode !== "add" && (
            <Button
              size="sm"
              onClick={() => { setColorForm(emptyColor()); setColorMode("add"); }}
            >
              + Add color
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <DataTable
            columns={colorColumns}
            rows={order.colors}
            getKey={(r) => r.id}
            empty="No colors yet."
          />
          {colorMode !== null && (
            <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                {colorMode === "add" ? "Add color" : "Edit color"}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <Label>S No</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={colorForm.sno}
                    onChange={(e) => setColorForm((f) => ({ ...f, sno: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Color Type</Label>
                  <Input
                    value={colorForm.color_type}
                    onChange={(e) => setColorForm((f) => ({ ...f, color_type: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Type Code</Label>
                  <Input
                    value={colorForm.type_code}
                    onChange={(e) => setColorForm((f) => ({ ...f, type_code: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Process Loss %</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={colorForm.process_loss_pct}
                    onChange={(e) => setColorForm((f) => ({ ...f, process_loss_pct: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2 md:col-span-4">
                  <Label>Description</Label>
                  <Input
                    value={colorForm.description}
                    onChange={(e) => setColorForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setColorMode(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    const fallbackSno = colorMode === "add" ? order.colors.length + 1 : (editingColor?.sno ?? 0);
                    const payload = colorFieldsToData(colorForm, order.id, fallbackSno);
                    if (colorMode === "add") onAddColor(payload);
                    else if (editingColor) onUpdateColor(editingColor.id, payload);
                    setColorMode(null);
                  }}
                >
                  {isPending ? "Saving..." : colorMode === "add" ? "Add" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Structures grid */}
      <Card>
        <CardHeader>
          <CardTitle>Structures ({order.structures.length})</CardTitle>
          {canMutate && structureMode !== "add" && (
            <Button
              size="sm"
              onClick={() => { setStructureForm(emptyStructure()); setStructureMode("add"); }}
            >
              + Add structure
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          <DataTable
            columns={structureColumns}
            rows={order.structures}
            getKey={(r) => r.id}
            empty="No structures yet."
          />
          {structureMode !== null && (
            <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">
                {structureMode === "add" ? "Add structure" : "Edit structure"}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>S No</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={structureForm.sno}
                    onChange={(e) => setStructureForm((f) => ({ ...f, sno: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Category Name</Label>
                  <Input
                    value={structureForm.category_name}
                    onChange={(e) => setStructureForm((f) => ({ ...f, category_name: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setStructureMode(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    const fallbackSno = structureMode === "add" ? order.structures.length + 1 : (editingStructure?.sno ?? 0);
                    const payload = structureFieldsToData(structureForm, order.id, fallbackSno);
                    if (structureMode === "add") onAddStructure(payload);
                    else if (editingStructure) onUpdateStructure(editingStructure.id, payload);
                    setStructureMode(null);
                  }}
                >
                  {isPending ? "Saving..." : structureMode === "add" ? "Add" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------- Fabric Details (Styles) tab — read-only overview ----------

function FabricDetailsTab({ order }: { order: OrderDetail }) {
  type StyleRow = OrderDetail["styles"][number];

  return (
    <div className="space-y-4">
      {order.styles.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">No styles recorded.</p>
          </CardBody>
        </Card>
      )}
      {order.styles.map((style) => (
        <Card key={style.id}>
          <CardHeader>
            <CardTitle>
              Style: {style.style_ref_no ?? "--"} / Article: {style.article_no ?? "--"}
              {style.delivery_date ? ` — Delivery: ${fmtDate(style.delivery_date)}` : ""}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {style.details.length === 0 ? (
              <p className="text-sm text-muted-foreground">No details for this style.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4">Fabric Description</th>
                      <th className="pb-2 pr-4">Type</th>
                      <th className="pb-2 pr-4">Stage</th>
                      <th className="pb-2 pr-4">GSM</th>
                      <th className="pb-2 pr-4 text-right">Order Qty</th>
                      <th className="pb-2 pr-4 text-right">Rate</th>
                      <th className="pb-2 text-right">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {style.details.map((d) => (
                      <tr key={d.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-4">{d.category_name ?? "--"}</td>
                        <td className="py-1.5 pr-4">{d.fabric_description ?? "--"}</td>
                        <td className="py-1.5 pr-4">{d.category_type ?? "--"}</td>
                        <td className="py-1.5 pr-4">{d.stage ?? "--"}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{d.gsm ?? "--"}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtNumber(d.order_qty)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{fmtMoney(d.rate)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtMoney(d.total_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

// ---------- Styles tab — editable ----------

type StyleFields = {
  sno: string;
  style_ref_no: string;
  article_no: string;
  delivery_date: string;
};

function emptyStyle(): StyleFields {
  return { sno: "", style_ref_no: "", article_no: "", delivery_date: "" };
}

function styleRowToFields(r: FabricOrderStyle): StyleFields {
  return {
    sno: String(r.sno),
    style_ref_no: r.style_ref_no ?? "",
    article_no: r.article_no ?? "",
    delivery_date: r.delivery_date ?? "",
  };
}

function styleFieldsToData(
  f: StyleFields,
  orderId: string,
  fallbackSno: number,
): Record<string, unknown> {
  return {
    fabric_order_id: orderId,
    sno: parseInt(f.sno) || fallbackSno,
    style_ref_no: f.style_ref_no.trim() || null,
    article_no: f.article_no.trim() || null,
    delivery_date: f.delivery_date || null,
  };
}

function StylesEditTab({
  order,
  canMutate,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
}: {
  order: OrderDetail;
  canMutate: boolean;
  isPending: boolean;
  onAdd: (data: Record<string, unknown>) => void;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [formMode, setFormMode] = useState<"add" | string | null>(null);
  const [form, setForm] = useState<StyleFields>(emptyStyle());

  useUnsavedGuard(formMode !== null);

  const editingStyle =
    formMode && formMode !== "add"
      ? order.styles.find((r) => r.id === formMode)
      : undefined;

  type StyleRow = OrderDetail["styles"][number];
  const columns: Column<StyleRow>[] = [
    { header: "S No",         cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span> },
    { header: "Style Ref",    cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span> },
    { header: "Article No",   cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span> },
    { header: "Delivery Date", cell: (r) => <span className="tabular-nums text-sm">{r.delivery_date ? fmtDate(r.delivery_date) : "--"}</span> },
    { header: "Details",      align: "right", cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.details.length} rows</span> },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: StyleRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (formMode === r.id) { setFormMode(null); }
                    else { setForm(styleRowToFields(r)); setFormMode(r.id); }
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
        <CardTitle>Fabric Styles ({order.styles.length})</CardTitle>
        {canMutate && formMode !== "add" && (
          <Button size="sm" onClick={() => { setForm(emptyStyle()); setFormMode("add"); }}>
            + Add style
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={columns}
          rows={order.styles}
          getKey={(r) => r.id}
          empty="No styles yet."
        />
        {formMode !== null && (
          <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">
              {formMode === "add" ? "Add style" : "Edit style"}
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
                <Label>Style Ref No</Label>
                <Input
                  value={form.style_ref_no}
                  onChange={(e) => setForm((f) => ({ ...f, style_ref_no: e.target.value }))}
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
                <Label>Delivery Date</Label>
                <Input
                  type="date"
                  value={form.delivery_date}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setFormMode(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => {
                  const fallbackSno = formMode === "add" ? order.styles.length + 1 : (editingStyle?.sno ?? 0);
                  const payload = styleFieldsToData(form, order.id, fallbackSno);
                  if (formMode === "add") onAdd(payload);
                  else if (editingStyle) onUpdate(editingStyle.id, payload);
                  setFormMode(null);
                }}
              >
                {isPending ? "Saving..." : formMode === "add" ? "Add" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* Detail overview nested below each style */}
        {order.styles.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Detail overview (read-only)</p>
            <FabricDetailsTab order={order} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ---------- Logistic tab (read-only) ----------

function LogisticTab({ order }: { order: OrderDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logistic / Pricing</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Gross Value</dt>
            <dd className="tabular-nums font-medium">{fmtMoney(order.gross_value)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Currency</dt>
            <dd>{order.currency_code}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Exchange Rate</dt>
            <dd className="tabular-nums">{fmtNumber(order.exchange_rate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ship Type</dt>
            <dd>{order.ship_type ?? "--"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Bonus</dt>
            <dd className="tabular-nums">{fmtNumber(order.bonus)}{order.bonus_type ? ` (${order.bonus_type})` : ""}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Buyer Commission</dt>
            <dd className="tabular-nums">{fmtNumber(order.buyer_commission)}{order.buyer_commission_type ? ` (${order.buyer_commission_type})` : ""}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Agent Commission</dt>
            <dd className="tabular-nums">{fmtNumber(order.agent_commission)}{order.agent_commission_type ? ` (${order.agent_commission_type})` : ""}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Discount</dt>
            <dd className="tabular-nums">{fmtNumber(order.discount)}{order.discount_type ? ` (${order.discount_type})` : ""}</dd>
          </div>
          {order.less_other_desc_1 && (
            <div>
              <dt className="text-xs text-muted-foreground">{order.less_other_desc_1}</dt>
              <dd className="tabular-nums">{fmtNumber(order.less_other_value_1)}</dd>
            </div>
          )}
          {order.less_other_desc_2 && (
            <div>
              <dt className="text-xs text-muted-foreground">{order.less_other_desc_2}</dt>
              <dd className="tabular-nums">{fmtNumber(order.less_other_value_2)}</dd>
            </div>
          )}
          {order.add_other_desc_1 && (
            <div>
              <dt className="text-xs text-muted-foreground">{order.add_other_desc_1}</dt>
              <dd className="tabular-nums">{fmtNumber(order.add_other_value_1)}</dd>
            </div>
          )}
          {order.add_other_desc_2 && (
            <div>
              <dt className="text-xs text-muted-foreground">{order.add_other_desc_2}</dt>
              <dd className="tabular-nums">{fmtNumber(order.add_other_value_2)}</dd>
            </div>
          )}
        </dl>
      </CardBody>
    </Card>
  );
}

// ---------- Main component ----------

export function FabricOrderDetail({
  order,
  canEdit,
  canDelete,
  canApprove,
}: {
  order: OrderDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const isDraft = order.status === "draft";
  const isSubmitted = order.status === "submitted";
  const canMutate = isDraft && canEdit;

  useUnsavedGuard(isPending);

  function handleAddColor(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addFabricOrderColor(data);
      if (res.ok) success("Color added.");
      else toastError(res.error);
    });
  }

  function handleUpdateColor(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateFabricOrderColor(id, order.id, data);
      if (res.ok) success("Color updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteColor(id: string) {
    startTransition(async () => {
      const res = await deleteFabricOrderColor(id, order.id);
      if (res.ok) success("Color deleted.");
      else toastError(res.error);
    });
  }

  function handleAddStructure(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addFabricOrderStructure(data);
      if (res.ok) success("Structure added.");
      else toastError(res.error);
    });
  }

  function handleUpdateStructure(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateFabricOrderStructure(id, order.id, data);
      if (res.ok) success("Structure updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteStructure(id: string) {
    startTransition(async () => {
      const res = await deleteFabricOrderStructure(id, order.id);
      if (res.ok) success("Structure deleted.");
      else toastError(res.error);
    });
  }

  function handleAddStyle(data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await addFabricOrderStyle(data);
      if (res.ok) success("Style added.");
      else toastError(res.error);
    });
  }

  function handleUpdateStyle(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateFabricOrderStyle(id, order.id, data);
      if (res.ok) success("Style updated.");
      else toastError(res.error);
    });
  }

  function handleDeleteStyle(id: string) {
    startTransition(async () => {
      const res = await deleteFabricOrderStyle(id, order.id);
      if (res.ok) success("Style deleted.");
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitFabricOrder(order.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveFabricOrder(order.id);
      if (res.ok) { success("Fabric Order approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteFabricOrder(order.id);
      if (res.ok) { success("Deleted."); router.push("/planning/fabric-order"); }
      else toastError(res.error);
    });
  }

  const colorPrintTab = (
    <ColorPrintTab
      order={order}
      canMutate={canMutate}
      isPending={isPending}
      onAddColor={handleAddColor}
      onUpdateColor={handleUpdateColor}
      onDeleteColor={handleDeleteColor}
      onAddStructure={handleAddStructure}
      onUpdateStructure={handleUpdateStructure}
      onDeleteStructure={handleDeleteStructure}
    />
  );

  const fabricDetailsTab = (
    <StylesEditTab
      order={order}
      canMutate={canMutate}
      isPending={isPending}
      onAdd={handleAddStyle}
      onUpdate={handleUpdateStyle}
      onDelete={handleDeleteStyle}
    />
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{order.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="tabular-nums">{fmtDate(order.oc_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{order.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order No</dt>
              <dd>{order.order_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ship Type</dt>
              <dd>{order.ship_type ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd>{order.currency_code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Exchange Rate</dt>
              <dd className="tabular-nums">{fmtNumber(order.exchange_rate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Gross Value</dt>
              <dd className="tabular-nums font-medium">{fmtMoney(order.gross_value)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={statusTone(order.status)}>
                  {STATUS_LABELS[order.status]}
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
            {order.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{order.approved_at ? ` on ${fmtDate(order.approved_at)}` : ""}.
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

      <Tabs
        defaultKey="colors"
        items={[
          {
            key: "colors",
            label: `Color/Print Details (${order.colors.length})`,
            content: colorPrintTab,
          },
          {
            key: "fabric",
            label: `Fabric Details (${order.styles.length})`,
            content: fabricDetailsTab,
          },
          {
            key: "logistic",
            label: "Logistic",
            content: <LogisticTab order={order} />,
          },
        ]}
      />
    </div>
  );
}
