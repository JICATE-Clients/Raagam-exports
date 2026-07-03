"use client";

import Link from "next/link";
import { AuditList } from "@/components/audit/audit-list";
import { TABLE_LABELS, type RecordAuditRow } from "@/lib/record-audit/types";

interface Current {
  table: string;
  op: string;
  from: string;
  to: string;
}

function buildHref(c: Current, page: number): string {
  const params = new URLSearchParams();
  if (c.table) params.set("table", c.table);
  if (c.op) params.set("op", c.op);
  if (c.from) params.set("from", c.from);
  if (c.to) params.set("to", c.to);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/audit?${qs}` : "/admin/audit";
}

export function AuditBrowser({
  rows,
  page,
  hasMore,
  current,
}: {
  rows: RecordAuditRow[];
  page: number;
  hasMore: boolean;
  current: Current;
}) {
  const field =
    "h-8 rounded-md border border-border bg-surface px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-3">
      {/* Filters submit via GET so filtering is server-driven + shareable via URL */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Record type</span>
          <select name="table" defaultValue={current.table} className={field}>
            <option value="">All</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Action</span>
          <select name="op" defaultValue={current.op} className={field}>
            <option value="">All</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={current.from} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={current.to} className={field} />
        </label>
        <button
          type="submit"
          className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground active:scale-95"
        >
          Filter
        </button>
        <Link
          href="/admin/audit"
          className="flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
        >
          Clear
        </Link>
      </form>

      <AuditList rows={rows} />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Page {page}</span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={buildHref(current, page - 1)}
              className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted"
            >
              Previous
            </Link>
          )}
          {hasMore && (
            <Link
              href={buildHref(current, page + 1)}
              className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
