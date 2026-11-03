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
import { deleteDepartmentReturn } from "@/lib/stores/department-return-actions";
import { DEPARTMENT_RETURN_STATUS_LABELS } from "@/lib/stores/department-return-types";
import type { DepartmentReturnRow } from "@/lib/stores/department-return-service";

const BASE = "/purchase/department-returns";

export function DepartmentReturnsList({
  rows,
  canEdit,
  canDelete,
}: {
  rows: DepartmentReturnRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  function remove(r: DepartmentReturnRow) {
    start(async () => {
      const res = await deleteDepartmentReturn(r.id);
      if (!res.ok) return toastError(res.error);
      success(`${r.code ?? "Return"} deleted`);
      router.refresh();
    });
  }

  const columns: Column<DepartmentReturnRow>[] = [
    {
      header: "Return No",
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.return_date)}</span> },
    { header: "MRS No", cell: (r) => <span className="font-mono text-xs">{r.mrs_code ?? "—"}</span> },
    { header: "Department", cell: (r) => <span className="text-sm">{r.department}</span> },
    { header: "Store", cell: (r) => <span className="text-sm">{r.store_name ?? "—"}</span> },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason}</span> },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span> },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.total_qty)}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{DEPARTMENT_RETURN_STATUS_LABELS[r.status]}</StatusPill>,
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
          editDisabledReason={r.status === "draft" ? null : `${DEPARTMENT_RETURN_STATUS_LABELS[r.status]} — read-only`}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={r.status === "posted" ? "Posted — the stock is back in the store" : null}
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
      empty="No department returns yet."
    />
  );
}
