import { requirePermission, can } from "@/lib/auth/server";
import { listInternalWorkOrders } from "@/lib/orders/internal-work-orders/service";
import { previewIwoNumber } from "@/lib/orders/internal-work-orders/actions";
import { today } from "@/lib/calendar";
import { IwoScreen } from "./iwo-screen";

/**
 * Orders ▸ Internal Work Order — the list, with the editor as an OVERLAY mode
 * of it (`raagam-screen-layout`, the operator's rule 3). The header and its
 * For-shaped line grid are one document with one Save (client 2026-09-18,
 * screenshots 2936–2940); the old create-here, add-lines-on-another-page flow
 * is gone, and `[iwoId]` now redirects back here.
 */
export default async function InternalWorkOrdersPage() {
  await requirePermission("orders", "view");

  // No form data: the header's only picker (Reference) is typed since 0597.
  const [rows, canCreate, canEdit, canDelete, nextIwoNo] = await Promise.all([
    listInternalWorkOrders(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    // Today's next number, fetched with the page so a new work order's I.WO No
    // box is filled on its FIRST paint rather than blank until a round trip
    // lands (the Garment Order SC No box, client 2026-08-31).
    previewIwoNumber(today()),
  ]);

  return (
    <IwoScreen
      rows={rows}
      perms={{ canCreate, canEdit, canDelete }}
      nextIwoNo={nextIwoNo}
    />
  );
}
