import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ProcessOrder,
  ProcessOrderLine,
  ProcessMaterialIssue,
  ProcessMaterialReceipt,
} from "./process-types";

export type ProcWithVendor = ProcessOrder & { vendor_name: string | null };
export type ProcWithDetails = ProcWithVendor & { lines: ProcessOrderLine[] };

export async function listProcessOrders(): Promise<ProcWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("process_orders")
    .select("*, vendors(name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const vendor = row.vendors as { name: string } | null;
    const { vendors: _v, ...rest } = row;
    void _v;
    return {
      ...(rest as unknown as ProcessOrder),
      vendor_name: vendor?.name ?? null,
    };
  });
}

export async function getProcessOrder(
  id: string,
): Promise<ProcWithDetails | null> {
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("process_orders")
    .select("*, vendors(name)")
    .eq("id", id)
    .maybeSingle();
  if (!order) return null;

  const { data: lines } = await supabase
    .from("process_order_lines")
    .select("*")
    .eq("process_order_id", id)
    .order("sort_order");

  const row = order as Record<string, unknown>;
  const vendor = row.vendors as { name: string } | null;
  const { vendors: _v, ...rest } = row;
  void _v;

  return {
    ...(rest as unknown as ProcessOrder),
    vendor_name: vendor?.name ?? null,
    lines: (lines ?? []) as ProcessOrderLine[],
  };
}

export async function listProcessIssues(
  processOrderId?: string,
): Promise<ProcessMaterialIssue[]> {
  const supabase = await createClient();
  let query = supabase
    .from("process_material_issues")
    .select("*")
    .order("created_at", { ascending: false });

  if (processOrderId) {
    query = query.eq("process_order_id", processOrderId);
  }

  const { data } = await query;
  return (data ?? []) as ProcessMaterialIssue[];
}

export async function listProcessReceipts(
  processOrderId?: string,
): Promise<ProcessMaterialReceipt[]> {
  const supabase = await createClient();
  let query = supabase
    .from("process_material_receipts")
    .select("*")
    .order("created_at", { ascending: false });

  if (processOrderId) {
    query = query.eq("process_order_id", processOrderId);
  }

  const { data } = await query;
  return (data ?? []) as ProcessMaterialReceipt[];
}
