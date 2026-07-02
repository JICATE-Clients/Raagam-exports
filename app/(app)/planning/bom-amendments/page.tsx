import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listBomAmendments,
  getBomPickerOptions,
} from "@/lib/planning/amendment-service";
import { BomAmendmentsClient } from "./bom-amendments-client";

export default async function BomAmendmentsPage() {
  await requirePermission("planning", "view");

  const [amendments, boms, canCreate, canEdit, canApprove] = await Promise.all([
    listBomAmendments(),
    getBomPickerOptions(),
    can("planning", "create"),
    can("planning", "edit"),
    can("planning", "approve"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="BOM Amendments"
        description="Formally record and approve a change to a fabric or material BOM."
      />
      <BomAmendmentsClient
        amendments={amendments}
        boms={boms}
        canCreate={canCreate}
        canEdit={canEdit}
        canApprove={canApprove}
      />
    </div>
  );
}
