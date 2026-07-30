import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  GarmentPpm,
  GarmentPpmRow,
  GarmentPpmPack,
  GarmentPpmQuantity,
  GarmentPpmCoordinate,
  GarmentPpmCombo,
  GarmentPpmSize,
  GarmentPpmFabric,
  GarmentPpmFabricSize,
  GarmentPpmProcess,
  GarmentPpmProcessItem,
  GarmentPpmAccessory,
  GarmentPpmAccessorySize,
  ProcessingPpm,
  ProcessingPpmRow,
  ProcessingPpmItem,
  ProcessingPpmSize,
  ProcessingPpmYarn,
  PurchasePpm,
  PurchasePpmRow,
  PurchasePpmItem,
  PurchasePpmSize,
  PpmCancel,
  PpmCancelRow,
  PpmCancelItem,
  PpmCancelSize,
  PpmCompletion,
  PpmCompletionRow,
  GarmentPpmCancellation,
  GarmentPpmCancelStyle,
  GarmentPpmCancelCoordinate,
  GarmentPpmCancelCombo,
  GarmentPpmCancelSize,
} from "./ppm-types";

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
// 1. GARMENT PPM
// ============================================================================

export async function listGarmentPpms(): Promise<GarmentPpmRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garment_ppms")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<GarmentPpmRow>(row, {
      customers: "customer_name",
      sales_orders: "order_code",
    }),
  );
}

export async function getGarmentPpm(id: string) {
  const supabase = await createClient();

  const { data: ppm } = await supabase
    .from("garment_ppms")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!ppm) return null;

  const header = flattenRow<GarmentPpmRow>(
    ppm as Record<string, unknown>,
    { customers: "customer_name", sales_orders: "order_code" },
  );

  const [
    { data: packs },
    { data: quantities },
    { data: fabrics },
    { data: processes },
    { data: accessories },
  ] = await Promise.all([
    supabase
      .from("garment_ppm_packs")
      .select("*")
      .eq("garment_ppm_id", id)
      .order("sno"),
    supabase
      .from("garment_ppm_quantities")
      .select("*")
      .eq("garment_ppm_id", id)
      .order("sno"),
    supabase
      .from("garment_ppm_fabrics")
      .select("*")
      .eq("garment_ppm_id", id)
      .order("sno"),
    supabase
      .from("garment_ppm_processes")
      .select("*")
      .eq("garment_ppm_id", id)
      .order("sno"),
    supabase
      .from("garment_ppm_accessories")
      .select("*")
      .eq("garment_ppm_id", id)
      .order("sno"),
  ]);

  // Load children for quantities (coordinates, combos→sizes)
  const qtyIds = (quantities ?? []).map((q: { id: string }) => q.id);
  let allCoordinates: GarmentPpmCoordinate[] = [];
  let allCombos: (GarmentPpmCombo & { sizes: GarmentPpmSize[] })[] = [];

  if (qtyIds.length > 0) {
    const [{ data: coords }, { data: combos }] = await Promise.all([
      supabase
        .from("garment_ppm_coordinates")
        .select("*")
        .in("quantity_id", qtyIds)
        .order("sno"),
      supabase
        .from("garment_ppm_combos")
        .select("*")
        .in("quantity_id", qtyIds)
        .order("sno"),
    ]);
    allCoordinates = (coords ?? []) as GarmentPpmCoordinate[];

    const comboIds = (combos ?? []).map((c: { id: string }) => c.id);
    let allSizes: GarmentPpmSize[] = [];
    if (comboIds.length > 0) {
      const { data: sizes } = await supabase
        .from("garment_ppm_sizes")
        .select("*")
        .in("combo_id", comboIds)
        .order("sno");
      allSizes = (sizes ?? []) as GarmentPpmSize[];
    }

    allCombos = ((combos ?? []) as GarmentPpmCombo[]).map((combo) => ({
      ...combo,
      sizes: allSizes.filter((s) => s.combo_id === combo.id),
    }));
  }

  // Load fabric sizes
  const fabIds = (fabrics ?? []).map((f: { id: string }) => f.id);
  let allFabricSizes: GarmentPpmFabricSize[] = [];
  if (fabIds.length > 0) {
    const { data: fsizes } = await supabase
      .from("garment_ppm_fabric_sizes")
      .select("*")
      .in("fabric_id", fabIds)
      .order("sno");
    allFabricSizes = (fsizes ?? []) as GarmentPpmFabricSize[];
  }

  // Load process items
  const procIds = (processes ?? []).map((p: { id: string }) => p.id);
  let allProcessItems: GarmentPpmProcessItem[] = [];
  if (procIds.length > 0) {
    const { data: pitems } = await supabase
      .from("garment_ppm_process_items")
      .select("*")
      .in("process_id", procIds)
      .order("sno");
    allProcessItems = (pitems ?? []) as GarmentPpmProcessItem[];
  }

  // Load accessory sizes
  const accIds = (accessories ?? []).map((a: { id: string }) => a.id);
  let allAccessorySizes: GarmentPpmAccessorySize[] = [];
  if (accIds.length > 0) {
    const { data: asizes } = await supabase
      .from("garment_ppm_accessory_sizes")
      .select("*")
      .in("accessory_id", accIds)
      .order("sno");
    allAccessorySizes = (asizes ?? []) as GarmentPpmAccessorySize[];
  }

  return {
    ...header,
    packs: (packs ?? []) as GarmentPpmPack[],
    quantities: ((quantities ?? []) as GarmentPpmQuantity[]).map((q) => ({
      ...q,
      coordinates: allCoordinates.filter((c) => c.quantity_id === q.id),
      combos: allCombos.filter((c) => c.quantity_id === q.id),
    })),
    fabrics: ((fabrics ?? []) as GarmentPpmFabric[]).map((f) => ({
      ...f,
      sizes: allFabricSizes.filter((s) => s.fabric_id === f.id),
    })),
    processes: ((processes ?? []) as GarmentPpmProcess[]).map((p) => ({
      ...p,
      items: allProcessItems.filter((i) => i.process_id === p.id),
    })),
    accessories: ((accessories ?? []) as GarmentPpmAccessory[]).map((a) => ({
      ...a,
      sizes: allAccessorySizes.filter((s) => s.accessory_id === a.id),
    })),
  };
}

