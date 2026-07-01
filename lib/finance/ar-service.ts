import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  receivableOutstandingFc,
  forexToInr,
  summariseAging,
} from "@/lib/finance/calc";
import type { Receivable, ReceivableReceipt } from "@/lib/finance/types";
import type { AgingBucket } from "@/lib/finance/calc";

export type ReceivableWithBuyer = Receivable & {
  buyers: { id: string; name: string; currency_code: string | null } | null;
  shipments: { id: string; code: string | null } | null;
};

export type ReceivableDetail = ReceivableWithBuyer & {
  receivable_receipts: ReceivableReceipt[];
};

export async function listReceivables(): Promise<ReceivableWithBuyer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("receivables")
    .select("*, buyers(id, name, currency_code), shipments(id, code)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ReceivableWithBuyer[];
}

export async function getReceivable(id: string): Promise<ReceivableDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("receivables")
    .select(
      "*, buyers(id, name, currency_code), shipments(id, code), receivable_receipts(*)",
    )
    .eq("id", id)
    .single();
  return (data ?? null) as unknown as ReceivableDetail | null;
}

export async function getBuyers(): Promise<
  { id: string; name: string; currency_code: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("buyers")
    .select("id, name, currency_code")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as { id: string; name: string; currency_code: string | null }[];
}

export async function getShipmentsForPicker(): Promise<
  { id: string; code: string | null; buyer_id: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shipments")
    .select("id, code, buyer_id")
    .in("status", ["shipped", "delivered", "closed"])
    .order("created_at", { ascending: false });
  return (data ?? []) as { id: string; code: string | null; buyer_id: string | null }[];
}

export async function getCurrencies(): Promise<{ code: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, name")
    .eq("is_active", true)
    .in("code", ["GBP", "EUR"])
    .order("code");
  if (data && data.length > 0) return data;
  // Fallback when currencies table is not seeded
  return [
    { code: "EUR", name: "Euro" },
    { code: "GBP", name: "British Pound" },
  ];
}

/** Aging summary over all open/overdue/partial receivables (outstanding_fc × invoice rate → INR). */
export async function getReceivableAging(): Promise<Record<AgingBucket, number>> {
  const all = await listReceivables();
  const active = all.filter(
    (r) => r.status !== "received" && r.status !== "cancelled",
  );
  const items = active.map((r) => ({
    dueDate: r.due_date,
    outstanding: forexToInr(receivableOutstandingFc(r), r.exchange_rate),
  }));
  return summariseAging(items);
}
