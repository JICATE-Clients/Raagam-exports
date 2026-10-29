"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCheck, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import type { AlertItem, ApprovalRow } from "@/lib/dashboard/types";
import { Icon } from "./icon";
import { toneSoft } from "./tone";
import { GLASS } from "./glass";

/** Rows the card lists per tab before handing over to the full page. */
const SHOWN = 5;

/**
 * NEEDS YOU (user 2026-10-29, plan https://claude.ai/artifact/HR3L5D6gDKbcvLS3Cj1S9v):
 * Pending approvals and Alerts were two panels, one of them a seven-column
 * table carrying a single purchase order. Both answer "what is waiting on me",
 * so they are one card with two tabs, each tab saying its count.
 *
 * Alerts opens first when any alert is red; otherwise Approvals does, if there
 * are any. The full approvals table lives on /approvals, one link away.
 */
export function NeedsYouCard({
  approvals,
  approvalsTotal,
  canApprovals,
  alerts,
}: {
  approvals: ApprovalRow[];
  approvalsTotal: number;
  /** False when the viewer can see no approval queue at all: the tab is then not offered. */
  canApprovals: boolean;
  alerts: AlertItem[];
}) {
  const red = alerts.some((a) => a.tone === "danger");
  const [tab, setTab] = useState<"approvals" | "alerts">(
    !canApprovals || red || approvalsTotal === 0 ? "alerts" : "approvals",
  );
  const waiting = (canApprovals ? approvalsTotal : 0) + alerts.length;

  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col overflow-hidden")}>
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h3 className="text-sm font-semibold">Needs you</h3>
        {waiting > 0 && (
          <span className="rounded-full bg-danger-soft px-2 text-[11px] font-bold tabular-nums text-danger">{waiting}</span>
        )}
      </div>

      {canApprovals && (
        <ToggleGroup
          role="tablist"
          label="Needs you"
          value={tab}
          onChange={setTab}
          className="mx-4 flex"
          options={[
            { value: "approvals", label: "Approvals", count: approvalsTotal },
            { value: "alerts", label: "Alerts", count: alerts.length },
          ]}
        />
      )}

      <div className="px-2 pb-2 pt-1.5" role={canApprovals ? "tabpanel" : undefined}>
        {tab === "approvals" ? <ApprovalRows rows={approvals} total={approvalsTotal} /> : <AlertRows items={alerts} />}
      </div>
    </Card>
  );
}

function ApprovalRows({ rows, total }: { rows: ApprovalRow[]; total: number }) {
  if (rows.length === 0) return <AllClear title="Nothing waiting for approval" />;
  return (
    <>
      <ul>
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.key} className="border-b border-[var(--glass-edge)] last:border-0">
            <Link href={r.href} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-muted">
              <span className="grid size-7 place-items-center rounded-lg bg-primary-soft text-primary">
                <FileText className="size-[15px]" />
              </span>
              <span className="min-w-0">
                <Truncated text={r.ref} className="block font-mono text-[12.5px] font-semibold" />
                <Truncated
                  text={[r.type, r.party, `waiting ${r.ageDays} day${r.ageDays === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  className="block text-[11.5px] text-muted-foreground"
                />
              </span>
              <span className="text-right text-xs font-semibold tabular-nums">
                {r.value != null ? fmtMoney(r.value, r.currency) : "—"}
                <span className="block text-[11px] font-medium text-primary">Review →</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > SHOWN && (
        <Link href="/approvals" className="block px-2 pt-1.5 text-xs font-semibold text-primary hover:underline">
          All {total} approvals →
        </Link>
      )}
    </>
  );
}

function AlertRows({ items }: { items: AlertItem[] }) {
  if (items.length === 0) return <AllClear title="Nothing needs attention" />;
  return (
    <ul>
      {items.map((a) => {
        const inner = (
          <>
            <span className={cn("grid size-7 place-items-center rounded-lg", toneSoft[a.tone])}>
              <Icon name={a.icon} className="size-[15px]" />
            </span>
            <span className="min-w-0">
              <Truncated text={a.title} className="block text-[13px] font-semibold" />
              <Truncated text={a.body} className="block text-[11.5px] text-muted-foreground" />
            </span>
          </>
        );
        const cls = "grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-2";
        return (
          <li key={a.key} className="border-b border-[var(--glass-edge)] last:border-0">
            {a.href ? (
              <Link href={a.href} className={cn(cls, "transition-colors hover:bg-surface-muted")}>{inner}</Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AllClear({ title }: { title: string }) {
  return (
    <p className="flex items-center gap-2.5 px-2 py-3 text-[13px] text-muted-foreground">
      <span className="grid size-7 place-items-center rounded-lg bg-success-soft text-success">
        <CheckCheck className="size-4" />
      </span>
      {title}
    </p>
  );
}
