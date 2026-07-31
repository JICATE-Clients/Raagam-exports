import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /reports. See `orders/loading.tsx`. */
export default function ReportsLoading() {
  return <ListPageSkeleton />;
}
