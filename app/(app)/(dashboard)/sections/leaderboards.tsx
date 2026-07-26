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
  const boards = await getLeaderboards(filters, caps);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {boards.map((b) => (
        <LeaderboardCard key={b.key} title={b.title} note={b.note} rows={b.rows} />
      ))}
    </div>
  );
}
