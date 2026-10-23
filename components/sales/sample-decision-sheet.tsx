"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * ONE SAMPLE DECISION, IN ORDER APPROVAL'S LAYOUT — the sheet Plan Approval,
 * PD Request and PD Acknowledge open a record in (2026-10-15).
 * `orders/budget-approval/approval-overview.tsx` is the model:
 *
 *   left   → the record's IDENTITY: its number, pills and facts;
 *   middle → the BODY the decision is about;
 *   right  → the TRAIL, then the override warning.
 *
 * The decision itself sits in the sheet's header (`actions` — an
 * `ApprovalActionBar` run with `overrideNote={false}`, because the warning is
 * said here, in the trail column, before the click).
 *
 * Two exports, because Plan Approval's overview owns state its columns share
 * (the full-report sheet both the left button and a click on the figures
 * open): `SampleDecisionSheet` is the sheet and its titled crumb,
 * `SampleDecisionColumns` the three columns inside it.
 */
export function SampleDecisionSheet({
  open,
  onClose,
  title,
  crumb,
  recordNo,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Where the record lives — "Sample / Plan Approval". */
  crumb: string;
  /** The record's number, closing the crumb in mono. */
  recordNo: ReactNode;
  /** The header's decision bar; undefined while there is nothing to decide. */
  actions?: ReactNode;
  /** `SampleDecisionColumns`, or a loading / unreadable line. */
  children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex flex-col">
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {`${crumb} / `}
            <span className="font-mono text-foreground">{recordNo}</span>
          </span>
        </span>
      }
      headerActions={actions}
      size="lg"
      fullBleed
    >
      {children}
    </Sheet>
  );
}

/** What a sheet says before the record arrives, or when it cannot be read. */
export function SampleDecisionWait({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

export function SampleDecisionColumns({
  identity,
  body,
  trail,
  override = false,
  onBodyClick,
}: {
  identity: ReactNode;
  body: ReactNode;
  trail?: ReactNode;
  /** The user acts as an override (`verdict.is_override`) — said in the trail. */
  override?: boolean;
  /** A click anywhere on the body — Plan Approval opens its full report. A
   *  pointer shortcut only: the identity column must carry the keyboard's way. */
  onBodyClick?: () => void;
}) {
  return (
    <div className="grid items-start gap-3 xl:grid-cols-12">
      {/* ═══ LEFT — the record's identity ═══ */}
      <div className="xl:col-span-3">{identity}</div>

      {/* ═══ MIDDLE — what the decision is about ═══ */}
      <div className={cn("min-w-0 space-y-3 xl:col-span-6", onBodyClick && "cursor-pointer")} onClick={onBodyClick}>
        {body}
      </div>

      {/* ═══ RIGHT — the trail, then the override ═══ */}
      <div className="space-y-3 xl:col-span-3">
        {trail}
        {/* THE OVERRIDE, SAID BEFORE THE CLICK (the order page's rule) — the
            header's action bar runs with `overrideNote={false}`. */}
        {override && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You are not an approver on this step — acting here is recorded as an override.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The identity column's label · value list — the shape Plan Approval's left
 * card draws. A null value prints a dash; a row the caller has nothing for is
 * left out by the caller, not drawn empty.
 */
export function DecisionFacts({ facts, children }: { facts: [string, string | null][]; children?: ReactNode }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {facts.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 text-right">
            <Truncated text={value ?? "—"} className="block text-xs font-semibold text-foreground" />
          </dd>
        </div>
      ))}
      {/* A row that is not one line — Plan Approval's samples, one per line. */}
      {children}
    </dl>
  );
}

/** The identity card's head: a two-letter tile, the record's number, a sub-line. */
export function DecisionTitle({ tile, number, sub }: { tile: string; number: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-primary-soft text-lg font-bold text-primary">
        {tile}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-semibold text-foreground">{number}</div>
        {sub}
      </div>
    </div>
  );
}
