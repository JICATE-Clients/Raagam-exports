import "server-only";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendments, getAmendmentFormData } from "@/lib/orders/amendments/service";

/**
 * Everything `AmendmentScreen` needs, fetched once and shared by BOTH its
 * routes.
 *
 * The screen answers two doors — `/orders/garment-orders` raises a garment
 * order, `/orders/amendments` amends a saved one — and they differ by a single
 * `mode` prop. This exists so that is ALL they differ by: an eight-way
 * `Promise.all` copied into a second page is a second permission list, and the
 * copy that drifts is the one that quietly grants or refuses the wrong thing.
 *
 * `requirePermission` returns the AppUser, so the operator's home Unit costs no
 * extra query.
 */
export async function loadGarmentOrderProps() {
  const user = await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getAmendments(),
      getAmendmentFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return {
    rows,
    data,
    perms: { canCreate, canEdit, canDelete },
    defaultLocationId: user.defaultLocationId,
    masterPerms: { canCreate: mCreate, canEdit: mEdit },
  };
}
