import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { MemosScreen } from "@/components/hr/conduct/memos-screen";
import { conductViewer, listConductPeople, listMemos } from "@/lib/hr/conduct-service";

export const metadata = { title: "Memos" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await conductViewer();
  const [rows, people] = await Promise.all([listMemos(), viewer.canEdit ? listConductPeople(viewer) : Promise.resolve([])]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Memos"
        description={
          viewer.myStaffId
            ? "Memos HR has issued to you. Acknowledge each one, or say why you disagree."
            : "HR issues a memo; the person acknowledges or disputes it — HR records it from the signed copy for workers — and HR closes it, saying whether it counts toward further action."
        }
      />
      {/* useOpenIntent reads the URL, so the screen sits in Suspense. */}
      <Suspense>
        <MemosScreen rows={rows} people={people} myStaffId={viewer.myStaffId} canEdit={viewer.canEdit} />
      </Suspense>
    </div>
  );
}