// ============================================================================
// 2. PROCESSING PPM
// ============================================================================

export async function listProcessingPpms(): Promise<ProcessingPpmRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("processing_ppms")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<ProcessingPpmRow>(row, {
      customers: "customer_name",
      sales_orders: "order_code",
    }),
  );
}

export async function getProcessingPpm(id: string) {
  const supabase = await createClient();

  const { data: ppm } = await supabase
    .from("processing_ppms")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!ppm) return null;

  const header = flattenRow<ProcessingPpmRow>(
    ppm as Record<string, unknown>,
    { customers: "customer_name", sales_orders: "order_code" },
  );

  const [{ data: items }, { data: yarns }] = await Promise.all([
    supabase
      .from("processing_ppm_items")
      .select("*")
      .eq("processing_ppm_id", id)
      .order("sno"),
    supabase
      .from("processing_ppm_yarns")
      .select("*")
      .eq("processing_ppm_id", id)
      .order("sno"),
  ]);

  // Load item sizes
  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  let allSizes: ProcessingPpmSize[] = [];
  if (itemIds.length > 0) {
    const { data: sizes } = await supabase
      .from("processing_ppm_sizes")
      .select("*")
      .in("item_id", itemIds)
      .order("sno");
    allSizes = (sizes ?? []) as ProcessingPpmSize[];
  }

  return {
    ...header,
    items: ((items ?? []) as ProcessingPpmItem[]).map((item) => ({
      ...item,
      sizes: allSizes.filter((s) => s.item_id === item.id),
    })),
    yarns: (yarns ?? []) as ProcessingPpmYarn[],
  };
}

// ============================================================================
// 3. PURCHASE PPM
// ============================================================================

export async function listPurchasePpms(): Promise<PurchasePpmRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_ppms")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<PurchasePpmRow>(row, {
      customers: "customer_name",
      sales_orders: "order_code",
    }),
  );
}

export async function getPurchasePpm(id: string) {
  const supabase = await createClient();

  const { data: ppm } = await supabase
    .from("purchase_ppms")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!ppm) return null;

  const header = flattenRow<PurchasePpmRow>(
    ppm as Record<string, unknown>,
    { customers: "customer_name", sales_orders: "order_code" },
  );

  const { data: items } = await supabase
    .from("purchase_ppm_items")
    .select("*")
    .eq("purchase_ppm_id", id)
    .order("sno");

  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  let allSizes: PurchasePpmSize[] = [];
  if (itemIds.length > 0) {
    const { data: sizes } = await supabase
      .from("purchase_ppm_sizes")
      .select("*")
      .in("item_id", itemIds)
      .order("sno");
    allSizes = (sizes ?? []) as PurchasePpmSize[];
  }

  return {
    ...header,
    items: ((items ?? []) as PurchasePpmItem[]).map((item) => ({
      ...item,
      sizes: allSizes.filter((s) => s.item_id === item.id),
    })),
  };
}

