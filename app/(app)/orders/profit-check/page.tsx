import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { loadProfitability } from "@/lib/orders/profitability/service";
import { BvaScreen } from "./bva-screen";

/**
 * Orders ▸ Order Management ▸ Order Profit Check — every order with an APPROVED
 * budget, the money planned beside the money really spent and shipped
 * (doc/order/digitalisation-plan.md §3). Named Order Profit Check by the user
 * (2026-10-01, chosen over "Profitability" and "Budget vs Actual"); the first
 * route, `/orders/profitability`, redirects here.
 */
export const metadata = { title: "Order Profit Check" };

export default async function ProfitCheckPage() {
  await requirePermission("orders", "view");
  const rows = await loadProfitability(await createClient());
  return <BvaScreen rows={rows} />;
}
