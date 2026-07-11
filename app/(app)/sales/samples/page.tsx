import { requirePermission, can } from "@/lib/auth/server";
import {
  listAllSamplesForRegister,
  getOpportunities,
  listAllStyles,
  getUoms,
} from "@/lib/sales/service";
import { SamplesClient } from "./samples-client";

export default async function SalesSamplesPage() {
  await requirePermission("sales", "view");

  const [samples, opportunities, styles, uoms, canCreate, canEdit, canDelete] =
    await Promise.all([
      listAllSamplesForRegister(),
      getOpportunities(),
      listAllStyles(),
      getUoms(),
      can("sales", "create"),
      can("sales", "edit"),
      can("sales", "delete"),
    ]);

  return (
    <SamplesClient
      samples={samples}
      opportunities={opportunities}
      styles={styles}
      uoms={uoms}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
