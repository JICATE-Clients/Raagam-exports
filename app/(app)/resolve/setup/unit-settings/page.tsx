import { PageHeader } from "@/components/ui/page-header";
import { UnitSettingsScreen } from "@/components/resolve/admin/unit-settings-screen";
import { requireRh } from "@/lib/resolve/auth";
import { getDeskUnitSettings, listDeskApproverIds } from "@/lib/resolve/desk-service";
import { getUnitSettings, listPeople } from "@/lib/resolve/service";

export default async function UnitSettingsPage() {
  await requireRh("admin");
  const [settings, people, desk, deskApproverIds] = await Promise.all([
    getUnitSettings(),
    listPeople(),
    getDeskUnitSettings(),
    // Only feeds an advisory warning — a failed read hides the warning, never the page.
    listDeskApproverIds().catch(() => null),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Unit Settings" description="Who escalations reach, how long each job has, and how triage scores" />
      {/* Keyed by unit so switching units in the topbar reopens the form on that unit's values. */}
      <UnitSettingsScreen
        key={settings.location_id}
        settings={settings}
        desk={desk}
        deskApproverIds={deskApproverIds}
        people={people}
      />
    </div>
  );
}
