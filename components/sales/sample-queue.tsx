"use client";

import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import type { StatusTone } from "@/lib/ui/tone";

/**
 * THE SAMPLE MODULE'S CARD QUEUE (user 2026-10-12: "in grouping to accessories
 * plan … how we list the created order entry in card-like UI, same for this
 * too — SMP entry will list as card"; plan "Sample card queues").
 *
 * Orders ▸ Accessories Plan, Fabric Plan and Material BOM open on a grid of
 * cards drawn by `BomQueue` (components/orders/bom-queue.tsx) — but that queue
 * is typed to a garment order (`BomTaskRow`) and its facets are an order's. So
 * the sample screens draw the SAME card through the same primitive
 * (`MobileCardList`, `columns={6}`, `queue`) and the same two state shades,
 * and each screen passes only what is genuinely its own: the number, the
 * sub-line, the three figures and what a tap does. The search row, the
 * Pending / Updated / Draft box and the Filters panel stay the screen's, as
 * they were above its table.
 */

/** A card's state — the stripe and the pill both read it, so they agree. */
export type SampleCardState = "pending" | "updated" | "draft" | "neutral";

/* THE ORDERS QUEUE'S OWN SHADES (`QUEUE_THEME` in bom-queue.tsx): Pending a dark
   red, done a clean green. Copied as literals, not imported, because Tailwind
   scans source text and the two must stay static class strings. */
const PILL: Partial<Record<SampleCardState, string>> = {
  pending: "border border-red-200 bg-red-50 py-px text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
  updated: "border border-emerald-200 bg-emerald-50 py-px text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
};
const EDGE: Partial<Record<SampleCardState, string>> = {
  pending: "border-l-red-700 dark:border-l-red-500",
  updated: "border-l-emerald-500",
};
const TONE: Record<SampleCardState, StatusTone> = { pending: "danger", updated: "success", draft: "warning", neutral: "neutral" };

export function SampleQueuePill({ state, children }: { state: SampleCardState; children: ReactNode }) {
  return (
    <StatusPill tone={TONE[state]} className={PILL[state]}>
      {children}
    </StatusPill>
  );
}

export function SampleCards<R>({
  rows,
  getKey,
  title,
  subtitle,
  state,
  pillText,
  stats,
  onOpen,
  selected,
  footerNote,
  canDelete = false,
  canDeleteRow,
  onDelete,
  isPending = false,
  empty,
}: {
  rows: R[];
  getKey: (r: R) => string;
  title: (r: R) => ReactNode;
  subtitle?: (r: R) => ReactNode;
  state: (r: R) => SampleCardState;
  pillText: (r: R) => ReactNode;
  /** The three figures, in the Orders card's order: the main one, the count,
   *  then the date or the scope. */
  stats: (r: R) => CardStat[];
  /** A tap on the card — open the record, or (Grouping ▸ Ungrouped) tick it. */
  onOpen: (r: R) => void;
  /** A ticked card wears the theme colour down its edge. */
  selected?: (r: R) => boolean;
  footerNote?: (r: R) => ReactNode;
  canDelete?: boolean;
  canDeleteRow?: (r: R) => boolean;
  onDelete?: (r: R) => void;
  isPending?: boolean;
  empty: ReactNode;
}) {
  return (
    <MobileCardList<R>
      columns={6}
      queue
      rows={rows}
      getKey={getKey}
      title={title}
      subtitle={subtitle}
      pill={(r) => <SampleQueuePill state={state(r)}>{pillText(r)}</SampleQueuePill>}
      stats={stats}
      tone={(r) => TONE[state(r)]}
      accent={(r) => (selected?.(r) ? "border-l-primary" : EDGE[state(r)])}
      footerNote={footerNote}
      onEdit={onOpen}
      canDelete={canDelete}
      canDeleteRow={canDeleteRow}
      onDelete={onDelete}
      isPending={isPending}
      empty={empty}
    />
  );
}
