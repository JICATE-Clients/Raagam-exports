import "server-only";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendments, getAmendmentFormData } from "@/lib/orders/amendments/service";
import { listMaterialBomStatus } from "@/lib/orders/material-bom-amendment/service";

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

  const [rows, data, bomStatus, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getAmendments(),
      getAmendmentFormData(),
      // A SEPARATE call, deliberately not a new embed on `getAmendments()`.
      // That select already names 14 relationships and ONE unresolvable name
      // fails the whole query, so growing it would put the entire Garment Order
      // screen at risk to add a column. It reads `computed_basis_hash`, so no
      // BOM child rows are fetched to answer it.
      listMaterialBomStatus(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return {
    rows,
    data,
    bomStatus,
    perms: { canCreate, canEdit, canDelete },
    defaultLocationId: user.defaultLocationId,
    masterPerms: { canCreate: mCreate, canEdit: mEdit },
  };
}
