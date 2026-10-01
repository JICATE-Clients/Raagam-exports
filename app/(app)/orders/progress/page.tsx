import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";
import { loadOrderProgress } from "@/lib/orders/progress/service";
import { ProgressScreen } from "./progress-screen";

/**
 * Orders ▸ Order Management ▸ Order Progress — every live RE, from Order Entry
 * to shipment, and whether it will make its delivery date
 * (doc/order/digitalisation-plan.md §1).
 *
 * The rows are derived on read (`loadOrderProgress` → `buildProgress`, the one
 * risk rule the nightly alert also uses); this page only loads them. The
 * screen — Overview charts and the Orders list — is the client half.
 *
 * `?open=<RE>` (the risk alert's link) opens that order in the Orders view.
 */
export const metadata = { title: "Order Progress" };

export default async function OrderProgressPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requirePermission("orders", "view");
  const sp = await searchParams;
  const now = today();
  const rows = await loadOrderProgress(await createClient(), now);
  return <ProgressScreen rows={rows} today={now} openId={sp.open ?? null} />;
}
