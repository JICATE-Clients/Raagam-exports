export interface MonthlySalesRow {
  month: string;
  order_count: number;
  units: number;
}
export interface TopCustomerRow {
  buyer_name: string;
  revenue_inr: number;
  invoices: number;
}
export interface TopProductRow {
  label: string;
  units: number;
}
export interface RevenueTrendRow {
  month: string;
  invoiced_inr: number;
  received_inr: number;
  domestic_inr: number;
}
export interface PurchaseTrendRow {
  month: string;
  po_count: number;
  po_value: number;
}
export interface InventoryMovementRow {
  month: string;
  qty_in: number;
  qty_out: number;
}
export interface AttendanceRow {
  month: string;
  present_days: number;
  absent_days: number;
  attendance_pct: number;
  total_hours: number;
}
export interface ProductionEfficiencyRow {
  month: string;
  good_qty: number;
  reject_qty: number;
  defect_pct: number;
}

export interface AnalyticsData {
  monthlySales: MonthlySalesRow[];
  topCustomers: TopCustomerRow[];
  topProducts: TopProductRow[];
  revenueTrend: RevenueTrendRow[];
  purchaseTrend: PurchaseTrendRow[];
  inventoryMovement: InventoryMovementRow[];
  attendance: AttendanceRow[];
  production: ProductionEfficiencyRow[];
}

export interface AnalyticsFilters {
  from: string; // YYYY-MM-DD
  to: string;
  location?: string | null;
}
