"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Building2 } from "lucide-react";
import { ReportView } from "@/components/reports/report-view";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { StatStrip, type StripGroup } from "@/components/reports/stat-strip";
import { Button } from "@/components/ui/button";
import { DATE_MAX, Input } from "@/components/ui/input";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import type { ReportColumn, ReportConfig } from "@/lib/reports/types";
import {
  AGE_BANDS,
  GROUP_LABEL,
  GROUP_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  type StockStatementRow,
  type StockValueRow,
} from "@/lib/reports/stock-statement-types";

/**
 * ONE VIEW FOR BOTH STOCK STATEMENTS (client brief 2026-11-02). The quantity page passes
 * rows with no rate at all (the RPC behind it has none); the value page passes
 * `StockValueRow`s and `withValue`, which adds PO Rate · Stock Value and the value cards.
 *
 * Filters are the shared drawer (`useFacetFilter`), so they work as every other list's
 * do. OPTIONS ARE ONLY WHAT THE ROWS HOLD, which is what keeps Customer / Vendor / Item
 * Class from ever offering a choice that can only empty the report. Order No / PO No is
 * the search box — a number is typed, not picked from a few hundred.
 */

type Row = StockStatementRow & Partial<Pick<StockValueRow, "rate" | "value">>;

const isClass = (r: Row, name: string) => r.item_class.toUpperCase().startsWith(name);
/** Stock the business owns: rejected and replacement stock is a claim on the vendor. */
const isAsset = (r: Row) => r.status !== "rejected" && r.status !== "replacement";

function facetGroups(): FacetGroup<Row>[] {
  return [
    {
      title: "Source",
      icon: <Building2 />,
      facets: [
        {
          key: "group",
          label: "Group Type",
          wide: true,
          counted: true,
          options: GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g] })),
          match: (r, v) => r.group_kind === v,
        },
        { key: "customer", label: "Customer / Buyer", value: (r) => (r.customer === "—" ? null : r.customer) },
        { key: "vendor", label: "Vendor", value: (r) => (r.vendor === "—" ? null : r.vendor) },
      ],
    },
    {
      title: "Material",
      icon: <Boxes />,
      facets: [
        { key: "itemClass", label: "Item Class", wide: true, value: (r) => r.item_class },
        { key: "store", label: "Store", value: (r) => r.store },
        {
          key: "status",
          label: "Status",
          counted: true,
          options: STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          match: (r, v) => r.status === v,
        },
        {
          key: "age",
          label: "Age",
          counted: true,
          options: AGE_BANDS.map((b) => ({ value: b, label: `${b} days` })),
          match: (r, v) => r.band === v,
        },
      ],
    },
  ];
}
const GROUPS = facetGroups();

function columns(withValue: boolean): ReportColumn<Row>[] {
  const cols: ReportColumn<Row>[] = [
    { key: "store", header: "Store", value: (r) => r.store },
    { key: "item_class", header: "Item Class", value: (r) => r.item_class },
    { key: "item", header: "Item", value: (r) => r.item },
    { key: "uom", header: "UOM", value: (r) => r.uom },
    { key: "reference", header: "GRN No", value: (r) => r.reference },
    { key: "lot", header: "Lot No", value: (r) => r.lot },
    { key: "bin", header: "Bin", value: (r) => r.bin },
    { key: "qty", header: "Qty", isNumeric: true, value: (r) => r.qty, format: (v) => fmtNumber(Number(v)) },
  ];
  if (withValue) {
    cols.push(
      // Excel gets the raw number (or blank); screen and PDF the formatted one.
      { key: "rate", header: "PO Rate", isNumeric: true, value: (r) => r.rate ?? "", format: (v) => (v === "" ? "—" : fmtMoney(Number(v))) },
      { key: "value", header: "Stock Value", isNumeric: true, value: (r) => r.value ?? 0, format: (v) => fmtMoney(Number(v)) },
    );
  }
  cols.push(
    { key: "status", header: "Status", value: (r) => STATUS_LABEL[r.status] },
    { key: "order", header: "Order / RE", value: (r) => r.order_no },
    { key: "age", header: "Age (Days)", isNumeric: true, value: (r) => r.age_days },
    { key: "in_date", header: "In Date", value: (r) => fmtDate(r.in_date) },
  );
  return cols;
}

