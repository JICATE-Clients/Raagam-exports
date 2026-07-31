import { cn } from "@/lib/utils";

/**
 * Loading placeholder block — a pulsing muted rectangle. Compose several to
 * mirror the shape of the content that's loading (checklist "Loading
 * Improvements": show skeletons instead of blank screens). Purely presentational
 * and server-renderable, so it works in Next.js `loading.tsx` files.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}

/** The bordered table block: a header strip and `rows` body rows. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-4 border-b border-border bg-surface-muted px-3 py-2.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-20" />
        <div className="flex-1" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-3 py-3 last:border-0"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <div className="flex-1" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A list screen minus its page header: filter/search toolbar, table, pagination.
 *
 * Lives in `ui/` rather than `masters/` because every module's index screen is
 * this same shape, and a `loading.tsx` under /orders or /finance must not have
 * to reach into the masters folder to say so. `MasterListSkeleton` is now a thin
 * alias over it, so the masters routes that already import that name keep
 * working unchanged.
 */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {/* toolbar: search + filters on the left, Add on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-64" />
        <Skeleton className="h-9 w-24" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-32" />
      </div>

      <TableSkeleton rows={rows} />

      {/* pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  );
}

/**
 * The default fallback for a module's `loading.tsx`: page title and subtitle
 * above a list.
 *
 * Sized to the *common* case rather than any one screen. A skeleton's job is to
 * hold the eye in roughly the right place for the ~300ms before real content
 * lands; matching every screen exactly would mean a fallback per route, which is
 * how these stop getting written at all.
 */
export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="mb-4 space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <ListSkeleton rows={rows} />
    </div>
  );
}
