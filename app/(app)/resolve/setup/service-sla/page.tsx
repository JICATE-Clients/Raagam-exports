import { PageHeader } from "@/components/ui/page-header";
import { ServiceSlaScreen } from "@/components/resolve/admin/service-sla-screen";
import { getCurrentLocationId } from "@/lib/auth/location";
import { requireRh } from "@/lib/resolve/auth";
import { listServiceSla } from "@/lib/resolve/desk-service";

export default async function ServiceSlaPage() {
  await requireRh("admin");
  const [sla, loc] = await Promise.all([listServiceSla(), getCurrentLocationId()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Service SLA" description="Minutes to first response and to resolution, per priority, for this unit's IT desk" />
      {/* Keyed by unit so switching units in the topbar reopens the grid on that unit's values. */}
      <ServiceSlaScreen key={loc ?? "none"} sla={sla} />
    </div>
  );
}
