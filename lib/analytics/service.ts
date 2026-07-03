import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnalyticsData, AnalyticsFilters } from "./types";

// PostgREST returns Postgres `numeric` as strings (to preserve precision) →
// coerce to number for the charts.
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));

function rows(res: { data: unknown }): Record<string, unknown>[] {
  return Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
}

/**
 * Fetch all 8 analytics datasets in parallel via the SECURITY DEFINER RPCs
 * (each self-gates on reports:view and aggregates cross-module in the DB).
 */
export async function getAnalytics(f: AnalyticsFilters): Promise<AnalyticsData> {
  const supabase = await createClient();
  const args = { p_from: f.from, p_to: f.to, p_location: f.location ?? null };

  const [ms, tc, tp, rt, pt, im, at, pr] = await Promise.all([
    supabase.rpc("analytics_monthly_sales", args),
    supabase.rpc("analytics_top_customers", args),
    supabase.rpc("analytics_top_products", args),
    supabase.rpc("analytics_revenue_trend", args),
    supabase.rpc("analytics_purchase_trend", args),
    supabase.rpc("analytics_inventory_movement", args),
    supabase.rpc("analytics_attendance", args),
    supabase.rpc("analytics_production_efficiency", args),
  ]);

  return {
    monthlySales: rows(ms).map((r) => ({
      month: str(r.month),
      order_count: n(r.order_count),
      units: n(r.units),
    })),
    topCustomers: rows(tc).map((r) => ({
      buyer_name: str(r.buyer_name),
      revenue_inr: n(r.revenue_inr),
      invoices: n(r.invoices),
    })),
    topProducts: rows(tp).map((r) => ({ label: str(r.label), units: n(r.units) })),
    revenueTrend: rows(rt).map((r) => ({
      month: str(r.month),
      invoiced_inr: n(r.invoiced_inr),
      received_inr: n(r.received_inr),
      domestic_inr: n(r.domestic_inr),
    })),
    purchaseTrend: rows(pt).map((r) => ({
      month: str(r.month),
      po_count: n(r.po_count),
      po_value: n(r.po_value),
    })),
    inventoryMovement: rows(im).map((r) => ({
      month: str(r.month),
      qty_in: n(r.qty_in),
      qty_out: n(r.qty_out),
    })),
    attendance: rows(at).map((r) => ({
      month: str(r.month),
      present_days: n(r.present_days),
      absent_days: n(r.absent_days),
      attendance_pct: n(r.attendance_pct),
      total_hours: n(r.total_hours),
    })),
    production: rows(pr).map((r) => ({
      month: str(r.month),
      good_qty: n(r.good_qty),
      reject_qty: n(r.reject_qty),
      defect_pct: n(r.defect_pct),
    })),
  };
}
