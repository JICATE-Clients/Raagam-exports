"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { NominatedVendorPicker } from "@/components/masters/nominated-vendor-picker";
import {
  nominatedVendorOptions,
  type VendorNomination,
  type VendorOption,
} from "@/lib/masters/vendor-nominations";
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

  // Always-editable row, so there is no open/closed flag to lean on — compare
  // against the milestone as loaded instead. A plain `true` here would pin the
  // tab on an old build for as long as the order page is open.
  useUnsavedGuard(
    status !== milestone.status ||
      actualDate !== (milestone.actual_date ?? "") ||
      isPending,
  );

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
      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
        // Same trap as the topbar: the control draws its own border, background
        // and focus ring, so repeating them here boxed it twice — and the inner
        // box kept its own h-9, leaving this 36px tall beside a 28px date input.
        className="h-7 w-40 text-xs md:text-xs"
        aria-label="Milestone status"
      >
        {MILESTONE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </Select>
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

  useUnsavedGuard(formOpen || isPending);

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
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <DataTable
        columns={lineColumns}
        rows={lines}
        getKey={(l) => l.id}
        empty="No line items yet."
      />

      {formOpen ? (
        <form onSubmit={handleAdd} className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
          {/* `FieldGrid` and one field width, in place of a
              `flex flex-wrap items-end gap-3` of `w-28` / `w-20` / `w-24`
              boxes. Sizing each control to its own data is what LAYOUT.md §3
              fixes a field at ~280px to avoid — none of these lined up with the
              lines table above them, or with each other. */}
          <FieldGrid>
            <Field label="Colour" size="sm" htmlFor="li-colour">
              <Input
                id="li-colour"
                uppercase
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </Field>
            <Field label="Size" size="sm" htmlFor="li-size">
              <Input
                id="li-size"
                uppercase
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — one
                prop for the star, the `data-required-empty` hold and the Add
                button, so they cannot disagree. The native `required` was here
                already and said nothing on screen. */}
            <Field label="Qty" required size="sm" htmlFor="li-qty">
              <Input
                id="li-qty"
                type="number"
                min="0"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </Field>
          </FieldGrid>
          <div className="flex gap-2">
            {/* The third enforcer of the same `required`. */}
            <Button type="submit" size="sm" disabled={isPending || !qty.trim()}>
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

  // Only `isPending` here. Picking a template is a one-click choice, not typed
  // work — treating it as dirty would block auto-updates for anyone who merely
  // opened this tab, and re-picking after a reload costs nothing.
  useUnsavedGuard(isPending);

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
            // A lone field still belongs to a track — `--check field-track`
            // exists because one `Field` outside a `FieldGrid` sizes itself and
            // stops lining up with the next thing added beside it.
            <FieldGrid>
              <Field label="Template" size="sm" htmlFor="ta-template">
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
              </Field>
            </FieldGrid>
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

  useUnsavedGuard(formOpen || rejectForm !== null || isPending);

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
          {/* One track for all three, in place of a `sm:grid-cols-2` pair with a
              full-width box under it — halves above and a whole below is two
              layouts, and nothing shared a left edge across them. */}
          <FieldGrid>
            <Field label="Type" size="sm" htmlFor="am-type">
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
            </Field>
            <Field label="Profit impact" size="sm" htmlFor="am-impact">
              <Input
                id="am-impact"
                type="number"
                step="0.01"
                placeholder="0.00 (optional)"
                value={profitImpact}
                onChange={(e) => setProfitImpact(e.target.value)}
              />
            </Field>
            {/* `full` — free prose, and a `<Textarea>` is one of the places the
                CAPITALS rule is exempt by construction. */}
            <Field label="Description" size="full" htmlFor="am-desc">
              <Textarea
                id="am-desc"
                placeholder="Describe the amendment…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
          </FieldGrid>
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
  /** `master_vendors`, inactive included — see `lib/masters/vendor-service.ts`. */
  vendors: VendorOption[];
  nominations: VendorNomination[];
  /** The customer whose nominations apply, resolved through `buyers.customer_id`
   *  (0380). Both nulls when the buyer has not been linked to a customer. */
  nominationCustomer: { customer_id: string | null; customer_name: string | null };
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

  // The five add-row tabs below all follow this shape: an inline panel gated on
  // `adding`, no overlay, so nothing registers them automatically.
  useUnsavedGuard(adding || isPending);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Coordinate Colors</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Color"}</Button>
      </div>
      {adding && (
        // ONE MARKER, NEVER A HANDLER. These five panels are `adding`-gated divs
        // rather than overlays, so `isEditorScope()` is false without it and Tab
        // walks straight out of the panel it just opened.
        <div data-focus-scope className="space-y-3 rounded border border-border p-3">
          <FieldGrid>
            {/* The `*` was typed into the label text, so it drew a red star and
                nothing else — the hold comes from the same prop or not at all,
                and Tab left a blank Coordinate freely while the Add button below
                it stayed disabled with nothing saying why. */}
            <Field label="Coordinate" required size="sm" htmlFor="cc-coordinate">
              <Input id="cc-coordinate" uppercase value={f.coordinate} onChange={(e) => setF({ ...f, coordinate: e.target.value })} />
            </Field>
            <Field label="Color" size="sm" htmlFor="cc-color">
              <Input id="cc-color" uppercase value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
            </Field>
          </FieldGrid>
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

  useUnsavedGuard(adding || isPending);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Process Descriptions</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add"}</Button>
      </div>
      {adding && (
        <div data-focus-scope className="space-y-3 rounded border border-border p-3">
          <FieldGrid>
            <Field label="Type" size="sm" htmlFor="pd-type">
              <Select id="pd-type" value={f.description_type} onChange={(e) => setF({ ...f, description_type: e.target.value })}><option value=""></option>{DESCRIPTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</Select>
            </Field>
            <Field label="Description" size="lg" htmlFor="pd-description">
              <Input id="pd-description" uppercase value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
          </FieldGrid>
          <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => { const res = await addOrderDescription({ sales_order_id: orderId, description_type: f.description_type || null, description: f.description || null }, orderId); if (res.ok) { success("Added."); setAdding(false); setF({ description_type: "", description: "" }); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trims Tab
// ---------------------------------------------------------------------------
function TrimsTab({
  orderId,
  vendors,
  nominations,
  nominationCustomer,
}: {
  orderId: string;
  vendors: VendorOption[];
  nominations: VendorNomination[];
  nominationCustomer: { customer_id: string | null; customer_name: string | null };
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const BLANK = {
    category: "",
    trims_specifications: "",
    supply_type: "",
    vendor_id: null as string | null,
  };
  const [f, setF] = useState(BLANK);

  /**
   * Vendor was a free-text `<Input>` until 0380: an operator typed any string at
   * all, including on a line marked "nominated", and it joined to nothing. It is
   * a real `master_vendors` reference now, narrowed by the customer's nomination
   * list like MBA and Accessory BOM.
   *
   * `unresolvedCustomerHint` is this screen's own wrinkle. Orders hang off
   * `buyers`, nominations off `customers`, and the link between them
   * (`buyers.customer_id`, 0380) is nullable and unset by default — so an
   * unlinked buyer must offer everything and SAY so. Claiming "this customer has
   * nominated nobody" would be a lie about a customer we never identified.
   */
  const vendorRule = {
    customerId: nominationCustomer.customer_id,
    customerName: nominationCustomer.customer_name,
    vendors,
    nominations,
    unresolvedCustomerHint: nominationCustomer.customer_id
      ? null
      : "This buyer is not linked to a customer yet, so nominations cannot be applied — set the Customer on the buyer record.",
  };

  useUnsavedGuard(adding || isPending);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Trims & Accessories</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Trim"}</Button>
      </div>
      {adding && (
        <div data-focus-scope className="space-y-3 rounded border border-border p-3">
          <FieldGrid>
            <Field label="Category" size="sm" htmlFor="tr-category">
              <Input id="tr-category" uppercase value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
            </Field>
            <Field label="Specifications" size="lg" htmlFor="tr-specs">
              <Input id="tr-specs" uppercase value={f.trims_specifications} onChange={(e) => setF({ ...f, trims_specifications: e.target.value })} />
            </Field>
            <Field label="Supply Type" size="sm" htmlFor="tr-supply">
              <Select id="tr-supply" value={f.supply_type} onChange={(e) => {
                // Clears a vendor the new type no longer allows, asked of the same
                // function that builds the picker's options.
                const supply_type = e.target.value;
                const { items } = nominatedVendorOptions({ ...vendorRule, supplyType: supply_type });
                setF((p) => ({ ...p, supply_type, vendor_id: !p.vendor_id || items.some((v) => v.id === p.vendor_id) ? p.vendor_id : null }));
              }}><option value=""></option>{SUPPLY_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select>
            </Field>
            {/* Stays `compact` — the picker keeps its own short "pick the supply
                type first" line inside the box, which is the whole point of
                `shortHint`: a blank supply type offers NOTHING and says so. */}
            <Field label="Vendor" size="sm">
              <NominatedVendorPicker {...vendorRule} supplyType={f.supply_type} value={f.vendor_id} onChange={(id) => setF((p) => ({ ...p, vendor_id: id }))} compact />
            </Field>
          </FieldGrid>
          <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => { const res = await addOrderTrim({ sales_order_id: orderId, category: f.category || null, trims_specifications: f.trims_specifications || null, supply_type: f.supply_type || null, vendor_id: f.vendor_id }, orderId); if (res.ok) { success("Added."); setAdding(false); setF(BLANK); router.refresh(); } else error(res.error); })}>{isPending ? "Adding…" : "Add"}</Button>
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

  useUnsavedGuard(adding || isPending);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Fabric Specifications</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Fabric"}</Button>
      </div>
      {adding && (
        <div data-focus-scope className="space-y-3 rounded border border-border p-3">
          <FieldGrid>
            <Field label="Structure" size="sm" htmlFor="fb-structure">
              <Input id="fb-structure" uppercase value={f.structure_name} onChange={(e) => setF({ ...f, structure_name: e.target.value })} />
            </Field>
            <Field label="Composition" size="sm" htmlFor="fb-composition">
              <Input id="fb-composition" uppercase value={f.composition} onChange={(e) => setF({ ...f, composition: e.target.value })} />
            </Field>
            {/* A `w-16` box for a number is exactly the sizing LAYOUT.md §3
                refuses: the field is ~280px like every other, and the digits
                sitting in it are not the measure of the column. */}
            <Field label="GSM" size="sm" htmlFor="fb-gsm">
              <Input id="fb-gsm" type="number" value={f.gsm} onChange={(e) => setF({ ...f, gsm: e.target.value })} />
            </Field>
            <Field label="Type" size="sm" htmlFor="fb-type">
              <Select id="fb-type" value={f.fabric_type} onChange={(e) => setF({ ...f, fabric_type: e.target.value })}><option value=""></option><option value="main">Main</option><option value="trims_fabric">Trims Fabric</option></Select>
            </Field>
          </FieldGrid>
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

  useUnsavedGuard(adding || isPending);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Approval Parameters</h4>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Parameter"}</Button>
      </div>
      {adding && (
        <div data-focus-scope className="space-y-3 rounded border border-border p-3">
          <FieldGrid>
            {/* The module's second hand-typed `*`, same as Coordinate above. */}
            <Field label="Parameter" required size="lg" htmlFor="ap-parameter">
              <Input id="ap-parameter" uppercase value={f.parameter_name} onChange={(e) => setF({ ...f, parameter_name: e.target.value })} />
            </Field>
            <Field label="Status" size="sm" htmlFor="ap-status">
              <Select id="ap-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value=""></option>{APPROVAL_PARAM_STATUSES.map(s => <option key={s} value={s}>{s === "ok" ? "OK" : "NOT OK"}</option>)}</Select>
            </Field>
            <Field label="Comment" size="sm" htmlFor="ap-comment">
              <Input id="ap-comment" uppercase value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
            </Field>
          </FieldGrid>
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
  vendors,
  nominations,
  nominationCustomer,
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
      content: (
        <TrimsTab
          orderId={order.id}
          vendors={vendors}
          nominations={nominations}
          nominationCustomer={nominationCustomer}
        />
      ),
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
