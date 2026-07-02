"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  raiseShortage,
  submitShortage,
  approveShortage,
  rejectShortage,
  resolveShortage,
  deleteShortage,
} from "@/lib/planning/shortage-actions";
import {
  SHORTAGE_KINDS,
  SHORTAGE_KIND_LABELS,
  SHORTAGE_STATUS_LABELS,
  shortageQty,
  type ShortageKind,
  type ShortageStatus,
} from "@/lib/planning/types";
import type { ShortageWithRefs, ItemOption, UomOption } from "@/lib/planning/shortage-service";
import type { OrderForPicker } from "@/lib/planning/budget-service";

function statusTone(status: ShortageStatus): StatusTone {
  switch (status) {
    case "open":
      return "neutral";
    case "submitted":
      return "info";
    case "approved":
      return "warning";
    case "rejected":
      return "danger";
    case "resolved":
      return "success";
  }
}

interface Props {
  shortages: ShortageWithRefs[];
  orders: OrderForPicker[];
  items: ItemOption[];
  uoms: UomOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

export function ShortagesClient({
  shortages,
  orders,
  items,
  uoms,
  canCreate,
  canEdit,
  canApprove,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // raise form state
  const [kind, setKind] = useState<ShortageKind>("material");
  const [salesOrderId, setSalesOrderId] = useState("");
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [uomId, setUomId] = useState("");
  const [requiredQty, setRequiredQty] = useState("");
  const [availableQty, setAvailableQty] = useState("");
  const [reason, setReason] = useState("");

  const previewShortage = shortageQty(
    parseFloat(requiredQty) || 0,
    parseFloat(availableQty) || 0,
  );

  function resetForm() {
    setKind("material");
    setSalesOrderId("");
    setItemId("");
    setDescription("");
    setUomId("");
    setRequiredQty("");
    setAvailableQty("");
    setReason("");
  }

  function handleRaise(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await raiseShortage({
        kind,
        sales_order_id: salesOrderId || null,
        item_id: itemId || null,
        description,
        uom_id: uomId || null,
        required_qty: parseFloat(requiredQty) || 0,
        available_qty: parseFloat(availableQty) || 0,
        reason: reason || null,
      });
      if (result.ok) {
        success("Shortage raised");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function runAction(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        success(ok);
        router.refresh();
      } else {
        toastError(result.error ?? "Action failed");
      }
    });
  }

  const columns: Column<ShortageWithRefs>[] = [
    {
      header: "Shortage #",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span>,
    },
    {
      header: "Kind",
      cell: (r) => <span className="text-sm">{SHORTAGE_KIND_LABELS[r.kind]}</span>,
    },
    {
      header: "Order",
      cell: (r) => (
        <span className="text-sm">{r.order_number ?? <span className="text-muted-foreground">—</span>}</span>
      ),
    },
    {
      header: "Item / description",
      cell: (r) => (
        <span className="text-sm">{r.item_name ? `${r.item_name} — ` : ""}{r.description}</span>
      ),
    },
    {
      header: "Required",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.required_qty)}</span>,
    },
    {
      header: "Available",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.available_qty)}</span>,
    },
    {
      header: "Short",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold text-danger">
          {fmtNumber(r.shortage_qty)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{SHORTAGE_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "Raised",
      cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>,
    },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "open" && (
            <Button
              size="sm"
              variant="subtle"
              className="h-7 px-2 text-xs"
              disabled={isPending}
              onClick={() => runAction(() => submitShortage(r.id), "Submitted for approval")}
            >
              Submit
            </Button>
          )}
          {canApprove && r.status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="subtle"
                className="h-7 px-2 text-xs"
                disabled={isPending}
                onClick={() => runAction(() => approveShortage(r.id), "Approved")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending}
                onClick={() => runAction(() => rejectShortage(r.id), "Rejected")}
              >
                Reject
              </Button>
            </>
          )}
          {canEdit && r.status === "approved" && (
            <Button
              size="sm"
              variant="subtle"
              className="h-7 px-2 text-xs"
              disabled={isPending}
              onClick={() => runAction(() => resolveShortage(r.id, null), "Marked resolved")}
            >
              Resolve
            </Button>
          )}
          {canDelete && (r.status === "open" || r.status === "rejected") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-danger hover:border-danger"
              disabled={isPending}
              onClick={() => runAction(() => deleteShortage(r.id), "Deleted")}
            >
              Del
            </Button>
          )}
        </div>
      ),
    },
  ];

  function TableFor({ rows }: { rows: ShortageWithRefs[] }) {
    return (
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No shortages in this view." />
    );
  }

  const openRows = shortages.filter((s) => s.status === "open");
  const submittedRows = shortages.filter((s) => s.status === "submitted");
  const approvedRows = shortages.filter((s) => s.status === "approved");

  const tabItems = [
    { key: "all", label: `All (${shortages.length})`, content: <TableFor rows={shortages} /> },
    { key: "open", label: `Open (${openRows.length})`, content: <TableFor rows={openRows} /> },
    { key: "submitted", label: `To approve (${submittedRows.length})`, content: <TableFor rows={submittedRows} /> },
    { key: "approved", label: `Approved (${approvedRows.length})`, content: <TableFor rows={approvedRows} /> },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>Raise a shortage</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleRaise} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="sh-kind">Kind</Label>
                    <Select
                      id="sh-kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as ShortageKind)}
                    >
                      {SHORTAGE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {SHORTAGE_KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="sh-order">Sales order (optional)</Label>
                    <Select
                      id="sh-order"
                      value={salesOrderId}
                      onChange={(e) => setSalesOrderId(e.target.value)}
                    >
                      <option value="">— none —</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.order_number ?? o.id.slice(0, 8)}
                          {o.buyer_name ? ` — ${o.buyer_name}` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="sh-item">Item (optional)</Label>
                    <Select id="sh-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                      <option value="">— none —</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.code ? `${i.code} — ` : ""}{i.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="sm:col-span-2">
                    <Label htmlFor="sh-desc">Description</Label>
                    <Input
                      id="sh-desc"
                      placeholder="e.g. Navy rib shortfall for style 4021"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="sh-uom">UOM</Label>
                    <Select id="sh-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
                      <option value="">— select UOM —</option>
                      {uoms.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} — {u.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="sh-req">Required qty</Label>
                    <Input
                      id="sh-req"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0"
                      value={requiredQty}
                      onChange={(e) => setRequiredQty(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="sh-avail">Available qty</Label>
                    <Input
                      id="sh-avail"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0"
                      value={availableQty}
                      onChange={(e) => setAvailableQty(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label>Shortage (auto)</Label>
                    <div className="flex h-9 items-center px-2 text-sm font-semibold tabular-nums text-danger">
                      {fmtNumber(previewShortage)}
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="sh-reason">Reason / notes</Label>
                  <Textarea
                    id="sh-reason"
                    rows={2}
                    placeholder="Why is there a gap?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Saving…" : "Raise shortage"}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setOpen(true)}>Raise shortage</Button>
          </div>
        ))}

      <Tabs items={tabItems} defaultKey="all" />
    </div>
  );
}
