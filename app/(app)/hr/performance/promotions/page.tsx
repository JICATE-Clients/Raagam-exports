import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { PromotionsScreen } from "@/components/hr/performance/promotions-screen";
import {
  listApprovedReviews,
  listDesignationOptions,
  listPeopleRoles,
  listPerformancePeople,
  listPromotions,
  performanceViewer,
} from "@/lib/hr/performance-service";

export const metadata = { title: "Promotions" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await performanceViewer();
  const [rows, people, roles, designations, reviews] = await Promise.all([
    listPromotions(),
    viewer.canEdit ? listPerformancePeople(viewer) : Promise.resolve([]),
    viewer.canEdit ? listPeopleRoles() : Promise.resolve({}),
    listDesignationOptions(),
    listApprovedReviews(),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Promotions"
        description="HR raises a promotion and it goes to the approver. Approving it sets the person's new designation."
      />
      <Suspense>
        <PromotionsScreen
          rows={rows}
          people={people}
          roles={roles}
          designations={designations}
          reviews={reviews}
          canEdit={viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
