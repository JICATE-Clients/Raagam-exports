import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /hr. See `orders/loading.tsx`. */
export default function HrLoading() {
  return <ListPageSkeleton />;
}
