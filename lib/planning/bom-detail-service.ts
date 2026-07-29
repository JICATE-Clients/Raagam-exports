import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  FabricBom,
  GarmentBom,
  AccessoryBom,
} from "./bom-types";

// ============================================================================
// Fabric BOM detail (FrmStyle_Fab_BOM)
// ============================================================================

export type FabricBomCloth = {
  id: string;
  fabric_id: string;
  sno: number;
  cloth_name: string | null;
  fabric_short_name: string | null;
  uom_id: string | null;
  yarn_short_name: string | null;
  shade_id: string | null;
  warp_weft: string | null;
  yarn_reqd_form: string | null;
  is_doubling_yarn: boolean;
  sort_order: number;
};

export type FabricBomFabric = {
  id: string;
  fabric_bom_id: string;
  sno: number;
  category_id: string | null;
  item_id: string | null;
  item_sub_type: string | null;
  gsm_range: string | null;
  no_of_colors: number;
  mixing_uom_id: string | null;
  sort_order: number;
  cloths: FabricBomCloth[];
};

export type FabricBomDyeColor = {
  id: string;
  fabric_bom_id: string;
  color_type: string;
  description: string;
  process_loss_pct: number;
  sub_type: string | null;
  sort_order: number;
};

export type FabricBomComponent = {
  id: string;
  fabric_bom_id: string;
  sno: number;
  component_id: string | null;
  coordinate: string | null;
  category_id: string | null;
  item_type: string | null;
  item_sub_type: string | null;
  item_id: string | null;
  gsm: number | null;
  sort_order: number;
  combos: FabricBomCombo[];
};

export type FabricBomCombo = {
  id: string;
  component_id: string;
  sno: number;
  assort_color: string | null;
  item_sub_type: string | null;
  item_id: string | null;
  gsm: number | null;
  item_process_type: string | null;
  item_color: string | null;
  print_name: string | null;
  specifications: string | null;
  sort_order: number;
};

export type FabricBomDetail = FabricBom & {
  customer_name: string | null;
  style_code: string | null;
  dye_colors: FabricBomDyeColor[];
  fabrics: FabricBomFabric[];
  components: FabricBomComponent[];
};

