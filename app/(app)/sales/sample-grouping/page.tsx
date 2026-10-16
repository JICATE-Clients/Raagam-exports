import { can, requirePermission } from "@/lib/auth/server";
import { getGroupingData } from "@/lib/sales/sample-grouping/service";
import { GroupingScreen } from "./grouping-screen";

/**
 * Sample ▸ Grouping — batch sample styles of one season that share a fabric
 * structure and a yarn blend into one MOQ-rounded purchase
 * (doc/sample/product-grouping-specification.md; tables 0702 / 0703).
 * The next child after Costing: a style's kilos come from its costing.
 * Season and Year are Filters-panel facets on the screen (2026-10-15).
 */
export default async function SampleGroupingPage() {
  await requirePermission("sales", "view");
  const [data, canCreate, canEdit, canDelete, canRaiseIw] = await Promise.all([
    getGroupingData(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    can("orders", "create"),
  ]);
  return <GroupingScreen data={data} perms={{ canCreate, canEdit, canDelete, canRaiseIw }} />;
}
