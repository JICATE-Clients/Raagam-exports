import { requirePermission } from "@/lib/auth/server";
import { loadPeople, type TicketFact } from "@/lib/analytics/sources";
import { TICKET_AGE, TICKET_KIND_LABEL, onLeaveToday, openTickets } from "@/lib/analytics/compute";
import { inRange, parsePeriod } from "@/lib/analytics/period";
import { today } from "@/lib/dashboard/range";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import { fmtDate } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { StatusPill } from "@/components/ui/status-pill";
import { GlowBars, NeedsDoing, Strip, Tape, VizCard, type StripCell } from "@/components/viz/kit";
import { PeopleGrid } from "@/components/analytics/pictures";
import { BoardHeader, LoadError, NoAccess, Row3, n, viewOf } from "@/components/analytics/board-ui";

/**
 * ANALYTICS ▸ PEOPLE & WORKPLACE — "Are people here, and are problems getting fixed?"
 *
 * Four small sources, each behind its own screen, so each part stands or falls on its own: staff
 * (HR ▸ Staff), leave (Leave Calendar), Resolve Hub problems (Problem Summary) and trips (Fleet
 * Board). Attendance is not drawn yet: no punches are recorded, and a 0% would read as an empty
 * factory.
 */
export default async function PeopleBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports", "view");
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const view = viewOf(sp.view);
  const t = today();
  const p = await loadPeople();

  const tk = p.tickets.ok ? openTickets(p.tickets.data, t) : null;
  const leaveAll = p.leave.ok ? p.leave.data : [];
  const leaveRows = leaveAll.filter((l) => inRange(l.start, period));
  const trips = p.trips.ok ? p.trips.data.filter((x) => inRange(x.planned, period)) : [];
  const offToday = new Set(leaveAll.filter((l) => l.status === "approved" && l.start <= t && (l.end || l.start) >= t).map((l) => l.staffId));

  /* People by department, with who is on approved leave today. */
  const depts = new Map<string, { name: string; count: number; off: number }>();
  if (p.staff.ok) {
    for (const s of p.staff.data) {
      const d = depts.get(s.department) ?? { name: s.department, count: 0, off: 0 };
      d.count++;
      if (offToday.has(s.id)) d.off++;
      depts.set(s.department, d);
    }
  }
  const deptList = [...depts.values()].sort((a, b) => b.count - a.count);
  const leaveState = (...s: string[]) => leaveRows.filter((l) => s.includes(l.status)).length;
  const header = <BoardHeader title="People & Workplace" question="Are people here, and are problems getting fixed?" period={period.key} view={view} />;

  if (view === "list") {
    return (
      <div className="space-y-3">
        {header}
        {!p.tickets.ok ? (
          p.tickets.reason === "access" ? <NoAccess what="Problems" screen="Problem Summary" /> : <LoadError message={p.tickets.message} />
        ) : (
          <DataTable
            rows={tk!.oldest}
            getKey={(r) => r.id}
            empty="No problem is open."
            columns={withCreatedColumns<TicketFact>(
              [
                { header: "Ref", cell: (r) => <span className="font-semibold">{r.refNo}</span> },
                { header: "Kind", cell: (r) => TICKET_KIND_LABEL[r.kind] ?? r.kind },
                { header: "Problem", cell: (r) => r.title },
                { header: "Reported", cell: (r) => fmtDate(r.createdAt) },
                { header: "Deadline", cell: (r) => (r.late ? <StatusPill tone="danger">Late</StatusPill> : <StatusPill tone="neutral">On time</StatusPill>) },
              ],
              tk!.oldest,
            )}
          />
        )}
      </div>
    );
  }

  const locked = (label: string, screen: string): StripCell => ({ label, value: "—", hint: `Needs ${screen}`, mood: "quiet" });
  const waitingLeave = leaveAll.filter((l) => l.status === "pending").length;

  return (
    <div className="space-y-2.5">
      {header}
      <Strip
        cells={[
          p.staff.ok ? { label: "Active staff", value: fmtCompactNumber(p.staff.data.length), hint: n(depts.size, "department"), href: "/hr/staff" } : locked("Active staff", "HR & Payroll ▸ People ▸ Staff"),
          p.leave.ok
            ? { label: "On leave today", value: fmtCompactNumber(onLeaveToday(leaveAll, t)), hint: "approved leave", mood: "look", href: "/hr/time-off/calendar" }
            : locked("On leave today", "Leave Calendar"),
          tk
            ? { label: "Problems open", value: fmtCompactNumber(tk.open), hint: tk.late ? `${tk.late} past the deadline` : "none late", mood: tk.late ? "problem" : "good", href: "/resolve/analytics" }
            : locked("Problems open", "Problem Summary"),
          p.leave.ok
            ? { label: "Leave to approve", value: fmtCompactNumber(waitingLeave), hint: waitingLeave ? "waiting a decision" : "nothing waiting", mood: waitingLeave ? "look" : "good", href: "/hr/time-off/approvals" }
            : locked("Leave to approve", "Leave Calendar"),
          p.trips.ok
            ? { label: `Trips · ${period.label}`, value: fmtCompactNumber(trips.length), hint: `${fmtCompactInr(trips.reduce((a, x) => a + x.cost, 0))} cost`, href: "/logistics/transport/board" }
            : locked("Trips", "Fleet Board"),
        ]}
      />
      <VizCard title="Who is here today?" question="Each figure is one active person; amber is on approved leave today">
        {p.staff.ok ? <PeopleGrid depts={deptList} /> : <div className="px-3.5 py-3"><NoAccess what="Staff" screen="HR & Payroll ▸ People ▸ Staff" /></div>}
        <p className="px-3.5 pb-3 text-[11.5px] text-muted-foreground">Attendance punches join this picture once the biometric devices are recording; until then it shows who is on leave, not who punched in.</p>
      </VizCard>
      <Row3>
        <VizCard title="What is broken, and what kind?" question="Open problems by kind" padded>
          {tk ? (
            <GlowBars
              rows={tk.byKind.map((k) => ({ key: k.key, label: k.label, value: k.parts.reduce((a, x) => a + x, 0), colour: k.parts[2] ? "var(--danger)" : k.parts[1] ? "var(--warning)" : "var(--primary)" }))}
              format={(v) => `${v} open`}
              empty="Nothing open."
            />
          ) : (
            <NoAccess what="Problems" screen="Problem Summary" />
          )}
        </VizCard>
        <VizCard title="How old are the open problems?" question="Days since reported" padded>
          {tk ? (
            <Tape
              parts={TICKET_AGE.map((label, i) => ({ label, value: tk.byKind.reduce((a, k) => a + k.parts[i], 0), colour: ["var(--success)", "var(--warning)", "var(--danger)"][i] }))}
              format={(v) => fmtCompactNumber(v)}
            />
          ) : (
            <NoAccess what="Problems" screen="Problem Summary" />
          )}
        </VizCard>
        <VizCard title="How is leave going?" question={`Requests starting in ${period.label}`} padded>
          {p.leave.ok ? (
            <Tape
              parts={[
                { label: "Approved", value: leaveState("approved"), colour: "var(--success)" },
                { label: "Waiting", value: leaveState("pending"), colour: "var(--warning)" },
                { label: "Rejected", value: leaveState("rejected"), colour: "var(--danger)" },
                { label: "Withdrawn", value: leaveState("withdrawn", "cancelled", "revoked"), colour: "var(--border-strong)" },
              ]}
              format={(v) => fmtCompactNumber(v)}
            />
          ) : (
            <NoAccess what="Leave" screen="Leave Calendar" />
          )}
        </VizCard>
      </Row3>
      <NeedsDoing
        cells={[
          {
            title: "Past the deadline",
            mood: tk?.late ? "problem" : "good",
            count: tk?.late ? n(tk.late, "problem") : "None",
            text: tk?.late ? tk.oldest.filter((x) => x.late).map((x) => `${x.refNo} ${x.title}`).join(" · ") : "No reported problem is late",
            href: tk?.late ? "/resolve/inbox" : undefined,
            linkText: "My Jobs",
          },
          {
            title: "Leave to approve",
            mood: waitingLeave ? "look" : "good",
            count: waitingLeave ? n(waitingLeave, "request") : "None",
            text: waitingLeave ? "Waiting for a decision" : "Nothing waiting",
            href: waitingLeave ? "/hr/time-off/approvals" : undefined,
            linkText: "Time Off Approvals",
          },
          {
            title: "Trips on the road",
            mood: "normal",
            count: n(p.trips.ok ? p.trips.data.filter((x) => !["completed", "cancelled"].includes(x.status)).length : 0, "trip"),
            text: p.trips.ok ? "Not yet completed" : "Needs Fleet Board",
            href: p.trips.ok ? "/logistics/transport/board" : undefined,
            linkText: "Fleet Board",
          },
        ]}
      />
    </div>
  );
}
