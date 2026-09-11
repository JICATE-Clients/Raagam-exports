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

const STATUSES = ["all", "pending", "sent", "approved", "rework"] as const;
type StatusFilter = (typeof STATUSES)[number];
const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  sent: "Sent",
  approved: "Approved",
  rework: "Rework",
};

/**
 * Filters (doc/ui/order/tafollowup.md §1). `rework` is not a status the live
 * row ever actually rests at — `markApprovalRework` archives the rejected
 * attempt and resets the live row straight to `pending` for the next try
 * (see approvals-worklist-actions.ts) — so "Rework" here means a `pending`
 * row that has been through at least one rejection (`activeVersion > 1`),
 * and "Pending" means the FIRST attempt. Together the two partition today's
 * `pending` rows with nothing double-counted against Sent/Approved, matching
 * the spec's single ALL/PENDING/SENT/APPROVED/REWORK toggle.
 */
function matchesStatus(row: ApprovalWorklistRow, status: StatusFilter): boolean {
  if (status === "all") return true;
  if (status === "rework") return row.status === "pending" && row.activeVersion > 1;
  if (status === "pending") return row.status === "pending" && row.activeVersion === 1;
  return row.status === status;
}

type Filters = { buyer: string; owner: string; ref: string; status: StatusFilter };

function matchesFilters(row: ApprovalWorklistRow, f: Filters): boolean {
  if (f.buyer && row.buyer !== f.buyer) return false;
  if (f.owner && row.merchandiserId !== f.owner) return false;
  if (f.ref) {
    const needle = f.ref.trim().toLowerCase();
    const hit =
      (row.orderRef?.toLowerCase().includes(needle) ?? false) ||
      (row.amendmentCode?.toLowerCase().includes(needle) ?? false);
    if (!hit) return false;
  }
  if (!matchesStatus(row, f.status)) return false;
  return true;
}

