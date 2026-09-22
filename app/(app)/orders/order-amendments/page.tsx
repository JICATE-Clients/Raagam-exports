import { requirePermission, can } from "@/lib/auth/server";
import { listAmendableOrders, listAmendmentEntries } from "@/lib/orders/order-amendments/service";
import { AmendmentRegisterScreen } from "./register-screen";

/**
 * Orders ▸ Order Amendments — the register (doc/order/amedment.md §1).
 *
 * A standalone sidebar row (`kind: "link"` in `lib/nav/module-groups.ts`): the
 * register IS the sub-module, and the entry page beneath it is a `[entryId]`
 * route rather than a second sidebar row. The legacy `/orders/amendments`
 * (the amend door over `GarmentOrderScreen`) is unchanged and is where a row's
 * "Open order" lands, with `?open=<id>`.
 */
export default async function OrderAmendmentsPage() {
  await requirePermission("orders", "view");
  const [rows, orders, canEdit] = await Promise.all([
    listAmendmentEntries(),
    listAmendableOrders(),
    can("orders", "edit"),
  ]);
  return <AmendmentRegisterScreen rows={rows} orders={orders} perms={{ canEdit }} />;
}
