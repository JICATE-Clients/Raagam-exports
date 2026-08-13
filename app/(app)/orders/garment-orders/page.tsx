import { AmendmentScreen } from "../amendments/amendment-screen";
import { loadGarmentOrderProps } from "../amendments/loader";

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
 * The COMPONENT deliberately still lives under `amendments/`. Moving 5,500
 * lines buys nothing an operator can see, and `scripts/audit_layout.py` keys
 * three checks on that file's path. The folder name is not the route.
 */
export default async function GarmentOrderEntryPage() {
  const props = await loadGarmentOrderProps();
  return <AmendmentScreen {...props} />;
}
