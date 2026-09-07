"use client";

import { useState, useTransition } from "react";
import {
  submitGarmentBom,
  approveGarmentBom,
  addGarmentBomProcess,
  deleteGarmentBomProcess,
  addGarmentBomComponent,
  deleteGarmentBomComponent,
  addGarmentBomPlacement,
  deleteGarmentBomPlacement,
} from "@/lib/planning/bom-detail-actions";
import type { BomStatus } from "@/lib/planning/bom-types";
import type { GarmentBomDetail as BomDetail } from "@/lib/planning/bom-detail-service";
import type {
  GarmentBomProcess,
  GarmentBomComponent,
  GarmentBomPlacement,
} from "@/lib/planning/bom-detail-service";
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

// ============================================================================
// Process tab (shared for component + garment process types)
// ============================================================================

function ProcessTab({
  title,
  processType,
  processes,
  bomId,
  canMutate,
  isPending,
  onAddProcess,
  onDeleteProcess,
  onAddComponent,
  onDeleteComponent,
  onAddPlacement,
  onDeletePlacement,
}: {
  title: string;
  processType: "component" | "garment";
  processes: GarmentBomProcess[];
  bomId: string;
  canMutate: boolean;
  isPending: boolean;
  onAddProcess: (data: Record<string, unknown>) => void;
  onDeleteProcess: (processId: string) => void;
  onAddComponent: (processId: string, data: Record<string, unknown>) => void;
  onDeleteComponent: (componentId: string) => void;
  onAddPlacement: (componentId: string, data: Record<string, unknown>) => void;
  onDeletePlacement: (placementId: string) => void;
}) {
  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const [expandedComps, setExpandedComps] = useState<Set<string>>(new Set());
  const [addCompFor, setAddCompFor] = useState<string | null>(null);
  const [addPlaceFor, setAddPlaceFor] = useState<string | null>(null);

  const [compForm, setCompForm] = useState({
    coordinate: "",
    design: "",
    vendor_specification: "",
    attachment_ref: "",
  });

  const [placeForm, setPlaceForm] = useState({
    position: "",
    design_detail: "",
    combo_detail: "",
    pack_ref_detail: "",
  });

  useUnsavedGuard(addCompFor !== null || addPlaceFor !== null);

  function toggleProc(id: string) {
    setExpandedProcs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleComp(id: string) {
    setExpandedComps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Parent: Processes
  const procColumns: Column<GarmentBomProcess>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Style Ref",
      cell: (r) => <span className="text-sm">{r.style_ref_no ?? "--"}</span>,
    },
    {
      header: "Style No",
      cell: (r) => <span className="text-sm">{r.style_no ?? "--"}</span>,
    },
    {
      header: "Article No",
      cell: (r) => <span className="text-sm">{r.article_no ?? "--"}</span>,
    },
    {
      header: "Process",
      cell: (r) => <span className="text-sm">{r.process_id ? r.process_id.slice(0, 8) : "--"}</span>,
    },
    {
      header: "Pack Ref",
      cell: (r) => <span className="text-sm">{r.against_pack_ref ? "Yes" : "No"}</span>,
    },
    {
      header: "Loss %",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.loss_pct)}</span>,
    },
    {
      header: "Components",
      cell: (r) => <span className="tabular-nums text-sm">{r.components.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleProc(r.id)}>
            {expandedProcs.has(r.id) ? "Hide" : "Details"}
          </Button>
          {canMutate && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={isPending}
              onClick={() => onDeleteProcess(r.id)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Child: Components
  const compColumns: Column<GarmentBomComponent>[] = [
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
      header: "Design",
      cell: (r) => <span className="text-sm">{r.design ?? "--"}</span>,
    },
    {
      header: "Vendor Spec",
      cell: (r) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground">
          {r.vendor_specification ?? "--"}
        </span>
      ),
    },
    {
      header: "Attachment",
      cell: (r) => <span className="text-sm">{r.attachment_ref ?? "--"}</span>,
    },
    {
      header: "Placements",
      cell: (r) => <span className="tabular-nums text-sm">{r.placements.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => toggleComp(r.id)}>
            {expandedComps.has(r.id) ? "Hide" : "Placements"}
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

  // Grandchild: Placements
  const placeColumns: Column<GarmentBomPlacement>[] = [
    {
      header: "S No",
      cell: (r) => <span className="tabular-nums text-sm">{r.sno}</span>,
    },
    {
      header: "Position",
      cell: (r) => <span className="text-sm">{r.position ?? "--"}</span>,
    },
    {
      header: "Design Detail",
      cell: (r) => <span className="text-sm">{r.design_detail ?? "--"}</span>,
    },
    {
      header: "Combo Detail",
      cell: (r) => <span className="text-sm">{r.combo_detail ?? "--"}</span>,
    },
    {
      header: "Pack Ref",
      cell: (r) => <span className="text-sm">{r.pack_ref_detail ?? "--"}</span>,
    },
    ...(canMutate
      ? [
          {
            header: "",
            align: "right" as const,
            cell: (r: GarmentBomPlacement) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={isPending}
                onClick={() => onDeletePlacement(r.id)}
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
        <CardTitle>
          {title} ({processes.length})
        </CardTitle>
        {canMutate && (
          <Button
            size="sm"
            onClick={() =>
              onAddProcess({
                process_type: processType,
                sno: processes.length + 1,
                sort_order: processes.length,
              })
            }
          >
            + Add process
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <DataTable
          columns={procColumns}
          rows={processes}
          getKey={(r) => r.id}
          empty={`No ${processType} processes yet.`}
        />

        {/* Expanded processes */}
        {processes
          .filter((p) => expandedProcs.has(p.id))
          .map((proc) => (
            <div key={`child-${proc.id}`} className="ml-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground">
                  Components for: Process {proc.sno}
                </p>
                {canMutate && addCompFor !== proc.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCompForm({ coordinate: "", design: "", vendor_specification: "", attachment_ref: "" });
                      setAddCompFor(proc.id);
                    }}
                  >
                    + Add component
                  </Button>
                )}
              </div>

              <DataTable
                columns={compColumns}
                rows={proc.components}
                getKey={(r) => r.id}
              />

              {/* Add component form */}
              {addCompFor === proc.id && (
                <div className="rounded-md border border-border bg-surface-muted p-4">
                  <p className="mb-3 text-xs font-bold text-muted-foreground">Add component</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                    <div>
                      <Label>Coordinate</Label>
                      <Input
                        value={compForm.coordinate}
                        onChange={(e) => setCompForm((f) => ({ ...f, coordinate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Design</Label>
                      <Input
                        value={compForm.design}
                        onChange={(e) => setCompForm((f) => ({ ...f, design: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Vendor Spec</Label>
                      <Input
                        value={compForm.vendor_specification}
                        onChange={(e) => setCompForm((f) => ({ ...f, vendor_specification: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Attachment</Label>
                      <Input
                        value={compForm.attachment_ref}
                        onChange={(e) => setCompForm((f) => ({ ...f, attachment_ref: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddCompFor(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        onAddComponent(proc.id, {
                          sno: proc.components.length + 1,
                          coordinate: compForm.coordinate.trim() || null,
                          design: compForm.design.trim() || null,
                          vendor_specification: compForm.vendor_specification.trim() || null,
                          attachment_ref: compForm.attachment_ref.trim() || null,
                          sort_order: proc.components.length,
                        });
                        setAddCompFor(null);
                      }}
                    >
                      {isPending ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Expanded components — placements */}
              {proc.components
                .filter((c) => expandedComps.has(c.id))
                .map((comp) => (
                  <div key={`grandchild-${comp.id}`} className="ml-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-muted-foreground">
                        Placements for: Component {comp.sno}
                      </p>
                      {canMutate && addPlaceFor !== comp.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPlaceForm({ position: "", design_detail: "", combo_detail: "", pack_ref_detail: "" });
                            setAddPlaceFor(comp.id);
                          }}
                        >
                          + Add placement
                        </Button>
                      )}
                    </div>

                    <DataTable
                      columns={placeColumns}
                      rows={comp.placements}
                      getKey={(r) => r.id}
                    />

                    {addPlaceFor === comp.id && (
                      <div className="rounded-md border border-border bg-surface-muted p-4">
                        <p className="mb-3 text-xs font-bold text-muted-foreground">Add placement</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                          <div>
                            <Label>Position</Label>
                            <Input
                              value={placeForm.position}
                              onChange={(e) => setPlaceForm((f) => ({ ...f, position: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Design Detail</Label>
                            <Input
                              value={placeForm.design_detail}
                              onChange={(e) => setPlaceForm((f) => ({ ...f, design_detail: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Combo Detail</Label>
                            <Input
                              value={placeForm.combo_detail}
                              onChange={(e) => setPlaceForm((f) => ({ ...f, combo_detail: e.target.value }))}
                            />
                          </div>
                          <div>
                            <Label>Pack Ref</Label>
                            <Input
                              value={placeForm.pack_ref_detail}
                              onChange={(e) => setPlaceForm((f) => ({ ...f, pack_ref_detail: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setAddPlaceFor(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              onAddPlacement(comp.id, {
                                sno: comp.placements.length + 1,
                                position: placeForm.position.trim() || null,
                                design_detail: placeForm.design_detail.trim() || null,
                                combo_detail: placeForm.combo_detail.trim() || null,
                                pack_ref_detail: placeForm.pack_ref_detail.trim() || null,
                                sort_order: comp.placements.length,
                              });
                              setAddPlaceFor(null);
                            }}
                          >
                            {isPending ? "Saving..." : "Add"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function GarmentBomDetail({
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
      const result = await submitGarmentBom(bom.id);
      if (result.ok) success("Submitted for approval.");
      else toastError(result.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const result = await approveGarmentBom(bom.id);
      if (result.ok) success("Garment BOM approved.");
      else toastError(result.error);
    });
  }

  // --- Process handlers ---
  function handleAddProcess(data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addGarmentBomProcess(bom.id, data as never);
      if (result.ok) success("Process added.");
      else toastError(result.error);
    });
  }

  function handleDeleteProcess(processId: string) {
    startTransition(async () => {
      const result = await deleteGarmentBomProcess(processId, bom.id);
      if (result.ok) success("Process deleted.");
      else toastError(result.error);
    });
  }

  // --- Component handlers ---
  function handleAddComponent(processId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addGarmentBomComponent(processId, bom.id, data as never);
      if (result.ok) success("Component added.");
      else toastError(result.error);
    });
  }

  function handleDeleteComponent(componentId: string) {
    startTransition(async () => {
      const result = await deleteGarmentBomComponent(componentId, bom.id);
      if (result.ok) success("Component deleted.");
      else toastError(result.error);
    });
  }

  // --- Placement handlers ---
  function handleAddPlacement(componentId: string, data: Record<string, unknown>) {
    startTransition(async () => {
      const result = await addGarmentBomPlacement(componentId, bom.id, data as never);
      if (result.ok) success("Placement added.");
      else toastError(result.error);
    });
  }

  function handleDeletePlacement(placementId: string) {
    startTransition(async () => {
      const result = await deleteGarmentBomPlacement(placementId, bom.id);
      if (result.ok) success("Placement deleted.");
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
              <dt className="text-xs text-muted-foreground">Order No</dt>
              <dd>{bom.order_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">OC No</dt>
              <dd>{bom.oc_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amendment</dt>
              <dd>{bom.amendment_no}</dd>
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
            key: "component_processes",
            label: "Component Processes",
            content: (
              <ProcessTab
                title="Component Processes"
                processType="component"
                processes={bom.component_processes}
                bomId={bom.id}
                canMutate={canMutate}
                isPending={isPending}
                onAddProcess={handleAddProcess}
                onDeleteProcess={handleDeleteProcess}
                onAddComponent={handleAddComponent}
                onDeleteComponent={handleDeleteComponent}
                onAddPlacement={handleAddPlacement}
                onDeletePlacement={handleDeletePlacement}
              />
            ),
          },
          {
            key: "garment_processes",
            label: "Garment Processes",
            content: (
              <ProcessTab
                title="Garment Processes"
                processType="garment"
                processes={bom.garment_processes}
                bomId={bom.id}
                canMutate={canMutate}
                isPending={isPending}
                onAddProcess={handleAddProcess}
                onDeleteProcess={handleDeleteProcess}
                onAddComponent={handleAddComponent}
                onDeleteComponent={handleDeleteComponent}
                onAddPlacement={handleAddPlacement}
                onDeletePlacement={handleDeletePlacement}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
