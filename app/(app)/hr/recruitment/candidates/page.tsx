import { Suspense } from "react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { CandidatesScreen } from "@/components/hr/recruitment/candidates-screen";
import {
  listCandidates,
  listDesignationOptions,
  listJobs,
  listRecruitmentPeople,
  recruitmentViewer,
} from "@/lib/hr/recruitment-service";
import { listTemplates } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Candidates" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await recruitmentViewer();
  const [rows, jobs, designations, people, templates, canCreate, canDelete] = await Promise.all([
    listCandidates(),
    listJobs(),
    listDesignationOptions(),
    listRecruitmentPeople(viewer),
    listTemplates(),
    can("hr_payroll", "create"),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Candidates"
        description="Every applicant from first contact to joining — shortlist, interview, send the offer for approval, then mark them joined."
      />
      <Suspense>
        <CandidatesScreen
          rows={rows}
          jobs={jobs}
          designations={designations}
          people={viewer.myStaffId ? [] : people}
          templates={templates}
          canCreate={canCreate && viewer.canEdit}
          canEdit={viewer.canEdit}
          canDelete={canDelete && viewer.canEdit}
        />
      </Suspense>
    </div>
  );
}
