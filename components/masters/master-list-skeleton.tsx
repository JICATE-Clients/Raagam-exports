import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder that mirrors a `MasterListShell`: a filter/search row, a
 * table with a header and several rows, and a pagination strip. Rendered by the
 * master route `loading.tsx` files while the server component fetches data, so
 * the user sees the page's shape immediately instead of a blank screen.
 */
export function MasterListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {/* toolbar: search + filters on the left, Add on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-64" />
        <Skeleton className="h-9 w-24" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-32" />
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-4 border-b border-border bg-surface-muted px-3 py-2.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
          <div className="flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <div className="flex-1" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        ))}
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  );
}
