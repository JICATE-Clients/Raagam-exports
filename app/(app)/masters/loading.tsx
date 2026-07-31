import { ListPageSkeleton } from "@/components/ui/skeleton";

/**
 * Streamed fallback for the /masters hub and any masters route without a closer
 * one. The two entity routes below it (`[submodule]/[entity]` and
 * `materials/[entity]`) keep their own more specific files, which win for those
 * subtrees.
 */
export default function MastersLoading() {
  return <ListPageSkeleton />;
}
