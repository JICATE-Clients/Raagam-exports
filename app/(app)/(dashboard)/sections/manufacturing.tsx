import { getManufacturing } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { ProductionFlow } from "@/components/dashboard/production-flow";
import { CardFooter } from "@/components/dashboard/card-footer";
import { PanelCard } from "@/components/dashboard/lists";
import { PeriodSwitch, dashHref, periodWords, type Carry } from "@/components/dashboard/hero";

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
  carry,
}: {
  filters: DashboardFilters;
  /** The page's query, so the period switch changes only the period. */
  carry: Carry;
  caps: DashboardCaps;
  /** Lines that entered output today, for the card's header. */
  lines: { reporting: number; active: number } | null;
}) {
  const stages = (await getManufacturing(filters, caps)).filter((s) => s.data.ok || s.data.reason !== "denied");
  if (stages.length === 0) return null;

  // Nothing recorded? Offer the next wider period, so the empty card has a way forward.
  const wider =
    filters.range === "today"
      ? { href: dashHref({ ...carry, from: undefined, to: undefined }, { range: "week" }), label: "Show this week" }
      : filters.range === "week"
        ? { href: dashHref({ ...carry, from: undefined, to: undefined }, { range: "month" }), label: "Show this month" }
        : null;

  return (
    <PanelCard
      title="Where is production right now?"
      // The garment route (plan option A + C, 2026-11-03). The line count moved to the footer:
      // the subtitle beside the period dropdown is one short phrase.
      subtitle={`The garment route · ${periodWords(filters)}`}
      icon="factory"
      tone="success"
      aside={<PeriodSwitch filters={filters} carry={carry} />}
      footer={
        <CardFooter
          facts={lines ? [{ label: "Lines reporting today", value: `${lines.reporting} of ${lines.active}`, tone: "primary" }] : []}
          href="/production"
          cta="Production board"
        />
      }
    >
      {/* The route, not eight tiles or piles + a word list: one journey, one picture. */}
      <ProductionFlow stages={stages} period={periodWords(filters)} widerHref={wider} />
    </PanelCard>
  );
}
