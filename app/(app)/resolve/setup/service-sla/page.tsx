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
      <PageHeader title="IT Reply Time" description="How soon the IT desk must first reply, and fix, at each priority — this unit" />
      {/* Keyed by unit so switching units in the topbar reopens the grid on that unit's values. */}
      <ServiceSlaScreen key={loc ?? "none"} sla={sla} />
    </div>
  );
}
