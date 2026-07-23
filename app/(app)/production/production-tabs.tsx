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
import { Stat } from "@/components/ui/stat";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/lib/auth/permission-context";
import { fmtNumber, fmtDate } from "@/lib/format";
import { recordEntry, confirmEntry, logRework } from "@/lib/production/actions";
import {
  PRODUCTION_STAGES,
  STAGE_LABELS,
  type ProductionLine,
} from "@/lib/production/types";
import type {
  LineDashboardRow,
  OrderProgressRow,
  EntryWithRelations,
  OrderPickerItem,
} from "@/lib/production/service";

// ---- Line Dashboard tab ----

function LineDashboardTab({
  rows,
}: {
  rows: LineDashboardRow[];
}) {
  const totalGood = rows.reduce((s, r) => s + r.good_confirmed, 0);
  const totalPending = rows.reduce((s, r) => s + r.pending_count, 0);
  const totalRejects = rows.reduce(
    (s, r) => s + r.reject_confirmed + r.reject_recorded,
    0,
  );

  const columns: Column<LineDashboardRow>[] = [
    {
      header: "Line",
      cell: (r) => (
        <span className="font-mono text-xs font-semibold">
          {r.line_code ?? "—"}
        </span>
      ),
    },
    {
      header: "Name",
      cell: (r) => (
        <span className="text-sm text-foreground">{r.line_name ?? "—"}</span>
      ),
    },
    {
      header: "Stage",
      cell: (r) => (
        <StatusPill tone="info">{STAGE_LABELS[r.stage]}</StatusPill>
      ),
    },
    {
      header: "Good (conf.)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.good_confirmed)}</span>
      ),
    },
    {
      header: "Rejects",
      align: "right",
      cell: (r) => {
        const total = r.reject_confirmed + r.reject_recorded;
        return (
          <span className="tabular-nums text-sm">
            {total > 0 ? (
              <StatusPill tone="warning">{fmtNumber(total)}</StatusPill>
            ) : (
              fmtNumber(total)
            )}
          </span>
        );
      },
    },
    {
      header: "Recorded",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.good_recorded)}</span>
      ),
    },
    {
      header: "Pending",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.pending_count > 0 ? (
            <StatusPill tone="warning">{r.pending_count}</StatusPill>
          ) : (
            "0"
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Today's good pieces"
          value={fmtNumber(totalGood)}
          tone="success"
        />
        <Stat
          label="Pending confirmations"
          value={fmtNumber(totalPending)}
          tone={totalPending > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Today's rejects"
          value={fmtNumber(totalRejects)}
          tone={totalRejects > 0 ? "danger" : "neutral"}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(r, i) => `${r.line_id ?? "none"}-${r.stage}-${i}`}
        empty="No output recorded for today."
      />
    </div>
  );
}

// ---- Order Progress tab ----

