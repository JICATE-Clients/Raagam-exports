"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { deleteKnittingOrder } from "@/lib/production/knitting-actions";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { FileText } from "lucide-react";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { KNIT_STATUS_LABELS, type KnittingOrderListRow } from "@/lib/production/knitting-types";

const BASE = "/process/knitting-hub";

export function KnittingOrdersList({ rows, canEdit, canDelete = false }: { rows: KnittingOrderListRow[]; canEdit: boolean; canDelete?: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  /* A row the yarn has gone out on keeps its bin GREYED with the reason (AGENTS.md "Row actions":
     hiding is for missing permission only). An issued order whose DC was raised is refused by
     the server with its own sentence. */
  const deleteBlocked = (r: KnittingOrderListRow) =>
    ["draft", "issued", "cancelled"].includes(r.status) ? null : `${KNIT_STATUS_LABELS[r.status]} — yarn is at the knitter, cancel or close it instead`;
  const remove = (r: KnittingOrderListRow) =>
    startTransition(async () => {
      const res = await deleteKnittingOrder(r.id);
      if (res.ok) {
        success(`${r.code ?? "Knitting order"} deleted`);
        router.refresh();
      } else toastError(res.error);
    });
  const columns: Column<KnittingOrderListRow>[] = [
    {
      header: "KO No",
      cell: (r) => (
        <Link href={`${BASE}/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </Link>
      ),
    },
    { header: "KO Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.order_date)}</span> },
    { header: "RE No", cell: (r) => <span className="text-sm">{r.order_number ?? "—"}</span> },
    { header: "Knitter", cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span> },
    { header: "Fabrics", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.fabric_count}</span> },
    { header: "Program Kg", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.programmed_kg)}</span> },
    { header: "Delivery", cell: (r) => <span className="tabular-nums text-sm">{r.expected_date ? fmtDate(r.expected_date) : "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{KNIT_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowActions
          label={r.code}
          view={false}
          // Report takes the eye's slot (AGENTS.md "Row actions"): the Knitting Analysis.
          lead={<RowIconAction label="Knitting Analysis" name={r.code} icon={FileText} onClick={() => router.push(`${BASE}/${r.id}/report`)} />}
          canEdit={canEdit}
          onEdit={() => router.push(`${BASE}/${r.id}`)}
          editDisabledReason={r.status === "draft" ? null : `${KNIT_STATUS_LABELS[r.status]} — read-only`}
          canDelete={canDelete}
          onDelete={() => remove(r)}
          deleteDisabledReason={deleteBlocked(r)}
        />
      ),
    },
  ];
  return <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No knitting orders yet." />;
}
