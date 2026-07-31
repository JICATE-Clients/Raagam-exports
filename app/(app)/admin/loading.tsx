import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /admin. See `orders/loading.tsx`. */
export default function AdminLoading() {
  return <ListPageSkeleton />;
}
