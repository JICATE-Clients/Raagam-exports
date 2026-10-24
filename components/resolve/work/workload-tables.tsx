import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkloadRow } from "@/lib/resolve/types";

/*
 * Workload — what each team and each person is carrying. `rh_workload()`
 * returns one row per (team, person) already scoped to what the viewer may see;
 * the team table is the same rows summed, so the two can never disagree.
 *
 * The tables are aggregates with no `created_at`, so `withCreatedColumns`
 * leaves them unchanged — it is called anyway, so the listing rule is visibly met.
 */

type Load = { open: number; in_progress: number; blocked: number; overdue: number };
type TeamLoad = Load & { key: string; team: string };
type PersonLoad = Load & { key: string; name: string; team: string };

const num = (n: number, tone?: string) => (
  <span className={`tabular-nums text-sm ${n && tone ? tone : ""}`}>{n}</span>
);

function loadColumns<T extends Load>(): Column<T>[] {
  return [
    { header: "Open", align: "right", cell: (r) => num(r.open) },
    { header: "In Progress", align: "right", cell: (r) => num(r.in_progress) },
    { header: "Blocked", align: "right", cell: (r) => num(r.blocked, "text-warning") }, // active-first: exempt -- a COUNT of blocked jobs, not an on/off switch
    { header: "Overdue", align: "right", cell: (r) => num(r.overdue, "font-semibold text-danger") },
  ];
}

const teamColumns: Column<TeamLoad>[] = [
  { header: "Team", cell: (r) => <span className="text-sm font-medium">{r.team}</span> },
  ...loadColumns<TeamLoad>(),
];

const personColumns: Column<PersonLoad>[] = [
  { header: "Person", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
  { header: "Team", cell: (r) => <span className="text-sm text-muted-foreground">{r.team}</span> },
  ...loadColumns<PersonLoad>(),
];

const add = (a: Load, b: Load): Load => ({
  open: a.open + b.open,
  in_progress: a.in_progress + b.in_progress,
  blocked: a.blocked + b.blocked,
  overdue: a.overdue + b.overdue,
});

export function WorkloadTables({ rows }: { rows: WorkloadRow[] }) {
  const teams = new Map<string, TeamLoad>();
  const people: PersonLoad[] = [];
  for (const r of rows) {
    const teamKey = r.team_id ?? "none";
    const team = r.team_name ?? "No team";
    const prev = teams.get(teamKey) ?? { key: teamKey, team, open: 0, in_progress: 0, blocked: 0, overdue: 0 };
    teams.set(teamKey, { ...prev, ...add(prev, r) });
    if (r.profile_id) {
      people.push({
        key: `${teamKey}:${r.profile_id}`,
        name: r.name ?? "Unknown",
        team,
        open: r.open,
        in_progress: r.in_progress,
        blocked: r.blocked,
        overdue: r.overdue,
      });
    }
  }
  const teamRows = [...teams.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  people.sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>By team</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={withCreatedColumns(teamColumns, teamRows)}
rows={teamRows}
            getKey={(r) => r.key}
            paginate={false}
            empty="No open work in this unit."
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>By person</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable columns={withCreatedColumns(personColumns, people)} rows={people} getKey={(r) => r.key} empty="Nobody is carrying open work." />
        </CardBody>
      </Card>
    </div>
  );
}
