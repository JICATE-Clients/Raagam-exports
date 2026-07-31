import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /logistics. See `orders/loading.tsx`. */
export default function LogisticsLoading() {
  return <ListPageSkeleton />;
}
