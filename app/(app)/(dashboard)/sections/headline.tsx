import { getHeroKpis, getMiniStats } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { CellView, KpiCard, MiniStat, NotTracked } from "@/components/dashboard/cards";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Not denied: the viewer may open it, whether or not it has a value. */
const visible = <T,>(c: { ok: true; value: T } | { ok: false; reason: string }) => c.ok || c.reason !== "denied";

/** Wide-screen columns by tile count, so a short row fills the width instead of leaving a gap. */
const KPI_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
const MINI_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" };

/**
 * Section 01 — the headline figures and the strip of smaller ones below them.
 *
 * A tile the viewer may not open is LEFT OUT, and the row's columns follow how
 * many remain (user 2026-10-29: remove the unused tiles and align the rest).
 * It used to be drawn as "No access" to keep the grid's shape, which filled a
 * Merchandiser's dashboard with boxes saying nothing. "Couldn't load" still
 * shows: that is a fault the viewer should see.
 */
export async function HeadlineSection({
  filters,
  caps,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
}) {
  const [allKpis, allMini] = await Promise.all([
    getHeroKpis(filters, caps),
    getMiniStats(filters, caps),
  ]);
  const kpis = allKpis.filter(visible);
  const mini = allMini.filter(visible);

  return (
    <div className="space-y-3">
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", KPI_COLS[kpis.length])}>
        {kpis.map((k, i) =>
          k.ok ? (
            <KpiCard key={k.value.key} kpi={k.value} />
          ) : (
            <Card key={`kpi-${i}`} className="p-4">
              <NotTracked reason={k.reason} note={k.note} />
            </Card>
          ),
        )}
      </div>

      <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3", MINI_COLS[mini.length])}>
        {mini.map((m, i) => (
          <div key={m.ok ? m.value.key : `mini-${i}`} className="min-w-0">
            {m.ok ? (
              <MiniStat stat={m.value} />
            ) : (
              <Card className="h-full px-3.5 py-3">
                <CellView cell={m} compact>
                  {() => null}
                </CellView>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
