import { GarmentOrderScreen } from "../_garment-order/garment-order-screen";
import { loadGarmentOrderProps } from "../_garment-order/loader";

/**
 * THE AMEND DOOR — Amendments ▸ Order Amendment.
 *
 * Same screen as `/orders/garment-orders`, in amend mode: it lists saved
 * garment orders and re-opens one, and it offers no way to create. That
 * matters more than the wording — `createAmendment` mints a brand-new
 * `sales_orders` row, so a create reachable from a door labelled "amendment"
 * is the exact confusion this split was made to end.
 *
 * The route kept its name deliberately. It is the one that was always honest
 * about amending; what was wrong was that ENTRY went through it too. Keeping it
 * means every existing link still lands somewhere sensible — the Approve
 * Amendment screen's "Details" column, `revalidatePath`, the count map and the
 * mobile section actions all point here and none of them had to move.
 */
export default async function OrderAmendmentsPage() {
  const props = await loadGarmentOrderProps();
  return <GarmentOrderScreen {...props} purpose="amend" />;
}
