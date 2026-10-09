import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Grouping's own loading state, inside its skin layout — the same reason
 *  Costing has one (`sample-costing/loading.tsx`). */
export default function SampleGroupingLoading() {
  return <ListPageSkeleton />;
}
