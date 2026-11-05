import { type ReactNode, Suspense } from "react";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import type { PeriodKey } from "@/lib/analytics/period";
import { PeriodSwitch, ViewSwitch, type BoardView } from "./period-switch";

/**
 * THE FRAME OF EVERY ANALYTICS BOARD (plan https://claude.ai/artifact/87etHN8WiMGTnSiK2JLVQh,
 * user 2026-11-05 "build it"). Every board is the same five rows, drawn from the shared Overview
 * kit (`components/viz/kit.tsx`) so it looks exactly like Purchase ▸ Store Overview:
 *
 *   1. title row — the board, its question, the period and Picture · List
 *   2. Strip — 4–5 numbers with mood lines
 *   3. the picture — the subject drawn (`./pictures.tsx`)
 *   4. three question cards
 *   5. What needs doing? — three cells, each linking to the screen that clears it
 *
 * "List" swaps rows 2–5 for the board's full table, as Store Overview's All lots tab does.
 */

export function BoardHeader({ title, question, period, view }: { title: string; question: string; period: PeriodKey | null; view?: BoardView }) {
  return (
    <PageHeader
      title={title}
      description={question}
      actions={
        <Suspense fallback={null}>
          <div className="flex flex-wrap items-center gap-2">
            {period ? <PeriodSwitch value={period} /> : null}
            {view ? <ViewSwitch value={view} /> : null}
          </div>
        </Suspense>
      }
    />
  );
}

export function viewOf(raw: string | undefined): BoardView {
  return raw === "list" ? "list" : "picture";
}

export function Row3({ children }: { children: ReactNode }) {
  return <div className="grid gap-2.5 lg:grid-cols-3">{children}</div>;
}

/** What a panel says when its source is not the person's to see — a fact about them, said plainly. */
export function NoAccess({ what, screen }: { what: string; screen: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {what} shows to people who can open <b className="font-semibold text-foreground">{screen}</b>.
      </span>
    </p>
  );
}

export function LoadError({ message }: { message?: string }) {
  return (
    <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
      This could not be read{message ? `: ${message}` : "."} Reload the page; if it stays, report it with this sentence.
    </p>
  );
}

/** A count with its noun: 1 order · 3 orders. */
export const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-IN")} ${count === 1 ? one : many}`;
