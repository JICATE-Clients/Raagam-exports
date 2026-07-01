import { requirePermission } from "@/lib/auth/server";
import { can } from "@/lib/auth/server";
import { getSettings } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import SettingsClient from "./settings-client";

export default async function HrSettingsPage() {
  await requirePermission("hr_payroll", "view");

  const [settings, canEdit] = await Promise.all([
    getSettings(),
    can("hr_payroll", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll Settings"
        description="Configure OT multipliers, statutory deduction rates, and currency."
      />
      <SettingsClient settings={settings} canEdit={canEdit} />
    </div>
  );
}
