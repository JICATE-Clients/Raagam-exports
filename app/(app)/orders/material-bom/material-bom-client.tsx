"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";
import type { BomStatus } from "@/lib/planning/types";
import type { AcceptedOrderRow } from "@/lib/orders/material-bom-service";

function bomTone(s: BomStatus | null): StatusTone {
  if (!s) return "neutral";
  return s === "final" ? "success" : "warning";
}
function bomLabel(s: BomStatus | null): string {
  if (!s) return "Not started";
  return s === "final" ? "Final" : "Draft";
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
};

export function MaterialBomClient({ rows }: { rows: AcceptedOrderRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.order_number, r.buyer_name].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<AcceptedOrderRow>[] = [
    {
      header: "SC No",
      cell: (r) => (
        <span className="font-mono text-xs font-medium">{r.order_number ?? "—"}</span>
      ),
    },
    {
      header: "SC Dt",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(r.created_at)}
        </span>
      ),
    },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    {
      header: "Deli Dt",
      cell: (r) => (
        <span className="tabular-nums text-xs">{fmtDate(r.ship_date)}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.order_qty)}</span>,
    },
    {
      header: "Order status",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {ORDER_STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
    },
    {
      header: "Material BOM",
      cell: (r) => (
        <StatusPill tone={bomTone(r.material_bom_status)}>
          {bomLabel(r.material_bom_status)}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Link href={`/planning/orders/${r.id}`}>
          <Button variant="outline" size="sm">
            {r.material_bom_status ? "Open BOM →" : "Prepare BOM →"}
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by SC No or customer…"
        />
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No accepted orders. Confirm a sales order first."
      />
    </div>
  );
}
