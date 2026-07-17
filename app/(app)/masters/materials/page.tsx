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
import { listStyleNames } from "@/lib/masters/style-name-service";
import { listStyleLevels } from "@/lib/masters/style-level-service";
import { listPackingInstructions } from "@/lib/masters/packing-instruction-service";
import { listPackingMethods } from "@/lib/masters/packing-method-service";
import { listSeasons } from "@/lib/masters/season-service";
import { listColors } from "@/lib/masters/color-service";
import { listBrands } from "@/lib/masters/brand-service";
import { listBins } from "@/lib/masters/bin-service";
import { listSizeGroups } from "@/lib/masters/size-group-service";
import { listShadeGroups } from "@/lib/masters/shade-group-service";
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
  const [lookups, attributes, levies, materialAttributes, categories, compositions, stockUnits, materials, processes, components, outDocTerms, commodities, styleNames, styleLevels, packingInstructions, packingMethods, seasons, colors, brands, bins, sizeGroups, shadeGroups] =
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
      listStyleNames(),
      listStyleLevels(),
      listPackingInstructions(),
      listPackingMethods(),
      listSeasons(),
      listColors(),
      listBrands(),
      listBins(),
      listSizeGroups(),
      listShadeGroups(),
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
  const styleNameCount = styleNames.length;
  const styleLevelCount = styleLevels.length;
  const packingInstructionCount = packingInstructions.length;
  const packingMethodCount = packingMethods.length;
  const seasonCount = seasons.length;
  const colorCount = colors.length;
  const brandCount = brands.length;
  const binCount = bins.length;
  const sizeGroupCount = sizeGroups.length;
  const shadeGroupCount = shadeGroups.length;

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
                                          : c.custom === "commodities"
                                            ? commodityCount
                                            : c.custom === "seasons"
                                              ? seasonCount
                                              : c.custom === "colors"
                                                ? colorCount
                                                : c.custom === "brands"
                                                  ? brandCount
                                                  : c.custom === "bins"
                                                    ? binCount
                                                    : c.custom === "size_groups"
                                                      ? sizeGroupCount
                                                      : c.custom === "shade_groups"
                                                        ? shadeGroupCount
                                                        : c.custom === "style_names"
                                                          ? styleNameCount
                                                          : c.custom === "style_levels"
                                                            ? styleLevelCount
                                                            : c.custom === "packing_instructions"
                                                              ? packingInstructionCount
                                                              : c.custom === "packing_methods"
                                                                ? packingMethodCount
                                                                : materialCount
              : null;
          const href = isLink ? c.href : `/masters/materials/${c.slug}`;
          const empty = count === 0;
          return (
            <Link
              key={c.slug}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary",
              )}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Tag className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{c.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {c.description}
                </span>
              </span>
              {isLink ? (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    empty ? "text-muted-foreground/60" : "text-muted-foreground",
                  )}
                  title={empty ? "No records yet — click to add" : `${count} records`}
                >
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
