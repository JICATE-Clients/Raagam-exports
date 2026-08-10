import type { LookupKind } from "./extras-types";

/**
 * Master Data ▸ Materials — the 15 legacy EDP2 child masters, in legacy order.
 * (HSN Assign to Materials moved to Master Data ▸ GST — it's a GST/tax
 * classification assignment, not a materials master; see `submodules.ts`.)
 *
 * Every entry is a `CustomChild` with its own rich screen + dedicated
 * table/service (no plain `LookupChild` remain — Stock Units and Materials
 * each grew a full CRUD screen instead of staying flat `config_lookups`
 * lookups or link-out cards). `LookupChild`/`isLookupChild` are kept for the
 * shape they document, but no current entry uses that path.
 *
 * Adding a master here means giving it its own `custom` branch in
 * `app/(app)/masters/materials/[entity]/page.tsx`.
 *
 * 2026-08-01 — 30 children were removed as not applicable to the business
 * (client call), after 0381 removed Warp Length Allowances the same way; their
 * tables are dropped in migration 0382. Remove the `custom` union member FIRST
 * when withdrawing another: TypeScript then points straight at the orphaned
 * `else if` branch in the route, which nothing else would catch.
 */
export type LookupChild = {
  slug: string;
  label: string; // plural, list/heading
  singular: string; // "Add {singular}"
  description: string;
  kind: LookupKind;
};
export type LinkChild = {
  slug: string;
  label: string;
  singular: string;
  description: string;
  href: string;
};
/** Rich master-detail children with their own tables + a dedicated screen. */
export type CustomChild = {
  slug: string;
  label: string;
  singular: string;
  description: string;
  custom: "item_class" | "attributes" | "levies" | "material_attributes" | "categories" | "stock_units" | "counts" | "yarn_purities" | "compositions" | "materials" | "processes" | "components" | "gauges" | "knitting_dias" | "out_document_terms" | "bins" | "garment_rejection_rules" | "defect_groups" | "defect_details" | "size_groups";
};
export type MaterialChild = LookupChild | LinkChild | CustomChild;

export const MATERIALS_CHILDREN: MaterialChild[] = [
  { slug: "item-class", label: "Item Classes", singular: "Item Class", description: "Item class definitions (Name + Has Attribute)", custom: "item_class" },
  { slug: "attributes", label: "Attributes", singular: "Attribute", description: "Per item-class attribute value lists", custom: "attributes" },
  // Labelled "GST", not "Levy" (client 2026-08-01) — that is what the operator
  // calls it. The table, slug and `custom` key stay `levies`: renaming those
  // would break every saved URL, the data-io entity key and 30-odd `levy_id`
  // FKs for a wording change. The screen still covers VAT / CST / Duty / TDS /
  // Excise rows, and its sheet title names the one being edited.
  { slug: "levies", label: "GST", singular: "GST", description: "GST, duty & TDS structures (rates + account heads)", custom: "levies" },
  { slug: "categories", label: "Categories", singular: "Category", description: "Material classifications", custom: "categories" },
  { slug: "material-attributes", label: "Material Attributes", singular: "Material Attribute", description: "Per class/category attribute specs", custom: "material_attributes" },
  { slug: "stock-units", label: "Stock Units", singular: "Stock Unit", description: "Units of measure (decimals + item classes)", custom: "stock_units" },
  { slug: "counts", label: "Counts", singular: "Count", description: "Yarn counts", custom: "counts" },
  { slug: "yarn-purities", label: "Yarn Purities", singular: "Yarn Purity", description: "Purity grades", custom: "yarn_purities" },
  { slug: "compositions", label: "Compositions", singular: "Composition", description: "Fibre blends (e.g. 100% Cotton)", custom: "compositions" },
  { slug: "materials", label: "Materials", singular: "Material", description: "Material master — class-driven specs, UOM & budget", custom: "materials" },
  { slug: "processes", label: "Processes", singular: "Process", description: "Sub-contract processes", custom: "processes" },
  { slug: "components", label: "Components", singular: "Component", description: "Buttons, zippers, labels, thread…", custom: "components" },
  // RESTORED 2026-08-10. Withdrawn in 129c59f as a child "the business does not
  // use"; the Style master now fills a style's sizes from a group, so it does.
  { slug: "size-groups", label: "Size Groups", singular: "Size Group", description: "Size sets (S · M · L · XL) a style is made in", custom: "size_groups" },
  { slug: "gauges", label: "Gauges", singular: "Gauge", description: "Knitting machine gauges", custom: "gauges" },
  { slug: "knitting-dias", label: "Knitting Dias", singular: "Knitting Dia", description: "Knitting diameters", custom: "knitting_dias" },
  { slug: "out-document-terms", label: "Out Document Terms", singular: "Out Document Term", description: "Sub-contract issue terms", custom: "out_document_terms" },
  { slug: "bins", label: "Bins", singular: "Bin", description: "Storage bin locations", custom: "bins" },
  { slug: "garment-rejection-rules", label: "Garment Rejection Rules", singular: "Garment Rejection Rule", description: "QC rejection acceptance rules", custom: "garment_rejection_rules" },
  // --- Phase 1: Simple masters (from VB.NET source of truth audit) ---
  { slug: "defect-groups", label: "Defect Groups", singular: "Defect Group", description: "QC defect category groups", custom: "defect_groups" },
  { slug: "defect-details", label: "Defect Details", singular: "Defect Detail", description: "Individual defect codes (CatgID.DefectID.DetID)", custom: "defect_details" },
];

export function findMaterialChild(slug: string): MaterialChild | undefined {
  return MATERIALS_CHILDREN.find((c) => c.slug === slug);
}

export function isLookupChild(c: MaterialChild): c is LookupChild {
  return "kind" in c;
}
export function isLinkChild(c: MaterialChild): c is LinkChild {
  return "href" in c;
}
export function isCustomChild(c: MaterialChild): c is CustomChild {
  return "custom" in c;
}
