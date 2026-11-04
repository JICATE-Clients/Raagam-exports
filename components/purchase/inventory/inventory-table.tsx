"use client";

import { useState } from "react";
import { ReportView } from "@/components/reports/report-view";
import { ToggleGroup } from "@/components/ui/segmented";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import type { ReportColumn, ReportConfig } from "@/lib/reports/types";
import {
  AGE_BANDS,
  STATUS_LABEL,
  type AgeBand,
  type StockStatementRow,
  type StockValueRow,
} from "@/lib/reports/stock-statement-types";

/**
 * PURCHASE ▸ INVENTORY DASHBOARD (user 2026-11-04, "Live Inventory & Bin Location
 * Dashboard … under purchase module").
 *
 * NOT A SECOND STOCK ENGINE. Every row is a FIFO receipt layer from 0793's
 * `report_stock_statement*` — the rows Reports ▸ Stock Statement (with Value) already show —
 * so the dashboard and the reports cannot disagree. The filters are that report's own facet
 * groups (Group Type · Order No · Customer · Vendor · Item Class · Store · Status · Age). What
 * this screen adds is the blueprint's shape: four headline cards, Detailed (lot · bin) vs
 * Summary (item) and the age matrix — each layer's qty under its 0–30 / 31–60 / 61–90 / 90+
 * column, 90+ flagged as idle.
 *
 * VALUE IS THE DATABASE'S DECISION, not this screen's: `withValue` is true only when the
 * value RPC answered, i.e. the caller holds the Stock Statement with Value screen grant.
 */

export type Row = StockStatementRow & Partial<Pick<StockValueRow, "rate" | "value">>;
type Mode = "detailed" | "summary";

export const isAsset = (r: Row) => r.status !== "rejected" && r.status !== "replacement";
const BAND_LABEL: Record<AgeBand, string> = { "0-30": "0–30 Days", "31-60": "31–60 Days", "61-90": "61–90 Days", "90+": "90+ Days" };

/** One item's line on Summary: every lot of it added up, its qty split by age. */
type SummaryRow = {
  key: string;
  item_class: string;
  item: string;
  uom: string;
  lots: number;
  stores: string;
  qty: number;
  value: number;
  bands: Record<AgeBand, number>;
};

function summarise(rows: Row[]): SummaryRow[] {
  const m = new Map<string, SummaryRow & { storeSet: Set<string> }>();
  for (const r of rows) {
    const k = `${r.item}|${r.uom}`;
    let s = m.get(k);
    if (!s) {
      s = {
        key: k,
        item_class: r.item_class,
        item: r.item,
        uom: r.uom,
        lots: 0,
        stores: "",
        qty: 0,
        value: 0,
        bands: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
        storeSet: new Set(),
      };
      m.set(k, s);
    }
    s.lots++;
    s.qty += r.qty;
    s.value += isAsset(r) ? (r.value ?? 0) : 0;
    s.bands[r.band] += r.qty;
    s.storeSet.add(r.store);
  }
  return [...m.values()]
    .map(({ storeSet, ...s }) => ({ ...s, stores: [...storeSet].join(", ") }))
    .sort((a, b) => b.bands["90+"] - a.bands["90+"] || a.item.localeCompare(b.item));
}

const qtyCell = (v: unknown) => (Number(v) ? fmtNumber(Number(v)) : "—");

