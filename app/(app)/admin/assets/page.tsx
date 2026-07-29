import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listAssets, getLocations, type AssetItemOption } from "@/lib/admin/extras-service";
import { listMaterials } from "@/lib/masters/material-service";
import { listCategories } from "@/lib/masters/category-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { AssetsClient } from "./assets-client";

/**
 * Capital Goods materials, shaped for the asset-name picker (0350). Machinery
 * bought as a CAP material IS the register's row; General (consumables like
 * stationery) is deliberately excluded — the client's own split.
 *
 * Reuses the masters' list services rather than a bespoke query, so the class
 * code → categories → items resolution matches the Materials screen exactly.
 */
async function getCapitalGoodsOptions(): Promise<AssetItemOption[]> {
  const [materials, categories, lookups] = await Promise.all([
    listMaterials(),
    listCategories(),
    listConfigLookups(),
  ]);
  const capClassIds = new Set(
    lookups.filter((l) => l.kind === "item_class" && l.code?.toUpperCase() === "CAP").map((l) => l.id),
  );
  if (capClassIds.size === 0) return [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name ?? c.short_name ?? null]));
  return materials
    .filter((m) => m.is_active && m.item_class_id && capClassIds.has(m.item_class_id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category_id ? categoryName.get(m.category_id) ?? null : null,
    }));
}

export default async function AssetsPage() {
  await requirePermission("system_admin", "view");
  const [rows, locations, canCreate, items] = await Promise.all([
    listAssets(),
    getLocations(),
    can("system_admin", "create"),
    getCapitalGoodsOptions(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Assets" description="Fixed-asset register with assignment (delivery/return) tracking." />
      <AssetsClient rows={rows} locations={locations} items={items} canCreate={canCreate} />
    </div>
  );
}
