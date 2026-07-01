import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Payable, PayablePayment } from "./types";

// ---------- derived types ----------

export type VendorForPicker = { id: string; name: string; code: string | null };
export type PoForPicker = { id: string; code: string | null; total_amount: number; vendor_id: string | null };
export type GrnForPicker = { id: string; code: string | null };

export type PayableWithVendor = Payable & {
  vendor_name: string | null;
};

export type PayableWithDetails = PayableWithVendor & {
  payments: PayablePayment[];
};

// ---------- vendors picker ----------

export async function getVendorsForPicker(): Promise<VendorForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as VendorForPicker[];
}

// ---------- PO + GRN pickers ----------

export async function getPosForPicker(): Promise<PoForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("id, code, total_amount, vendor_id")
    .in("status", ["approved", "partially_received", "received"])
    .order("created_at", { ascending: false });
  return (data ?? []) as PoForPicker[];
}

export async function getGrnsForPicker(): Promise<GrnForPicker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grns")
    .select("id, code")
    .order("created_at", { ascending: false });
  return (data ?? []) as GrnForPicker[];
}

/** Compute the GRN received value: Σ(accepted_qty × po_line unit_price). */
export async function computeGrnValue(grnId: string): Promise<number> {
  const supabase = await createClient();

  // fetch GRN line items with associated PO line unit prices
  const { data: grnLines } = await supabase
    .from("grn_line_items")
    .select("accepted_qty, po_line_item_id")
    .eq("grn_id", grnId);

  if (!grnLines || grnLines.length === 0) return 0;

  const lineItems = grnLines as { accepted_qty: number; po_line_item_id: string | null }[];
  const poLineIds = lineItems
    .map((l) => l.po_line_item_id)
    .filter((id): id is string => id != null);

  if (poLineIds.length === 0) return 0;

  const { data: poLines } = await supabase
    .from("po_line_items")
    .select("id, unit_price")
    .in("id", poLineIds);

  const priceMap = Object.fromEntries(
    ((poLines ?? []) as { id: string; unit_price: number }[]).map((l) => [l.id, l.unit_price]),
  );

  return lineItems.reduce((sum, l) => {
    const price = l.po_line_item_id ? (priceMap[l.po_line_item_id] ?? 0) : 0;
    return sum + (l.accepted_qty ?? 0) * price;
  }, 0);
}

// ---------- payables ----------

export async function listPayables(): Promise<PayableWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payables")
    .select("*, vendors(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const vendor = row.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = row;
    void _v;
    return {
      ...(rest as unknown as Payable),
      vendor_name: vendor?.name ?? null,
    };
  });
}

export async function getPayable(id: string): Promise<PayableWithDetails | null> {
  const supabase = await createClient();

  const { data: payable } = await supabase
    .from("payables")
    .select("*, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  if (!payable) return null;

  const { data: payments } = await supabase
    .from("payable_payments")
    .select("*")
    .eq("payable_id", id)
    .order("payment_date", { ascending: false });

  const row = payable as Record<string, unknown>;
  const vendor = row.vendors as { name: string } | null;
  const { vendors: _v, ...rest } = row;
  void _v;

  return {
    ...(rest as unknown as Payable),
    vendor_name: vendor?.name ?? null,
    payments: (payments ?? []) as PayablePayment[],
  };
}
