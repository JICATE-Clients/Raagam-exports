"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowIconAction } from "@/components/ui/row-actions";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import type { DcReturnRow } from "@/lib/purchase/general-dc-service";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", posted: "Posted", cancelled: "Cancelled" };

/** Purchase ▸ Purchase Store ▸ Delivery Return — every return posted at this unit (0797). */
export function DeliveryReturnsList({ rows }: { rows: DcReturnRow[] }) {
  const router = useRouter();
  const columns: Column<DcReturnRow>[] = [
    { header: "Return No", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.return_date)}</span> },
    {
      header: "DC No",
      cell: (r) => (
        <Link href={`/purchase/general-delivery/${r.dc_id}/print`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.dc_code ?? "—"}
        </Link>
      ),
    },
    { header: "Party", cell: (r) => <span className="text-sm">{r.party}</span> },
    { header: "Party DC No", cell: (r) => <span className="font-mono text-xs">{r.party_dc_no ?? "—"}</span> },
    { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.line_count}</span> },
    { header: "Returned", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.returned)}</span> },
    {
      header: "Written Off",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.closed > 0 ? fmtNumber(r.closed) : "—"}</span>,
    },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <RowIconAction label="Print DC" name={r.dc_code} icon={FileText} onClick={() => router.push(`/purchase/general-delivery/${r.dc_id}/print`)} />
      ),
    },
  ];
  return <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No delivery returns yet." />;
}
