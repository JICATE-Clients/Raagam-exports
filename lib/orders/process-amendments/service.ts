import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GarmentProcessAmendment } from "./types";

/** Buyer option for the Customer picker. */
export type BuyerRow = { id: string; code: string | null; name: string };
/** Sales-order option for the SC No picker (buyer_id drives Customer auto-fill). */
export type OrderRow = {
  id: string;
  order_number: string | null;
  buyer_id: string | null;
};
/** Style option (Style Ref No picker) + its display Style / Article No. */
export type StyleRow = {
  id: string;
  code: string | null;
  style_name: string | null;
  article_no: string | null;
};

export async function getProcessAmendments(): Promise<GarmentProcessAmendment[]> {
  const s = await createClient();
  const { data } = await s
    .from("garment_process_amendment_docs")
    .select(
      "*, customer:buyers(id, name), sales_order:sales_orders(id, order_number), " +
        "lines:garment_process_amendment_lines(*)",
    )
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as GarmentProcessAmendment[]).map((d) => ({
    ...d,
    lines: [...(d.lines ?? [])].sort((a, b) => a.sno - b.sno),
  }));
}

export type GpaFormData = {
  buyers: BuyerRow[];
  orders: OrderRow[];
  styles: StyleRow[];
};

export async function getGpaFormData(): Promise<GpaFormData> {
  const s = await createClient();
  const [buyerRes, orderRes, styleRes] = await Promise.all([
    s.from("buyers").select("id, code, name").order("name"),
    s
      .from("sales_orders")
      .select("id, order_number, buyer_id")
      .not("status", "in", "(cancelled)")
      .order("created_at", { ascending: false }),
    s
      .from("garment_styles")
      .select("id, code, style_name, article_no")
      .order("created_at", { ascending: false }),
  ]);
  return {
    buyers: (buyerRes.data ?? []) as BuyerRow[],
    orders: (orderRes.data ?? []) as OrderRow[],
    styles: (styleRes.data ?? []) as StyleRow[],
  };
}
