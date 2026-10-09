import { ListPageSkeleton } from "@/components/ui/skeleton";

/**
 * Costing's own loading state (client 2026-10-09: "I clicked Revise on the report
 * and nothing happened"). The Sales module's skeleton sits ABOVE this segment, so
 * moving between the Costing list and a costing's Reports (both children of the
 * same `sample-costing` layout) showed nothing at all while the next page read
 * its data — the old page just sat there. This boundary is inside the layout, so
 * those moves now answer immediately. Reports has its own, document-shaped one
 * (`[id]/reports/loading.tsx`), which wins for that route.
 */
export default function SampleCostingLoading() {
  return <ListPageSkeleton />;
}
