import { getLeaderboards } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardFilters } from "@/lib/dashboard/types";
import { LeaderboardList } from "@/components/dashboard/cards";
import { TabbedCard } from "@/components/dashboard/tabbed-card";

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

  // ONE CARD, A TAB PER BOARD (approved plan v2, 2026-11-02) — the three cards sat side by
  // side and repeated one shape three times.
  return (
    <TabbedCard
      label="Top lists"
      icon="trophy"
      tone="warning"
      tabs={boards.map((b) => ({ key: b.key, label: b.title, subtitle: b.note, body: <LeaderboardList rows={b.rows} /> }))}
    />
  );
}
