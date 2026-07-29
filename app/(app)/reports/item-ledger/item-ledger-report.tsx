"use client";

import { ReportView } from "@/components/reports/report-view";
import { columnsFromFields, type FactRow } from "@/lib/reports/columns";
import type { ReportField } from "@/lib/reports/registry";
import type { ReportConfig } from "@/lib/reports/types";
import type { ItemLedgerRow } from "@/lib/reports/item-types";

/** Human labels for the fact kinds emitted by `report_item_movements`. */
const FACT_KIND_LABELS: Record<string, string> = {
  opening: "Opening",
  ordered: "Ordered",
  received: "Received",
  grn_accepted: "GRN accepted",
  grn_rejected: "GRN rejected",
  issued: "Consumed",
  returned: "Returned",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjust_in: "Adjust in",
  adjust_out: "Adjust out",
  planned: "Planned",
  sent_out: "Sent to processor",
  came_back: "Back from processor",
};

const LEDGER_FIELDS: ReportField[] = [
  { key: "txn_date", label: "Date", kind: "dimension", format: "date", source: "report_item_movements" },
  { key: "kind_label", label: "Movement", kind: "dimension", format: "text", source: "report_item_movements" },
  { key: "item_name", label: "Material", kind: "dimension", format: "text", source: "items" },
  { key: "item_class_name", label: "Class", kind: "dimension", format: "text", source: "config_lookups" },
  { key: "category_name", label: "Category", kind: "dimension", format: "text", source: "categories" },
  { key: "store_name", label: "Store", kind: "dimension", format: "text", source: "stores" },
  { key: "party_name", label: "Party", kind: "dimension", format: "text", source: "vendors" },
  { key: "doc_code", label: "Document", kind: "dimension", format: "text", source: "report_item_movements" },
  { key: "uom_code", label: "UOM", kind: "dimension", format: "text", source: "uoms" },
  { key: "quantity", label: "Quantity", kind: "measure", format: "qty", source: "report_item_movements" },
  { key: "rate", label: "Rate", kind: "measure", format: "money", source: "report_item_movements" },
  { key: "value", label: "Value", kind: "measure", format: "money", source: "report_item_movements" },
  { key: "stock_effect", label: "Stock effect", kind: "dimension", format: "text", source: "report_item_movements" },
];

export function ItemLedgerReport({ rows }: { rows: ItemLedgerRow[] }) {
  // Decorate on the client — these are display concerns, not data.
  const decorated: FactRow[] = rows.map((r) => ({
    ...r,
    kind_label: FACT_KIND_LABELS[r.fact_kind] ?? r.fact_kind,
    stock_effect: r.posts_to_ledger
      ? r.direction === "in"
        ? "In"
        : "Out"
      : "Document only",
  }));

  const config: ReportConfig<FactRow> = {
    title: "Item Movement Ledger",
    subtitle: "One row per movement, across every source",
    rows: decorated,
    columns: columnsFromFields(LEDGER_FIELDS),
  };

  return (
    <ReportView
      config={config}
      getKey={(row) => String(row.fact_id)}
      empty="No movements match these filters."
    />
  );
}
