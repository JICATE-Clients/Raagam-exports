import { getHeroKpis, getMiniStats } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { CellView, KpiCard, MiniStat, NotTracked } from "@/components/dashboard/cards";
import { Card } from "@/components/ui/card";

/**
 * Section 01 — the four headline figures and the six-up strip below them.
 *
 * Tiles the viewer can't see are rendered as an explicit "No access" rather
 * than omitted, so the grid keeps its shape and nobody wonders whether a number
 * is missing or merely zero.
 */
export async function HeadlineSection({
  filters,
  caps,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
}) {
  const [kpis, mini] = await Promise.all([
    getHeroKpis(filters, caps),
    getMiniStats(filters, caps),
  ]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
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
