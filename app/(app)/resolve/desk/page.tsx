import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { DeskQueueScreen } from "@/components/resolve/desk/desk-queue-screen";
import { canRh } from "@/lib/resolve/auth";
import { getShiftSummary, listDeskQueue } from "@/lib/resolve/desk-service";
import { listPeople } from "@/lib/resolve/service";
import { DESK_QUEUE_TABS, type DeskQueueRow, type DeskQueueTab } from "@/lib/resolve/desk-types";

// Work, triage or analytics may open the queue (plan §3 "Access edit or approve
// or export"); `rh_sd_queue` scopes the rows itself. Only triage assigns.
export default async function DeskQueuePage() {
  const [canWork, canTriage, canAnalytics] = await Promise.all([canRh("work"), canRh("triage"), canRh("analytics")]);
  if (!canWork && !canTriage && !canAnalytics) redirect("/resolve");
  const [tabs, shift, people] = await Promise.all([
    Promise.all(DESK_QUEUE_TABS.map((t) => listDeskQueue(t))),
    canWork ? getShiftSummary() : Promise.resolve(null),
    canTriage ? listPeople() : Promise.resolve([]),
  ]);
  const lists = Object.fromEntries(DESK_QUEUE_TABS.map((t, i) => [t, tabs[i]])) as Record<DeskQueueTab, DeskQueueRow[]>;
  return (
    <div className="space-y-4">
      <PageHeader title="Desk Queue" description="IT requests — urgent overrides first, then priority, then first come first served" />
      <DeskQueueScreen lists={lists} shift={shift} people={people} canAssign={canTriage} />
    </div>
  );
}