export default async function ApprovalsWorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; buyer?: string; owner?: string; ref?: string; status?: string }>;
}) {
  await requirePermission("orders", "view");
  const sp = await searchParams;
  const bucket = sp.bucket;
  const filters: Filters = {
    buyer: sp.buyer ?? "",
    owner: sp.owner ?? "",
    ref: sp.ref ?? "",
    status: (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusFilter) : "all",
  };
  const wl = await getApprovalsWorklist();

  // Option lists come off the FULL unfiltered set — narrowing them to the
  // current filter would make a buyer disappear from its own dropdown the
  // moment it was selected.
  const buyerOptions = [...new Set(wl.rows.map((r) => r.buyer).filter((v): v is string => !!v))].sort();
  const ownerMap = new Map<string, string>();
  for (const r of wl.rows) if (r.merchandiserId && r.merchandiserName) ownerMap.set(r.merchandiserId, r.merchandiserName);
  const ownerOptions = [...ownerMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const filteredRows = wl.rows.filter((r) => matchesFilters(r, filters));
  const filtering = !!(filters.buyer || filters.owner || filters.ref || filters.status !== "all");

  const backlog = filteredRows.filter((r) => r.bucket === "backlog");
  const dueToday = filteredRows.filter((r) => r.bucket === "today");
  const upcoming = filteredRows.filter((r) => r.bucket === "upcoming");
  const resolved = filteredRows.filter((r) => r.bucket === "resolved");
  const escalatedCount = filteredRows.filter((r) => r.escalated).length;

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

  // Carries the active filters along with a bucket switch — losing them on
  // every tab click would make "filter, then look at Today" a one-shot deal.
  function tabHref(b: Bucket) {
    const params = new URLSearchParams({ bucket: b });
    if (filters.buyer) params.set("buyer", filters.buyer);
    if (filters.owner) params.set("owner", filters.owner);
    if (filters.ref) params.set("ref", filters.ref);
    if (filters.status !== "all") params.set("status", filters.status);
    return `/orders/ta-followup?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals Worklist"
        description={`Technical approvals awaiting action, across every order, as of ${fmtDate(wl.today)}.`}
      />

      <div className="space-y-3">
        {/* Every tile but "Scanned" reflects the ACTIVE filters — "Scanned"
            stays the total, unfiltered count on purpose (its own hint has
            said "Before any filtering" since before this filter bar existed:
            it is a data-health figure, not a view of the current filter). */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Due today" value={dueToday.length} tone={dueToday.length > 0 ? "info" : "neutral"} />
          <Stat
            label="Backlog"
            value={backlog.length}
            hint="Past target, not resolved"
            tone={backlog.length > 0 ? "warning" : "neutral"}
          />
          <Stat
            label="Escalate"
            value={escalatedCount}
            hint="3+ days late"
            tone={escalatedCount > 0 ? "danger" : "neutral"}
          />
          <Stat label="Next 7 days" value={upcoming.length} tone="neutral" />
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

      <FilterBar buyers={buyerOptions} owners={ownerOptions} filters={filters} bucket={activeBucket} />

      {filtering && filteredRows.length === 0 && wl.rows.length > 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No approvals match this filter. {wl.rows.length} total, before filtering.
        </p>
      )}

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

/**
 * Filters (doc/ui/order/tafollowup.md §1) — Buyer, Order/ARI Ref, Merchandiser,
 * Status. A plain `<form method="get">`, no client JS: this page is a server
 * component by design (see `tabHref`'s own note above), and a GET form to its
 * own URL is the native-HTML way to keep that true while still taking
 * multiple filter inputs at once. Date range is deliberately NOT a fifth
 * control here — the bucket tabs below already ARE "Due Today / Due This
 * Week (Next 7 days) / Overdue (Backlog)".
 */
function FilterBar({
  buyers,
  owners,
  filters,
  bucket,
}: {
  buyers: string[];
  owners: [string, string][];
  filters: Filters;
  bucket: Bucket;
}) {
  const active = filters.buyer || filters.owner || filters.ref || filters.status !== "all";
  return (
    <form
      method="get"
      action="/orders/ta-followup"
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-2.5"
    >
      <input type="hidden" name="bucket" value={bucket} />
      {/* Raw <select>s, deliberately — components/ui/select.tsx is a client
          component built for controlled value/onChange, and this bar is a
          plain GET <form> so the page stays server-only (see tabHref's own
          note). AGENTS.md's autofill rule covers exactly this case: hand-
          rolled is fine as long as it sets the opt-out attributes itself, so
          both get autoComplete="off" + the password-manager trio by hand —
          a Buyer/Merchandiser list is master data, not something Chrome
          should ever be re-offering from a saved profile. */}
      <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor="wl-buyer">
        Buyer
        <select
          id="wl-buyer"
          name="buyer"
          defaultValue={filters.buyer}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block h-8 w-40 rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">All buyers</option>
          {buyers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor="wl-owner">
        Merchandiser
        <select
          id="wl-owner"
          name="owner"
          defaultValue={filters.owner}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block h-8 w-40 rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">All merchandisers</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor="wl-ref">
        Order / ARI Ref No.
        {/* Raw <input>, not the shared `Input` primitive — `Input` pulls in
            `field.tsx`'s `useRequiredHold`, which uses React context and
            forces a client boundary; importing it here broke this page's
            server-only build (`createContext` in a Server Component module).
            caps-input: exempt -- a search box, not a stored value (AGENTS.md,
            CAPS §"Exempt": "a search box ... including the one in
            data-picker.tsx"), so no uppercase transform is needed by hand
            either. */}
        <input
          id="wl-ref"
          name="ref"
          defaultValue={filters.ref}
          placeholder="Search…"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block h-8 w-36 rounded-md border border-border bg-surface px-2 text-sm"
        />
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor="wl-status">
        Status
        <select
          id="wl-status"
          name="status"
          defaultValue={filters.status}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block h-8 w-32 rounded-md border border-border bg-surface px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          className="h-8 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
        >
          Apply
        </button>
        {active && (
          <Link
            href={`/orders/ta-followup?bucket=${bucket}`}
            className="h-8 rounded-md border border-border px-3 text-sm leading-8 text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </div>
    </form>
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
