"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight } from "lucide-react";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDateTime } from "@/lib/format";
import {
  tableLabel,
  type AuditOperation,
  type RecordAuditRow,
} from "@/lib/record-audit/types";
import { cn } from "@/lib/utils";

const OP: Record<AuditOperation, { label: string; tone: StatusTone }> = {
  INSERT: { label: "Created", tone: "success" },
  UPDATE: { label: "Updated", tone: "info" },
  DELETE: { label: "Deleted", tone: "danger" },
};

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

/** A chronological, expandable list of record changes with old → new diffs. */
export function AuditList({
  rows,
  showRecord = true,
}: {
  rows: RecordAuditRow[];
  showRecord?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
        No changes recorded.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {rows.map((r) => {
        const meta = OP[r.operation];
        const open = openId === r.id;
        const fields = r.operation === "UPDATE" ? (r.changed_fields ?? []) : [];
        return (
          <div key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : r.id)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-muted/60"
            >
              <ChevronRight
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  {showRecord && (
                    <span className="text-sm font-medium text-foreground">
                      {tableLabel(r.table_name)}
                      {r.record_id && (
                        <span className="ml-1 font-mono text-xs text-muted-foreground">
                          #{r.record_id.slice(0, 8)}
                        </span>
                      )}
                    </span>
                  )}
                  {r.operation === "UPDATE" && fields.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {fields.length} field{fields.length > 1 ? "s" : ""} changed
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {r.actor_name ?? r.actor_email ?? "System"}
                  </span>
                  {" · "}
                  <span title={fmtDateTime(r.created_at)}>
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </button>

            {open && (
              <div className="border-t border-border bg-surface-muted/30 px-3 py-2.5 pl-10 text-xs">
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  {fmtDateTime(r.created_at)}
                </div>
                {r.operation === "UPDATE" ? (
                  <table className="w-full">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground">
                        <th className="pb-1 pr-3 text-left font-medium">Field</th>
                        <th className="pb-1 pr-3 text-left font-medium">Previous</th>
                        <th className="pb-1 text-left font-medium">New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr key={f} className="align-top">
                          <td className="py-0.5 pr-3 font-mono text-foreground">{f}</td>
                          <td className="py-0.5 pr-3 text-danger">{fmtVal(r.old_data?.[f])}</td>
                          <td className="py-0.5 text-success">{fmtVal(r.new_data?.[f])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Snapshot data={r.operation === "DELETE" ? r.old_data : r.new_data} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Snapshot({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <p className="text-muted-foreground">No data.</p>;
  const entries = Object.entries(data).filter(
    ([k]) => k !== "id" && !k.endsWith("_at"),
  );
  return (
    <div className="space-y-0.5">
      {entries.slice(0, 24).map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <span className="w-40 shrink-0 font-mono text-muted-foreground">{k}</span>
          <span className="min-w-0 flex-1 text-foreground">{fmtVal(v)}</span>
        </div>
      ))}
    </div>
  );
}
