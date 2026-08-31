import "server-only";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendments, getAmendmentFormData } from "@/lib/orders/amendments/service";
import { listMaterialBomStatus } from "@/lib/orders/material-bom-amendment/service";
import { previewOrderNumber } from "@/lib/orders/actions";

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

  const [rows, data, bomStatus, canCreate, canEdit, canDelete, mCreate, mEdit, initialOrderNo] =
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
      /**
       * THE RE No, FETCHED HERE SO THE BOX IS NEVER EMPTY (client 2026-08-31:
       * "why the RE number field taking to load the number — make it
       * immediately enabled in that field").
       *
       * It was a `useEffect` calling `previewOrderNumber` after mount, so the
       * field painted blank and filled in a round trip later — and TWO hops at
       * that, since the action re-checks `can("orders","create")` before its
       * RPC. On the screen where an order is raised, the first thing the
       * operator looks at is the number, and it was the last thing to arrive.
       *
       * IT COSTS NOTHING TO MOVE. This `Promise.all` already runs eight
       * requests in parallel and already holds the two inputs the preview needs
       * — the operator's home Unit (`user.defaultLocationId`, free from
       * `requirePermission`) and the date. So the number lands with the first
       * paint rather than after it, and the effect below it stays exactly as it
       * was: it re-runs when the operator CHANGES Unit or Date, which is what
       * it was always for.
       *
       * `null` FOR THE DATE, deliberately: the RPC then buckets on the
       * database's own `current_date`. The client's effect passes the BROWSER's
       * local date, and the two can differ for five and a half hours a day on a
       * UTC+5:30 business — but only across a fiscal-year boundary would that
       * change the number, and the insert trigger is the sole authority either
       * way. A preview that is right 364 days a year and re-confirmed on mount
       * beats an empty box every day of the year.
       */
      previewOrderNumber(user.defaultLocationId, null),
    ]);

  return {
    rows,
    data,
    bomStatus,
    perms: { canCreate, canEdit, canDelete },
    defaultLocationId: user.defaultLocationId,
    initialOrderNo,
    masterPerms: { canCreate: mCreate, canEdit: mEdit },
  };
}
