import { GarmentOrderScreen } from "../_garment-order/garment-order-screen";
import { loadGarmentOrderProps } from "../_garment-order/loader";

/**
 * THE ENTRY DOOR — Order Entry ▸ Garment Order. Where a garment order is
 * raised: `createAmendment` inserts a new `sales_orders` row and mints its
 * SC No.
 *
 * This route was the legacy 14-step hub until 2026-08-13 (a page of ten
 * borrowed cards, hidden from the sidebar since 08-10, and retired with the
 * rest of the cross-listing). Its name is the one operators have used for this
 * screen for years, which is why the entry door took it rather than inventing
 * a third spelling — `/orders/garment-order` singular beside it would have been
 * one character from the old hub, a pairing the registry had already rejected
 * in writing.
 *
 * THE COMPONENT MOVED OUT OF `amendments/` ON 2026-08-31 (client: "the order
 * entry child name routing is in amendment name, which will make confusion in
 * future"). It had stayed there on the argument that moving it "buys nothing an
 * operator can see" — true, and beside the point: the cost was to the next
 * READER, who found the screen that RAISES an order filed under the word for
 * changing one. The routes were corrected on 08-13 and the folder was the half
 * left behind.
 *
 * It lives in `_garment-order/` — underscore-prefixed, so Next.js excludes it
 * from routing. That matters: the screen answers BOTH doors, so putting it
 * inside either route folder would recreate the same confusion mirrored, with
 * the amend route importing from `garment-orders/`. A shared thing belongs in a
 * folder that is not a route at all. It stays under `app/(app)` so
 * `scripts/audit_layout.py` keeps scanning it.
 */
export default async function GarmentOrderEntryPage() {
  const props = await loadGarmentOrderProps();
  return <GarmentOrderScreen {...props} />;
}