export function StockStatementView({
  title,
  rows,
  asOf,
  unit,
  pendingQc,
  withValue = false,
}: {
  title: string;
  rows: Row[];
  asOf: string;
  unit: string;
  pendingQc: number;
  withValue?: boolean;
}) {
  const facets = useFacetFilter(rows, GROUPS);
  const matches = facets.matches;
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          matches(r) &&
          (!q || [r.order_no, r.po, r.reference, r.item, r.lot].some((x) => x.toLowerCase().includes(q))),
      ),
    [rows, matches, q],
  );

  const count = (pred: (r: Row) => boolean) => shown.filter(pred).length;
  const sum = (pred: (r: Row) => boolean) => shown.filter(pred).reduce((a, r) => a + (r.value ?? 0), 0);

  const config: ReportConfig<Row> = {
    title,
    subtitle: `${unit} · stock as on ${fmtDate(asOf)}`,
    rows: shown,
    columns: columns(withValue),
    chart: withValue
      ? {
          kind: "bar",
          category: (r) => r.item_class,
          series: [{ key: "value", label: "Stock Value", value: (r) => r.value ?? 0 }],
        }
      : undefined,
  };

  /* THE FIGURES IN ONE STRIP (user 2026-11-03, screenshot 4031: eight tall cards in two
     rows): the status (or value) group and the age group side by side in one short card. */
  const statusGroup: StripGroup = withValue
    ? {
        title: "Value",
        cells: [
          { label: "Yarn Stock Value", value: fmtMoney(sum((r) => isAsset(r) && isClass(r, "YARN"))), hint: "In stores and at processors" },
          { label: "Fabric / Processing", value: fmtMoney(sum((r) => isAsset(r) && isClass(r, "FABRIC"))), hint: "In hand or out at processors" },
          { label: "Total Inventory", value: fmtMoney(sum(isAsset)), hint: `${fmtNumber(count(isAsset))} lots` },
          {
            label: "Rejected / Replacement",
            value: fmtMoney(sum((r) => !isAsset(r))),
            hint: "Owed by vendors — not in the total",
            tone: count((r) => !isAsset(r)) ? "warning" : "neutral",
          },
        ],
      }
    : {
        title: "Lots by status",
        cells: [
          { label: "Accepted", value: fmtNumber(count((r) => r.status === "accepted")), tone: "success" },
          { label: "Rejected", value: fmtNumber(count((r) => r.status === "rejected")), tone: "danger" },
          { label: "Replacement", value: fmtNumber(count((r) => r.status === "replacement")), tone: "warning" },
          { label: "At Processor / In Transit", value: fmtNumber(count((r) => r.status === "processing" || r.status === "transit")) },
        ],
      };
  const ageGroup: StripGroup = {
    title: "Lots by age",
    cells: AGE_BANDS.map((b) => {
      const n = count((r) => r.band === b);
      return {
        label: `${b} days`,
        value: fmtNumber(n),
        hint: withValue ? fmtMoney(sum((r) => r.band === b && isAsset(r))) : undefined,
        tone: b === "90+" && n ? "danger" : b === "61-90" && n ? "warning" : "neutral",
      };
    }),
  };

  return (
    <div className="space-y-3">
      <StatStrip groups={[statusGroup, ageGroup]} />

      {/* ONE CONTROL ROW (user 2026-11-03): the as-on date, the search and Filters on the
          left of Download / Print — three bands above the table were one too many. */}
      <ReportView
        config={config}
        getKey={(r) => r.key}
        empty="No stock on hand for this unit on this date."
        controls={
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search Order No, PO No, GRN, item or lot…"
            activeCount={facets.activeCount}
            onReset={facets.activeCount ? facets.reset : undefined}
            panel={facets.panel}
            leading={
              /* As-on date: a plain GET, so the URL is the report and a past date is shareable. */
              <form method="get" className="flex items-center gap-2">
                <Input type="date" name="asOf" aria-label="Stock as on" title="Stock as on" max={DATE_MAX} defaultValue={asOf} className="w-40" />
                <Button type="submit" variant="outline">
                  Show
                </Button>
              </form>
            }
          />
        }
      />

      <ul className="space-y-0.5 text-xs text-muted-foreground">
        <li>
          Each row is stock still on hand from one receipt. Issues use up their own bin and lot first, then the oldest
          stock (FIFO), so GRN No and age are those of the stock that is actually left.
        </li>
        {withValue && (
          <li>
            Stock Value = qty on hand × the approved PO rate of the GRN it came in on.
            {count((r) => r.rate == null) > 0 &&
              ` ${fmtNumber(count((r) => r.rate == null))} lots have no known rate and add nothing to the value.`}
          </li>
        )}
        {pendingQc > 0 && (
          <li>
            {fmtNumber(pendingQc)} GRN {pendingQc === 1 ? "line is" : "lines are"} awaiting QC and not yet in stock —{" "}
            <Link href="/stores/qc-pending" className="underline">
              Stores ▸ Pending QC
            </Link>
            .
          </li>
        )}
      </ul>
    </div>
  );
}
