"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  FABRIC_TYPES,
  FABRIC_SUBTYPES,
  BOM_STATUSES,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  QUANTITY_BASES,
  netConsumption,
  effectiveMaterialQty,
  type FabricBom,
  type FabricBomComponent,
  type FabricBomProcess,
  type MaterialBom,
  type MaterialBomItem,
  type BomStatus,
  type MaterialCategory,
  type QuantityBasis,
} from "@/lib/planning/types";
import {
  createFabricBom,
  updateFabricBom,
  addFabricComponent,
  updateFabricComponent,
  deleteFabricComponent,
  addFabricProcess,
  deleteFabricProcess,
  createMaterialBom,
  updateMaterialBom,
  addMaterialItem,
  updateMaterialItem,
  deleteMaterialItem,
} from "@/lib/planning/bom-actions";
import type { Uom, Item } from "@/lib/masters/types";

// ---------- suggested process names ----------

const SUGGESTED_PROCESSES = [
  "Yarn Purchase",
  "Knitting",
  "Dyeing",
  "Stentering",
  "Compacting",
];

// ---------- empty state shell ----------

function EmptyBom({
  label,
  description,
  onCreateAction,
  isPending,
}: {
  label: string;
  description: string;
  onCreateAction: () => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-muted px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <Button className="mt-4" onClick={onCreateAction} disabled={isPending}>
        {isPending ? "Creating…" : `Create ${label}`}
      </Button>
    </div>
  );
}

// =====================================================================
// FABRIC BOM TAB
// =====================================================================