export async function getFabricBom(id: string): Promise<FabricBomDetail | null> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("fabric_boms")
    .select("*, customers(name), styles(code)")
    .eq("id", id)
    .maybeSingle();
  if (!bom) return null;

  const bomRow = bom as Record<string, unknown>;
  const customer = bomRow.customers as { name: string } | null;
  const style = bomRow.styles as { code: string } | null;
  const { customers: _c, styles: _s, ...bomRest } = bomRow;
  void _c;
  void _s;

  const [{ data: dyeColors }, { data: fabrics }, { data: components }] = await Promise.all([
    supabase
      .from("fabric_bom_dye_colors")
      .select("*")
      .eq("fabric_bom_id", id)
      .order("sort_order"),
    supabase
      .from("fabric_bom_fabrics")
      .select("*, fabric_bom_cloths(*)")
      .eq("fabric_bom_id", id)
      .order("sort_order"),
    supabase
      .from("fabric_bom_components")
      .select("*, fabric_bom_combos(*)")
      .eq("fabric_bom_id", id)
      .order("sort_order"),
  ]);

  const mappedFabrics = ((fabrics ?? []) as Record<string, unknown>[]).map((f) => {
    const cloths = (f.fabric_bom_cloths ?? []) as FabricBomCloth[];
    const { fabric_bom_cloths: _cl, ...fabRest } = f;
    void _cl;
    return {
      ...(fabRest as unknown as Omit<FabricBomFabric, "cloths">),
      cloths: cloths.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  const mappedComponents = ((components ?? []) as Record<string, unknown>[]).map((c) => {
    const combos = (c.fabric_bom_combos ?? []) as FabricBomCombo[];
    const { fabric_bom_combos: _cb, ...compRest } = c;
    void _cb;
    return {
      ...(compRest as unknown as Omit<FabricBomComponent, "combos">),
      combos: combos.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  return {
    ...(bomRest as unknown as FabricBom),
    customer_name: customer?.name ?? null,
    style_code: style?.code ?? null,
    dye_colors: (dyeColors ?? []) as FabricBomDyeColor[],
    fabrics: mappedFabrics,
    components: mappedComponents,
  };
}

// ============================================================================
// Garment BOM detail (FrmStyl_Gar_BOM)
// ============================================================================

export type GarmentBomPlacement = {
  id: string;
  component_id: string;
  sno: number;
  position: string | null;
  design_detail: string | null;
  combo_detail: string | null;
  pack_ref_detail: string | null;
  sort_order: number;
};

export type GarmentBomComponent = {
  id: string;
  process_id: string;
  sno: number;
  component_id: string | null;
  coordinate: string | null;
  design: string | null;
  vendor_specification: string | null;
  attachment_ref: string | null;
  sort_order: number;
  placements: GarmentBomPlacement[];
};

export type GarmentBomProcess = {
  id: string;
  garment_bom_id: string;
  process_type: string;
  sno: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  process_id: string | null;
  against_pack_ref: boolean;
  loss_pct: number;
  sort_order: number;
  components: GarmentBomComponent[];
};

export type GarmentBomDetail = GarmentBom & {
  customer_name: string | null;
  style_code: string | null;
  component_processes: GarmentBomProcess[];
  garment_processes: GarmentBomProcess[];
};

export async function getGarmentBom(id: string): Promise<GarmentBomDetail | null> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("garment_boms")
    .select("*, customers(name), styles(code)")
    .eq("id", id)
    .maybeSingle();
  if (!bom) return null;

  const bomRow = bom as Record<string, unknown>;
  const customer = bomRow.customers as { name: string } | null;
  const style = bomRow.styles as { code: string } | null;
  const { customers: _c, styles: _s, ...bomRest } = bomRow;
  void _c;
  void _s;

  const { data: processes } = await supabase
    .from("garment_bom_processes")
    .select("*, garment_bom_components(*, garment_bom_placements(*))")
    .eq("garment_bom_id", id)
    .order("sort_order");

  const allProcesses = ((processes ?? []) as Record<string, unknown>[]).map((p) => {
    const rawComponents = (p.garment_bom_components ?? []) as Record<string, unknown>[];
    const { garment_bom_components: _gc, ...procRest } = p;
    void _gc;

    const components = rawComponents.map((c) => {
      const placements = (c.garment_bom_placements ?? []) as GarmentBomPlacement[];
      const { garment_bom_placements: _gp, ...compRest } = c;
      void _gp;
      return {
        ...(compRest as unknown as Omit<GarmentBomComponent, "placements">),
        placements: placements.sort((a, b) => a.sort_order - b.sort_order),
      };
    }).sort((a, b) => a.sort_order - b.sort_order);

    return {
      ...(procRest as unknown as Omit<GarmentBomProcess, "components">),
      components,
    };
  });

  return {
    ...(bomRest as unknown as GarmentBom),
    customer_name: customer?.name ?? null,
    style_code: style?.code ?? null,
    component_processes: allProcesses.filter((p) => p.process_type === "component"),
    garment_processes: allProcesses.filter((p) => p.process_type === "garment"),
  };
}

// ============================================================================
// Accessory BOM detail (FrmSC_Acc_BOM + FrmIWO_Acc_BOM)
// ============================================================================

export type AccessoryBomConsumptionSize = {
  id: string;
  consumption_id: string;
  sno: number;
  garment_size: string | null;
  nos_per_pcs: number;
  pcs_per_nos: number;
  allowance_pct: number;
  allowance_qty: number;
  sort_order: number;
};

export type AccessoryBomConsumption = {
  id: string;
  item_id: string;
  sno: number;
  uom_id: string | null;
  nos_per_pcs: number;
  pcs_per_nos: number;
  waste_pct: number;
  allowance_qty: number;
  style_ref_no: string | null;
  style_no: string | null;
  article_no: string | null;
  is_sizewise: boolean;
  sort_order: number;
  sizes: AccessoryBomConsumptionSize[];
};

export type AccessoryBomItem = {
  id: string;
  accessory_bom_id: string;
  sno: number;
  category_id: string | null;
  item_id: string | null;
  availability_type: string | null;
  bom_for: string | null;
  supply_type: string | null;
  vendor_id: string | null;
  uom_id: string | null;
  consumption_uom_id: string | null;
  moq: number | null;
  is_approval_required: boolean;
  advised_item_name: string | null;
  specifications: string | null;
  sort_order: number;
};

export type AccessoryBomProcessStage = {
  id: string;
  process_id: string;
  sno: number;
  stage: string | null;
  process_name: string | null;
  loss_for: string | null;
  loss_pct: number;
  description: string | null;
  sort_order: number;
};

export type AccessoryBomProcess = {
  id: string;
  accessory_bom_id: string;
  sno: number;
  item_id: string | null;
  sort_order: number;
  stages: AccessoryBomProcessStage[];
};

export type AccessoryBomDetail = AccessoryBom & {
  customer_name: string | null;
  style_code: string | null;
  items: AccessoryBomItem[];
  consumptions: AccessoryBomConsumption[];
  processes: AccessoryBomProcess[];
};

export async function getAccessoryBom(id: string): Promise<AccessoryBomDetail | null> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("accessory_boms")
    .select("*, customers(name), styles(code)")
    .eq("id", id)
    .maybeSingle();
  if (!bom) return null;

  const bomRow = bom as Record<string, unknown>;
  const customer = bomRow.customers as { name: string } | null;
  const style = bomRow.styles as { code: string } | null;
  const { customers: _c, styles: _s, ...bomRest } = bomRow;
  void _c;
  void _s;

  const [{ data: items }, { data: consumptions }, { data: processes }] = await Promise.all([
    supabase
      .from("accessory_bom_items")
      .select("*")
      .eq("accessory_bom_id", id)
      .order("sort_order"),
    supabase
      .from("accessory_bom_consumptions")
      .select("*, accessory_bom_consumption_sizes(*)")
      .eq("item_id", id), // need all consumptions for all items — we'll re-query below
    supabase
      .from("accessory_bom_processes")
      .select("*, accessory_bom_process_stages(*)")
      .eq("accessory_bom_id", id)
      .order("sort_order"),
  ]);

  // For consumptions, we need to get them via item_ids
  const itemIds = ((items ?? []) as { id: string }[]).map((i) => i.id);
  let allConsumptions: AccessoryBomConsumption[] = [];
  if (itemIds.length > 0) {
    const { data: cons } = await supabase
      .from("accessory_bom_consumptions")
      .select("*, accessory_bom_consumption_sizes(*)")
      .in("item_id", itemIds)
      .order("sort_order");

    allConsumptions = ((cons ?? []) as Record<string, unknown>[]).map((c) => {
      const sizes = (c.accessory_bom_consumption_sizes ?? []) as AccessoryBomConsumptionSize[];
      const { accessory_bom_consumption_sizes: _sz, ...consRest } = c;
      void _sz;
      return {
        ...(consRest as unknown as Omit<AccessoryBomConsumption, "sizes">),
        sizes: sizes.sort((a, b) => a.sort_order - b.sort_order),
      };
    });
  }

  const mappedProcesses = ((processes ?? []) as Record<string, unknown>[]).map((p) => {
    const stages = (p.accessory_bom_process_stages ?? []) as AccessoryBomProcessStage[];
    const { accessory_bom_process_stages: _st, ...procRest } = p;
    void _st;
    return {
      ...(procRest as unknown as Omit<AccessoryBomProcess, "stages">),
      stages: stages.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  return {
    ...(bomRest as unknown as AccessoryBom),
    customer_name: customer?.name ?? null,
    style_code: style?.code ?? null,
    items: (items ?? []) as AccessoryBomItem[],
    consumptions: allConsumptions,
    processes: mappedProcesses,
  };
}
