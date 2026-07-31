import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback for every screen under /stores. See `orders/loading.tsx`. */
export default function StoresLoading() {
  return <ListPageSkeleton />;
}
