"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { buttonClasses } from "@/components/ui/button";
import { fmtNumber } from "@/lib/format";
import { WORKFLOWS, WORKFLOW_LIST, workflowLabel } from "@/lib/approvals/workflows";
import type { QueueItem, StrandedRun } from "@/lib/approvals/types";

/** A queue row with the two keys `withCreators` / `withCreatedColumns` read. */
export type QueueRow = QueueItem & {
  created_at: string;
  created_by: string;
  created_by_name?: string | null;
};

/**
 * MY APPROVALS — every module's pending sign-offs in one queue.
 *
 * ## WHAT IS NOT HERE, ON PURPOSE
 *
 * No "approve" button. A decision needs the document in front of it — the whole
 * failure mode of a bulk-approve inbox is that it makes approving cheaper than
 * reading, and an approval nobody read is worse than no approval step at all.
 * Each row opens its document, and `<ApprovalActionBar>` decides there, where
 * the figures are.
 *
 * ## AND NO CLIENT-SIDE FILTER ON WHO MAY ACT
 *
 * `approval_my_queue` already resolved that, through the same
 * `approval_step_approvers` predicate `approval_can_act` uses. A row that is
 * here is actionable by definition. The search and workflow facets below narrow
 * what is DISPLAYED and nothing else — the skill's troubleshooting table lists
 * "badge count ≠ list length" with "you filtered the queue client-side" as the
 * cause, and that is a warning about filtering on eligibility, not on text.
 */
