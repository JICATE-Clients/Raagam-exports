import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { LifecycleSetupScreen } from "@/components/hr/lifecycle/setup-screen";
import { getLcSettings, lifecycleViewer, listExitCatalog, listRequiredDocs, listTemplates } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Lifecycle Setup" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [templates, required, exitSteps, settings, viewer, canDelete] = await Promise.all([
    listTemplates(),
    listRequiredDocs(),
    listExitCatalog(),
    getLcSettings(),
    lifecycleViewer(),
    can("hr_payroll", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Lifecycle Setup"
        description="Joining checklist templates, the documents everyone must hand in, exit steps, and the notice, retirement and gratuity numbers."
      />
      <LifecycleSetupScreen
        templates={templates}
        required={required}
        exitSteps={exitSteps}
        settings={settings}
        canEdit={viewer.canEdit}
        canDelete={canDelete && viewer.canEdit}
      />
    </div>
  );
}
