import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { JobsScreen } from "@/components/hr/recruitment/jobs-screen";
import { listDepartmentOptions, listDesignationOptions, listJobs, recruitmentViewer } from "@/lib/hr/recruitment-service";

export const metadata = { title: "Job Openings" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [rows, departments, designations, viewer, canCreate, canDelete] = await Promise.all([
    listJobs(),
    listDepartmentOptions(),
    listDesignationOptions(),
    recruitmentViewer(),
    can("hr_payroll", "create"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Job Openings"
        description="Vacancies in this unit. Candidates can be added while a job is Open; it fills itself when enough have joined."
      />
      <Suspense>
        <JobsScreen
          rows={rows}
          departments={departments}
          designations={designations}
          canCreate={canCreate && viewer.canEdit}
          canEdit={viewer.canEdit}
          canDelete={canDelete && viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