function detailedColumns(withValue: boolean): ReportColumn<Row & { sno: number }>[] {
  return [
    { key: "sno", header: "S No", isNumeric: true, value: (r) => r.sno },
    { key: "item_class", header: "Item Class", value: (r) => r.item_class },
    { key: "item", header: "Item", value: (r) => r.item },
    { key: "reference", header: "GRN Ref", value: (r) => r.reference },
    { key: "lot", header: "Lot No", value: (r) => r.lot },
    { key: "location", header: "Store · Bin", value: (r) => `${r.store} · ${r.bin}` },
    { key: "status", header: "Stock Type", value: (r) => STATUS_LABEL[r.status] },
    { key: "group", header: "Order / Pool", value: (r) => (r.order_no === "—" ? "General Stock" : r.order_no) },
    { key: "qty", header: "Qty on Hand", isNumeric: true, value: (r) => r.qty, format: (v) => fmtNumber(Number(v)) },
    { key: "uom", header: "UOM", value: (r) => r.uom },
    ...(withValue
      ? ([
          { key: "rate", header: "Rate", isNumeric: true, value: (r) => r.rate ?? "", format: (v) => (v === "" ? "—" : fmtMoney(Number(v))) },
          { key: "value", header: "Value", isNumeric: true, value: (r) => r.value ?? 0, format: (v) => fmtMoney(Number(v)) },
        ] as ReportColumn<Row & { sno: number }>[])
      : []),
    /* THE AGE MATRIX: the lot's qty under the one band its in-date falls in. Excel gets the
       number (or 0) so each band column sums; the screen prints "—" for an empty cell. */
    ...AGE_BANDS.map(
      (b): ReportColumn<Row & { sno: number }> => ({
        key: `band_${b}`,
        header: BAND_LABEL[b],
        isNumeric: true,
        value: (r) => (r.band === b ? r.qty : 0),
        format: (v) => (b === "90+" && Number(v) ? `${fmtNumber(Number(v))} · idle` : qtyCell(v)),
      }),
    ),
    { key: "in_date", header: "In Date", value: (r) => fmtDate(r.in_date) },
  ];
}

function summaryColumns(withValue: boolean): ReportColumn<SummaryRow>[] {
  return [
    { key: "item_class", header: "Item Class", value: (r) => r.item_class },
    { key: "item", header: "Item", value: (r) => r.item },
    { key: "stores", header: "Stores", value: (r) => r.stores },
    { key: "lots", header: "Lots", isNumeric: true, value: (r) => r.lots },
    { key: "qty", header: "Qty on Hand", isNumeric: true, value: (r) => r.qty, format: (v) => fmtNumber(Number(v)) },
    { key: "uom", header: "UOM", value: (r) => r.uom },
    ...(withValue ? [{ key: "value", header: "Value", isNumeric: true, value: (r: SummaryRow) => r.value, format: (v: unknown) => fmtMoney(Number(v)) }] : []),
    ...AGE_BANDS.map(
      (b): ReportColumn<SummaryRow> => ({
        key: `band_${b}`,
        header: BAND_LABEL[b],
        isNumeric: true,
        value: (r) => r.bands[b],
        format: qtyCell,
      }),
    ),
  ];
}

/**
 * THE "ALL LOTS" TABLE under the dashboard's visuals — Detailed (lot · bin) or Summary (item), with
 * the age matrix and Download / Print. It is handed rows the dashboard has ALREADY filtered, so the
 * table and every visual above it always describe the same stock.
 */
export function InventoryTable({ rows, asOf, unit, withValue }: { rows: Row[]; asOf: string; unit: string; withValue: boolean }) {
  const [mode, setMode] = useState<Mode>("detailed");
  const title = "Purchase Store Overview";
  const subtitle = `${unit} · stock as on ${fmtDate(asOf)}`;
  const controls = (
    <ToggleGroup<Mode>
      label="View"
      value={mode}
      onChange={setMode}
      options={[
        { value: "detailed", label: "Detailed (lot · bin)" },
        { value: "summary", label: "Summary (item)" },
      ]}
    />
  );
  return mode === "detailed" ? (
    <ReportView<Row & { sno: number }>
      config={{ title, subtitle, rows: rows.map((r, i) => ({ ...r, sno: i + 1 })), columns: detailedColumns(withValue) } satisfies ReportConfig<Row & { sno: number }>}
      getKey={(r) => r.key}
      empty="No stock matches."
      controls={controls}
    />
  ) : (
    <ReportView<SummaryRow>
      config={{ title: `${title} — Summary`, subtitle, rows: summarise(rows), columns: summaryColumns(withValue) } satisfies ReportConfig<SummaryRow>}
      getKey={(r) => r.key}
      empty="No stock matches."
      controls={controls}
    />
  );
}
