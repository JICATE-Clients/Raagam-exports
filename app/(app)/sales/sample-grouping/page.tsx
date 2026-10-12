import { can, requirePermission } from "@/lib/auth/server";
import { getGroupingData } from "@/lib/sales/sample-grouping/service";
import { GroupingScreen } from "./grouping-screen";

/**
 * Sample ▸ Grouping — batch sample styles of one season that share a fabric
 * structure and a yarn blend into one MOQ-rounded purchase
 * (doc/sample/product-grouping-specification.md; tables 0702 / 0703).
 * The next child after Costing: a style's kilos come from its costing.
 *
 * `?season=&year=` — the screen keeps them current, so a refresh or a shared
 * link opens the same season.
 */
export default async function SampleGroupingPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; year?: string }>;
}) {
  await requirePermission("sales", "view");
  const sp = await searchParams;
  const y = Number(sp.year);
  const initial = {
    season: (sp.season ?? "").trim(),
    year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? String(y) : "",
  };
  const [data, canCreate, canEdit, canDelete, canRaiseIw] = await Promise.all([
    getGroupingData(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    can("orders", "create"),
  ]);
  return <GroupingScreen data={data} perms={{ canCreate, canEdit, canDelete, canRaiseIw }} initial={initial} />;
}
