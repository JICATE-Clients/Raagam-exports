import { redirect } from "next/navigation";

/**
 * PURCHASE ORDERS LEFT THE MENU (user 2026-11-03: "purchase order remove it", the row
 * under Raise PO). A PO is raised on Raise PO now, so the old list address lands there.
 * A PO's own page (`./[poId]`) and its print are untouched: PO Approval, Raise PO and
 * Indents open them, and they keep the "Purchase Orders" permission screen through
 * OFF_MENU_SCREENS in lib/permissions/screen-catalog.ts.
 */
export default function PurchaseOrdersMoved() {
  redirect("/purchase/requirement-po");
}
