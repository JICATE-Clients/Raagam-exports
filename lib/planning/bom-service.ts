import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  MaterialBom,
  MaterialBomProduct,
  MaterialBomProcessSequence,
  MaterialBomProcessStage,
  FabricBom,
  GarmentBom,
  AccessoryBom,
  BomShortage,
  BomShortageItem,
  BomTransfer,
  BomTransferItem,
} from "./bom-types";
import { withCreators } from "@/lib/created-by";

// ============================================================================
// Material BOM (FrmProd_BOM)
// ============================================================================

export type MaterialBomRow = MaterialBom & {
  customer_name: string | null;
  order_code: string | null;
};

export async function listMaterialBoms(): Promise<MaterialBomRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_boms")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const order = row.sales_orders as { code: string } | null;
    const { customers: _c, sales_orders: _o, ...rest } = row;
    void _c;
    void _o;
    return {
      ...(rest as unknown as MaterialBom),
      customer_name: customer?.name ?? null,
      order_code: order?.code ?? null,
    };
  }));
}

export async function getMaterialBom(id: string): Promise<
  | (MaterialBomRow & {
      products: MaterialBomProduct[];
      yarn_sequences: (MaterialBomProcessSequence & { stages: MaterialBomProcessStage[] })[];
      fabric_sequences: (MaterialBomProcessSequence & { stages: MaterialBomProcessStage[] })[];
    })
  | null
> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("material_boms")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!bom) return null;

  const bomRow = bom as Record<string, unknown>;
  const customer = bomRow.customers as { name: string } | null;
  const order = bomRow.sales_orders as { code: string } | null;
  const { customers: _c, sales_orders: _o, ...bomRest } = bomRow;
  void _c;
  void _o;

  const [{ data: products }, { data: sequences }] = await Promise.all([
    supabase
      .from("material_bom_products")
      .select("*")
      .eq("material_bom_id", id)
      .order("sort_order"),
    supabase
      .from("material_bom_process_sequences")
      .select("*, material_bom_process_stages(*)")
      .eq("material_bom_id", id)
      .order("sort_order"),
  ]);

  const allSeqs = ((sequences ?? []) as Record<string, unknown>[]).map((s) => {
    const stages = (s.material_bom_process_stages ?? []) as MaterialBomProcessStage[];
    const { material_bom_process_stages: _st, ...seqRest } = s;
    void _st;
    return {
      ...(seqRest as unknown as MaterialBomProcessSequence),
      stages: stages.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  return {
    ...(bomRest as unknown as MaterialBom),
    customer_name: customer?.name ?? null,
    order_code: order?.code ?? null,
    products: (products ?? []) as MaterialBomProduct[],
    yarn_sequences: allSeqs.filter((s) => s.process_type === "yarn"),
    fabric_sequences: allSeqs.filter((s) => s.process_type === "fabric"),
  };
}

// ============================================================================
// Fabric BOM (FrmStyle_Fab_BOM)
// ============================================================================

export type FabricBomRow = FabricBom & {
  customer_name: string | null;
  style_code: string | null;
};

export async function listFabricBoms(): Promise<FabricBomRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fabric_boms")
    .select("*, customers(name), styles(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const style = row.styles as { code: string } | null;
    const { customers: _c, styles: _s, ...rest } = row;
    void _c;
    void _s;
    return {
      ...(rest as unknown as FabricBom),
      customer_name: customer?.name ?? null,
      style_code: style?.code ?? null,
    };
  }));
}

// ============================================================================
// Garment BOM (FrmStyl_Gar_BOM)
// ============================================================================

export type GarmentBomRow = GarmentBom & {
  customer_name: string | null;
  style_code: string | null;
};

export async function listGarmentBoms(): Promise<GarmentBomRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garment_boms")
    .select("*, customers(name), styles(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const style = row.styles as { code: string } | null;
    const { customers: _c, styles: _s, ...rest } = row;
    void _c;
    void _s;
    return {
      ...(rest as unknown as GarmentBom),
      customer_name: customer?.name ?? null,
      style_code: style?.code ?? null,
    };
  }));
}

