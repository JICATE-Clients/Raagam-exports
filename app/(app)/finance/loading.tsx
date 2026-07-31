import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /finance. See `orders/loading.tsx`. */
export default function FinanceLoading() {
  return <ListPageSkeleton />;
}
