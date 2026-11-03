"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtMoney } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { deleteOpeningStock } from "@/lib/stores/opening-stock/actions";
import { OPENING_STOCK_STATUS_LABELS, STOCK_TYPE_LABELS } from "@/lib/stores/opening-stock/types";
import type { OpeningStockRow } from "@/lib/stores/opening-stock/service";

const BASE = "/purchase/opening-stock";

export function OpeningStockList({ rows, canEdit, canDelete }: { rows: OpeningStockRow[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  function remove(r: OpeningStockRow) {
    start(async () => {
      const res = await deleteOpeningStock(r.id);
      if (!res.ok) return toastError(res.error);
      success(`${r.code ?? "Opening stock"} deleted`);
      router.refresh();
    });
  }

  const columns: Column<OpeningStockRow>[] = [
    {
      header: "Entry No",
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.opening_date)}</span> },
    { header: "Stock Type", cell: (r) => <span className="text-sm">{STOCK_TYPE_LABELS[r.stock_type]}</span> },
    { header: "Group", cell: (r) => <span className="text-sm">{r.group_label}</span> },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_name ?? "—"}</span> },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span> },
    { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.total_value)}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{OPENING_STOCK_STATUS_LABELS[r.status]}</StatusPill>,
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
          editDisabledReason={r.status === "draft" ? null : `${OPENING_STOCK_STATUS_LABELS[r.status]} — read-only`}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={r.status === "posted" ? "Posted — the stock is in the ledger" : null}
          isPending={isPending}
        />
      ),
    },
  ];

  return <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No opening stock entered yet." />;
}
