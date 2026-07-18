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
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  addOrderLine,
  generateTaPlan,
  updateMilestone,
  raiseAmendment,
  approveAmendment,
  rejectAmendment,
} from "@/lib/orders/actions";
import {
  AMENDMENT_TYPES,
  AMENDMENT_TYPE_LABELS,
  MILESTONE_STATUSES,
  milestoneTone,
  type MilestoneStatus,
  type AmendmentType,
  type SoLineItem,
  type OrderAmendment,
  type TaPlan,
  type TaMilestone,
} from "@/lib/orders/types";
import type { AmendmentStatus } from "@/lib/orders/types";
import type { OrderWithBuyer, OrderRevision } from "@/lib/orders/service";
import type { StatusTone } from "@/components/ui/status-pill";
import {
  addCoordinateColor,
  addOrderDescription,
  addOrderTrim,
  addOrderFabric,
  addApprovalParam,
} from "@/lib/orders/order-detail-actions";
import {
  DESCRIPTION_TYPES,
  SUPPLY_TYPES,
  APPROVAL_PARAM_STATUSES,
} from "@/lib/orders/order-detail-types";

// ---------- helpers ----------

function amendmentStatusTone(status: AmendmentStatus): StatusTone {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

// ---------- per-milestone edit row ----------

function MilestoneEditRow({ milestone }: { milestone: TaMilestone }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<MilestoneStatus>(milestone.status);
  const [actualDate, setActualDate] = useState(milestone.actual_date ?? "");

  function handleUpdate() {
    startTransition(async () => {
      const result = await updateMilestone(milestone.id, status, actualDate || null);
      if (result.ok) {
        success("Milestone updated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
        className="h-7 rounded border border-border bg-surface px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Milestone status"
      >
        {MILESTONE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={actualDate}
        onChange={(e) => setActualDate(e.target.value)}
        className="h-7 rounded border border-border bg-surface px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Actual date"
      />
      <Button
        size="sm"
        variant="subtle"
        onClick={handleUpdate}
        disabled={isPending}
        className="h-7 px-2 text-xs"
      >
        {isPending ? "…" : "Save"}
      </Button>
    </div>
  );
}

// ---------- line items tab ----------

function LineItemsTab({
  orderId,
  lines,
}: {
  orderId: string;
  lines: SoLineItem[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const lineColumns: Column<SoLineItem>[] = [
    { header: "Colour", cell: (l) => l.color ?? "—" },
    { header: "Size", cell: (l) => l.size ?? "—" },
    {
      header: "Qty",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums">{l.quantity.toLocaleString("en-IN")}</span>
      ),
    },
  ];

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addOrderLine(orderId, {
        color: color || null,
        size: size || null,
        quantity: Number(qty) || 0,
      });
      if (result.ok) {
        success("Line added");
        setColor("");
        setSize("");
        setQty("");
        setFormOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={lineColumns}
        rows={lines}
        getKey={(l) => l.id}
        empty="No line items yet."
      />

      {formOpen ? (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3">
          <div>
            <Label htmlFor="li-colour" className="mb-0.5">Colour</Label>
            <Input
              id="li-colour"
              placeholder="e.g. Navy"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-28"
            />
          </div>
          <div>
            <Label htmlFor="li-size" className="mb-0.5">Size</Label>
            <Input
              id="li-size"
              placeholder="e.g. M"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-20"
            />
          </div>
          <div>
            <Label htmlFor="li-qty" className="mb-0.5">Qty</Label>
            <Input
              id="li-qty"
              type="number"
              min="0"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              className="w-24"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Adding…" : "Add"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
          + Add line
        </Button>
      )}
    </div>
  );
}

// ---------- T&A tab ----------

function TaTab({
  orderId,
  shipDate,
  taPlan,
  milestones,
  templates,
}: {
  orderId: string;
  shipDate: string | null;
  taPlan: TaPlan | null;
  milestones: TaMilestone[];
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [method, setMethod] = useState<"template" | "auto">("template");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  const milestoneColumns: Column<TaMilestone>[] = [
    {
      header: "#",
      cell: (m) => (
        <span className="text-xs text-muted-foreground">{m.sequence}</span>
      ),
    },
    {
      header: "Milestone",
      cell: (m) => <span className="text-sm font-medium">{m.name}</span>,
    },
    {
      header: "Planned",
      cell: (m) => (
        <span className="tabular-nums text-sm">{fmtDate(m.planned_date)}</span>
      ),
    },
    {
      header: "Actual",
      cell: (m) => (
        <span className="tabular-nums text-sm">{fmtDate(m.actual_date)}</span>
      ),
    },
    {
      header: "Status",
      cell: (m) => (
        <StatusPill tone={milestoneTone(m)}>
          {m.status.replace("_", " ")}
        </StatusPill>
      ),
    },
    {
      header: "Update",
      cell: (m) => (
        // key forces remount with fresh state after router.refresh()
        <MilestoneEditRow
          key={`${m.id}-${m.status}-${m.actual_date ?? ""}`}
          milestone={m}
        />
      ),
    },
  ];

  function handleGenerate() {
    if (!shipDate && method === "auto") {
      toastError("Order has no ship date — set a ship date to generate a T&A plan.");
      return;
    }
    startTransition(async () => {
      const result = await generateTaPlan({
        sales_order_id: orderId,
        method,
        template_id: method === "template" ? templateId || null : null,
      });
      if (result.ok) {
        success("T&A plan generated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!taPlan) {
    if (!shipDate) {
      return (
        <div className="rounded-md border border-border bg-surface-muted px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">No ship date set</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A ship date is required before generating a T&A plan.
          </p>
        </div>
      );
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>Generate T&A plan</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="ta-method"
                value="template"
                checked={method === "template"}
                onChange={() => setMethod("template")}
                className="accent-primary"
              />
              Template based
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="ta-method"
                value="auto"
                checked={method === "auto"}
                onChange={() => setMethod("auto")}
                className="accent-primary"
              />
              Auto-generate (Standard 8-stage)
            </label>
          </div>

          {method === "template" && (
            <div>
              <Label htmlFor="ta-template">Template</Label>
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active templates found.</p>
              ) : (
                <Select
                  id="ta-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}

          <div>
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? "Generating…" : "Generate T&A plan"}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  // Plan exists — show milestones
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Generated via:{" "}
        <strong>
          {taPlan.method === "template" ? "Template" : "Auto-generated (Standard Knit T&A)"}
        </strong>
      </p>
      <DataTable
        columns={milestoneColumns}
        rows={milestones}
        getKey={(m) => m.id}
        empty="No milestones found."
      />
    </div>
  );
}

// ---------- amendments tab ----------

function AmendmentsTab({
  orderId,
  amendments,
  canApprove,
}: {
  orderId: string;
  amendments: OrderAmendment[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // raise amendment form state
  const [formOpen, setFormOpen] = useState(false);
  const [amendType, setAmendType] = useState<AmendmentType>("quantity");
  const [description, setDescription] = useState("");
  const [profitImpact, setProfitImpact] = useState("");

  // reject inline form: tracks which amendment is in "reject" mode
  const [rejectForm, setRejectForm] = useState<{ id: string; reason: string } | null>(null);

  function resetForm() {
    setAmendType("quantity");
    setDescription("");
    setProfitImpact("");
    setFormOpen(false);
  }

  function handleRaise(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await raiseAmendment({
        sales_order_id: orderId,
        amendment_type: amendType,
        description: description || null,
        details: {},
        profit_impact: profitImpact ? Number(profitImpact) : null,
      });
      if (result.ok) {
        success("Amendment raised");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleApprove(amendmentId: string) {
    startTransition(async () => {
      const result = await approveAmendment(amendmentId);
      if (result.ok) {
        success("Amendment approved");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleReject() {
    if (!rejectForm) return;
    const { id, reason } = rejectForm;
    if (!reason.trim()) {
      toastError("Please provide a reason for rejection.");
      return;
    }
    startTransition(async () => {
      const result = await rejectAmendment(id, reason);
      if (result.ok) {
        success("Amendment rejected");
        setRejectForm(null);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const amendmentColumns: Column<OrderAmendment>[] = [
    {
      header: "Type",
      cell: (a) => (
        <span className="text-sm">{AMENDMENT_TYPE_LABELS[a.amendment_type]}</span>
      ),
    },
    {
      header: "Description",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.description ?? "—"}</span>
      ),
    },
    {
      header: "Profit impact",
      align: "right",
      cell: (a) => (
        <span className="tabular-nums text-sm">
          {fmtMoney(a.profit_impact)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (a) => (
        <StatusPill tone={amendmentStatusTone(a.status)}>
          {a.status}
        </StatusPill>
      ),
    },
    ...(canApprove
      ? [
          {
            header: "Action",
            cell: (a: OrderAmendment) => {
              if (a.status !== "pending") return null;

              if (rejectForm?.id === a.id) {
                return (
                  <div className="flex flex-col gap-1.5">
                    <Input
                      placeholder="Reason for rejection"
                      value={rejectForm.reason}
                      onChange={(e) =>
                        setRejectForm((f) => f ? { ...f, reason: e.target.value } : null)
                      }
                      className="h-7 text-xs w-48"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={handleReject}
                        disabled={isPending}
                        className="h-7 text-xs"
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRejectForm(null)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => handleApprove(a.id)}
                    disabled={isPending}
                    className="h-7 text-xs"
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectForm({ id: a.id, reason: "" })}
                    className="h-7 text-xs"
                  >
                    Reject
                  </Button>
                </div>
              );
            },
          } satisfies Column<OrderAmendment>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={amendmentColumns}
        rows={amendments}
        getKey={(a) => a.id}
        empty="No amendments yet."
      />

      {formOpen ? (
        <form
          onSubmit={handleRaise}
          className="rounded-md border border-border bg-surface-muted p-4 space-y-3"
        >
          <p className="text-sm font-medium">Raise amendment</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="am-type">Type</Label>
              <Select
                id="am-type"
                value={amendType}
                onChange={(e) => setAmendType(e.target.value as AmendmentType)}
              >
                {AMENDMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {AMENDMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="am-impact">Profit impact</Label>
              <Input
                id="am-impact"
                type="number"
                step="0.01"
                placeholder="0.00 (optional)"
                value={profitImpact}
                onChange={(e) => setProfitImpact(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="am-desc">Description</Label>
            <Textarea
              id="am-desc"
              placeholder="Describe the amendment…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Raise amendment"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={resetForm}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
          + Raise amendment
        </Button>
      )}
    </div>
  );
}

// ---------- revisions tab ----------

function RevisionsTab({ revisions }: { revisions: OrderRevision[] }) {
  const columns: Column<OrderRevision>[] = [
    {
      header: "Version",
      cell: (r) => (
        <span className="font-mono text-xs font-semibold">v{r.version}</span>
      ),
    },
    {
      header: "Reason",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.reason ?? "—"}</span>
      ),
    },
    {
      header: "Date",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={revisions}
      getKey={(r) => r.id}
      empty="No revisions yet — revisions are created when amendments are approved."
    />
  );
}

// ---------- main export ----------

interface Props {
  order: OrderWithBuyer;
  lines: SoLineItem[];
  amendments: OrderAmendment[];
  revisions: OrderRevision[];
  taPlan: TaPlan | null;
  milestones: TaMilestone[];
  templates: { id: string; name: string }[];
  canApprove: boolean;
}

// ---------------------------------------------------------------------------
// Coordinate Colors Tab
// ---------------------------------------------------------------------------
function CoordColorsTab({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ coordinate: "", color: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Coordinate Colors</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Color"}</Button>
      </div>
      {adding && (
        <div className="flex gap-2 items-end rounded border border-border p-3">
          <div><Label>Coordinate *</Label><Input className="w-28" value={f.coordinate} onChange={(e) => setF({ ...f, coordinate: e.target.value })} placeholder="e.g. Sleeve" /></div>
          <div><Label>Color</Label><Input className="w-28" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
          <Button size="sm" disabled={isPending || !f.coordinate} onClick={() => startTransition(async () => { const res = await addCoordinateColor({ sales_order_id: orderId, coordinate: f.coordinate, color: f.color || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ coordinate: "", color: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Color assignments per garment coordinate position.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Descriptions Tab
// ---------------------------------------------------------------------------
function DescriptionsTab({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ description_type: "", description: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Process Descriptions</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add"}</Button>
      </div>
      {adding && (
        <div className="flex gap-2 items-end rounded border border-border p-3">
          <div><Label>Type</Label><Select className="w-28" value={f.description_type} onChange={(e) => setF({ ...f, description_type: e.target.value })}><option value="">Select…</option>{DESCRIPTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</Select></div>
          <div className="flex-1"><Label>Description</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => { const res = await addOrderDescription({ sales_order_id: orderId, description_type: f.description_type || null, description: f.description || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ description_type: "", description: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trims Tab
// ---------------------------------------------------------------------------
function TrimsTab({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ category: "", trims_specifications: "", supply_type: "", vendor_name: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Trims & Accessories</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Trim"}</Button>
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div><Label>Category</Label><Input className="w-28" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
          <div className="flex-1"><Label>Specifications</Label><Input value={f.trims_specifications} onChange={(e) => setF({ ...f, trims_specifications: e.target.value })} /></div>
          <div><Label>Supply Type</Label><Select className="w-28" value={f.supply_type} onChange={(e) => setF({ ...f, supply_type: e.target.value })}><option value="">Select…</option>{SUPPLY_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select></div>
          <div><Label>Vendor</Label><Input className="w-28" value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} /></div>
          <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => { const res = await addOrderTrim({ sales_order_id: orderId, category: f.category || null, trims_specifications: f.trims_specifications || null, supply_type: f.supply_type || null, vendor_name: f.vendor_name || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ category: "", trims_specifications: "", supply_type: "", vendor_name: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fabric Tab
// ---------------------------------------------------------------------------
function FabricTab({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ structure_name: "", composition: "", gsm: "", fabric_type: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Fabric Specifications</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Fabric"}</Button>
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div><Label>Structure</Label><Input className="w-28" value={f.structure_name} onChange={(e) => setF({ ...f, structure_name: e.target.value })} /></div>
          <div><Label>Composition</Label><Input className="w-28" value={f.composition} onChange={(e) => setF({ ...f, composition: e.target.value })} /></div>
          <div><Label>GSM</Label><Input className="w-16" type="number" value={f.gsm} onChange={(e) => setF({ ...f, gsm: e.target.value })} /></div>
          <div><Label>Type</Label><Select className="w-28" value={f.fabric_type} onChange={(e) => setF({ ...f, fabric_type: e.target.value })}><option value="">Select…</option><option value="main">Main</option><option value="trims_fabric">Trims Fabric</option></Select></div>
          <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => { const res = await addOrderFabric({ sales_order_id: orderId, structure_name: f.structure_name || null, composition: f.composition || null, gsm: f.gsm ? Number(f.gsm) : null, fabric_type: (f.fabric_type as "main" | "trims_fabric") || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ structure_name: "", composition: "", gsm: "", fabric_type: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Parameters Tab
// ---------------------------------------------------------------------------
function ApprovalParamsTab({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ parameter_name: "", status: "", comment: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Approval Parameters</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Parameter"}</Button>
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div className="flex-1"><Label>Parameter *</Label><Input value={f.parameter_name} onChange={(e) => setF({ ...f, parameter_name: e.target.value })} /></div>
          <div><Label>Status</Label><Select className="w-24" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">—</option>{APPROVAL_PARAM_STATUSES.map(s => <option key={s} value={s}>{s === "ok" ? "OK" : "NOT OK"}</option>)}</Select></div>
          <div><Label>Comment</Label><Input className="w-40" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></div>
          <Button size="sm" disabled={isPending || !f.parameter_name} onClick={() => startTransition(async () => { const res = await addApprovalParam({ sales_order_id: orderId, parameter_name: f.parameter_name, status: (f.status as "ok" | "not_ok") || null, comment: f.comment || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ parameter_name: "", status: "", comment: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}

export function OrderTabs({
  order,
  lines,
  amendments,
  revisions,
  taPlan,
  milestones,
  templates,
  canApprove,
}: Props) {
  const items = [
    {
      key: "lines",
      label: `Line items (${lines.length})`,
      content: <LineItemsTab orderId={order.id} lines={lines} />,
    },
    {
      key: "ta",
      label: "T&A",
      content: (
        <TaTab
          orderId={order.id}
          shipDate={order.ship_date}
          taPlan={taPlan}
          milestones={milestones}
          templates={templates}
        />
      ),
    },
    {
      key: "amendments",
      label: `Amendments (${amendments.length})`,
      content: (
        <AmendmentsTab
          orderId={order.id}
          amendments={amendments}
          canApprove={canApprove}
        />
      ),
    },
    {
      key: "revisions",
      label: `Revisions (${revisions.length})`,
      content: <RevisionsTab revisions={revisions} />,
    },
    {
      key: "colors",
      label: "Colors",
      content: <CoordColorsTab orderId={order.id} />,
    },
    {
      key: "descriptions",
      label: "Descriptions",
      content: <DescriptionsTab orderId={order.id} />,
    },
    {
      key: "trims",
      label: "Trims",
      content: <TrimsTab orderId={order.id} />,
    },
    {
      key: "fabric",
      label: "Fabric",
      content: <FabricTab orderId={order.id} />,
    },
    {
      key: "approval",
      label: "Approval",
      content: <ApprovalParamsTab orderId={order.id} />,
    },
  ];

  return <Tabs items={items} defaultKey="lines" />;
}
