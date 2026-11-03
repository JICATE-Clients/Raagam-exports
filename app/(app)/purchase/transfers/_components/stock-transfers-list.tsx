"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { deleteStockTransfer } from "@/lib/stores/stock-transfer-actions";
import { STOCK_TRANSFER_STATUS_LABELS, TRANSFER_TYPE_LABELS } from "@/lib/stores/stock-transfer-types";
import type { StockTransferRow } from "@/lib/stores/stock-transfer-service";

const BASE = "/purchase/transfers";

export function StockTransfersList({
  rows,
  canEdit,
  canDelete,
}: {
  rows: StockTransferRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  function remove(r: StockTransferRow) {
    start(async () => {
      const res = await deleteStockTransfer(r.id);
      if (!res.ok) return toastError(res.error);
      success(`${r.code ?? "Transfer"} deleted`);
      router.refresh();
    });
  }

  const side = (store: string | null, owner: string) => (
    <span className="text-sm leading-tight">
      <span className="block">{owner}</span>
      <span className="block text-xs text-muted-foreground">{store ?? "—"}</span>
    </span>
  );

  const columns: Column<StockTransferRow>[] = [
    {
      header: "Transfer No",
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.transfer_date)}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{TRANSFER_TYPE_LABELS[r.transfer_type]}</span> },
    { header: "From", cell: (r) => side(r.from_store_name, r.from_owner) },
    { header: "To", cell: (r) => side(r.to_store_name, r.to_owner) },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.total_qty)}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{STOCK_TRANSFER_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          label={r.code}
          view={false}
          lead={
            r.status === "posted" ? (
              <RowIconAction label="Print" name={r.code} icon={FileText} onClick={() => router.push(`${BASE}/${r.id}/print`)} />
            ) : undefined
          }
          canEdit={canEdit}
          onEdit={() => router.push(`${BASE}/${r.id}`)}
          editDisabledReason={r.status === "draft" ? null : `${STOCK_TRANSFER_STATUS_LABELS[r.status]} — read-only`}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={r.status === "posted" ? "Posted — the stock has moved" : null}
          isPending={isPending}
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={withCreatedColumns(columns, rows)}
      rows={rows}
      getKey={(r) => r.id}
      empty="No stock transfers yet."
    />
  );
}
