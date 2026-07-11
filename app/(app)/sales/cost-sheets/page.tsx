import { requirePermission, can } from "@/lib/auth/server";
import {
  listAllCostSheetsForRegister,
  getOpportunities,
  listAllStyles,
} from "@/lib/sales/service";
import { PrepareCostSheetClient } from "./prepare-cost-sheet-client";

export default async function SalesCostSheetsPage() {
  await requirePermission("sales", "view");

  const [costSheets, opportunities, styles, canCreate, canEdit, canApprove] =
    await Promise.all([
      listAllCostSheetsForRegister(),
      getOpportunities(),
      listAllStyles(),
      can("sales", "create"),
      can("sales", "edit"),
      can("sales", "approve"),
    ]);

  return (
    <PrepareCostSheetClient
      costSheets={costSheets}
      opportunities={opportunities}
      styles={styles}
      perms={{ canCreate, canEdit, canApprove }}
    />
  );
}