// ============================================================================
// Accessory BOM (FrmSC_Acc_BOM + FrmIWO_Acc_BOM)
// ============================================================================

export type AccessoryBomRow = AccessoryBom & {
  customer_name: string | null;
  style_code: string | null;
};

export async function listAccessoryBoms(): Promise<AccessoryBomRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("accessory_boms")
    .select("*, customers(name), styles(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const style = row.styles as { code: string } | null;
    const { customers: _c, styles: _s, ...rest } = row;
    void _c;
    void _s;
    return {
      ...(rest as unknown as AccessoryBom),
      customer_name: customer?.name ?? null,
      style_code: style?.code ?? null,
    };
  }));
}

// ============================================================================
// BOM Shortage (FrmBOM_Shortage)
// ============================================================================

export type BomShortageRow = BomShortage & {
  customer_name: string | null;
  order_code: string | null;
};

export async function listBomShortages(): Promise<BomShortageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bom_shortages")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const order = row.sales_orders as { code: string } | null;
    const { customers: _c, sales_orders: _o, ...rest } = row;
    void _c;
    void _o;
    return {
      ...(rest as unknown as BomShortage),
      customer_name: customer?.name ?? null,
      order_code: order?.code ?? null,
    };
  }));
}

export async function getBomShortage(
  id: string,
): Promise<(BomShortageRow & { items: (BomShortageItem & { sizes: unknown[] })[] }) | null> {
  const supabase = await createClient();

  const { data: shortage } = await supabase
    .from("bom_shortages")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!shortage) return null;

  const row = shortage as Record<string, unknown>;
  const customer = row.customers as { name: string } | null;
  const order = row.sales_orders as { code: string } | null;
  const { customers: _c, sales_orders: _o, ...rest } = row;
  void _c;
  void _o;

  const { data: items } = await supabase
    .from("bom_shortage_items")
    .select("*, bom_shortage_sizes(*)")
    .eq("shortage_id", id)
    .order("sort_order");

  return {
    ...(rest as unknown as BomShortage),
    customer_name: customer?.name ?? null,
    order_code: order?.code ?? null,
    items: ((items ?? []) as Record<string, unknown>[]).map((it) => {
      const sizes = (it.bom_shortage_sizes ?? []) as unknown[];
      const { bom_shortage_sizes: _s, ...itemRest } = it;
      void _s;
      return { ...(itemRest as unknown as BomShortageItem), sizes };
    }),
  };
}

// ============================================================================
// BOM Transfer (FrmBOMXfrs)
// ============================================================================

export type BomTransferRow = BomTransfer & {
  customer_name: string | null;
  order_code: string | null;
};

export async function listBomTransfers(): Promise<BomTransferRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bom_transfers")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const order = row.sales_orders as { code: string } | null;
    const { customers: _c, sales_orders: _o, ...rest } = row;
    void _c;
    void _o;
    return {
      ...(rest as unknown as BomTransfer),
      customer_name: customer?.name ?? null,
      order_code: order?.code ?? null,
    };
  }));
}

export async function getBomTransfer(
  id: string,
): Promise<(BomTransferRow & { items: (BomTransferItem & { sizes: unknown[] })[] }) | null> {
  const supabase = await createClient();

  const { data: transfer } = await supabase
    .from("bom_transfers")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!transfer) return null;

  const row = transfer as Record<string, unknown>;
  const customer = row.customers as { name: string } | null;
  const order = row.sales_orders as { code: string } | null;
  const { customers: _c, sales_orders: _o, ...rest } = row;
  void _c;
  void _o;

  const { data: items } = await supabase
    .from("bom_transfer_items")
    .select("*, bom_transfer_sizes(*)")
    .eq("transfer_id", id)
    .order("sort_order");

  return {
    ...(rest as unknown as BomTransfer),
    customer_name: customer?.name ?? null,
    order_code: order?.code ?? null,
    items: ((items ?? []) as Record<string, unknown>[]).map((it) => {
      const sizes = (it.bom_transfer_sizes ?? []) as unknown[];
      const { bom_transfer_sizes: _s, ...itemRest } = it;
      void _s;
      return { ...(itemRest as unknown as BomTransferItem), sizes };
    }),
  };
}
