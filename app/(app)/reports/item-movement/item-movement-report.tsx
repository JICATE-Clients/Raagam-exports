"use client";

import { ReportView } from "@/components/reports/report-view";
import { columnsFromFields, type FactRow } from "@/lib/reports/columns";
import { rollup } from "@/lib/reports/rollup";
import {
  attributeName,
  fieldByKey,
  isAttributeKey,
  ITEM_MEASURES,
  defaultMeasures,
} from "@/lib/reports/registry";
import type { ReportConfig } from "@/lib/reports/types";
import type { ItemMovementRow } from "@/lib/reports/item-types";

/**
 * Builds the `ReportConfig` for Item Purchase & Consumption.
 *
 * MUST be a client component: `ReportConfig` holds closures (`column.value`,
 * the chart accessors) and functions are not serialisable, so the server page
 * can only pass the plain `rows` array across.
 *
 * Columns are derived from the registry rather than hand-listed — which is what
 * makes a newly-registered field appear here without this file changing.
 */
export function ItemMovementReport({
  rows,
  groupBy,
}: {
  rows: ItemMovementRow[];
  groupBy: string;
}) {
  const dimension = fieldByKey(groupBy);
  const measures = defaultMeasures();
  const measureKeys = measures.map((m) => m.key);

  // Roll the item × store × month grain onto the chosen axis. UOM only survives
  // an item-level grouping — mixed units cannot be summed into one figure.
  const keepUom = groupBy === "item_name" || groupBy === "item_code";
  const dimensionKeys = keepUom ? [groupBy, "stock_uom_code"] : [groupBy];
  const grouped = rollup(rows as unknown as FactRow[], dimensionKeys, measureKeys);

  const dimensionFields = dimensionKeys
    .map((k) => fieldByKey(k))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  const config: ReportConfig<FactRow> = {
    title: "Item Purchase & Consumption",
    subtitle: `Grouped by ${dimension?.label ?? groupBy}`,
    rows: grouped,
    columns: columnsFromFields([...dimensionFields, ...measures]),
    chart: {
      kind: "bar",
      category: (r) => String(r[groupBy] ?? "—"),
      series: [
        { key: "qty_received", label: "Purchased", value: (r) => Number(r.qty_received ?? 0) },
        { key: "qty_issued", label: "Consumed", value: (r) => Number(r.qty_issued ?? 0) },
      ],
    },
  };

  // Caveats attached to the measures actually on screen — an ERP number without
  // its provenance is worse than no number.
  const caveats = ITEM_MEASURES.filter(
    (m) => measureKeys.includes(m.key) && m.caveat,
  );

  return (
    <div className="space-y-3">
      <ReportView
        config={config}
        getKey={(_row, i) => `row-${i}`}
        empty="No material movement in this period."
      />
      {caveats.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground print:block">
          {caveats.map((m) => (
            <li key={m.key}>
              <span className="font-medium">{m.label}:</span> {m.caveat}
            </li>
          ))}
        </ul>
      )}
      {isAttributeKey(groupBy) && (
        <p className="text-xs text-muted-foreground">
          Grouped by the material attribute “{attributeName(groupBy)}”. Items that
          have no answer for it are grouped under “—”.
        </p>
      )}
    </div>
  );
}
