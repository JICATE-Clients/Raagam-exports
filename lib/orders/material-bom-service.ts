import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BomStatus } from "@/lib/planning/types";

/**
 * Accepted (confirmed / active) sales orders for the legacy "Prepare material
 * BOM for accepted orders" selector. Reuses the existing Planning `material_boms`
 * table for status — the actual BOM is prepared in the Planning order workspace
 * (`/planning/orders/[id]`), so this screen is only the accepted-order picker.
 * Note: material_bom status only shows for users who can read `material_boms`
 * (planning RLS); the "Prepare" action opens the Planning editor.
 */
export type AcceptedOrderRow = {
  id: string;
  order_number: string | null;
  created_at: string;
  ship_date: string | null;
  order_qty: number;
  status: string;
  buyer_name: string | null;
  material_bom_status: BomStatus | null;
};

export async function getAcceptedOrdersForBom(): Promise<AcceptedOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select(
      "id, order_number, created_at, ship_date, order_qty, status, " +
        "buyers(name), material_boms(status)",
    )
    .not("status", "in", "(cancelled,closed)")
    .order("created_at", { ascending: false });

  return (
    (data ?? []) as unknown as {
      id: string;
      order_number: string | null;
      created_at: string;
      ship_date: string | null;
      order_qty: number;
      status: string;
      buyers: { name: string } | null;
      material_boms: { status: BomStatus }[] | null;
    }[]
  ).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    created_at: o.created_at,
    ship_date: o.ship_date,
    order_qty: o.order_qty,
    status: o.status,
    buyer_name: o.buyers?.name ?? null,
    material_bom_status: o.material_boms?.[0]?.status ?? null,
  }));
}
