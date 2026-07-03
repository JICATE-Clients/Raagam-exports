"use client";

import { Card } from "@/components/ui/card";
import { ReportChart } from "@/components/reports/report-chart";
import type { ReportConfig } from "@/lib/reports/types";
import type {
  AnalyticsData,
  AttendanceRow,
  InventoryMovementRow,
  MonthlySalesRow,
  ProductionEfficiencyRow,
  PurchaseTrendRow,
  RevenueTrendRow,
  TopCustomerRow,
  TopProductRow,
} from "@/lib/analytics/types";

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function ChartCard<T>({ title, config }: { title: string; config: ReportConfig<T> }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {config.rows.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          No data for this period.
        </p>
      ) : (
        <ReportChart config={config} />
      )}
    </Card>
  );
}

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const sales: ReportConfig<MonthlySalesRow> = {
    title: "Monthly Sales",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "units", header: "Units", value: (r) => r.units, isNumeric: true },
      { key: "orders", header: "Orders", value: (r) => r.order_count, isNumeric: true },
    ],
    rows: data.monthlySales,
    chart: {
      kind: "bar",
      category: (r) => monthLabel(r.month),
      series: [
        { key: "units", label: "Units", value: (r) => r.units },
        { key: "orders", label: "Orders", value: (r) => r.order_count },
      ],
    },
  };

  const revenue: ReportConfig<RevenueTrendRow> = {
    title: "Revenue Trend",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "inv", header: "Invoiced", value: (r) => r.invoiced_inr, isNumeric: true },
      { key: "rec", header: "Received", value: (r) => r.received_inr, isNumeric: true },
      { key: "dom", header: "Domestic", value: (r) => r.domestic_inr, isNumeric: true },
    ],
    rows: data.revenueTrend,
    chart: {
      kind: "line",
      category: (r) => monthLabel(r.month),
      series: [
        { key: "inv", label: "Invoiced ₹", value: (r) => r.invoiced_inr },
        { key: "rec", label: "Received ₹", value: (r) => r.received_inr },
        { key: "dom", label: "Domestic ₹", value: (r) => r.domestic_inr },
      ],
    },
  };

  const customers: ReportConfig<TopCustomerRow> = {
    title: "Top Customers",
    columns: [
      { key: "buyer", header: "Customer", value: (r) => r.buyer_name },
      { key: "rev", header: "Revenue ₹", value: (r) => r.revenue_inr, isNumeric: true },
    ],
    rows: data.topCustomers,
    chart: {
      kind: "bar",
      category: (r) => r.buyer_name,
      series: [{ key: "rev", label: "Revenue ₹", value: (r) => r.revenue_inr }],
    },
  };

  const products: ReportConfig<TopProductRow> = {
    title: "Top Products",
    columns: [
      { key: "label", header: "Product", value: (r) => r.label },
      { key: "units", header: "Units", value: (r) => r.units, isNumeric: true },
    ],
    rows: data.topProducts,
    chart: {
      kind: "bar",
      category: (r) => r.label,
      series: [{ key: "units", label: "Units", value: (r) => r.units }],
    },
  };

  const purchase: ReportConfig<PurchaseTrendRow> = {
    title: "Purchase Trend",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "value", header: "PO value", value: (r) => r.po_value, isNumeric: true },
      { key: "count", header: "POs", value: (r) => r.po_count, isNumeric: true },
    ],
    rows: data.purchaseTrend,
    chart: {
      kind: "bar",
      category: (r) => monthLabel(r.month),
      series: [
        { key: "value", label: "PO value", value: (r) => r.po_value },
        { key: "count", label: "PO count", value: (r) => r.po_count },
      ],
    },
  };

  const inventory: ReportConfig<InventoryMovementRow> = {
    title: "Inventory Movement",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "in", header: "In", value: (r) => r.qty_in, isNumeric: true },
      { key: "out", header: "Out", value: (r) => r.qty_out, isNumeric: true },
    ],
    rows: data.inventoryMovement,
    chart: {
      kind: "bar",
      category: (r) => monthLabel(r.month),
      series: [
        { key: "in", label: "Qty in", value: (r) => r.qty_in },
        { key: "out", label: "Qty out", value: (r) => r.qty_out },
      ],
    },
  };

  const attendance: ReportConfig<AttendanceRow> = {
    title: "Employee Attendance",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "pct", header: "Attendance %", value: (r) => r.attendance_pct, isNumeric: true },
      { key: "present", header: "Present days", value: (r) => r.present_days, isNumeric: true },
    ],
    rows: data.attendance,
    chart: {
      kind: "line",
      category: (r) => monthLabel(r.month),
      series: [{ key: "pct", label: "Attendance %", value: (r) => r.attendance_pct }],
    },
  };

  const production: ReportConfig<ProductionEfficiencyRow> = {
    title: "Production Efficiency",
    columns: [
      { key: "month", header: "Month", value: (r) => monthLabel(r.month) },
      { key: "good", header: "Good", value: (r) => r.good_qty, isNumeric: true },
      { key: "reject", header: "Reject", value: (r) => r.reject_qty, isNumeric: true },
      { key: "defect", header: "Defect %", value: (r) => r.defect_pct, isNumeric: true },
    ],
    rows: data.production,
    chart: {
      kind: "bar",
      category: (r) => monthLabel(r.month),
      series: [
        { key: "good", label: "Good qty", value: (r) => r.good_qty },
        { key: "reject", label: "Reject qty", value: (r) => r.reject_qty },
      ],
    },
  };

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <ChartCard title="Monthly Sales (volume)" config={sales} />
      <ChartCard title="Revenue Trend (₹, INR)" config={revenue} />
      <ChartCard title="Top Customers (by revenue ₹)" config={customers} />
      <ChartCard title="Top Products (by units)" config={products} />
      <ChartCard title="Purchase Trend" config={purchase} />
      <ChartCard title="Inventory Movement" config={inventory} />
      <ChartCard title="Employee Attendance" config={attendance} />
      <ChartCard title="Production Efficiency" config={production} />
    </div>
  );
}