export function ApprovalsInboxScreen({
  rows,
  stranded,
  canViewAll,
}: {
  rows: QueueRow[];
  stranded: StrandedRun[];
  canViewAll: boolean;
}) {
  const [query, setQuery] = useState("");
  const [workflow, setWorkflow] = useState("");

  /**
   * HOW MANY SIT UNDER EACH WORKFLOW — the counts, in the facet, exactly as
   * Material BOM's status facet carries them (AGENTS.md's reference for this
   * shape). A list of workflows that says nothing about whether any rows are in
   * them cannot answer "is anything waiting on Purchase?" except by choosing it
   * and looking at an empty table.
   *
   * Derived from the rows rather than declared, so a workflow key built by hand
   * — one absent from `WORKFLOWS` — still appears here rather than becoming
   * unreachable. `workflowLabel` prints the raw key for those.
   */
  const workflowCounts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const w of WORKFLOW_LIST) seen.set(w.key, 0);
    for (const r of rows) seen.set(r.workflow_key, (seen.get(r.workflow_key) ?? 0) + 1);
    return [...seen.entries()].map(([key, count]) => ({ key, count }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (workflow && r.workflow_key !== workflow) return false;
      if (!needle) return true;
      return [workflowLabel(r.workflow_key), r.step_label, r.created_by_name ?? ""]
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, query, workflow]);

  /**
   * WHERE A ROW OPENS.
   *
   * `WORKFLOWS` knows the route per workflow key; a key it does not know has no
   * href, and the row renders as plain text rather than as a link to nowhere. A
   * dead link in a work queue is worse than no link: it reads as a broken screen
   * rather than as a workflow nobody has finished wiring.
   */
  const hrefFor = (r: QueueRow) =>
    WORKFLOWS[r.workflow_key as keyof typeof WORKFLOWS]?.href ?? null;

  /** "3d 4h" — a queue is read for how LONG something has waited, not for when
   *  it arrived, and the Created Date column already carries the when. */
  const waited = (hours: number) => {
    if (hours < 1) return "under an hour";
    if (hours < 24) return `${Math.floor(hours)}h`;
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return h ? `${d}d ${h}h` : `${d}d`;
  };

  const columns: Column<QueueRow>[] = [
    {
      header: "Document",
      cell: (r) => {
        const href = hrefFor(r);
        const label = workflowLabel(r.workflow_key);
        return href ? (
          <Link href={href} className="text-xs font-medium text-primary hover:underline">
            {label}
          </Link>
        ) : (
          <span className="text-xs font-medium">{label}</span>
        );
      },
    },
    {
      header: "Waiting on you for",
      cell: (r) => (
        /* AMBER PAST A WEEK, and nothing before it. A colour on every row is a
           colour on none — the same argument `DaysOut` makes for going silent
           beyond 60 days on a delivery date. */
        <span
          className={
            r.waiting_hours >= 168
              ? "text-sm font-medium text-warning"
              : "text-sm text-muted-foreground"
          }
        >
          {waited(r.waiting_hours)}
        </span>
      ),
    },
    {
      header: "Step",
      cell: (r) => (
        <span className="text-sm">
          <span className="text-muted-foreground">{r.step_order}. </span>
          <Truncated>{r.step_label}</Truncated>
        </span>
      ),
    },
    {
      header: "Status",
      cell: () => <StatusPill tone="warning">Awaiting you</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Approvals"
        description="Every request across the business that is waiting on your decision."
        actions={
          /* A LINK, NOT A BUTTON WRAPPING ONE. Raagam's `Button` renders a real
             <button> and takes no `asChild`, so nesting an <a> inside it is
             invalid markup — the same nesting rule `MobileCardList` is shaped
             around. `buttonClasses` gives the link the header row's `md` (h-9)
             height, which is what the toolbar-size rule asks of every control
             in this band. */
          canViewAll ? (
            <Link href="/approvals/flows" className={buttonClasses({ variant: "outline", size: "md" })}>
              Approval Flows
            </Link>
          ) : undefined
        }
      />

      {/* THE STRANDED BANNER — an incident, not a report.
          A run whose current step resolves to NOBODY raises no error and sits
          for months; the skill records it as the single highest-cost defect in
          the system this engine was extracted from, and `approval_start_run`
          exists to make it impossible by refusing at the start. So a non-empty
          result here means something changed AFTER a run began — a role was
          revoked, an approver deactivated — and it is the one thing on this
          screen that needs a person rather than a decision.

          Shown only to someone holding `approvals:view`: an ordinary approver is
          by definition not on a stranded step and can do nothing about it. */}
      {stranded.length > 0 && (
        <div className="rounded-md border-2 border-danger/40 bg-danger/5 p-3">
          <p className="text-sm font-semibold text-danger">
            {fmtNumber(stranded.length)}{" "}
            {stranded.length === 1 ? "request has" : "requests have"} no eligible
            approver
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Their current step resolves to nobody, so they are in no one&rsquo;s queue
            and no one is being asked. Assign the role the step names, or cancel the
            run.
          </p>
          <ul className="mt-2 space-y-1">
            {stranded.map((s) => (
              <li key={s.run_id} className="text-xs">
                <span className="font-medium">{workflowLabel(s.workflow_key)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · step {s.current_step}
                  {s.step_label ? ` (${s.step_label})` : ""} · stuck {s.age}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search document, step or requester…"
        activeCount={workflow ? 1 : 0}
        onReset={workflow ? () => setWorkflow("") : undefined}
        right={`${filtered.length} of ${rows.length}`}
      >
        <div>
          <Label htmlFor="approval-workflow">Document</Label>
          <Select
            id="approval-workflow"
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
          >
            <option value="">All ({rows.length})</option>
            {workflowCounts.map((w) => (
              <option key={w.key} value={w.key} disabled={w.count === 0 && w.key !== workflow}>
                {workflowLabel(w.key)} ({w.count})
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {/* The Created pair is the requester and when they raised it — mapped onto
          `created_at` / `created_by` in the page so the app's one helper renders
          them (see the note there). `withCreatedColumns` self-hides if a future
          change stops supplying them, so this cannot decay into a dash column. */}
      <DataTable
        columns={withCreatedColumns(columns, filtered)}
        rows={filtered}
        getKey={(r) => r.run_id}
        empty="Nothing is waiting on you. Requests appear here the moment a step names you as an approver."
      />
    </div>
  );
}
