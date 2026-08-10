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
import { listSizeGroups } from "@/lib/masters/size-group-service";
import {
  MATERIALS_CHILDREN,
  isLookupChild,
  isLinkChild,
  isCustomChild,
  type CustomChild,
} from "@/lib/masters/registry";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";

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
  const [rejectionRules, defectGroups, defectDetails, sizeGroups] = await Promise.all([
    listGarmentRejectionRules(),
    listDefectGroupsSimple(),
    listDefectDetails(),
    listSizeGroups(),
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
    size_groups: sizeGroups.length,
  };

  // The grid is `HubPage` now, like every other hub in the app. This page used
  // to inline the tile markup itself — not even `HubCard` — which is how it
  // drifted into a THIRD Master Data renderer: the empty-count styling here was
  // the original, and `/masters/[submodule]` never had it. The inline copy also
  // wrote a bare `truncate` span, so a description longer than the tile was cut
  // off with no way to read the rest; `HubCard` renders `<Truncated>`, which is
  // what AGENTS.md "Truncated values" requires.
  const cards: HubCardSpec[] = MATERIALS_CHILDREN.map((c) => ({
    key: c.slug,
    href: isLinkChild(c) ? c.href : `/masters/materials/${c.slug}`,
    label: c.label,
    description: c.description,
    // A link child is owned elsewhere and has no count of ours to show. There
    // are none in the registry today, so this branch is the one that keeps the
    // card honest the day one is added back.
    external: isLinkChild(c),
    count: isLookupChild(c)
      ? counts.get(c.kind) ?? 0
      : isCustomChild(c)
        ? countByChild[c.custom]
        : undefined,
  }));

  return (
    <HubPage
      breadcrumb={{ href: "/masters", label: "Master Data" }}
      title="Materials"
      description="Material & specification masters used across planning, purchase and production."
      cards={cards}
    />
  );
}
