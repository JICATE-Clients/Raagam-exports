import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import {
  getApprovalsWorklist,
  type ApprovalWorklistNote,
  type ApprovalWorklistRow,
} from "@/lib/ta/approvals-worklist";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApprovalsWorklistBoard } from "./approvals-worklist-board";

/**
 * Orders ▸ Time & Action (TA) ▸ Approvals Worklist — the transaction-entry
 * half of the Order Transaction Ledger (doc/approval.md §4). Structured like
 * `app/(app)/orders/ta-worklist/page.tsx`, the production activity worklist:
 * same tiles, same "an empty worklist is the dangerous failure" note
 * discipline, same reasoning for why counts and notes render ABOVE the list.
 *
 * A SEPARATE SCREEN FROM `ta-worklist`, DELIBERATELY (client 2026-09-07,
 * choosing this over extending the T&A tab): the order-entry T&A tab stays
 * plan-only (which approvals apply + review days), and this is where a
 * merchandiser actually marks Sent / Approved / Rework — same split as the
 * production ladder already has between the order's own tab and its
 * worklist.
 */
export const metadata = { title: "Approvals Worklist" };

export default async function ApprovalsWorklistPage() {
  await requirePermission("orders", "view");
  const wl = await getApprovalsWorklist();

  const backlog = wl.rows.filter((r) => r.bucket === "backlog");
  const dueToday = wl.rows.filter((r) => r.bucket === "today");
  const upcoming = wl.rows.filter((r) => r.bucket === "upcoming");
  const resolved = wl.rows.filter((r) => r.bucket === "resolved");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals Worklist"
        description={`Technical approvals awaiting action, across every order, as of ${fmtDate(wl.today)}.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Due today" value={wl.counts.today} tone={wl.counts.today > 0 ? "info" : "neutral"} />
        <Stat
          label="Backlog"
          value={wl.counts.backlog}
          hint="Past target, not resolved"
          tone={wl.counts.backlog > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Escalate"
          value={wl.counts.escalated}
          hint="3+ days late"
          tone={wl.counts.escalated > 0 ? "danger" : "neutral"}
        />
        <Stat label="Next 7 days" value={wl.counts.upcoming} tone="neutral" />
        <Stat label="Scanned" value={wl.counts.scanned} hint="Before any filtering" tone="neutral" />
      </div>

      {wl.notes.length > 0 && (
        <div className="space-y-2">
          {wl.notes.map((note, i) => (
            <NoteBanner key={i} note={note} />
          ))}
        </div>
      )}

      {wl.counts.escalated > 0 && (
        <div className="rounded-lg border border-danger/50 bg-danger-soft px-3 py-2 text-sm text-danger">
          <OctagonAlert className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          <strong className="font-semibold">
            {wl.counts.escalated} approval{wl.counts.escalated === 1 ? " is" : "s are"} 3 or more days late.
          </strong>{" "}
          A stuck sample review holds up cutting behind it — see the Cutting Room lock on the T&A
          Worklist.
        </div>
      )}

      <Section
        title="Backlog"
        subtitle="Past its target date and not resolved"
        rows={backlog}
        canComplete={wl.canComplete}
        empty="Nothing overdue."
      />
      <Section
        title={`Due today · ${fmtDate(wl.today)}`}
        subtitle="What needs a Sent/Approved/Rework today"
        rows={dueToday}
        canComplete={wl.canComplete}
        empty="Nothing due today."
      />
      <Section
        title="Next 7 days"
        subtitle="Coming up — not yet due"
        rows={upcoming}
        canComplete={wl.canComplete}
        empty="Nothing scheduled in the next week."
      />

      {resolved.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold">
            Approved ({resolved.length}) — for follow-up tracking, not action
          </summary>
          <div className="pt-2">
            <ApprovalsWorklistBoard rows={resolved} canComplete={wl.canComplete} />
          </div>
        </details>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  canComplete,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: ApprovalWorklistRow[];
  canComplete: boolean;
  empty: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ApprovalsWorklistBoard rows={rows} canComplete={canComplete} />
      )}
    </section>
  );
}

function NoteBanner({ note }: { note: ApprovalWorklistNote }) {
  const tone = {
    info: "border-border bg-surface-muted text-muted-foreground",
    warn: "border-warning/50 bg-warning-soft text-warning",
    danger: "border-danger/50 bg-danger-soft text-danger",
  }[note.level];
  const Icon = note.level === "info" ? Info : note.level === "warn" ? AlertTriangle : OctagonAlert;

  return (
    <div className={cn("rounded-lg border px-3 py-2 text-xs", tone)}>
      <Icon className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
      {note.text}
    </div>
  );
}
