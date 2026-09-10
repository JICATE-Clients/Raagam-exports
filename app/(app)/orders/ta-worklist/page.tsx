import Link from "next/link";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { getWorklist, type WorklistNote, type WorklistRow } from "@/lib/ta/worklist";
import { getMyStaffTaKpi } from "@/lib/ta/kpi";
import { endOfMonth, startOfMonth, today } from "@/lib/calendar";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WorklistBoard } from "./worklist-board";

/**
 * Orders ▸ Time & Action (TA) ▸ TA Worklist — the READ half of T&A.
 *
 * The client's diagnosis of why legacy T&A stopped being used: four screens
 * captured a schedule and nothing ever read it back, so nobody maintained it.
 * This is the screen that reads it back — "what does my department owe today,
 * on which order, in what quantity" — and it is why the T&A tab on the order is
 * worth filling in at all.
 *
 * ## THE EMPTY STATE IS THE DESIGN
 *
 * "Nothing due today" is a real, ordinary, welcome answer here, and it looks
 * exactly like a query that scoped itself into nothing. Nobody would ever report
 * that bug. So `lib/ta/worklist.ts` counts every row it drops and returns a
 * sentence for each, and this page renders those sentences ABOVE the list rather
 * than as a footnote — plus `Scanned`, the count before any narrowing, as a
 * standing tile. A zero list over a non-zero Scanned is self-diagnosing.
 *
 * ## Zero client JavaScript except the buttons
 *
 * The tiles, the notes and the three sections are server components, matching
 * the executive dashboard. `WorklistBoard` is the one client boundary, and only
 * because Done/Start/Undo are actions.
 */
export const metadata = { title: "TA Worklist" };

/**
 * `?scope=mine` (0547) — a URL search param, not client state, so the toggle
 * costs zero client JavaScript beyond the two `Link`s that set it: this page
 * is a server component and `getWorklist({ mineOnly })` runs the narrowing on
 * the server, the same way every other scoping decision here already does.
 */
export default async function TaWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requirePermission("orders", "view");
  const { scope } = await searchParams;
  const mineOnly = scope === "mine";
  const wl = await getWorklist({ mineOnly });

  // THIS MONTH, ALWAYS THE VIEWER'S OWN FIGURE (0547) — `getMyStaffTaKpi`
  // pins `p_staff_id` to `wl.viewerEmployeeId` explicitly rather than letting
  // `staff_ta_kpi` pick, because a manager (who holds `orders:export`) would
  // otherwise get the WHOLE TEAM's rows back on their own daily worklist,
  // which is a report, not a badge. Skipped entirely on an unlinked login —
  // there is no personal figure to show.
  const myKpi = wl.viewerEmployeeId
    ? await getMyStaffTaKpi(wl.viewerEmployeeId, startOfMonth(today()), endOfMonth(today()))
    : null;

  const backlog = wl.rows.filter((r) => r.bucket === "backlog");
  const dueToday = wl.rows.filter((r) => r.bucket === "today");
  const upcoming = wl.rows.filter((r) => r.bucket === "upcoming");
  const showDepartment = wl.scope.kind === "all_departments";

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Worklist"
        description={
          wl.scope.kind === "own_department" && wl.scope.departmentName
            ? `${wl.scope.departmentName} — Time & Action activities due on ${fmtDate(wl.today)}.`
            : `Time & Action activities due on ${fmtDate(wl.today)}, across every department.`
        }
        actions={
          <div className="flex items-center gap-2">
            <KpiBadge score={myKpi?.onTimeScorePercentage ?? null} />
            <ScopeToggle mineOnly={mineOnly} />
          </div>
        }
      />

      {/* The tiles. `Scanned` earns its place by being the number that makes an
          empty list legible: 0 of 0 is a quiet day, 0 of 43 is a scope. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Due today"
          value={wl.counts.today}
          tone={wl.counts.today > 0 ? "info" : "neutral"}
        />
        <Stat
          label="Backlog"
          value={wl.counts.backlog}
          hint="Past target, not completed"
          tone={wl.counts.backlog > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Escalate"
          value={wl.counts.escalated}
          hint={`${wl.escalateAfterDays}+ days late`}
          tone={wl.counts.escalated > 0 ? "danger" : "neutral"}
        />
        <Stat
          label={`Next ${wl.horizonDays} days`}
          value={wl.counts.upcoming}
          tone="neutral"
        />
        <Stat
          label="Scanned"
          value={wl.counts.scanned}
          hint="Before any filtering"
          tone="neutral"
        />
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
            {wl.counts.escalated} {wl.counts.escalated === 1 ? "activity is" : "activities are"}{" "}
            {wl.escalateAfterDays} or more days late.
          </strong>{" "}
          A slip this size is recovered with air freight, not with overtime — it needs a
          decision today, not a column.
        </div>
      )}

      {/* Backlog first: what is already late outranks what is due, and putting
          "today" at the top would bury it under the fold on a bad week. */}
      <Section
        title="Backlog"
        subtitle="Past its target date and not completed"
        rows={backlog}
        canComplete={wl.canComplete}
        showDepartment={showDepartment}
        viewerEmployeeId={wl.viewerEmployeeId}
        empty="Nothing overdue."
      />
      <Section
        title={`Due today · ${fmtDate(wl.today)}`}
        subtitle="What must happen today for these orders to ship on time"
        rows={dueToday}
        canComplete={wl.canComplete}
        showDepartment={showDepartment}
        viewerEmployeeId={wl.viewerEmployeeId}
        empty="Nothing due today."
      />
      <Section
        title={`Next ${wl.horizonDays} days`}
        subtitle="Coming up — not yet due"
        rows={upcoming}
        canComplete={wl.canComplete}
        showDepartment={showDepartment}
        viewerEmployeeId={wl.viewerEmployeeId}
        empty="Nothing scheduled in the next week."
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  canComplete,
  showDepartment,
  viewerEmployeeId,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: WorklistRow[];
  canComplete: boolean;
  showDepartment: boolean;
  viewerEmployeeId: string | null;
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
        <WorklistBoard
          rows={rows}
          canComplete={canComplete}
          showDepartment={showDepartment}
          viewerEmployeeId={viewerEmployeeId}
        />
      )}
    </section>
  );
}

