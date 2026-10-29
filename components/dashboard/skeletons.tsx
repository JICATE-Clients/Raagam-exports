import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { GLASS } from "./glass";

/**
 * Loading shapes for each dashboard section.
 *
 * Each one mirrors its real section's grid classes and heights exactly. That
 * matching is the whole value: a skeleton of the wrong size reserves the wrong
 * space, so the content jumps when it lands and the skeleton has made the page
 * feel *less* stable rather than more.
 *
 * Shared between `loading.tsx` and the inline `<Suspense fallback>`s, so there
 * is one definition of what each loading state looks like.
 */

function Tile({ className }: { className?: string }) {
  return <Card className={cn(GLASS, className)} />;
}

export function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-4 h-7 w-2/3" />
          <Skeleton className="mt-5 h-8 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function MiniStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Tile key={i} className="h-[74px]" />
      ))}
    </div>
  );
}

export function ChartRowSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Tile className="h-[320px]" />
        <Tile className="h-[320px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile className="h-[240px]" />
        <Tile className="h-[240px]" />
        <Tile className="h-[240px]" />
      </div>
    </div>
  );
}

/** The Manufacturing card: small stage tiles, two to a row. */
export function StageGridSkeleton() {
  return <Tile className="h-[300px]" />;
}

/** The "Needs you" card: approvals and alerts behind two tabs. */
export function ApprovalsSkeleton() {
  return <Tile className="h-[230px]" />;
}

/** One panel — Recent activity, or Alerts in the right column (2026-10-28). */
export function ActivitySkeleton() {
  return <Tile className="h-[380px]" />;
}

/** The right column's calendar: month grid, legend and the day's list. */
export function CalendarSkeleton() {
  return (
    <Card className={cn(GLASS, "p-4")}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-14 w-full" />
      <Skeleton className="mt-3 h-3 w-1/2" />
      <Skeleton className="mt-3 h-10 w-full" />
    </Card>
  );
}

/** One card's worth: the Top lists share a grid with Recent activity. */
export function LeaderboardSkeleton() {
  return <Tile className="h-[240px]" />;
}

/**
 * The page's top band: the welcome card (Nool, the greeting, a few task rows)
 * and the period bar. The three pulse tiles that sat under them went on
 * 2026-10-29, so the placeholder no longer draws them.
 */
export function HeroSkeleton() {
  return (
    <div className="space-y-4">
      <Tile className="h-[232px]" />
      <Tile className="h-[52px]" />
    </div>
  );
}
