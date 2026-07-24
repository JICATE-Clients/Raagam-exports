import { Skeleton } from "@/components/ui/skeleton";
import { MasterListSkeleton } from "@/components/masters/master-list-skeleton";

/** Streamed fallback for the Materials master entity screens. */
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3 w-64" />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <MasterListSkeleton />
    </div>
  );
}