// ============================================================================
// 4. PPM CANCEL
// ============================================================================

export async function listPpmCancels(): Promise<PpmCancelRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ppm_cancels")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<PpmCancelRow>(row, { customers: "customer_name" }),
  );
}

export async function getPpmCancel(id: string) {
  const supabase = await createClient();

  const { data: cancel } = await supabase
    .from("ppm_cancels")
    .select("*, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!cancel) return null;

  const header = flattenRow<PpmCancelRow>(
    cancel as Record<string, unknown>,
    { customers: "customer_name" },
  );

  const { data: items } = await supabase
    .from("ppm_cancel_items")
    .select("*")
    .eq("ppm_cancel_id", id)
    .order("sno");

  const itemIds = (items ?? []).map((i: { id: string }) => i.id);
  let allSizes: PpmCancelSize[] = [];
  if (itemIds.length > 0) {
    const { data: sizes } = await supabase
      .from("ppm_cancel_sizes")
      .select("*")
      .in("item_id", itemIds)
      .order("sno");
    allSizes = (sizes ?? []) as PpmCancelSize[];
  }

  return {
    ...header,
    items: ((items ?? []) as PpmCancelItem[]).map((item) => ({
      ...item,
      sizes: allSizes.filter((s) => s.item_id === item.id),
    })),
  };
}

// ============================================================================
// 5. PPM COMPLETION
// ============================================================================

export async function listPpmCompletions(): Promise<PpmCompletionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ppm_completions")
    .select("*, customers(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    flattenRow<PpmCompletionRow>(row, { customers: "customer_name" }),
  );
}

export async function getPpmCompletion(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ppm_completions")
    .select("*, customers(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  return flattenRow<PpmCompletionRow>(
    data as Record<string, unknown>,
    { customers: "customer_name" },
  );
}

// ============================================================================
// 6. GARMENT PPM CANCELLATION
// ============================================================================

export async function listGarmentPpmCancellations(): Promise<GarmentPpmCancellation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garment_ppm_cancellations")
    .select("*")
    .order("created_at", { ascending: false });

  return (data ?? []) as GarmentPpmCancellation[];
}

export async function getGarmentPpmCancellation(id: string) {
  const supabase = await createClient();

  const { data: cancel } = await supabase
    .from("garment_ppm_cancellations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!cancel) return null;

  const header = cancel as GarmentPpmCancellation;

  const { data: styles } = await supabase
    .from("garment_ppm_cancel_styles")
    .select("*")
    .eq("cancellation_id", id)
    .order("sno");

  const styleIds = (styles ?? []).map((s: { id: string }) => s.id);
  let allCoords: GarmentPpmCancelCoordinate[] = [];
  let allCombos: (GarmentPpmCancelCombo & { sizes: GarmentPpmCancelSize[] })[] = [];

  if (styleIds.length > 0) {
    const [{ data: coords }, { data: combos }] = await Promise.all([
      supabase
        .from("garment_ppm_cancel_coordinates")
        .select("*")
        .in("style_id", styleIds)
        .order("sno"),
      supabase
        .from("garment_ppm_cancel_combos")
        .select("*")
        .in("style_id", styleIds)
        .order("sno"),
    ]);
    allCoords = (coords ?? []) as GarmentPpmCancelCoordinate[];

    const comboIds = (combos ?? []).map((c: { id: string }) => c.id);
    let allSizes: GarmentPpmCancelSize[] = [];
    if (comboIds.length > 0) {
      const { data: sizes } = await supabase
        .from("garment_ppm_cancel_sizes")
        .select("*")
        .in("combo_id", comboIds)
        .order("sno");
      allSizes = (sizes ?? []) as GarmentPpmCancelSize[];
    }

    allCombos = ((combos ?? []) as GarmentPpmCancelCombo[]).map((combo) => ({
      ...combo,
      sizes: allSizes.filter((s) => s.combo_id === combo.id),
    }));
  }

  return {
    ...header,
    styles: ((styles ?? []) as GarmentPpmCancelStyle[]).map((style) => ({
      ...style,
      coordinates: allCoords.filter((c) => c.style_id === style.id),
      combos: allCombos.filter((c) => c.style_id === style.id),
    })),
  };
}
