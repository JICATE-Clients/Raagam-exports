import Link from "next/link";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtMoney } from "@/lib/format";
import { fmtAge } from "@/lib/dashboard/format";
import { getApprovals } from "@/lib/dashboard/service";
import type { ApprovalRow, DashboardCaps } from "@/lib/dashboard/types";

const PRIORITY_TONE: Record<ApprovalRow["priority"], StatusTone> = {
  Critical: "danger",
  High: "warning",
  Medium: "info",
  Low: "neutral",
};

const columns: Column<ApprovalRow>[] = [
  {
    header: "Document",
    cell: (r) => (
      <Link
        href={r.href}
        className="font-mono text-xs text-primary hover:underline"
      >
        {r.ref}
      </Link>
    ),
  },
  { header: "Type", cell: (r) => <span className="text-[13px]">{r.type}</span> },
  {
    header: "Party",
    cell: (r) => (
      <span className="block max-w-[220px] truncate text-[13px] text-muted-foreground">
        {r.party ?? "—"}
      </span>
    ),
  },
  {
    header: "Value",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums">
        {r.value == null ? "—" : fmtMoney(r.value, r.currency)}
      </span>
    ),
  },
  {
    header: "Priority",
    cell: (r) => <StatusPill tone={PRIORITY_TONE[r.priority]}>{r.priority}</StatusPill>,
  },
  {
    header: "Waiting",
    cell: (r) => (
      <span className="text-xs text-muted-foreground">{fmtAge(r.ageDays)}</span>
    ),
  },
  {
    /* Navigation to the record's own screen, not row CRUD (LAYOUT.md §6a). */
    header: "Action",
    align: "right",
    cell: (r) => (
      <Link href={r.href} className="text-xs text-primary hover:underline">
        Review →
      </Link>
    ),
  },
];

/**
 * Section 04a — what is waiting on somebody.
 *
 * Read-only by design. Each row links to the document, where the real approve
 * action already lives with its own permission check and audit entry.
 * Approving from a summary row would mean acting on a document you have not
 * opened, across six tables whose approval rules differ — the wrong place to
 * make that decision, and the wrong place to implement it.
 *
 * Priority is derived from age and value; no table in this schema stores one.
 * The footnote says so rather than letting it read as an entered field.
 */
export async function ApprovalsSection({ caps }: { caps: DashboardCaps }) {
  const { rows, total } = await getApprovals(caps);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Pending approvals</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total === 0
              ? "Nothing waiting"
              : `${total} document${total === 1 ? "" : "s"} awaiting action · priority derived from age and value`}
          </p>
        </div>
      </div>
      <DataTable
        bare
        columns={columns}
        rows={rows}
        getKey={(r) => r.key}
      />
    </Card>
  );
}
