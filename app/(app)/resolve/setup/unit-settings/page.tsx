import { PageHeader } from "@/components/ui/page-header";
import { UnitSettingsScreen } from "@/components/resolve/admin/unit-settings-screen";
import { requireRh } from "@/lib/resolve/auth";
import { getUnitSettings, listPeople } from "@/lib/resolve/service";

export default async function UnitSettingsPage() {
  await requireRh("admin");
  const [settings, people] = await Promise.all([getUnitSettings(), listPeople()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Unit Settings" description="Who escalations reach, how long each job has, and how triage scores" />
      {/* Keyed by unit so switching units in the topbar reopens the form on that unit's values. */}
      <UnitSettingsScreen key={settings.location_id} settings={settings} people={people} />
    </div>
  );
}
