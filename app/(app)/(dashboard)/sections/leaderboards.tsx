import { getLeaderboards } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { LeaderboardCard } from "@/components/dashboard/cards";

/**
 * Section 05b — top customers, colour/size combinations and suppliers.
 *
 * The middle card is NOT "best selling fabrics" as the mockup labelled it:
 * `analytics_top_products` groups `so_line_items` by colour + size, which is
 * not a fabric. Ranking fabric would need a join through the style master that
 * nothing currently populates. Naming the card for what it actually measures
 * costs nothing; naming it for what it doesn't would make a merchandiser
 * distrust every other number on the page.
 */
export async function LeaderboardSection({
  filters,
  caps,
}: {
  filters: DashboardFilters;
  caps: DashboardCaps;
}) {
  // A board with nothing to rank, or one the viewer may not open, is left out
  // (user 2026-10-29: no unused sections); the rest share the row evenly.
  const boards = (await getLeaderboards(filters, caps)).filter((b) =>
    b.rows.ok ? b.rows.value.length > 0 : b.rows.reason !== "denied",
  );
  if (boards.length === 0) return null;

  // Cards only, no wrapper: they share the page's grid with Recent activity
  // (2026-10-29), so neither ends up alone in a full-width row.
  return (
    <>
      {boards.map((b) => (
        <LeaderboardCard key={b.key} title={b.title} note={b.note} rows={b.rows} />
      ))}
    </>
  );
}