function OrderProgressTab({ rows }: { rows: OrderProgressRow[] }) {
  const columns: Column<OrderProgressRow>[] = [
    {
      header: "Order #",
      cell: (r) => (
        <span className="font-mono text-xs font-medium">
          {r.order_number ?? "—"}
        </span>
      ),
    },
    {
      header: "Buyer",
      cell: (r) => (
        <span className="text-sm text-foreground">{r.buyer_name ?? "—"}</span>
      ),
    },
    {
      header: "Order qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span>
      ),
    },
    {
      header: "Cutting",
      align: "right",
      cell: (r) => {
        const p = r.progress.find((s) => s.stage === "cutting");
        return (
          <span className="tabular-nums text-sm">{fmtNumber(p?.good ?? 0)}</span>
        );
      },
    },
    {
      header: "Sewing",
      align: "right",
      cell: (r) => {
        const p = r.progress.find((s) => s.stage === "sewing");
        return (
          <span className="tabular-nums text-sm">{fmtNumber(p?.good ?? 0)}</span>
        );
      },
    },
    {
      header: "Packing",
      align: "right",
      cell: (r) => {
        const p = r.progress.find((s) => s.stage === "packing");
        return (
          <span className="tabular-nums text-sm">{fmtNumber(p?.good ?? 0)}</span>
        );
      },
    },
    {
      header: "Progress",
      cell: (r) => {
        // progress based on furthest stage's confirmed good vs order qty
        const maxGood = Math.max(...r.progress.map((p) => p.good));
        const pct =
          r.order_qty > 0 ? Math.min(100, Math.round((maxGood / r.order_qty) * 100)) : 0;

        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 rounded-full bg-surface-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      header: "Gap",
      cell: (r) =>
        r.has_gap ? (
          <StatusPill tone="danger">Gap</StatusPill>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getKey={(r) => r.id}
      empty="No active orders found."
    />
  );
}

// ---- Record Output tab ----

function RecordOutputTab({
  lines,
  ordersForPicker,
  pendingEntries,
  today,
}: {
  lines: ProductionLine[];
  ordersForPicker: OrderPickerItem[];
  pendingEntries: EntryWithRelations[];
  today: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const canApprove = usePermission("production", "approve");

  // form state
  const [orderId, setOrderId] = useState(ordersForPicker[0]?.id ?? "");
  const [stage, setStage] = useState<string>(PRODUCTION_STAGES[0]);
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [goodQty, setGoodQty] = useState("");
  const [rejectQty, setRejectQty] = useState("0");
  const [note, setNote] = useState("");
  const [formPending, startFormTransition] = useTransition();

  // per-entry pending tracking
  const [busyId, setBusyId] = useState<string | null>(null);

  function resetForm() {
    setGoodQty("");
    setRejectQty("0");
    setColor("");
    setSize("");
    setNote("");
  }

  function handleRecord(e: React.FormEvent) {
    e.preventDefault();
    startFormTransition(async () => {
      const result = await recordEntry({
        sales_order_id: orderId,
        stage: stage as "cutting" | "sewing" | "packing",
        line_id: stage === "sewing" && lineId ? lineId : null,
        entry_date: date || null,
        color: color || null,
        size: size || null,
        good_qty: Number(goodQty) || 0,
        reject_qty: Number(rejectQty) || 0,
        is_rework: false,
        note: note || null,
      });
      if (result.ok) {
        success("Entry recorded");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleConfirm(entryId: string) {
    setBusyId(entryId);
    // wrap in async IIFE — startTransition callback can be async but we manage busy state
    void (async () => {
      const result = await confirmEntry(entryId);
      setBusyId(null);
      if (result.ok) {
        success("Entry confirmed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    })();
  }

  function handleLogRework(entryId: string) {
    setBusyId(entryId + ":rework");
    void (async () => {
      const result = await logRework(entryId);
      setBusyId(null);
      if (result.ok) {
        success("Rework entry created");
        router.refresh();
      } else {
        toastError(result.error);
      }
    })();
  }

  const entryColumns: Column<EntryWithRelations>[] = [
    {
      header: "Date",
      cell: (e) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(e.entry_date)}
        </span>
      ),
    },
    {
      header: "Order",
      cell: (e) => (
        <span className="font-mono text-xs">
          {e.sales_orders?.order_number ?? "—"}
        </span>
      ),
    },
    {
      header: "Stage",
      cell: (e) => (
        <StatusPill tone="info">{STAGE_LABELS[e.stage]}</StatusPill>
      ),
    },
    {
      header: "Line",
      cell: (e) => (
        <span className="text-xs text-muted-foreground">
          {e.production_lines?.code ?? "—"}
        </span>
      ),
    },
    {
      header: "Colour / Size",
      cell: (e) => (
        <span className="text-xs text-muted-foreground">
          {[e.color, e.size].filter(Boolean).join(" / ") || "—"}
        </span>
      ),
    },
    {
      header: "Good",
      align: "right",
      cell: (e) => (
        <span className="tabular-nums text-sm">{fmtNumber(e.good_qty)}</span>
      ),
    },
    {
      header: "Reject",
      align: "right",
      cell: (e) => (
        <span className="tabular-nums text-sm">
          {e.reject_qty > 0 ? (
            <StatusPill tone="warning">{fmtNumber(e.reject_qty)}</StatusPill>
          ) : (
            "0"
          )}
        </span>
      ),
    },
    {
      header: "Actions",
      cell: (e) => (
        <div className="flex gap-1.5">
          {canApprove && (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => handleConfirm(e.id)}
              disabled={busyId === e.id}
              className="h-7 px-2 text-xs"
            >
              {busyId === e.id ? "…" : "Confirm"}
            </Button>
          )}
          {e.reject_qty > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleLogRework(e.id)}
              disabled={busyId === e.id + ":rework"}
              className="h-7 px-2 text-xs"
            >
              {busyId === e.id + ":rework" ? "…" : "Log rework"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Record output</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleRecord} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="pe-order">Order</Label>
                <Select
                  id="pe-order"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  required
                >
                  {ordersForPicker.length === 0 && (
                    <option value="">No active orders</option>
                  )}
                  {ordersForPicker.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number ?? o.id.slice(0, 8)}{" "}
                      {o.buyer_name ? `— ${o.buyer_name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="pe-stage">Stage</Label>
                <Select
                  id="pe-stage"
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  {PRODUCTION_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>

              {stage === "sewing" && (
                <div>
                  <Label htmlFor="pe-line">Line</Label>
                  <Select
                    id="pe-line"
                    value={lineId}
                    onChange={(e) => setLineId(e.target.value)}
                  >
                    <option value="">— no line —</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="pe-date">Date</Label>
                <Input
                  id="pe-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="pe-color">Colour</Label>
                <Input
                  id="pe-color"
                  placeholder="e.g. Navy"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="pe-size">Size</Label>
                <Input
                  id="pe-size"
                  placeholder="e.g. M"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="pe-good">Good qty</Label>
                <Input
                  id="pe-good"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={goodQty}
                  onChange={(e) => setGoodQty(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="pe-reject">Reject qty</Label>
                <Input
                  id="pe-reject"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={rejectQty}
                  onChange={(e) => setRejectQty(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="pe-note">Note</Label>
              <Textarea
                id="pe-note"
                placeholder="Optional note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={formPending || ordersForPicker.length === 0}>
                {formPending ? "Recording…" : "Record output"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {pendingEntries.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            Pending confirmation ({pendingEntries.length})
          </p>
          <DataTable
            columns={entryColumns}
            rows={pendingEntries}
            getKey={(e) => e.id}
            empty="All entries are confirmed."
          />
        </div>
      )}

      {pendingEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No pending entries — all output has been confirmed.
        </p>
      )}
    </div>
  );
}

// ---- main export ----

interface Props {
  lines: ProductionLine[];
  lineDashboard: LineDashboardRow[];
  orderProgress: OrderProgressRow[];
  ordersForPicker: OrderPickerItem[];
  pendingEntries: EntryWithRelations[];
  today: string;
}

export function ProductionTabs({
  lines,
  lineDashboard,
  orderProgress,
  ordersForPicker,
  pendingEntries,
  today,
}: Props) {
  const items = [
    {
      key: "dashboard",
      label: "Line Dashboard",
      content: <LineDashboardTab rows={lineDashboard} />,
    },
    {
      key: "progress",
      label: `Order Progress (${orderProgress.length})`,
      content: <OrderProgressTab rows={orderProgress} />,
    },
    {
      key: "record",
      label: `Record Output${pendingEntries.length > 0 ? ` (${pendingEntries.length} pending)` : ""}`,
      content: (
        <RecordOutputTab
          lines={lines}
          ordersForPicker={ordersForPicker}
          pendingEntries={pendingEntries}
          today={today}
        />
      ),
    },
  ];

  return <Tabs items={items} defaultKey="record" />;
}
