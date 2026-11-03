"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, PackageCheck } from "lucide-react";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { issueMrs } from "@/lib/stores/extras-actions";
import type { DeliveryQueueRow, ItemClassOption } from "@/lib/stores/extras-service";

/**
 * Stock readiness of a slip, in this screen's own words. Ready means every line
 * is on hand in the slip's store (nothing stops the hand-over); Short means at
 * least one is not, and Deliver is greyed until stock arrives.
 */
const STOCK_TONE = { ready: "success", short: "danger" } as const;

/**
 * Delivered is this queue's finished state — the goods have gone to the
 * department (the shared table reads `issued` as "moving, out of our hands").
 */
const DELIVERY_TONE = { issued: "success", approved: "warning" } as const;

type View = "pending" | "delivered";
const ALL = "all";

interface Props {
  rows: DeliveryQueueRow[];
  classes: ItemClassOption[];
  canDeliver: boolean;
}

export function GeneralItemsDeliveryClient({ rows, classes, canDeliver }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<View>("pending");
  // General (GEN) by default — the screen's name; "All" widens to every class.
  const [classId, setClassId] = useState<string>(() => classes.find((c) => c.code === "GEN")?.id ?? ALL);
  const [confirming, setConfirming] = useState<DeliveryQueueRow | null>(null);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (view === "pending" ? r.status === "approved" : r.status === "issued") &&
          (classId === ALL || r.item_class_ids.includes(classId)),
      ),
    [rows, view, classId],
  );

  function deliver(r: DeliveryQueueRow) {
    setConfirming(null);
    startTransition(async () => {
      const res = await issueMrs(r.id);
      if (res.ok) {
        success(`${r.code ?? "Requisition"} delivered to ${r.department}`);
        router.refresh();
      } else toastError(res.error);
    });
  }

  function deliverBlock(r: DeliveryQueueRow): string | null {
    if (!canDeliver) return "Delivering needs the Edit permission on Stores";
    if (r.lines.length === 0) return "This slip has no lines";
    const n = r.short_lines.length;
    if (n > 0) return `${n} line${n === 1 ? "" : "s"} short of stock`;
    return null;
  }

  const columns: Column<DeliveryQueueRow>[] = [
    {
      header: "MRS No",
      cell: (r) => (
        <Link href={`/purchase/requisitions/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Department", cell: (r) => <span className="text-sm">{r.department}</span> },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_name ?? r.store_code ?? "—"}</span> },
    { header: "Required", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.required_date)}</span> },
    {
      header: "Lines",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.lines.length}</span>,
    },
    ...(view === "pending"
      ? [
          {
            header: "Stock",
            cell: (r: DeliveryQueueRow) => {
              const short = r.short_lines.length > 0;
              return (
                <div className="space-y-0.5">
                  <StatusPill tone={statusTone(short ? "short" : "ready", STOCK_TONE)}>{short ? "Short" : "Ready"}</StatusPill>
                  {short && (
                    <ul className="text-xs text-muted-foreground">
                      {r.short_lines.map((l) => (
                        <li key={l.id}>
                          {l.item_name ?? "Item"}: needs {fmtNumber(l.requested_qty)}, has {fmtNumber(l.stock_qty)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            },
          } satisfies Column<DeliveryQueueRow>,
        ]
      : []),
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={statusTone(r.status, DELIVERY_TONE)}>{r.status === "issued" ? "Delivered" : "To deliver"}</StatusPill>
      ),
    },
    rowActionsColumn<DeliveryQueueRow>((r) => (
      <div className="flex items-center justify-end gap-1">
        {r.status === "approved" && (
          <RowIconAction
            label="Deliver"
            name={r.code}
            icon={PackageCheck}
            disabledReason={deliverBlock(r)}
            onClick={() => setConfirming(r)}
          />
        )}
        <RowIconAction
          label="Open requisition"
          name={r.code}
          icon={FileText}
          onClick={() => router.push(`/purchase/requisitions/${r.id}`)}
        />
      </div>
    )),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup<View>
          label="Delivery"
          value={view}
          onChange={setView}
          options={[
            { value: "pending", label: "To deliver" },
            { value: "delivered", label: "Delivered" },
          ]}
        />
        <div className="w-60">
          <Select
            aria-label="Item class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value={ALL}>All item classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <DataTable
        columns={withCreatedColumns(columns, shown)}
        rows={shown}
        getKey={(r) => r.id}
        empty={view === "pending" ? "No approved requisitions waiting to be delivered." : "Nothing delivered yet."}
      />
      <ConfirmDialog
        open={!!confirming}
        title={`Deliver ${confirming?.code ?? "requisition"}?`}
        body={
          confirming
            ? `All ${confirming.lines.length} line${confirming.lines.length === 1 ? "" : "s"} are issued from ${confirming.store_name ?? confirming.store_code ?? "the store"} to ${confirming.department}, and the stock is taken out of the ledger.`
            : undefined
        }
        confirmLabel="Deliver"
        tone="primary"
        isPending={isPending}
        onConfirm={() => confirming && deliver(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
