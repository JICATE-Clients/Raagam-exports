import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { listManualCosts, loadProfitability } from "@/lib/orders/profitability/service";
import { OrderStory } from "./order-story";

/**
 * One order's Profit Check (doc/order/digitalisation-plan.md §3).
 *
 * Deliberately NOT under `/orders/[orderId]`: that folder is the per-order
 * report family `ORDER_REPORTS` governs (V_final capture during a revision),
 * and a statement of ACTUALS has nothing to freeze — what was bought and
 * shipped does not change when the order is being revised.
 */
export async function generateMetadata({ params }: { params: Promise<{ orderId: string }> }): Promise<Metadata> {
  // The workspace tab names itself from the title; without this it showed the
  // order's uuid (client screenshot 2026-10-01).
  const { orderId } = await params;
  const sb = await createClient();
  const { data } = await sb.from("sales_orders").select("order_number").eq("id", orderId).maybeSingle();
  return { title: `Profit Check · ${(data as { order_number?: string } | null)?.order_number ?? "Order"}` };
}

export default async function ProfitCheckOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePermission("orders", "view");
  const { orderId } = await params;
  const sb = await createClient();
  const [rows, manual, canEdit] = await Promise.all([
    loadProfitability(sb, { salesOrderId: orderId }),
    listManualCosts(sb, orderId),
    can("orders", "edit"),
  ]);
  const row = rows[0];
  if (!row) notFound();
  return <OrderStory row={row} manual={manual} canEdit={canEdit} />;
}
