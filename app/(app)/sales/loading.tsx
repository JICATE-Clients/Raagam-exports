import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /sales. See `orders/loading.tsx`. */
export default function SalesLoading() {
  return <ListPageSkeleton />;
}
