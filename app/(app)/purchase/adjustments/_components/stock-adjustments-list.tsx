"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { deleteStockAdjustment } from "@/lib/stores/stock-adjustment-actions";
import { ADJ_STOCK_TYPES, STOCK_ADJUSTMENT_STATUS_LABELS } from "@/lib/stores/stock-adjustment-types";
import type { StockAdjustmentRow } from "@/lib/stores/stock-adjustment-service";

const BASE = "/purchase/adjustments";

export function StockAdjustmentsList({
  rows,
  canEdit,
  canDelete,
}: {
  rows: StockAdjustmentRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  function remove(r: StockAdjustmentRow) {
    start(async () => {
      const res = await deleteStockAdjustment(r.id);
      if (!res.ok) return toastError(res.error);
      success(`${r.code ?? "Adjustment"} deleted`);
      router.refresh();
    });
  }

  const columns: Column<StockAdjustmentRow>[] = [
    {
      header: "Entry No",
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.adjustment_date)}</span> },
    {
      header: "Stock Type",
      cell: (r) => <span className="text-sm">{ADJ_STOCK_TYPES.find((t) => t.value === r.stock_type)?.label ?? "—"}</span>,
    },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_name ?? "—"}</span> },
    { header: "Group", cell: (r) => <span className="text-sm">{r.group_label}</span> },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span> },
    {
      header: "Net Qty",
      align: "right",
      cell: (r) => (
        <span className={`tabular-nums text-sm ${r.net_qty < 0 ? "text-destructive" : r.net_qty > 0 ? "text-success" : ""}`}>
          {r.net_qty > 0 ? "+" : ""}
          {fmtNumber(r.net_qty)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{STOCK_ADJUSTMENT_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          label={r.code}
          view={false}
          canEdit={canEdit}
          onEdit={() => router.push(`${BASE}/${r.id}`)}
          editDisabledReason={r.status === "draft" ? null : `${STOCK_ADJUSTMENT_STATUS_LABELS[r.status]} — read-only`}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={r.status === "posted" ? "Posted — the stock has changed" : null}
          isPending={isPending}
        />
      ),
    },
  ];

  return <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No stock adjustments yet." />;
}