function FabricBomTab({
  orderId,
  bom,
  components,
  processes,
  uoms,
}: {
  orderId: string;
  bom: FabricBom | null;
  components: FabricBomComponent[];
  processes: FabricBomProcess[];
  uoms: Uom[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // ----- header form state -----
  const [fabricType, setFabricType] = useState(bom?.fabric_type ?? "");
  const [fabricSubtype, setFabricSubtype] = useState(
    bom?.fabric_subtype ?? "",
  );
  const [bomStatus, setBomStatus] = useState<BomStatus>(
    bom?.status ?? "draft",
  );
  const [notes, setNotes] = useState(bom?.notes ?? "");

  // ----- component form state -----
  const [compFormOpen, setCompFormOpen] = useState(false);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);
  const [compName, setCompName] = useState("");
  const [compColor, setCompColor] = useState("");
  const [compSize, setCompSize] = useState("");
  const [compDiameter, setCompDiameter] = useState("");
  const [compGsm, setCompGsm] = useState("");
  const [compConsumption, setCompConsumption] = useState("0");
  const [compUomId, setCompUomId] = useState(uoms[0]?.id ?? "");
  const [compLossPct, setCompLossPct] = useState("0");
  const [compSortOrder, setCompSortOrder] = useState("0");

  // live computed net consumption shown in the add/edit form
  const liveNet = netConsumption(
    Number(compConsumption) || 0,
    Number(compLossPct) || 0,
  );

  // ----- process form state -----
  const [processFormOpen, setProcessFormOpen] = useState(false);
  const [processName, setProcessName] = useState("");
  const [processSeq, setProcessSeq] = useState("1");
  const [processLossPct, setProcessLossPct] = useState("0");
  const [processNotes, setProcessNotes] = useState("");

  // ----- handlers: bom creation -----

  function handleCreate() {
    startTransition(async () => {
      const result = await createFabricBom(orderId);
      if (result.ok) {
        success("Fabric BOM created");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- handlers: header save -----

  function handleSaveHeader() {
    if (!bom) return;
    startTransition(async () => {
      const result = await updateFabricBom(bom.id, orderId, {
        fabric_type:
          (fabricType as (typeof FABRIC_TYPES)[number]) || null,
        fabric_subtype:
          (fabricSubtype as (typeof FABRIC_SUBTYPES)[number]) || null,
        status: bomStatus,
        notes: notes || null,
      });
      if (result.ok) {
        success("Header saved");
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- handlers: components -----

  function openAddComp() {
    setEditingCompId(null);
    setCompName("");
    setCompColor("");
    setCompSize("");
    setCompDiameter("");
    setCompGsm("");
    setCompConsumption("0");
    setCompUomId(uoms[0]?.id ?? "");
    setCompLossPct("0");
    setCompSortOrder(String((components.length + 1) * 10));
    setCompFormOpen(true);
  }

  function openEditComp(c: FabricBomComponent) {
    setEditingCompId(c.id);
    setCompName(c.component_name);
    setCompColor(c.color ?? "");
    setCompSize(c.size ?? "");
    setCompDiameter(c.diameter ?? "");
    setCompGsm(c.gsm != null ? String(c.gsm) : "");
    setCompConsumption(String(c.consumption));
    setCompUomId(c.uom_id ?? "");
    setCompLossPct(String(c.process_loss_pct));
    setCompSortOrder(String(c.sort_order));
    setCompFormOpen(true);
  }

  function closeCompForm() {
    setCompFormOpen(false);
    setEditingCompId(null);
  }

  function handleSaveComp() {
    if (!bom) return;
    const data = {
      component_name: compName,
      color: compColor || null,
      size: compSize || null,
      diameter: compDiameter || null,
      gsm: compGsm ? Number(compGsm) : null,
      consumption: Number(compConsumption) || 0,
      uom_id: compUomId || null,
      process_loss_pct: Number(compLossPct) || 0,
      sort_order: Number(compSortOrder) || 0,
    };
    startTransition(async () => {
      const result = editingCompId
        ? await updateFabricComponent(editingCompId, orderId, data)
        : await addFabricComponent(bom.id, orderId, data);
      if (result.ok) {
        success(editingCompId ? "Component updated" : "Component added");
        closeCompForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteComp(componentId: string) {
    startTransition(async () => {
      const result = await deleteFabricComponent(componentId, orderId);
      if (result.ok) {
        success("Component removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- handlers: processes -----

  function openAddProcess() {
    setProcessName("");
    setProcessSeq(String(processes.length + 1));
    setProcessLossPct("0");
    setProcessNotes("");
    setProcessFormOpen(true);
  }

  function handleSaveProcess() {
    if (!bom) return;
    startTransition(async () => {
      const result = await addFabricProcess(bom.id, orderId, {
        sequence: Number(processSeq) || processes.length + 1,
        process_name: processName,
        process_loss_pct: Number(processLossPct) || 0,
        notes: processNotes || null,
      });
      if (result.ok) {
        success("Process added");
        setProcessFormOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteProcess(processId: string) {
    startTransition(async () => {
      const result = await deleteFabricProcess(processId, orderId);
      if (result.ok) {
        success("Process removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- render: no BOM -----
  if (!bom) {
    return (
      <EmptyBom
        label="Fabric BOM"
        description="Create a Fabric BOM to start adding components and processes."
        onCreateAction={handleCreate}
        isPending={isPending}
      />
    );
  }

  // ----- column definitions -----

  const compColumns: Column<FabricBomComponent>[] = [
    {
      header: "Component",
      cell: (c) => (
        <span className="text-sm font-medium">{c.component_name}</span>
      ),
    },
    {
      header: "Colour",
      cell: (c) => (
        <span className="text-sm text-muted-foreground">{c.color ?? "—"}</span>
      ),
    },
    {
      header: "Size",
      cell: (c) => (
        <span className="text-sm text-muted-foreground">{c.size ?? "—"}</span>
      ),
    },
    {
      header: "GSM",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-sm">{c.gsm ?? "—"}</span>
      ),
    },
    {
      header: "Consumption",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-sm">{fmtNumber(c.consumption)}</span>
      ),
    },
    {
      header: "Loss %",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-sm">{c.process_loss_pct}%</span>
      ),
    },
    {
      header: "Net consumption",
      align: "right",
      cell: (c) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtNumber(c.net_consumption)}
        </span>
      ),
    },
    {
      header: "UOM",
      cell: (c) => (
        <span className="text-sm">
          {uoms.find((u) => u.id === c.uom_id)?.code ?? "—"}
        </span>
      ),
    },
    {
      header: "",
      cell: (c) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openEditComp(c)}
            disabled={isPending}
            className="h-7 px-2 text-xs"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDeleteComp(c.id)}
            disabled={isPending}
            className="h-7 px-2 text-xs text-danger hover:opacity-80"
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const processColumns: Column<FabricBomProcess>[] = [
    {
      header: "#",
      cell: (p) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {p.sequence}
        </span>
      ),
    },
    {
      header: "Process",
      cell: (p) => (
        <span className="text-sm font-medium">{p.process_name}</span>
      ),
    },
    {
      header: "Loss %",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums text-sm">{p.process_loss_pct}%</span>
      ),
    },
    {
      header: "Notes",
      cell: (p) => (
        <span className="text-sm text-muted-foreground">{p.notes ?? "—"}</span>
      ),
    },
    {
      header: "",
      cell: (p) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleDeleteProcess(p.id)}
          disabled={isPending}
          className="h-7 px-2 text-xs text-danger hover:opacity-80"
        >
          Delete
        </Button>
      ),
    },
  ];

  // ----- render: BOM exists -----

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>BOM Header</CardTitle>
          <StatusPill tone={bom.status === "final" ? "success" : "warning"}>
            {bom.status === "final" ? "Final" : "Draft"}
          </StatusPill>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="fb-type">Fabric type</Label>
              <Select
                id="fb-type"
                value={fabricType}
                onChange={(e) => setFabricType(e.target.value)}
              >
                <option value="">— select —</option>
                {FABRIC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fb-subtype">Fabric subtype</Label>
              <Select
                id="fb-subtype"
                value={fabricSubtype}
                onChange={(e) => setFabricSubtype(e.target.value)}
              >
                <option value="">— select —</option>
                {FABRIC_SUBTYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="fb-status">Status</Label>
              <Select
                id="fb-status"
                value={bomStatus}
                onChange={(e) => setBomStatus(e.target.value as BomStatus)}
              >
                {BOM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="fb-notes">Notes</Label>
            <Textarea
              id="fb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
            />
          </div>
          <Button size="sm" onClick={handleSaveHeader} disabled={isPending}>
            {isPending ? "Saving…" : "Save header"}
          </Button>
        </CardBody>
      </Card>

      {/* Components card */}
      <Card>
        <CardHeader>
          <CardTitle>Components ({components.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable
            columns={compColumns}
            rows={components}
            getKey={(c) => c.id}
            empty="No components yet — add one below."
          />

          {compFormOpen ? (
            <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
              <p className="text-sm font-medium">
                {editingCompId ? "Edit component" : "Add component"}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="c-name">Component name *</Label>
                  <Input
                    id="c-name"
                    placeholder="e.g. Body Fabric"
                    value={compName}
                    onChange={(e) => setCompName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="c-color">Colour</Label>
                  <Input
                    id="c-color"
                    placeholder="e.g. Navy"
                    value={compColor}
                    onChange={(e) => setCompColor(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="c-size">Size</Label>
                  <Input
                    id="c-size"
                    placeholder="e.g. M"
                    value={compSize}
                    onChange={(e) => setCompSize(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="c-dia">Diameter</Label>
                  <Input
                    id="c-dia"
                    placeholder='e.g. 32"'
                    value={compDiameter}
                    onChange={(e) => setCompDiameter(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="c-gsm">GSM</Label>
                  <Input
                    id="c-gsm"
                    type="number"
                    min="0"
                    placeholder="e.g. 180"
                    value={compGsm}
                    onChange={(e) => setCompGsm(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="c-uom">UOM</Label>
                  <Select
                    id="c-uom"
                    value={compUomId}
                    onChange={(e) => setCompUomId(e.target.value)}
                  >
                    <option value="">— select —</option>
                    {uoms.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="c-cons">Consumption</Label>
                  <Input
                    id="c-cons"
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="0.000"
                    value={compConsumption}
                    onChange={(e) => setCompConsumption(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="c-loss">Process loss %</Label>
                  <Input
                    id="c-loss"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="0"
                    value={compLossPct}
                    onChange={(e) => setCompLossPct(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Net consumption</Label>
                  <div className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-semibold tabular-nums text-foreground">
                    {fmtNumber(liveNet)}
                  </div>
                </div>
                <div>
                  <Label htmlFor="c-sort">Sort order</Label>
                  <Input
                    id="c-sort"
                    type="number"
                    min="0"
                    value={compSortOrder}
                    onChange={(e) => setCompSortOrder(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveComp}
                  disabled={isPending || !compName.trim()}
                >
                  {isPending
                    ? "Saving…"
                    : editingCompId
                      ? "Update component"
                      : "Add component"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={closeCompForm}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="subtle" onClick={openAddComp}>
              + Add component
            </Button>
          )}
        </CardBody>
      </Card>

      {/* Process sequence card */}
      <Card>
        <CardHeader>
          <CardTitle>Process sequence ({processes.length})</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable
            columns={processColumns}
            rows={processes}
            getKey={(p) => p.id}
            empty="No processes yet — add one below."
          />

          {processFormOpen ? (
            <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
              <p className="text-sm font-medium">Add process</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="p-name">Process name *</Label>
                  <Input
                    id="p-name"
                    placeholder="e.g. Knitting"
                    value={processName}
                    onChange={(e) => setProcessName(e.target.value)}
                    list="proc-suggestions"
                    required
                  />
                  <datalist id="proc-suggestions">
                    {SUGGESTED_PROCESSES.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <Label htmlFor="p-seq">Sequence</Label>
                  <Input
                    id="p-seq"
                    type="number"
                    min="1"
                    value={processSeq}
                    onChange={(e) => setProcessSeq(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="p-loss">Process loss %</Label>
                  <Input
                    id="p-loss"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="0"
                    value={processLossPct}
                    onChange={(e) => setProcessLossPct(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="p-notes">Notes</Label>
                  <Input
                    id="p-notes"
                    placeholder="Optional…"
                    value={processNotes}
                    onChange={(e) => setProcessNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveProcess}
                  disabled={isPending || !processName.trim()}
                >
                  {isPending ? "Adding…" : "Add process"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProcessFormOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="subtle" onClick={openAddProcess}>
              + Add process
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// =====================================================================
// MATERIAL BOM TAB
// =====================================================================

function MaterialBomTab({
  orderId,
  bom,
  items,
  uoms,
}: {
  orderId: string;
  bom: MaterialBom | null;
  items: MaterialBomItem[];
  uoms: Uom[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // ----- header form state -----
  const [matStatus, setMatStatus] = useState<BomStatus>(
    bom?.status ?? "draft",
  );
  const [matNotes, setMatNotes] = useState(bom?.notes ?? "");

  // ----- item form state -----
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemCategory, setItemCategory] =
    useState<MaterialCategory>("sewing_accessory");
  const [itemDescription, setItemDescription] = useState("");
  const [itemAttribute, setItemAttribute] = useState("");
  const [itemUomId, setItemUomId] = useState(uoms[0]?.id ?? "");
  const [itemQtyBasis, setItemQtyBasis] = useState<QuantityBasis>("nos");
  const [itemQtyNos, setItemQtyNos] = useState("0");
  const [itemMoq, setItemMoq] = useState("");
  const [itemUnitCost, setItemUnitCost] = useState("0");
  const [itemReqProcessing, setItemReqProcessing] = useState(false);
  const [itemProcessingNote, setItemProcessingNote] = useState("");
  const [itemSortOrder, setItemSortOrder] = useState("0");

  // live effective qty shown in the form
  const liveEffectiveQty = effectiveMaterialQty({
    quantity_basis: itemQtyBasis,
    quantity_nos: Number(itemQtyNos) || 0,
    moq: itemMoq ? Number(itemMoq) : null,
  });

  // ----- handlers: bom creation -----

  function handleCreate() {
    startTransition(async () => {
      const result = await createMaterialBom(orderId);
      if (result.ok) {
        success("Material BOM created");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- handlers: header save -----

  function handleSaveHeader() {
    if (!bom) return;
    startTransition(async () => {
      const result = await updateMaterialBom(bom.id, orderId, {
        status: matStatus,
        notes: matNotes || null,
      });
      if (result.ok) {
        success("Saved");
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- handlers: items -----

  function openAddItem(category: MaterialCategory) {
    setEditingItemId(null);
    setItemCategory(category);
    setItemDescription("");
    setItemAttribute("");
    setItemUomId(uoms[0]?.id ?? "");
    setItemQtyBasis("nos");
    setItemQtyNos("0");
    setItemMoq("");
    setItemUnitCost("0");
    setItemReqProcessing(false);
    setItemProcessingNote("");
    const catItems = items.filter((i) => i.category === category);
    setItemSortOrder(String((catItems.length + 1) * 10));
    setItemFormOpen(true);
  }

  function openEditItem(item: MaterialBomItem) {
    setEditingItemId(item.id);
    setItemCategory(item.category);
    setItemDescription(item.description);
    setItemAttribute(item.attribute ?? "");
    setItemUomId(item.uom_id ?? "");
    setItemQtyBasis(item.quantity_basis);
    setItemQtyNos(String(item.quantity_nos));
    setItemMoq(item.moq != null ? String(item.moq) : "");
    setItemUnitCost(String(item.unit_cost));
    setItemReqProcessing(item.requires_processing);
    setItemProcessingNote(item.processing_note ?? "");
    setItemSortOrder(String(item.sort_order));
    setItemFormOpen(true);
  }

  function closeItemForm() {
    setItemFormOpen(false);
    setEditingItemId(null);
  }

  function handleSaveItem() {
    if (!bom) return;
    const data = {
      category: itemCategory,
      item_id: null as string | null,
      description: itemDescription,
      attribute: itemAttribute || null,
      uom_id: itemUomId || null,
      quantity_basis: itemQtyBasis,
      quantity_nos: Number(itemQtyNos) || 0,
      moq: itemMoq ? Number(itemMoq) : null,
      unit_cost: Number(itemUnitCost) || 0,
      requires_processing: itemReqProcessing,
      processing_note: itemReqProcessing ? itemProcessingNote || null : null,
      sort_order: Number(itemSortOrder) || 0,
    };
    startTransition(async () => {
      const result = editingItemId
        ? await updateMaterialItem(editingItemId, orderId, data)
        : await addMaterialItem(bom.id, orderId, data);
      if (result.ok) {
        success(editingItemId ? "Item updated" : "Item added");
        closeItemForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteItem(itemId: string) {
    startTransition(async () => {
      const result = await deleteMaterialItem(itemId, orderId);
      if (result.ok) {
        success("Item removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  // ----- render: no BOM -----
  if (!bom) {
    return (
      <EmptyBom
        label="Material BOM"
        description="Create a Material BOM to start adding sewing and packing accessories."
        onCreateAction={handleCreate}
        isPending={isPending}
      />
    );
  }

  // ----- item columns -----

  const itemColumns: Column<MaterialBomItem>[] = [
    {
      header: "Description",
      cell: (i) => (
        <span className="text-sm font-medium">{i.description}</span>
      ),
    },
    {
      header: "Attribute",
      cell: (i) => (
        <span className="text-sm text-muted-foreground">
          {i.attribute ?? "—"}
        </span>
      ),
    },
    {
      header: "UOM",
      cell: (i) => (
        <span className="text-sm">
          {uoms.find((u) => u.id === i.uom_id)?.code ?? "—"}
        </span>
      ),
    },
    {
      header: "Basis",
      cell: (i) => (
        <span className="text-xs font-medium uppercase">
          {i.quantity_basis}
        </span>
      ),
    },
    {
      header: "Qty (nos)",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums text-sm">{fmtNumber(i.quantity_nos)}</span>
      ),
    },
    {
      header: "MOQ",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums text-sm">
          {i.moq != null ? fmtNumber(i.moq) : "—"}
        </span>
      ),
    },
    {
      header: "Effective qty",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtNumber(effectiveMaterialQty(i))}
        </span>
      ),
    },
    {
      header: "Unit cost",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums text-sm">{fmtNumber(i.unit_cost)}</span>
      ),
    },
    {
      header: "Processing",
      cell: (i) =>
        i.requires_processing ? (
          <StatusPill tone="info">
            {i.processing_note ?? "Yes"}
          </StatusPill>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      header: "",
      cell: (i) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openEditItem(i)}
            disabled={isPending}
            className="h-7 px-2 text-xs"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDeleteItem(i.id)}
            disabled={isPending}
            className="h-7 px-2 text-xs text-danger hover:opacity-80"
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // ----- render: BOM exists -----

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Material BOM Header</CardTitle>
          <StatusPill tone={bom.status === "final" ? "success" : "warning"}>
            {bom.status === "final" ? "Final" : "Draft"}
          </StatusPill>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="mat-status">Status</Label>
              <Select
                id="mat-status"
                value={matStatus}
                onChange={(e) => setMatStatus(e.target.value as BomStatus)}
              >
                {BOM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="mat-notes">Notes</Label>
            <Textarea
              id="mat-notes"
              value={matNotes}
              onChange={(e) => setMatNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
            />
          </div>
          <Button size="sm" onClick={handleSaveHeader} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </CardBody>
      </Card>

      {/* Items grouped by category */}
      {MATERIAL_CATEGORIES.map((category) => {
        const catItems = items.filter((i) => i.category === category);
        const showForm =
          itemFormOpen &&
          (itemCategory === category ||
            (editingItemId != null &&
              items.find((i) => i.id === editingItemId)?.category ===
                category));

        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle>
                {MATERIAL_CATEGORY_LABELS[category]} ({catItems.length})
              </CardTitle>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => openAddItem(category)}
                disabled={isPending}
              >
                + Add
              </Button>
            </CardHeader>
            <CardBody className="space-y-3">
              <DataTable
                columns={itemColumns}
                rows={catItems}
                getKey={(i) => i.id}
                empty={`No ${MATERIAL_CATEGORY_LABELS[category].toLowerCase()} items yet.`}
              />

              {showForm && (
                <div className="rounded-md border border-border bg-surface-muted p-4 space-y-3">
                  <p className="text-sm font-medium">
                    {editingItemId
                      ? "Edit item"
                      : `Add ${MATERIAL_CATEGORY_LABELS[category]}`}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label htmlFor="i-desc">Description *</Label>
                      <Input
                        id="i-desc"
                        placeholder="e.g. Main label"
                        value={itemDescription}
                        onChange={(e) => setItemDescription(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="i-attr">Attribute</Label>
                      <Input
                        id="i-attr"
                        placeholder="e.g. red label"
                        value={itemAttribute}
                        onChange={(e) => setItemAttribute(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="i-uom">UOM</Label>
                      <Select
                        id="i-uom"
                        value={itemUomId}
                        onChange={(e) => setItemUomId(e.target.value)}
                      >
                        <option value="">— select —</option>
                        {uoms.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="i-basis">Quantity basis</Label>
                      <Select
                        id="i-basis"
                        value={itemQtyBasis}
                        onChange={(e) =>
                          setItemQtyBasis(e.target.value as QuantityBasis)
                        }
                      >
                        {QUANTITY_BASES.map((b) => (
                          <option key={b} value={b}>
                            {b.toUpperCase()}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="i-qty">Quantity (nos)</Label>
                      <Input
                        id="i-qty"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={itemQtyNos}
                        onChange={(e) => setItemQtyNos(e.target.value)}
                      />
                    </div>
                    {itemQtyBasis === "moq" && (
                      <div>
                        <Label htmlFor="i-moq">MOQ</Label>
                        <Input
                          id="i-moq"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={itemMoq}
                          onChange={(e) => setItemMoq(e.target.value)}
                        />
                      </div>
                    )}
                    <div>
                      <Label htmlFor="i-cost">Unit cost</Label>
                      <Input
                        id="i-cost"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={itemUnitCost}
                        onChange={(e) => setItemUnitCost(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Effective qty</Label>
                      <div className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-semibold tabular-nums text-foreground">
                        {fmtNumber(liveEffectiveQty)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="i-proc"
                      type="checkbox"
                      checked={itemReqProcessing}
                      onChange={(e) =>
                        setItemReqProcessing(e.target.checked)
                      }
                      className="accent-primary"
                    />
                    <label
                      htmlFor="i-proc"
                      className="cursor-pointer text-sm"
                    >
                      Requires processing
                    </label>
                  </div>

                  {itemReqProcessing && (
                    <div>
                      <Label htmlFor="i-proc-note">Processing note</Label>
                      <Input
                        id="i-proc-note"
                        placeholder="e.g. Button Coloring"
                        value={itemProcessingNote}
                        onChange={(e) =>
                          setItemProcessingNote(e.target.value)
                        }
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveItem}
                      disabled={isPending || !itemDescription.trim()}
                    >
                      {isPending
                        ? "Saving…"
                        : editingItemId
                          ? "Update item"
                          : "Add item"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={closeItemForm}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// =====================================================================
// MAIN EXPORT
// =====================================================================

export interface BomTabsProps {
  orderId: string;
  fabricBom: FabricBom | null;
  fabricComponents: FabricBomComponent[];
  fabricProcesses: FabricBomProcess[];
  materialBom: MaterialBom | null;
  materialItems: MaterialBomItem[];
  uoms: Uom[];
  masterItems: Item[];
}

export function BomTabs({
  orderId,
  fabricBom,
  fabricComponents,
  fabricProcesses,
  materialBom,
  materialItems,
  uoms,
}: BomTabsProps) {
  const fabricLabel =
    fabricBom
      ? `Fabric BOM (${fabricBom.status === "final" ? "Final" : "Draft"})`
      : "Fabric BOM";

  const materialLabel =
    materialBom
      ? `Material BOM (${materialBom.status === "final" ? "Final" : "Draft"})`
      : "Material BOM";

  return (
    <Tabs
      items={[
        {
          key: "fabric",
          label: fabricLabel,
          content: (
            <FabricBomTab
              key={fabricBom?.id ?? "new-fabric"}
              orderId={orderId}
              bom={fabricBom}
              components={fabricComponents}
              processes={fabricProcesses}
              uoms={uoms}
            />
          ),
        },
        {
          key: "material",
          label: materialLabel,
          content: (
            <MaterialBomTab
              key={materialBom?.id ?? "new-material"}
              orderId={orderId}
              bom={materialBom}
              items={materialItems}
              uoms={uoms}
            />
          ),
        },
      ]}
      defaultKey="fabric"
    />
  );
}
