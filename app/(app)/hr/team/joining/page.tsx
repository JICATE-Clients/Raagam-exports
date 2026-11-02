import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { JoiningScreen } from "@/components/hr/lifecycle/joining-screen";
import { lifecycleViewer, listLifecyclePeople, listOnboardings, listTemplates } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Joining Checklists" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await lifecycleViewer();
  const [rows, templates, people] = await Promise.all([listOnboardings(), listTemplates(), listLifecyclePeople(viewer)]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Joining Checklists"
        description="Every new joiner's checklist — documents, bank, PF / ESI, biometric, ID card, induction — ticked off step by step."
      />
      <Suspense>
        <JoiningScreen rows={rows} templates={templates} people={people} canEdit={viewer.canEdit} />
      </Suspense>
    </div>
  );
}
