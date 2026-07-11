import { requirePermission, can } from "@/lib/auth/server";
import {
  listSalesPdRequests,
  getOpportunities,
  listAllStyles,
  getUoms,
} from "@/lib/sales/service";
import { PdRequestsClient } from "./pd-requests-client";

export default async function SalesPdRequestsPage() {
  await requirePermission("sales", "view");

  const [requests, opportunities, styles, uoms, canCreate, canEdit] =
    await Promise.all([
      listSalesPdRequests(),
      getOpportunities(),
      listAllStyles(),
      getUoms(),
      can("sales", "create"),
      can("sales", "edit"),
    ]);

  return (
    <PdRequestsClient
      requests={requests}
      opportunities={opportunities}
      styles={styles}
      uoms={uoms}
      perms={{ canCreate, canEdit }}
    />
  );
}
