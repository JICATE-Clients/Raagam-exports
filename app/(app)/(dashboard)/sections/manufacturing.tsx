import { getManufacturing } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { StageCard } from "@/components/dashboard/cards";

/**
 * Section 03 — the production stage grid.
 *
 * Eight of the eleven cards are real. Dyeing, finishing and machine efficiency
 * keep their slots but state their gap: `production_entries.stage` is CHECK-
 * constrained to cutting / sewing / packing, and there is no machine master at
 * all, so no query could populate them. Leaving the cards in place makes the
 * gap a visible decision rather than a silent omission.
 */
export async function ManufacturingSection({
  filters,
  caps,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
}) {
  const stages = await getManufacturing(filters, caps);

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {stages.map((s) => (
        <StageCard key={s.key} stage={s} />
      ))}
    </div>
  );
}
