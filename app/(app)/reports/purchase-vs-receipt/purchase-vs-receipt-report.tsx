"use client";

import { ReportView } from "@/components/reports/report-view";
import { columnsFromFields, type FactRow } from "@/lib/reports/columns";
import { rollup } from "@/lib/reports/rollup";
import type { ReportField } from "@/lib/reports/registry";
import type { ReportConfig } from "@/lib/reports/types";
import type { ItemMovementRow } from "@/lib/reports/item-types";

const FIELDS: ReportField[] = [
  { key: "item_name", label: "Material", kind: "dimension", format: "text", source: "items" },
  { key: "stock_uom_code", label: "UOM", kind: "dimension", format: "text", source: "uoms" },
  { key: "qty_ordered", label: "Ordered", kind: "measure", format: "qty", source: "po_line_items" },
  { key: "qty_grn_accepted", label: "GRN accepted", kind: "measure", format: "qty", source: "grn_line_items" },
  { key: "qty_grn_rejected", label: "GRN rejected", kind: "measure", format: "qty", source: "grn_line_items" },
  { key: "qty_received", label: "Reached stock", kind: "measure", format: "qty", source: "stock_ledger" },
  { key: "qty_unposted", label: "Unposted", kind: "measure", format: "qty", source: "report_item_movements" },
  { key: "qty_pending", label: "Pending delivery", kind: "measure", format: "qty", source: "report_item_movements" },
  { key: "value_ordered", label: "Ordered value", kind: "measure", format: "money", source: "po_line_items" },
  { key: "value_purchased", label: "Received value", kind: "measure", format: "money", source: "stock_ledger" },
];

const MEASURES = FIELDS.filter((f) => f.kind === "measure").map((f) => f.key);

export function PurchaseVsReceiptReport({ rows }: { rows: ItemMovementRow[] }) {
  const grouped = rollup(rows as unknown as FactRow[], ["item_name", "stock_uom_code"], MEASURES);

  // Derived after the rollup: both are differences, and summing a difference
  // per-row then rolling up gives the same answer only because both terms are
  // additive — computing them here keeps that explicit.
  for (const r of grouped) {
    r.qty_unposted = Number(r.qty_grn_accepted ?? 0) - Number(r.qty_received ?? 0);
    r.qty_pending = Number(r.qty_ordered ?? 0) - Number(r.qty_grn_accepted ?? 0);
  }

  const config: ReportConfig<FactRow> = {
    title: "Purchase vs Receipt",
    subtitle: "Ordered → GRN accepted → reached stock",
    rows: grouped,
    columns: columnsFromFields(FIELDS),
    chart: {
      kind: "bar",
      category: (r) => String(r.item_name ?? "—"),
      series: [
        { key: "qty_ordered", label: "Ordered", value: (r) => Number(r.qty_ordered ?? 0) },
        { key: "qty_grn_accepted", label: "GRN accepted", value: (r) => Number(r.qty_grn_accepted ?? 0) },
        { key: "qty_received", label: "Reached stock", value: (r) => Number(r.qty_received ?? 0) },
      ],
    },
  };

  return (
    <div className="space-y-3">
      <ReportView
        config={config}
        getKey={(_row, i) => `row-${i}`}
        empty="No purchase activity in this period."
      />
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">GRN accepted reads 0 for lines with no PO
        link.</span>{" "}
        <code>grn_line_items</code> has no <code>item_id</code> of its own — the
        material is reachable only through <code>po_line_item_id</code>, so a GRN
        line entered without one cannot be attributed to any material. Those
        receipts still appear under “Reached stock”, which is why that column can
        exceed “GRN accepted”.
      </p>
    </div>
  );
}
