"use client";

import { TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { spanWords, ticketStatusTone } from "@/lib/resolve/sla";
import { STATUS_LABEL, type SimilarTicket } from "@/lib/resolve/types";

/**
 * "ALREADY REPORTED HERE" — the open reports at the chosen place, each with a
 * Join button. Joining is always the reporter's own click (spec §4: never
 * auto-join, and never merge a dangerous report): the panel offers, the form's
 * own Send stays the default.
 */
export function SimilarReports({
  items,
  checkedAtMs,
  dangerous,
  joiningId,
  onJoin,
}: {
  items: SimilarTicket[];
  /** When the list was fetched — ages are worded against this, never `Date.now()` in render. */
  checkedAtMs: number;
  dangerous: boolean;
  joiningId: string | null;
  onJoin: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Already reported here"
      className="rounded-lg border border-warning/40 bg-warning-soft/40 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4 text-warning" aria-hidden />
        Already reported here
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {dangerous
          ? "You marked this dangerous, so it will be sent as a new report unless you join one below."
          : "If one of these is the same problem, join it instead — you will be told when it is fixed."}
      </p>
      <ul className="mt-2 divide-y divide-border">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{t.ref_no}</span>
                <StatusPill tone={ticketStatusTone(t.status)}>{STATUS_LABEL[t.status]}</StatusPill>
                {t.is_dangerous ? (
                  <StatusPill tone="danger">
                    <TriangleAlert className="h-3 w-3" aria-hidden />
                    Dangerous
                  </StatusPill>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm text-foreground">
                <Truncated>{t.title}</Truncated>
              </p>
              <p className="text-xs text-muted-foreground">
                {spanWords(checkedAtMs - new Date(t.created_at).getTime())} ago
                {t.joiners > 0 ? ` · ${t.joiners} ${t.joiners === 1 ? "person has" : "people have"} joined` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={joiningId !== null}
              onClick={() => onJoin(t.id)}
            >
              {joiningId === t.id ? "Joining…" : "Join this report"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
