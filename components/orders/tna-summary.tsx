/**
 * T&A LADDER ▸ the four counts above the grid.
 *
 * `Stat` (`components/ui/stat.tsx`) IS THE KPI CARD — it already draws the
 * Card, the 12px muted label, the 2xl tabular-nums figure and the tone colour,
 * and it takes its tones from the same `StatusTone` vocabulary the badges use.
 * So this file is a layout and four tone decisions, not a card.
 *
 * ## IT TAKES `stats`, NOT `rows`
 *
 * The counting is `tnaSummary()` in `lib/orders/ta/tna-types.ts`, one function
 * the tab calls once and hands to both halves. A summary that counted for itself
 * could print `Delayed 3` above a table showing four red rows — the halves would
 * be judging the ladder against two different `today`s, with nothing on screen
 * to say which one was right.
 */

import { Stat } from "@/components/ui/stat";
import type { TnaSummaryStats } from "@/lib/orders/ta/tna-types";

export function TnaSummary({ stats }: { stats: TnaSummaryStats }) {
  return (
    /* Four across on a desktop, two on a tablet, one on a phone. `gap-3` is the
       app's card rhythm; no `min-w` anywhere, so nothing forces a sideways
       scroll at 400px (doc/ui/LAYOUT.md — a page body never scrolls
       horizontally). */
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* NEUTRAL, DELIBERATELY. The total is the denominator — it is context for
          the other three, and a coloured total would compete with the one card
          that is trying to say "look here". */}
      <Stat label="Total tasks" value={stats.total} tone="neutral" hint="Rungs on this ladder" />
      <Stat
        label="Completed"
        value={stats.completed}
        tone="success"
        hint="Signed off or dated"
      />
      {/* THE ONLY CARD THAT CAN BE RED, matching the badge's one `danger`: a
          missed target is the single state on this tab that is somebody's job
          today. `tone` is fixed rather than switching to neutral at zero — a
          card whose colour depends on its value makes "Delayed 0" and "Delayed
          4" look like two different rows, and the eye stops finding it in the
          same place. The number carries the news; the colour says which card
          carries it. */}
      <Stat label="Delayed" value={stats.delayed} tone="danger" hint="Past target, still open" />
      <Stat
        label="Upcoming"
        value={stats.upcoming}
        tone="info"
        /* Says what it folds in, because the four are exhaustive and a reader
           checking `completed + delayed + upcoming === total` needs to know
           where a rung due today, or one with no date yet, was counted. See
           `tnaSummary`. */
        hint="Open, not yet due"
      />
    </div>
  );
}
