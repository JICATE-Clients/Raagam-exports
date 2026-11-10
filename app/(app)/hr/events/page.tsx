import { Suspense } from "react";
import { requirePermission, can, requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { EventsScreen } from "@/components/hr/events/events-screen";
import { listEvents, listInvitablePeople } from "@/lib/hr/events-service";
import { getGoogleConnection, googleEnv } from "@/lib/google/calendar";

export const metadata = { title: "Events" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const user = await requireUser();
  const [rows, canCreate, canEdit, conn] = await Promise.all([
    listEvents(),
    can("hr_payroll", "create"),
    can("hr_payroll", "edit"),
    getGoogleConnection(user.id),
  ]);
  const people = canCreate || canEdit ? await listInvitablePeople() : [];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Events"
        description="Create an event, pick people by Employee ID, and Google Calendar sends them a real invitation."
      />
      <Suspense>
        <EventsScreen
          rows={rows}
          people={people}
          google={{ configured: !!googleEnv(), email: conn?.googleEmail ?? null }}
          canCreate={canCreate}
          canEdit={canEdit}
        />
      </Suspense>
    </div>
  );
}
