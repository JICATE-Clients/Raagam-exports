import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  MaterialExcessPlanRow,
  MaterialExcessPlanItem,
  MaterialExcessPlanSize,
  MaterialRateRow,
  MaterialRateItem,
  FabricOrderRow,
  FabricOrderColor,
  FabricOrderStructure,
  FabricOrderStyle,
  FabricOrderDetail,
  FabricOrderCombo,
  FabricOrderSize,
  FabricConsumption,
  FabricConsumptionComponent,
  FabricConsumptionEntry,
  FabricConsumptionSize,
  FabricConsumptionCombo,
  FabricConsumptionGarmentSize,
  ExcessOrder,
  ExcessOrderItem,
  ExcessOrderSize,
} from "./material-planning-types";

// Helper to flatten Supabase join
function flattenRow<T>(
  row: Record<string, unknown>,
  joinMap: Record<string, string>,
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key in joinMap) continue;
    result[key] = value;
  }
  for (const [joinKey, targetField] of Object.entries(joinMap)) {
    const joined = row[joinKey] as { name?: string; code?: string } | null;
    result[targetField] = joined?.name ?? joined?.code ?? null;
  }
  return result as T;
}

// ============================================================================
// 1. MATERIAL EXCESS PLAN
// ============================================================================

export async function listMaterialExcessPlans(): Promise<MaterialExcessPlanRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_excess_plans")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<MaterialExcessPlanRow>(row, { customers: "customer_name" }),
  );
}

export async function getMaterialExcessPlan(id: string) {
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("material_excess_plans")
    .select("*, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return null;

  const header = flattenRow<MaterialExcessPlanRow>(
    plan as Record<string, unknown>,
    { customers: "customer_name" },
  );

  const { data: items } = await supabase
    .from("material_excess_plan_items")
    .select("*")
    .eq("excess_plan_id", id)
    .order("sno");

  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  let allSizes: MaterialExcessPlanSize[] = [];
  if (itemIds.length > 0) {
    const { data: sizes } = await supabase
      .from("material_excess_plan_sizes")
      .select("*")
      .in("item_id", itemIds)
      .order("sno");
    allSizes = (sizes ?? []) as MaterialExcessPlanSize[];
  }

  return {
    ...header,
    items: ((items ?? []) as MaterialExcessPlanItem[]).map((item) => ({
      ...item,
      sizes: allSizes.filter((s) => s.item_id === item.id),
    })),
  };
}

// ============================================================================
// 2. MATERIAL RATE
// ============================================================================

export async function listMaterialRates(): Promise<MaterialRateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_rates")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<MaterialRateRow>(row, { customers: "customer_name" }),
  );
}

export async function getMaterialRate(id: string) {
  const supabase = await createClient();

  const { data: rate } = await supabase
    .from("material_rates")
    .select("*, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!rate) return null;

  const header = flattenRow<MaterialRateRow>(
    rate as Record<string, unknown>,
    { customers: "customer_name" },
  );

  const { data: items } = await supabase
    .from("material_rate_items")
    .select("*")
    .eq("material_rate_id", id)
    .order("sno");

  return {
    ...header,
    items: (items ?? []) as MaterialRateItem[],
  };
}

// ============================================================================
// 3. FABRIC ORDER
// ============================================================================

export async function listFabricOrders(): Promise<FabricOrderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fabric_orders")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<FabricOrderRow>(row, { customers: "customer_name" }),
  );
}

