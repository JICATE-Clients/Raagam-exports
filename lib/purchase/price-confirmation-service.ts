import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  PriceConfirmation,
  PriceConfirmationItem,
} from "./price-confirmation-types";
import { withCreators } from "@/lib/created-by";

export type PcWithVendor = PriceConfirmation & { vendor_name: string | null };

export async function listPriceConfirmations(): Promise<PcWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_price_confirmations")
    .select("*, vendors(name)")
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as Record<string, unknown>[]).map((row) => {
    const vendor = row.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = row;
    void _v;
    return {
      ...(rest as unknown as PriceConfirmation),
      vendor_name: vendor?.name ?? null,
    };
  }));
}

export async function getPriceConfirmation(
  id: string,
): Promise<(PcWithVendor & { items: PriceConfirmationItem[] }) | null> {
  const supabase = await createClient();

  const { data: pc } = await supabase
    .from("purchase_price_confirmations")
    .select("*, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  if (!pc) return null;

  const { data: items } = await supabase
    .from("purchase_price_confirmation_items")
    .select("*")
    .eq("price_confirmation_id", id)
    .order("sort_order");

  const pcRow = pc as Record<string, unknown>;
  const vendor = pcRow.vendors as { name: string } | null;
  const { vendors: _v, ...pcRest } = pcRow;
  void _v;

  return {
    ...(pcRest as unknown as PriceConfirmation),
    vendor_name: vendor?.name ?? null,
    items: (items ?? []) as PriceConfirmationItem[],
  };
}
