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
import { listBins } from "@/lib/masters/bin-service";
import { listGarmentRejectionRules } from "@/lib/masters/garment-rejection-rule-service";
import { listDefectGroupsSimple } from "@/lib/masters/simple-master-service";
import { listDefectDetails } from "@/lib/masters/defect-detail-service";
import {
  MATERIALS_CHILDREN,
  isLookupChild,
  isLinkChild,
  isCustomChild,
  type CustomChild,
} from "@/lib/masters/registry";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

export default async function MaterialsMastersPage() {
  await requirePermission("masters", "view");
  const [lookups, attributes, levies, materialAttributes, categories, compositions, stockUnits, materials, processes, components, outDocTerms, bins] =
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
      listBins(),
    ]);
  const [rejectionRules, defectGroups, defectDetails] = await Promise.all([
    listGarmentRejectionRules(),
    listDefectGroupsSimple(),
    listDefectDetails(),
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
  const binCount = bins.length;

  /**
   * One count per child, keyed on `custom`.
   *
   * This replaced a 25-deep nested ternary whose final `else` was
   * `materialCount` — so every child without a named branch quietly displayed
   * the Materials row count instead of its own. That is why five different
   * cards all read "29". A `Record` over the union cannot do that: add a child
   * to `CustomChild["custom"]` and this stops compiling until it is given a
   * real number.
   */
  const countByChild: Record<CustomChild["custom"], number> = {
    item_class: counts.get("item_class") ?? 0,
    attributes: attributeCount,
    levies: levyCount,
    material_attributes: maCount,
    categories: categoryCount,
    stock_units: stockUnitCount,
    counts: counts.get("yarn_count") ?? 0,
    yarn_purities: counts.get("yarn_purity") ?? 0,
    compositions: compositionCount,
    materials: materialCount,
    processes: processCount,
    components: componentCount,
    gauges: counts.get("gauge") ?? 0,
    knitting_dias: counts.get("knitting_dia") ?? 0,
    out_document_terms: outDocTermCount,
    bins: binCount,
    garment_rejection_rules: rejectionRules.length,
    defect_groups: defectGroups.length,
    defect_details: defectDetails.length,
  };

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
              ? countByChild[c.custom]
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
