"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Check, TriangleAlert, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/ui/pagination";
import { Truncated } from "@/components/ui/truncated";
import { Clock } from "@/components/resolve/inbox/inbox-bits";
import { usePagination } from "@/lib/use-pagination";
import { cn } from "@/lib/utils";
import type { QueueClock } from "./queue-clock";

/*
 * THE QUEUE ROW — Triage, Desk Queue and All Jobs drawn as the Inbox draws a
 * ticket (Resolve mobile redesign, user "okay go" 2026-10-26): lead tile ·
 * title (danger glyph) · ONE muted line · ONE clock · a small Assign. The same
 * row on every width; a desktop simply has a longer line. Tapping a row opens
 * the ticket in the Inbox (`/resolve/inbox?t=<id>`), where every step lives.
 *
 * These are work QUEUES, not registers of records: no Created Date / Created
 * User (AGENTS "Created Date / Created User" covers listings of records).
 */

export function inboxHref(id: string): string {
  return `/resolve/inbox?t=${id}`;
}

/** The priority stripe down a row's left edge (Desk Queue). */
export type Stripe = "danger" | "warning" | "info" | "neutral";
const STRIPE: Record<Stripe, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
  neutral: "bg-border",
};

/**
 * A paged card of rows. Pages with the app-wide "Rows per page" (AGENTS
 * "Pagination"), so a 300-job queue is not 300 rows on a phone.
 */
export function QueueList<T>({
  rows,
  getKey,
  renderRow,
  empty,
  label,
}: {
  rows: T[];
  getKey: (r: T) => string;
  renderRow: (r: T) => ReactNode;
  empty: string;
  label: string;
}) {
  const pg = usePagination(rows);
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div role="list" aria-label={label} className="overflow-hidden rounded-xl border border-border bg-surface">
        {pg.paged.map((r) => (
          <div key={getKey(r)} role="listitem" className="border-b border-border last:border-b-0">
            {renderRow(r)}
          </div>
        ))}
      </div>
      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />
    </div>
  );
}

/**
 * One ticket. `lead` (lane tile or score badge) sits OUTSIDE the tap target so
 * it may be a button of its own; the title and line are the tap target — a
 * link to the Inbox, or, in tick mode, the toggle.
 */
export function QueueRow({
  id,
  lead,
  title,
  titleIcon,
  dangerous,
  refNo,
  meta,
  clock,
  stripe,
  action,
  below,
  selecting = false,
  selected = false,
  onToggle,
}: {
  id: string;
  lead: ReactNode;
  title: string;
  /** A glyph before the title besides the danger one (Desk's ⚡ override). */
  titleIcon?: ReactNode;
  dangerous?: boolean;
  refNo: string;
  /** The muted line after the ref — place · trade · assignee, joined here. */
  meta: (string | null | undefined | false)[];
  clock: QueueClock;
  stripe?: Stripe;
  /** The row's own action (Assign) — hidden while ticking. */
  action?: ReactNode;
  /** Drawn under the row, full width (the score's explanation). */
  below?: ReactNode;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const line = meta.filter(Boolean).join(" · ");
  const body = (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1 text-[13px] font-semibold">
        {dangerous && <TriangleAlert className="size-3.5 flex-none text-danger" aria-label="Dangerous" />}
        {titleIcon}
        <Truncated text={title} className="min-w-0" />
      </span>
      <span className="flex gap-1 text-[11.5px] text-muted-foreground">
        <span className="flex-none font-mono text-[10.5px] leading-[17px]">{refNo}</span>
        {line && <Truncated text={`· ${line}`} className="min-w-0" />}
      </span>
    </span>
  );
  const target =
    "flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

  return (
    <div className={cn("relative", selected && "bg-primary-soft")}>
      {stripe && <span className={cn("absolute inset-y-0 left-0 w-[3px]", STRIPE[stripe])} aria-hidden="true" />}
      <div className="flex items-center gap-2.5 py-2 pl-3 pr-2.5">
        {selecting && (
          <span
            className={cn(
              "flex size-5 flex-none items-center justify-center rounded-full border-[1.5px]",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
            )}
            aria-hidden="true"
          >
            {selected && <Check className="size-3" />}
          </span>
        )}
        {lead}
        {selecting ? (
          // button-shape: exempt -- a whole list row is the tap target in tick mode, not an action button
          <button type="button" aria-pressed={selected} onClick={() => onToggle?.(id)} className={target}>
            {body}
          </button>
        ) : (
          <Link href={inboxHref(id)} className={cn(target, "hover:text-primary")}>
            {body}
          </Link>
        )}
        <span className="flex flex-none flex-col items-end gap-1 md:flex-row md:items-center md:gap-3">
          <Clock tone={clock.tone}>{clock.text}</Clock>
          {!selecting && action}
        </span>
      </div>
      {below}
    </div>
  );
}

/** The small per-row Assign. */
export function AssignButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={disabled}>
      <UserPlus aria-hidden />
      Assign
    </Button>
  );
}

/** "Select" — turns tick mode on and off. Lives in the screen's top row. */
export function SelectToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Button size="sm" variant={on ? "subtle" : "outline"} onClick={() => onChange(!on)}>
      {on ? <X aria-hidden /> : <Check aria-hidden />}
      {on ? "Done" : "Select"}
    </Button>
  );
}

/**
 * The bar docked at the bottom while ticking: "N selected · Clear · Assign to…".
 * Sticky, not fixed — it rides the bottom of the content pane, so it never
 * covers the phone's tab bar and is no overlay for the reload guard to know.
 *
 * toolbar-size: exempt -- a docked bulk bar, not the header row; every button in it is `sm` together.
 */
export function SelectDock({
  count,
  total,
  onAll,
  onClear,
  onAssign,
  disabled,
}: {
  count: number;
  total: number;
  onAll: () => void;
  onClear: () => void;
  onAssign: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-lg"
    >
      <span className="mr-auto text-sm font-semibold tabular-nums">{count} selected</span>
      {count < total ? (
        <Button size="sm" variant="ghost" onClick={onAll}>
          All {total}
        </Button>
      ) : null}
      <Button size="sm" variant="outline" onClick={onClear} disabled={!count}>
        Clear
      </Button>
      <Button size="sm" onClick={onAssign} disabled={!count || disabled}>
        <UserPlus aria-hidden />
        Assign to…
      </Button>
    </div>
  );
}
