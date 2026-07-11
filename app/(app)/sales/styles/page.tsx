import { requirePermission, can } from "@/lib/auth/server";
import { listAllStyles, getOpportunities, getUoms } from "@/lib/sales/service";
import { DefineStylesClient } from "./define-styles-client";

export default async function SalesStylesPage() {
  await requirePermission("sales", "view");

  const [styles, opportunities, uoms, canCreate, canEdit, canDelete] =
    await Promise.all([
      listAllStyles(),
      getOpportunities(),
      getUoms(),
      can("sales", "create"),
      can("sales", "edit"),
      can("sales", "delete"),
    ]);

  return (
    <DefineStylesClient
      styles={styles}
      opportunities={opportunities}
      uoms={uoms}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
