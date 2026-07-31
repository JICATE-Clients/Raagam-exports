import { ListPageSkeleton } from "@/components/ui/skeleton";

/**
 * Streamed fallback for every screen under /orders.
 *
 * Scoped to the module rather than to `app/(app)/loading.tsx`: a loading file
 * covers its whole subtree, so one at the shell level would flash a list
 * skeleton on the way to the dashboard as well (the reasoning is spelled out in
 * `(dashboard)/loading.tsx`). A nested route whose shape differs enough to
 * matter can still add its own, which wins for that subtree.
 */
export default function OrdersLoading() {
  return <ListPageSkeleton />;
}