/**
 * One of the reader's diagnosis sentences.
 *
 * These are not decoration and they are not an error state — most of them fire
 * on a perfectly healthy screen. Each says something the operator could not
 * otherwise see: which rows were removed and why, and where to go and change it.
 */
function NoteBanner({ note }: { note: WorklistNote }) {
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
      {note.href && (
        <>
          {" "}
          <Link href={note.href} className="font-medium underline underline-offset-2">
            {note.hrefLabel ?? "Open"}
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Department / My Tasks (0547) — two `Link`s, not client state, so this stays
 * inside the "zero client JavaScript except the buttons" rule the file
 * header states: the page itself does the narrowing server-side off
 * `?scope=`, this only sets which URL is next.
 *
 * `buttonClasses` (`components/ui/button.tsx`), never a hand-rolled class
 * list — it is the one place a control that must be an `<a>` rather than a
 * `<button>` gets the exact same classes a real `Button` would, including the
 * default `md` (h-9) size the header row STANDING rule requires.
 */
function ScopeToggle({ mineOnly }: { mineOnly: boolean }) {
  // `md` (h-9), not `sm` — AGENTS.md, "The header row (STANDING)": every
  // control in the band above a list is the header's own size, and this sits
  // inside `PageHeader actions={…}`, one of the two shapes the row-size check
  // recognises as a header row. A segmented toggle is not a dense grid
  // control like a ChildGrid's "+ Add line", which is the shape `sm` is for.
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
      <Link
        href="/orders/ta-worklist"
        className={buttonClasses({
          variant: mineOnly ? "ghost" : "outline",
          className: "border-transparent shadow-none",
        })}
      >
        Department
      </Link>
      <Link
        href="/orders/ta-worklist?scope=mine"
        className={buttonClasses({
          variant: mineOnly ? "outline" : "ghost",
          className: "border-transparent shadow-none",
        })}
      >
        My Tasks
      </Link>
    </div>
  );
}

/**
 * This month's on-time score, always the SIGNED-IN OPERATOR'S OWN figure
 * (see `getMyStaffTaKpi` in `page.tsx` above for why it is pinned rather
 * than left to `staff_ta_kpi`'s own "everyone, if you hold export" default).
 *
 * `null` covers TWO honest states this badge does not try to tell apart —
 * an unlinked login (no employee record to score) and a linked one with
 * nothing completed yet this month — both read as "nothing to show" rather
 * than a wrong number, which is worse than no number.
 *
 * 90 / 75 THRESHOLDS, copied from nowhere else in this codebase: this is the
 * spec's own three-tier read (green ≥90, amber 75–89, red <75), reused
 * verbatim on the Reports ▸ T&A Staff Performance page's `ScoreBadge` (now a
 * plain-text cell there, per `ReportView`'s export-safe-columns rule) so the
 * two surfaces can never disagree about where a tier boundary sits.
 */
function KpiBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 90 ? "success" : score >= 75 ? "warning" : "danger";
  return (
    <Link href="/reports/ta-performance" title="This month's on-time completion — open the full report">
      <StatusPill tone={tone}>{score}% on-time</StatusPill>
    </Link>
  );
}
