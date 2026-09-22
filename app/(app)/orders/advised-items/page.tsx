import { requirePermission } from "@/lib/auth/server";
import { listAdvisedOrders } from "@/lib/orders/advised/service";
import { AdvisedRegister } from "./advised-register";

/**
 * Orders ▸ Advised Items — the register of Material BOM lines still "To be
 * advised", one row per order (RE No). See `advised-register.tsx`.
 */
export default async function AdvisedItemsPage() {
  await requirePermission("orders", "view");
  const rows = await listAdvisedOrders();
  return <AdvisedRegister rows={rows} />;
}
