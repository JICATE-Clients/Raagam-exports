import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { loadSeasonReport } from "@/lib/orders/season-report/service";
import { SeasonReportScreen } from "./season-report-screen";

/**
 * Orders ▸ Order Management ▸ Season Report — what is committed to a season,
 * and what is still to ship (client audio brief, 2026-10-09).
 *
 * Season and Year are a PAIR the filter states, never a date range: an order
 * keyed in early 2027 for Q4 2026 reports under Q4 2026. The pair lives in the
 * URL (`?season=Summer&year=2026`), so a report can be bookmarked, mailed and
 * reopened as it was; the Shipped / Pending toggles and the format are client
 * state, so flipping them is instant.
 */
export const metadata = { title: "Season Report" };

export default async function SeasonReportPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; year?: string }>;
}) {
  await requirePermission("orders", "view");
  const sp = await searchParams;
  const season = (sp.season ?? "").trim();
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;

  const [report, company] = await Promise.all([loadSeasonReport(season, year), companyName()]);
  return <SeasonReportScreen report={report} company={company} />;
}

/** The letterhead's name, for the PDF. A failed read is not fatal — the PDF
 *  falls back to the product name — so it degrades rather than throws. */
async function companyName(): Promise<string | null> {
  const s = await createClient();
  const { data } = await s.from("company_profile").select("*").limit(1).maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  const v = row.name ?? row.company_name;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
