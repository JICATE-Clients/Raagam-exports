import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /planning. See `orders/loading.tsx`. */
export default function PlanningLoading() {
  return <ListPageSkeleton />;
}
