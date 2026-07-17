"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtNumber } from "@/lib/format";
import type { RateAmendedItemRow } from "@/lib/planning/types";

function statusTone(s: string): StatusTone {
  if (s === "approved") return "success";
  if (s === "rejected" || s === "cancelled") return "danger";
  if (s === "pending" || s === "submitted") return "warning";
  return "neutral";
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function RateAmendedItemsClient({ rows }: { rows: RateAmendedItemRow[] }) {
  const columns: Column<RateAmendedItemRow>[] = [
    { header: "Source", cell: (r) => <StatusPill tone={r.source === "PO" ? "info" : "neutral"}>{r.source}</StatusPill> },
    { header: "Doc", cell: (r) => <span className="font-mono text-xs font-medium">{r.doc_code ?? "—"}</span> },
    { header: "Item", cell: (r) => <span className="text-sm">{r.item_label}</span> },
    { header: "Old rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.previous_rate)}</span> },
    { header: "New rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.revised_rate)}</span> },
    {
      header: "Δ",
      align: "right",
      cell: (r) => {
        const d = r.revised_rate - r.previous_rate;
        const cls = d > 0 ? "text-danger" : d < 0 ? "text-success" : "text-muted-foreground";
        return <span className={`tabular-nums text-sm ${cls}`}>{d > 0 ? "+" : ""}{fmtNumber(d)}</span>;
      },
    },
    { header: "Reason", cell: (r) => <span className="text-sm text-muted-foreground">{r.reason ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={statusTone(r.status)}>{r.status || "—"}</StatusPill> },
    { header: "Decided", cell: (r) => <span className="text-xs text-muted-foreground">{fmtDate(r.decided_at)}</span> },
  ];

  return <DataTable columns={columns} rows={rows} getKey={(r) => `${r.source}-${r.id}`} empty="No amended-item rates found." />;
}
