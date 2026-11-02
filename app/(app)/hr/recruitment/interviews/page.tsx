import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { InterviewsScreen } from "@/components/hr/recruitment/interviews-screen";
import { listCandidates, listInterviews, listRecruitmentPeople, recruitmentViewer } from "@/lib/hr/recruitment-service";

export const metadata = { title: "Interviews" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await recruitmentViewer();
  const [rows, candidates, people] = await Promise.all([listInterviews(), listCandidates(), listRecruitmentPeople(viewer)]);
  const schedulable = candidates.filter((c) => ["new", "shortlisted", "interview"].includes(c.status) && !c.next_interview_at);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Interviews"
        description="Interview rounds, who sits on each panel, and their marks. A panel member enters their own marks; HR can enter them from the paper sheet."
      />
      <Suspense>
        <InterviewsScreen
          rows={rows}
          schedulable={schedulable}
          staff={people.filter((p) => p.kind === "staff")}
          myStaffId={viewer.myStaffId}
          canEdit={viewer.canEdit}
          now={new Date().toISOString()}
        />
      </Suspense>
    </div>
  );
}
