import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  FabricBom,
  FabricBomComponent,
  FabricBomProcess,
  MaterialBom,
  MaterialBomItem,
} from "@/lib/planning/types";
import type { Uom, Item } from "@/lib/masters/types";

// ---------- shared types ----------

export type OrderHeader = {
  id: string;
  order_number: string | null;
  order_qty: number;
  ship_date: string | null;
  buyers: { name: string } | null;
};

export type OrderWithBomStatus = OrderHeader & {
  fabric_bom: Pick<FabricBom, "id" | "status"> | null;
  material_bom: Pick<MaterialBom, "id" | "status"> | null;
};

// ---------- list ----------

export async function getOrdersWithBomStatus(): Promise<OrderWithBomStatus[]> {
  const supabase = await createClient();

  const [{ data: orders }, { data: fabricBoms }, { data: materialBoms }] =
    await Promise.all([
      supabase
        .from("sales_orders")
        .select("id, order_number, order_qty, ship_date, buyers(name)")
        .order("created_at", { ascending: false }),
      supabase.from("fabric_boms").select("id, sales_order_id, status"),
      supabase.from("material_boms").select("id, sales_order_id, status"),
    ]);

  const fabricMap = new Map(
    (fabricBoms ?? []).map((b) => [
      b.sales_order_id as string,
      { id: b.id as string, status: b.status as FabricBom["status"] },
    ]),
  );
  const materialMap = new Map(
    (materialBoms ?? []).map((b) => [
      b.sales_order_id as string,
      { id: b.id as string, status: b.status as MaterialBom["status"] },
    ]),
  );

  return ((orders ?? []) as unknown as OrderHeader[]).map((o) => ({
    ...o,
    fabric_bom: fabricMap.get(o.id) ?? null,
    material_bom: materialMap.get(o.id) ?? null,
  }));
}

// ---------- order header ----------

export async function getOrderHeader(
  orderId: string,
): Promise<OrderHeader | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, order_qty, ship_date, buyers(name)")
    .eq("id", orderId)
    .single();
  return (data ?? null) as unknown as OrderHeader | null;
}

// ---------- fabric bom ----------

export async function getFabricBom(orderId: string): Promise<{
  bom: FabricBom | null;
  components: FabricBomComponent[];
  processes: FabricBomProcess[];
}> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("fabric_boms")
    .select("*")
    .eq("sales_order_id", orderId)
    .maybeSingle();

  if (!bom) {
    return { bom: null, components: [], processes: [] };
  }

  const [{ data: components }, { data: processes }] = await Promise.all([
    supabase
      .from("fabric_bom_components")
      .select("*")
      .eq("fabric_bom_id", bom.id)
      .order("sort_order"),
    supabase
      .from("fabric_bom_processes")
      .select("*")
      .eq("fabric_bom_id", bom.id)
      .order("sequence"),
  ]);

  return {
    bom: bom as unknown as FabricBom,
    components: (components ?? []) as unknown as FabricBomComponent[],
    processes: (processes ?? []) as unknown as FabricBomProcess[],
  };
}

// ---------- material bom ----------

export async function getMaterialBom(orderId: string): Promise<{
  bom: MaterialBom | null;
  items: MaterialBomItem[];
}> {
  const supabase = await createClient();

  const { data: bom } = await supabase
    .from("material_boms")
    .select("*")
    .eq("sales_order_id", orderId)
    .maybeSingle();

  if (!bom) {
    return { bom: null, items: [] };
  }

  const { data: items } = await supabase
    .from("material_bom_items")
    .select("*")
    .eq("material_bom_id", bom.id)
    .order("sort_order");

  return {
    bom: bom as unknown as MaterialBom,
    items: (items ?? []) as unknown as MaterialBomItem[],
  };
}

// ---------- masters ----------

export async function getUoms(): Promise<Uom[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as unknown as Uom[];
}

export async function getItems(): Promise<Item[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name, category, uom_id, is_active")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as unknown as Item[];
}
