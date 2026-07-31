import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /purchase. See `orders/loading.tsx`. */
export default function PurchaseLoading() {
  return <ListPageSkeleton />;
}
