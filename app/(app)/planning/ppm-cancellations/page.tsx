import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listPpmCancellations,
  getIssuedPpmsForPicker,
} from "@/lib/planning/extras-service";
import { PpmCancellationsClient } from "./ppm-cancellations-client";

export default async function PpmCancellationsPage() {
  await requirePermission("planning", "view");
  const [rows, ppms, canCreate, canApprove, canDelete] = await Promise.all([
    listPpmCancellations(),
    getIssuedPpmsForPicker(),
    can("planning", "create"),
    can("planning", "approve"),
    can("planning", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Garmenting PPM Cancellation"
        description="Raise a reason-logged cancellation against an issued PPM; on approval the PPM is cancelled."
      />
      <PpmCancellationsClient
        rows={rows}
        ppms={ppms}
        canCreate={canCreate}
        canApprove={canApprove}
        canDelete={canDelete}
      />
    </div>
  );
}
