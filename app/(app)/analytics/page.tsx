import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { getAnalytics } from "@/lib/analytics/service";
import { AnalyticsDashboard } from "./analytics-dashboard";
import { AnalyticsFiltersBar } from "./analytics-filters";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === "month") return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (preset === "year") return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
  // 12m (default): trailing 12 months through end of current month
  return { from: iso(new Date(y, m - 11, 1)), to: iso(new Date(y, m + 1, 0)) };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports", "view");
  const sp = await searchParams;

  const preset = sp.preset ?? "12m";
  const useCustom = preset === "custom" && !!sp.from && !!sp.to;
  const { from, to } = useCustom ? { from: sp.from!, to: sp.to! } : presetRange(preset);
  const location = sp.location || undefined;

  const supabase = await createClient();
  const [{ data: locations }, data] = await Promise.all([
    supabase.from("locations").select("id, code, name").eq("is_active", true).order("code"),
    getAnalytics({ from, to, location }),
  ]);

  // KPI roll-ups over the selected period
  const revenue = data.revenueTrend.reduce((a, r) => a + r.invoiced_inr + r.domestic_inr, 0);
  const received = data.revenueTrend.reduce((a, r) => a + r.received_inr, 0);
  const orders = data.monthlySales.reduce((a, r) => a + r.order_count, 0);
  const units = data.monthlySales.reduce((a, r) => a + r.units, 0);
  const poValue = data.purchaseTrend.reduce((a, r) => a + r.po_value, 0);
  const avgAttendance = data.attendance.length
    ? data.attendance.reduce((a, r) => a + r.attendance_pct, 0) / data.attendance.length
    : 0;
  const good = data.production.reduce((a, r) => a + r.good_qty, 0);
  const reject = data.production.reduce((a, r) => a + r.reject_qty, 0);
  const defectPct = good + reject > 0 ? (reject / (good + reject)) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        description="Sales, revenue, purchasing, inventory, workforce and production — at a glance."
      />
      <AnalyticsFiltersBar
        locations={locations ?? []}
        current={{
          preset: useCustom ? "custom" : preset,
          from: sp.from ?? "",
          to: sp.to ?? "",
          location: sp.location ?? "",
        }}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Revenue (invoiced)" value={fmtMoney(revenue)} tone="success" hint="AR + domestic" />
        <Stat label="Received" value={fmtMoney(received)} tone="info" />
        <Stat label="Orders booked" value={fmtNumber(orders)} hint={`${fmtNumber(units)} units`} />
        <Stat label="Purchase value" value={fmtMoney(poValue)} hint="mixed currency" />
        <Stat
          label="Avg attendance"
          value={`${avgAttendance.toFixed(1)}%`}
          tone={avgAttendance >= 90 ? "success" : avgAttendance > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Defect rate"
          value={`${defectPct.toFixed(1)}%`}
          tone={reject + good === 0 ? "neutral" : defectPct <= 3 ? "success" : "danger"}
        />
      </div>

      <AnalyticsDashboard data={data} />
    </div>
  );
}
