import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
  return <Card className={className} />;
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
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
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

export function StageGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <Tile key={i} className="h-[150px]" />
      ))}
    </div>
  );
}

export function ApprovalsSkeleton() {
  return <Tile className="h-[320px]" />;
}

export function ActivitySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Tile className="h-[380px]" />
      <Tile className="h-[380px]" />
    </div>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Tile className="h-[280px]" />
      <Tile className="h-[280px]" />
      <Tile className="h-[280px]" />
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <Card className="px-6 py-5">
      <Skeleton className="h-3 w-56" />
      <Skeleton className="mt-3 h-8 w-72" />
      <Skeleton className="mt-2 h-3.5 w-64" />
      <div className="mt-5 flex gap-5">
        <Skeleton className="h-[42px] w-[42px] rounded-full" />
        <Skeleton className="h-[42px] w-[42px] rounded-full" />
        <Skeleton className="h-[42px] w-[42px] rounded-full" />
      </div>
    </Card>
  );
}
