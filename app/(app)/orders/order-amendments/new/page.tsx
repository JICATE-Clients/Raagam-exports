import { requirePermission } from "@/lib/auth/server";
import { listAmendableOrders } from "@/lib/orders/order-amendments/service";
import { RaiseAmendmentScreen } from "./raise-amendment-screen";

/**
 * Orders ▸ Order Amendments ▸ Raise Amendment — the door, as a page (user
 * 2026-09-22). `?order=<garment order id>` pre-picks the RE (the register's
 * Amend button, the order list's [Amend] row action).
 */
export default async function RaiseAmendmentPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  await requirePermission("orders", "edit");
  const [{ order }, orders] = await Promise.all([searchParams, listAmendableOrders()]);
  return <RaiseAmendmentScreen orders={orders} initialOrderId={order ?? null} />;
}
