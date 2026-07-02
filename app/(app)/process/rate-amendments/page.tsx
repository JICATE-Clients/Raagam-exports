import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getRateAmendments,
  getConfirmedRfqs,
} from "@/lib/process/rate-amendments/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { RateAmendmentsClient } from "./rate-amendments-client";

export default async function RateAmendmentsPage() {
  await requirePermission("process_planning", "view");

  const [amendments, confirmedRfqs, canCreate, canApprove] = await Promise.all([
    getRateAmendments(),
    getConfirmedRfqs(),
    can("process_planning", "create"),
    can("process_planning", "approve"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process Rate Amendments"
        description="Amend a confirmed process order's rate — applied on approval"
        actions={
          <Link href="/process">
            <Button variant="outline" size="sm">
              ← Process Planning
            </Button>
          </Link>
        }
      />

      <RateAmendmentsClient
        amendments={amendments}
        confirmedRfqs={confirmedRfqs}
        canCreate={canCreate}
        canApprove={canApprove}
      />
    </div>
  );
}
