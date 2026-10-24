import { PageHeader } from "@/components/ui/page-header";
import { ComplaintsScreen } from "@/components/resolve/complaints/complaints-screen";
import { requireUser } from "@/lib/auth/server";
import { canRh } from "@/lib/resolve/auth";
import { listComplaintWork, listPeople } from "@/lib/resolve/service";
import type { TicketListRow } from "@/lib/resolve/types";

/** The handler queue never carries who complained — not even for a named
 *  complaint, and not even in the Created User column. The ticket page is
 *  where a permitted viewer sees the reporter (plan §10.3). */
function withoutReporter(r: TicketListRow): TicketListRow {
  return { ...r, reporter_id: null, reporter_name: null, created_by: null, created_by_name: null } as TicketListRow;
}

/**
 * Complaint handling is configured PER CATEGORY (handler, committee,
 * oversight), not by a permission — so the gate is a login, and the database
 * decides which complaints come back. A viewer who handles nothing gets a
 * sentence saying how one becomes a handler, not an empty table.
 */
export default async function ComplaintsPage() {
  await requireUser();
  // `rh_people` refuses a viewer without work / triage / admin, so the Assign
  // picker is offered only to them; a committee member still has Start.
  const [mine, committee, all, canPick] = await Promise.all([
    listComplaintWork("mine"),
    listComplaintWork("committee"),
    listComplaintWork("all"),
    Promise.all([canRh("work"), canRh("triage"), canRh("admin")]).then((a) => a.some(Boolean)),
  ]);
  const people = canPick ? await listPeople() : [];
  const handlesNothing = !mine.length && !committee.length && !all.length;

  return (
    <div className="space-y-4">
      <PageHeader title="Complaints" description="Complaints you handle, or sit on the committee for" />
      {handlesNothing ? (
        <p className="max-w-[40rem] text-sm text-muted-foreground">
          You do not handle any complaints. Handlers, committee and oversight members are set per category on Resolve
          Hub ▸ Administration ▸ Complaint Categories — ask the administrator if you should be one.
        </p>
      ) : (
        <ComplaintsScreen
          lists={{ mine: mine.map(withoutReporter), committee: committee.map(withoutReporter), all: all.map(withoutReporter) }}
          people={people}
        />
      )}
    </div>
  );
}
