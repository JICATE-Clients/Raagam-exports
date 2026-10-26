"use client";

import { ChevronDown, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { BarLegend, StackBar } from "@/components/resolve/analytics/analytics-view";
import { ROUTE_LOOK } from "@/components/resolve/chat/assist";
import { useAccordion } from "@/lib/ui/use-accordion";
import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import type { WorkloadRow } from "@/lib/resolve/types";

/*
 * Workload — what each team is carrying, and inside a team, each person
 * (resolve-mobile mockup, 2026-10-26). `rh_workload()` returns one row per
 * (team, person) already scoped to what the viewer may see; a team's bar is
 * the same rows summed, so the team and its people can never disagree.
 *
 * By team only, as stacked bars; tapping a team unfolds its people — one team
 * at a time (AGENTS "Folds are accordions", `useAccordion`). The person table
 * that used to repeat the team figures is now that drill-down.
 */

type Load = { open: number; in_progress: number; blocked: number; overdue: number };
type PersonLoad = Load & { key: string; name: string };
type TeamLoad = Load & { key: string; team: string; people: PersonLoad[] };

/** The three statuses are disjoint; OVERDUE is not — it is open or in-progress
 *  jobs past due, already inside those segments — so it rides as a red "late"
 *  pill beside the bar rather than a fourth segment that would count it twice. */
const PARTS: { key: "open" | "in_progress" | "blocked"; label: string; tone: DashboardTone }[] = [
  { key: "open", label: "Open", tone: "primary" },
  { key: "in_progress", label: "In progress", tone: "success" },
  // active-first: exempt -- a bar segment counting blocked jobs, not a status field
  { key: "blocked", label: "Blocked", tone: "warning" },
];

const add = (a: Load, b: Load): Load => ({
  open: a.open + b.open,
  in_progress: a.in_progress + b.in_progress,
  blocked: a.blocked + b.blocked,
  overdue: a.overdue + b.overdue,
});
const sum = (l: Load) => l.open + l.in_progress + l.blocked;
const parts = (l: Load) => PARTS.map((p) => ({ value: l[p.key], tone: p.tone, label: p.label.toLowerCase() }));

export function WorkloadTables({ rows }: { rows: WorkloadRow[] }) {
  const fold = useAccordion();

  const teams = new Map<string, TeamLoad>();
  for (const r of rows) {
    const teamKey = r.team_id ?? "none";
    const prev = teams.get(teamKey) ?? {
      key: teamKey,
      team: r.team_name ?? "No team",
      open: 0,
      in_progress: 0,
      blocked: 0,
      overdue: 0,
      people: [],
    };
    const next: TeamLoad = { ...prev, ...add(prev, r) };
    if (r.profile_id) {
      next.people = [
        ...prev.people,
        {
          key: `${teamKey}:${r.profile_id}`,
          name: r.name ?? "Unknown",
          open: r.open,
          in_progress: r.in_progress,
          blocked: r.blocked,
          overdue: r.overdue,
        },
      ];
    }
    teams.set(teamKey, next);
  }
  const teamRows = [...teams.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  for (const t of teamRows) t.people.sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
  const teamMax = Math.max(1, ...teamRows.map(sum));
  const look = ROUTE_LOOK.fix;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">By team</h3>
        <BarLegend items={PARTS.map((p) => ({ label: p.label, tone: p.tone }))} />
      </div>

      {teamRows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No open work in this unit.</Card>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2 lg:items-start">
          {teamRows.map((t) => {
            const open = fold.isOpen(t.key);
            const personMax = Math.max(1, ...t.people.map(sum));
            return (
              <Card key={t.key} className="overflow-hidden">
                {/* button-shape: exempt -- a fold header spanning the card, not an action button */}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`wl-${t.key}`}
                  onClick={() => fold.toggle(t.key)}
                  className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex w-full items-center gap-2.5">
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", look.tile)}>
                      <Users className="size-3.5" aria-hidden />
                    </span>
                    <Truncated text={t.team} className="min-w-0 flex-1 text-sm font-semibold" />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t.people.length} {t.people.length === 1 ? "person" : "people"}
                    </span>
                    {t.overdue > 0 && <StatusPill tone="danger">{t.overdue} late</StatusPill>}
                    <ChevronDown
                      className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      aria-hidden
                    />
                  </span>
                  <StackBar label={<span className="text-muted-foreground">All jobs</span>} parts={parts(t)} max={teamMax} />
                </button>
                {open && (
                  <div id={`wl-${t.key}`} className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
                    {t.people.length ? (
                      t.people.map((p) => (
                        <StackBar
                          key={p.key}
                          label={p.name}
                          parts={parts(p)}
                          max={personMax}
                          end={p.overdue > 0 ? <StatusPill tone="danger">{p.overdue} late</StatusPill> : undefined}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">Nobody in this team is named on these jobs yet.</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