export async function getFabricOrder(id: string) {
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("fabric_orders")
    .select("*, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!order) return null;

  const header = flattenRow<FabricOrderRow>(
    order as Record<string, unknown>,
    { customers: "customer_name" },
  );

  // Load colors, structures, styles in parallel
  const [
    { data: colors },
    { data: structures },
    { data: styles },
  ] = await Promise.all([
    supabase
      .from("fabric_order_colors")
      .select("*")
      .eq("fabric_order_id", id)
      .order("sno"),
    supabase
      .from("fabric_order_structures")
      .select("*")
      .eq("fabric_order_id", id)
      .order("sno"),
    supabase
      .from("fabric_order_styles")
      .select("*")
      .eq("fabric_order_id", id)
      .order("sno"),
  ]);

  // Load details for styles
  const styleIds = (styles ?? []).map((s: { id: string }) => s.id);
  let allDetails: (FabricOrderDetail & {
    combos: (FabricOrderCombo & { sizes: FabricOrderSize[] })[];
    sizes: FabricOrderSize[];
  })[] = [];

  if (styleIds.length > 0) {
    const { data: details } = await supabase
      .from("fabric_order_details")
      .select("*")
      .in("style_id", styleIds)
      .order("sno");

    const detailIds = (details ?? []).map((d: { id: string }) => d.id);
    let allCombos: FabricOrderCombo[] = [];
    let allSizes: FabricOrderSize[] = [];

    if (detailIds.length > 0) {
      const [{ data: combos }, { data: directSizes }] = await Promise.all([
        supabase
          .from("fabric_order_combos")
          .select("*")
          .in("detail_id", detailIds)
          .order("sno"),
        supabase
          .from("fabric_order_sizes")
          .select("*")
          .in("detail_id", detailIds)
          .order("sno"),
      ]);
      allCombos = (combos ?? []) as FabricOrderCombo[];

      // Load sizes for combos
      const comboIds = allCombos.map((c) => c.id);
      let comboSizes: FabricOrderSize[] = [];
      if (comboIds.length > 0) {
        const { data: csizes } = await supabase
          .from("fabric_order_sizes")
          .select("*")
          .in("combo_id", comboIds)
          .order("sno");
        comboSizes = (csizes ?? []) as FabricOrderSize[];
      }

      // Direct sizes (detail_id set, combo_id null)
      allSizes = (directSizes ?? []).filter(
        (s: Record<string, unknown>) => s.combo_id === null,
      ) as FabricOrderSize[];

      // Merge combo sizes
      const allComboSizes = comboSizes;

      allDetails = ((details ?? []) as FabricOrderDetail[]).map((detail) => ({
        ...detail,
        combos: allCombos
          .filter((c) => c.detail_id === detail.id)
          .map((combo) => ({
            ...combo,
            sizes: allComboSizes.filter((s) => s.combo_id === combo.id),
          })),
        sizes: allSizes.filter((s) => s.detail_id === detail.id),
      }));
    }
  }

  return {
    ...header,
    colors: (colors ?? []) as FabricOrderColor[],
    structures: (structures ?? []) as FabricOrderStructure[],
    styles: ((styles ?? []) as FabricOrderStyle[]).map((style) => ({
      ...style,
      details: allDetails.filter((d) => d.style_id === style.id),
    })),
  };
}

// ============================================================================
// 4. FABRIC CONSUMPTION
// ============================================================================

export async function listFabricConsumptions(): Promise<FabricConsumption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fabric_consumptions")
    .select("*")
    .order("created_at", { ascending: false });

  return (data ?? []) as FabricConsumption[];
}

export async function getFabricConsumption(id: string) {
  const supabase = await createClient();

  const { data: consumption } = await supabase
    .from("fabric_consumptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!consumption) return null;

  const header = consumption as FabricConsumption;

  const [
    { data: components },
    { data: entries },
    { data: combos },
    { data: garmentSizes },
  ] = await Promise.all([
    supabase
      .from("fabric_consumption_components")
      .select("*")
      .eq("consumption_id", id)
      .order("sno"),
    supabase
      .from("fabric_consumption_entries")
      .select("*")
      .eq("consumption_id", id)
      .order("sno"),
    supabase
      .from("fabric_consumption_combos")
      .select("*")
      .eq("consumption_id", id)
      .order("sno"),
    supabase
      .from("fabric_consumption_garment_sizes")
      .select("*")
      .eq("consumption_id", id)
      .order("sno"),
  ]);

  // Load sizes for entries
  const entryIds = (entries ?? []).map((e: { id: string }) => e.id);
  let allSizes: FabricConsumptionSize[] = [];
  if (entryIds.length > 0) {
    const { data: sizes } = await supabase
      .from("fabric_consumption_sizes")
      .select("*")
      .in("entry_id", entryIds)
      .order("sno");
    allSizes = (sizes ?? []) as FabricConsumptionSize[];
  }

  return {
    ...header,
    components: (components ?? []) as FabricConsumptionComponent[],
    entries: ((entries ?? []) as FabricConsumptionEntry[]).map((entry) => ({
      ...entry,
      sizes: allSizes.filter((s) => s.entry_id === entry.id),
    })),
    combos: (combos ?? []) as FabricConsumptionCombo[],
    garment_sizes: (garmentSizes ?? []) as FabricConsumptionGarmentSize[],
  };
}

// ============================================================================
// 5. EXCESS ORDER
// ============================================================================

export async function listExcessOrders(): Promise<ExcessOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("excess_orders")
    .select("*")
    .order("created_at", { ascending: false });

  return (data ?? []) as ExcessOrder[];
}

export async function getExcessOrder(id: string) {
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("excess_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!order) return null;

  const header = order as ExcessOrder;

  const { data: items } = await supabase
    .from("excess_order_items")
    .select("*")
    .eq("excess_order_id", id)
    .order("sno");

  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  let allSizes: ExcessOrderSize[] = [];
  if (itemIds.length > 0) {
    const { data: sizes } = await supabase
      .from("excess_order_sizes")
      .select("*")
      .in("item_id", itemIds)
      .order("sno");
    allSizes = (sizes ?? []) as ExcessOrderSize[];
  }

  return {
    ...header,
    items: ((items ?? []) as ExcessOrderItem[]).map((item) => ({
      ...item,
      sizes: allSizes.filter((s) => s.item_id === item.id),
    })),
  };
}
