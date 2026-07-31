import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /production. See `orders/loading.tsx`. */
export default function ProductionLoading() {
  return <ListPageSkeleton />;
}
