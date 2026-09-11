import Link from "next/link";
import { AlertTriangle, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import {
  getApprovalsWorklist,
  type ApprovalWorklistNote,
  type ApprovalWorklistRow,
} from "@/lib/ta/approvals-worklist";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/ui/tone";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApprovalsWorklistBoard } from "./approvals-worklist-board";

/**
 * Orders ▸ Time & Action (TA) ▸ Approvals Worklist — the transaction-entry
 * half of the Order Transaction Ledger (doc/approval.md §4). Structured like
 * `app/(app)/orders/ta-worklist/page.tsx`, the production activity worklist:
 * same tiles, same "an empty worklist is the dangerous failure" note
 * discipline, same reasoning for why counts and notes render ABOVE the list —
 * and, as of 2026-09-10, the same TABBED bucket layout and compact card,
 * ported over once the operator flagged the identical "too much scrolling /
 * too confusing" complaint here that `ta-worklist` already got fixed for.
 * See that file for the fuller reasoning; this one only records what differs.
 *
 * A SEPARATE SCREEN FROM `ta-worklist`, DELIBERATELY (client 2026-09-07,
 * choosing this over extending the T&A tab): the order-entry T&A tab stays
 * plan-only (which approvals apply + review days), and this is where a
 * merchandiser actually marks Sent / Approved / Rework — same split as the
 * production ladder already has between the order's own tab and its
 * worklist.
 */
export const metadata = { title: "Approvals Worklist" };

const BUCKETS = ["backlog", "today", "upcoming"] as const;
type Bucket = (typeof BUCKETS)[number];

export default async function ApprovalsWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  await requirePermission("orders", "view");
  const { bucket } = await searchParams;
  const wl = await getApprovalsWorklist();

  const backlog = wl.rows.filter((r) => r.bucket === "backlog");
  const dueToday = wl.rows.filter((r) => r.bucket === "today");
  const upcoming = wl.rows.filter((r) => r.bucket === "upcoming");
  const resolved = wl.rows.filter((r) => r.bucket === "resolved");

  // TABS, same reasoning and shape as `ta-worklist/page.tsx` — one bucket
  // renders at a time, defaulting to the most urgent non-empty one, reached
  // by a plain `Link` + `?bucket=` so the page stays a server component.
  // "Approved", below, stays OUTSIDE this — it is archival follow-up
  // tracking, not a worklist to scan, so it keeps its own collapsed
  // `<details>` rather than becoming a fourth tab.
  const sections: Record<Bucket, { title: string; subtitle: string; tone: StatusTone; rows: ApprovalWorklistRow[]; empty: string }> = {
    backlog: {
      title: "Backlog",
      subtitle: "Past its target date and not resolved",
      tone: "warning",
      rows: backlog,
      empty: "Nothing overdue.",
    },
    today: {
      title: `Due today · ${fmtDate(wl.today)}`,
      subtitle: "What needs a Sent/Approved/Rework today",
      tone: "info",
      rows: dueToday,
      empty: "Nothing due today.",
    },
    upcoming: {
      title: "Next 7 days",
      subtitle: "Coming up — not yet due",
      tone: "neutral",
      rows: upcoming,
      empty: "Nothing scheduled in the next week.",
    },
  };
  const activeBucket: Bucket =
    bucket && (BUCKETS as readonly string[]).includes(bucket)
      ? (bucket as Bucket)
      : (BUCKETS.find((b) => sections[b].rows.length > 0) ?? "backlog");

  function tabHref(b: Bucket) {
    return `/orders/ta-followup?bucket=${b}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals Worklist"
        description={`Technical approvals awaiting action, across every order, as of ${fmtDate(wl.today)}.`}
      />

      <div className="space-y-3">
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
      </div>

      <nav aria-label="Bucket" className="flex items-center gap-1 border-b border-border">
        {BUCKETS.map((b) => {
          const active = b === activeBucket;
          return (
            <Link
              key={b}
              href={tabHref(b)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-t-md border-b-2 px-2 py-1.5 text-sm font-semibold transition-colors",
                "hover:bg-surface-muted focus-visible:bg-primary-soft focus-visible:outline-none",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <StatusDot tone={sections[b].tone} />
              {sections[b].title}
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                ({sections[b].rows.length})
              </span>
            </Link>
          );
        })}
      </nav>

      <Section
        title={sections[activeBucket].title}
        subtitle={sections[activeBucket].subtitle}
        rows={sections[activeBucket].rows}
        empty={sections[activeBucket].empty}
        canComplete={wl.canComplete}
      />

      {resolved.length > 0 && (
        <details className="space-y-2 border-t border-border pt-6">
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
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {subtitle} <span className="sr-only">— {title}</span>
      </p>
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

/** Same shared shell as `ta-worklist/page.tsx`'s `Banner` — kept local here
 *  rather than extracted to `components/ui/` since only two files use it and
 *  each carries a slightly different note-level union; not worth a shared
 *  import for one prop-shape difference. */
function Banner({ tone, icon: Icon, children }: { tone: "info" | "warn" | "danger"; icon: LucideIcon; children: React.ReactNode }) {
  const cls = {
    info: "border-border bg-surface-muted text-muted-foreground",
    warn: "border-warning/50 bg-warning-soft text-warning",
    danger: "border-danger/50 bg-danger-soft text-danger",
  }[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-xs", cls)}>
      <Icon className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
      {children}
    </div>
  );
}

function NoteBanner({ note }: { note: ApprovalWorklistNote }) {
  const Icon = note.level === "info" ? Info : note.level === "warn" ? AlertTriangle : OctagonAlert;
  return <Banner tone={note.level} icon={Icon}>{note.text}</Banner>;
}
