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
  custom: "attributes" | "levies" | "material_attributes" | "categories" | "stock_units" | "counts" | "yarn_purities" | "compositions" | "materials" | "processes" | "components" | "gauges" | "knitting_dias" | "out_document_terms" | "commodities" | "seasons" | "colors" | "brands" | "bins" | "size_groups" | "shade_groups";
};
export type MaterialChild = LookupChild | LinkChild | CustomChild;

export const MATERIALS_CHILDREN: MaterialChild[] = [
  { slug: "attributes", label: "Attributes", singular: "Attribute", description: "Attribute definitions with value lists", custom: "attributes" },
  { slug: "levies", label: "Levies", singular: "Levy", description: "Tax & duty configuration (GST rates + account heads)", custom: "levies" },
  { slug: "categories", label: "Categories", singular: "Category", description: "Material classifications", custom: "categories" },
  { slug: "material-attributes", label: "Material Attributes", singular: "Material Attribute", description: "Per class/category attribute specs", custom: "material_attributes" },
  { slug: "stock-units", label: "Stock Units", singular: "Stock Unit", description: "Units of measure (decimals + item classes)", custom: "stock_units" },
  { slug: "counts", label: "Counts", singular: "Count", description: "Yarn counts", custom: "counts" },
  { slug: "yarn-purities", label: "Yarn Purities", singular: "Yarn Purity", description: "Purity grades", custom: "yarn_purities" },
  { slug: "compositions", label: "Compositions", singular: "Composition", description: "Fibre blends (e.g. 100% Cotton)", custom: "compositions" },
  { slug: "materials", label: "Materials", singular: "Material", description: "Material master — class-driven specs, UOM & budget", custom: "materials" },
  { slug: "processes", label: "Processes", singular: "Process", description: "Sub-contract processes", custom: "processes" },
  { slug: "components", label: "Components", singular: "Component", description: "Buttons, zippers, labels, thread…", custom: "components" },
  { slug: "gauges", label: "Gauges", singular: "Gauge", description: "Knitting machine gauges", custom: "gauges" },
  { slug: "knitting-dias", label: "Knitting Dias", singular: "Knitting Dia", description: "Knitting diameters", custom: "knitting_dias" },
  { slug: "out-document-terms", label: "Out Document Terms", singular: "Out Document Term", description: "Sub-contract issue terms", custom: "out_document_terms" },
  { slug: "commodities", label: "Commodities", singular: "Commodity", description: "Customs commodity classes", custom: "commodities" },
  { slug: "seasons", label: "Seasons", singular: "Season", description: "Style seasons", custom: "seasons" },
  { slug: "colors", label: "Colors", singular: "Color", description: "Colour master", custom: "colors" },
  { slug: "brands", label: "Brands", singular: "Brand", description: "Brand master", custom: "brands" },
  { slug: "bins", label: "Bins", singular: "Bin", description: "Storage bin locations", custom: "bins" },
  { slug: "size-groups", label: "Size Groups", singular: "Size Group", description: "Size groupings (S/M/L/XL sets)", custom: "size_groups" },
  { slug: "shade-groups", label: "Shade Groups", singular: "Shade Group", description: "Shade groupings with individual shades", custom: "shade_groups" },
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
