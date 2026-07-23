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
  custom: "item_class" | "attributes" | "levies" | "material_attributes" | "categories" | "stock_units" | "counts" | "yarn_purities" | "compositions" | "materials" | "processes" | "components" | "gauges" | "knitting_dias" | "out_document_terms" | "commodities" | "seasons" | "colors" | "brands" | "bins" | "size_groups" | "shade_groups" | "style_names" | "style_levels" | "packing_instructions" | "packing_methods" | "garment_rejection_rules" | "yarn_compositions" | "defect_groups" | "defect_details" | "product_sizes" | "style_stock_categories" | "special_instructions" | "production_sections" | "beams" | "beam_types" | "tyres" | "designs" | "domestic_product_designs" | "lab_test_standards" | "print_types" | "product_types" | "print_items" | "print_processes" | "garment_accepted_qty_levels" | "count_groups" | "constructions" | "yarn_purchase_rates" | "yarn_debit_rates" | "sizing_rates" | "warp_length_allowances" | "process_sequences" | "process_sequence_groups";
};
export type MaterialChild = LookupChild | LinkChild | CustomChild;

export const MATERIALS_CHILDREN: MaterialChild[] = [
  { slug: "item-class", label: "Item Classes", singular: "Item Class", description: "Item class definitions (Name + Has Attribute)", custom: "item_class" },
  { slug: "attributes", label: "Attributes", singular: "Attribute", description: "Per item-class attribute value lists", custom: "attributes" },
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
  { slug: "style-names", label: "Style Names", singular: "Style Name", description: "Garment style naming standards", custom: "style_names" },
  { slug: "style-levels", label: "Style Levels", singular: "Style Level", description: "Style level classification (1/2/3)", custom: "style_levels" },
  { slug: "packing-instructions", label: "Packing Instructions", singular: "Packing Instruction", description: "Packing instruction specifications", custom: "packing_instructions" },
  { slug: "packing-methods", label: "Packing Methods", singular: "Packing Method", description: "Packing method definitions with categories", custom: "packing_methods" },
  { slug: "garment-rejection-rules", label: "Garment Rejection Rules", singular: "Garment Rejection Rule", description: "QC rejection acceptance rules", custom: "garment_rejection_rules" },
  // --- Phase 1: Simple masters (from VB.NET source of truth audit) ---
  { slug: "yarn-compositions", label: "Yarn Compositions", singular: "Yarn Composition", description: "Fibre types (Cotton, Polyester, Viscose…)", custom: "yarn_compositions" },
  { slug: "defect-groups", label: "Defect Groups", singular: "Defect Group", description: "QC defect category groups", custom: "defect_groups" },
  { slug: "defect-details", label: "Defect Details", singular: "Defect Detail", description: "Individual defect codes (CatgID.DefectID.DetID)", custom: "defect_details" },
  { slug: "product-sizes", label: "Product Sizes", singular: "Product Size", description: "Width × Length × Height product dimensions", custom: "product_sizes" },
  { slug: "style-stock-categories", label: "Style Stock Categories", singular: "Style Stock Category", description: "Style stock classification", custom: "style_stock_categories" },
  { slug: "special-instructions", label: "Special Instructions", singular: "Special Instruction", description: "Reusable instruction templates for orders", custom: "special_instructions" },
  { slug: "production-sections", label: "Production Sections", singular: "Production Section", description: "Production line/section masters (Cut/Stitch/…)", custom: "production_sections" },
  { slug: "beams", label: "Beams", singular: "Beam", description: "Weaving beam master with loom type", custom: "beams" },
  { slug: "beam-types", label: "Beam Types", singular: "Beam Type", description: "Beam type classifications", custom: "beam_types" },
  { slug: "tyres", label: "Tyres", singular: "Tyre", description: "Loom tyre master with retread tracking", custom: "tyres" },
  { slug: "designs", label: "Designs", singular: "Design", description: "Fabric design master", custom: "designs" },
  { slug: "domestic-product-designs", label: "Domestic Product Designs", singular: "Domestic Product Design", description: "Design groupings for domestic market", custom: "domestic_product_designs" },
  { slug: "lab-test-standards", label: "Lab Test Standards", singular: "Lab Test Standard", description: "Lab test standard benchmarks", custom: "lab_test_standards" },
  { slug: "print-types", label: "Print Types", singular: "Print Type", description: "Printing type classification", custom: "print_types" },
  { slug: "product-types", label: "Product Types", singular: "Product Type", description: "Product type classification", custom: "product_types" },
  { slug: "print-items", label: "Print Items", singular: "Print Item", description: "Printing module item master", custom: "print_items" },
  { slug: "print-processes", label: "Print Processes", singular: "Print Process", description: "Printing process with applicability flags", custom: "print_processes" },
  { slug: "garment-accepted-qty-levels", label: "Garment Accepted Qty Levels", singular: "Garment Accepted Qty Level", description: "Range-based acceptance rules with dated entries", custom: "garment_accepted_qty_levels" },
  // --- Phase 2: Grid masters ---
  { slug: "count-groups", label: "Count Groups", singular: "Count Group", description: "Yarn count groupings for reporting", custom: "count_groups" },
  { slug: "constructions", label: "Constructions", singular: "Construction", description: "Fabric construction (warp/weft counts + reed + pick)", custom: "constructions" },
  { slug: "yarn-purchase-rates", label: "Yarn Purchase Rates", singular: "Yarn Purchase Rate", description: "Effective-dated yarn purchase rates", custom: "yarn_purchase_rates" },
  { slug: "yarn-debit-rates", label: "Yarn Debit Rates", singular: "Yarn Debit Rate", description: "Yarn debit rates (per KG & per bundle)", custom: "yarn_debit_rates" },
  { slug: "sizing-rates", label: "Sizing Rates", singular: "Sizing Rate", description: "Costing rates for sizing by yarn/ends", custom: "sizing_rates" },
  { slug: "warp-length-allowances", label: "Warp Length Allowances", singular: "Warp Length Allowance", description: "Range-based warp → fabric length conversion", custom: "warp_length_allowances" },
  { slug: "process-sequences", label: "Process Sequences", singular: "Process Sequence", description: "Ordered process steps with loss %", custom: "process_sequences" },
  { slug: "process-sequence-groups", label: "Process Sequence Groups", singular: "Process Sequence Group", description: "Groups of process sequences", custom: "process_sequence_groups" },
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
