import { Skeleton } from "@/components/ui/skeleton";

/**
 * Costing ▸ Reports while it loads (client 2026-10-09: "I clicked the report, it
 * is not opening"). The page reads the costing, the lookups, its revisions and its
 * approval before it can draw, and a click that shows nothing for those seconds
 * reads as a dead button. This answers the click at once, in the SHAPE of what is
 * coming — a document with a tab strip and a sheet — instead of the Sales
 * module's list skeleton, which would flash a table that is not on the way.
 */
export default function CostingReportsLoading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="space-y-4 rounded-lg border border-border p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
