import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { CasesScreen } from "@/components/hr/conduct/cases-screen";
import { conductViewer, listCases, listConductPeople, listMemos } from "@/lib/hr/conduct-service";

export const metadata = { title: "Disciplinary Cases" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await conductViewer();
  const [rows, memos, people] = await Promise.all([
    viewer.myStaffId ? Promise.resolve([]) : listCases(),
    viewer.canEdit ? listMemos() : Promise.resolve([]),
    viewer.canEdit ? listConductPeople(viewer) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Disciplinary Cases"
        description="A case moves Initiated → Enquiry → Hearing → Decision. HR proposes the decision and the MD or an HR Manager approves it; an approved termination opens the person's exit on Team Lifecycle ▸ Exits."
      />
      <Suspense>
        <CasesScreen rows={rows} memos={memos} people={people} canEdit={viewer.canEdit} />
      </Suspense>
    </div>
  );
}
