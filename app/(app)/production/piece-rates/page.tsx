import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listPieceRates, getContractors, getWorkTypeOptions } from "@/lib/production/extras-service";
import { PieceRatesClient } from "./piece-rates-client";

export default async function PieceRatesPage() {
  await requirePermission("production", "view");
  const [rows, contractors, workTypes, canCreate, canEdit, canApprove, canDelete, canExport] = await Promise.all([
    listPieceRates(),
    getContractors(),
    getWorkTypeOptions(),
    can("production", "create"),
    can("production", "edit"),
    can("production", "approve"),
    can("production", "delete"),
    can("production", "export"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Contractor Piece Rates"
        description="Per-operation piece rates for contractors; submit for approval before use."
      />
      <PieceRatesClient
        rows={rows}
        contractors={contractors}
        workTypes={workTypes}
        canCreate={canCreate}
        canEdit={canEdit}
        canApprove={canApprove}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
