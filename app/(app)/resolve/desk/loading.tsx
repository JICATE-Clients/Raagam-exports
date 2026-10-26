import { ListPageSkeleton } from "@/components/ui/skeleton";

/** Streamed fallback while the server reads the page's rows. */
export default function Loading() {
  return <ListPageSkeleton />;
}
