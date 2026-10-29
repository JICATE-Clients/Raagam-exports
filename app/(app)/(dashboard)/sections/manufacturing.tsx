import { getManufacturing } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { StageTile } from "@/components/dashboard/cards";
import { PanelCard } from "@/components/dashboard/lists";

/**
 * Section 03 — the production stage grid.
 *
 * Only stages something records. Dyeing, finishing and machine efficiency used
 * to keep "Not tracked yet" cards (`production_entries.stage` is CHECK-limited
 * to cutting / sewing / packing, and there is no machine master), which no
 * query could ever fill; the user had them removed on 2026-10-29 as unused.
 * A stage the viewer may not open is left out too, rather than drawn as
 * "No access". Since the same day it is one compact card of small tiles under
 * Quick actions, in the right column.
 */
export async function ManufacturingSection({
  filters,
  caps,
  lines,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
  /** Lines that entered output today, for the card's header. */
  lines: { reporting: number; active: number } | null;
}) {
  const stages = (await getManufacturing(filters, caps)).filter((s) => s.data.ok || s.data.reason !== "denied");
  if (stages.length === 0) return null;

  return (
    <PanelCard
      title="Manufacturing"
      aside={
        lines ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {lines.reporting} of {lines.active} lines today
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-1.5 p-3">
        {stages.map((s) => (
          <StageTile key={s.key} stage={s} />
        ))}
      </div>
    </PanelCard>
  );
}
