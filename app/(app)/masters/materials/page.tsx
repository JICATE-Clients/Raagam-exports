import Link from "next/link";
import { Tag, ArrowUpRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { listConfigLookups, listAttributes } from "@/lib/masters/extras-service";
import { listLevies } from "@/lib/masters/levy-service";
import { listMaterialAttributes } from "@/lib/masters/material-attribute-service";
import { listCategories } from "@/lib/masters/category-service";
import { listCompositions } from "@/lib/masters/composition-service";
import { listStockUnits } from "@/lib/masters/stock-unit-service";
import { listMaterials } from "@/lib/masters/material-service";
import { listProcesses } from "@/lib/masters/process-service";
import { listComponents } from "@/lib/masters/component-service";
import { listOutDocumentTerms } from "@/lib/masters/out-document-term-service";
import { listCommodities } from "@/lib/masters/commodity-service";
import {
  MATERIALS_CHILDREN,
  isLookupChild,
  isLinkChild,
  isCustomChild,
} from "@/lib/masters/registry";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

export default async function MaterialsMastersPage() {
  await requirePermission("masters", "view");
  const [lookups, attributes, levies, materialAttributes, categories, compositions, stockUnits, materials, processes, components, outDocTerms, commodities] =
    await Promise.all([
      listConfigLookups(),
      listAttributes(),
      listLevies(),
      listMaterialAttributes(),
      listCategories(),
      listCompositions(),
      listStockUnits(),
      listMaterials(),
      listProcesses(),
      listComponents(),
      listOutDocumentTerms(),
      listCommodities(),
    ]);
  const counts = new Map<string, number>();
  for (const l of lookups) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  const attributeCount = attributes.length;
  const levyCount = levies.length;
  const maCount = materialAttributes.length;
  const categoryCount = categories.length;
  const compositionCount = compositions.length;
  const stockUnitCount = stockUnits.length;
  const materialCount = materials.length;
  const processCount = processes.length;
  const componentCount = components.length;
  const outDocTermCount = outDocTerms.length;
  const commodityCount = commodities.length;

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted-foreground">
        <Link href="/masters" className="hover:text-primary">
          Master Data
        </Link>{" "}
        / <span className="text-foreground">Materials</span>
      </nav>
      <PageHeader
        title="Materials"
        description="Material & specification masters used across planning, purchase and production."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MATERIALS_CHILDREN.map((c) => {
          const isLink = isLinkChild(c);
          const count = isLookupChild(c)
            ? counts.get(c.kind) ?? 0
            : isCustomChild(c)
              ? c.custom === "attributes"
                ? attributeCount
                : c.custom === "levies"
                  ? levyCount
                  : c.custom === "categories"
                    ? categoryCount
                    : c.custom === "material_attributes"
                      ? maCount
                      : c.custom === "counts"
                        ? counts.get("yarn_count") ?? 0
                        : c.custom === "yarn_purities"
                          ? counts.get("yarn_purity") ?? 0
                          : c.custom === "compositions"
                            ? compositionCount
                            : c.custom === "stock_units"
                              ? stockUnitCount
                              : c.custom === "materials"
                                ? materialCount
                                : c.custom === "processes"
                                  ? processCount
                                  : c.custom === "components"
                                    ? componentCount
                                    : c.custom === "gauges"
                                      ? counts.get("gauge") ?? 0
                                      : c.custom === "knitting_dias"
                                        ? counts.get("knitting_dia") ?? 0
                                        : c.custom === "out_document_terms"
                                          ? outDocTermCount
                                          : commodityCount
              : null;
          const href = isLink ? c.href : `/masters/materials/${c.slug}`;
          const empty = count === 0;
          return (
            <Link
              key={c.slug}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-xl border bg-surface p-4 transition-colors hover:border-primary",
                empty ? "border-dashed border-border" : "border-border",
              )}
            >
              <span
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                  empty ? "bg-surface-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <Tag className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{c.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {empty ? "Not set up yet" : c.description}
                </span>
              </span>
              {isLink ? (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
