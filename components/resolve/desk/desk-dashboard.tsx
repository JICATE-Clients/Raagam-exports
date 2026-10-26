"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BarChartMini } from "@/components/dashboard/charts";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { BarLegend, HBar, InsightCard, KpiTile, StackBar } from "@/components/resolve/analytics/analytics-view";
import { LiveBadge } from "@/components/resolve/live/live-badge";
import { useLiveRefresh } from "@/components/resolve/live/use-live-refresh";
import { useCurrentLocationId } from "@/lib/auth/location-context";
import { fmtDateTime } from "@/lib/format";
import type { DashboardTone } from "@/lib/dashboard/types";
import {
  ESCALATION_REASON_LABEL,
  PRIORITY_LABEL,
  TICKET_TYPE_LABEL,
  type DeskDashboard as DeskDashboardData,
  type TicketType,
} from "@/lib/resolve/desk-types";
import type { Priority } from "@/lib/resolve/types";
import { deskTicketHref, priorityTone } from "./desk-columns";

/*
 * Service Desk ▸ Desk Dashboard (plan §6, spec §5.1 + §8.1), redrawn
 * phone-first (resolve-mobile mockup, 2026-10-26). Every number is the
 * server's (`rh_sd_dashboard`) over the current unit, and the page keeps
 * itself current through Realtime — a dashboard someone has to reload is a
 * report, not a dashboard.
 *
 * Four tiles (On Hold and Resolved Today ride as small text under them), the
 * technicians as stacked bars, a compact trend chart, and the latest
 * escalations as a short list. The two donuts became bar lists (By priority,
 * By type) — same numbers, a third of the height.
 */

type Period = "daily" | "weekly" | "monthly";
const PERIODS: { value: Period; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
const PERIOD_SUBTITLE: Record<Period, string> = {
  daily: "Last 14 days",
  weekly: "Last 12 weeks, by week start",
  monthly: "Last 12 months",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Axis labels stay short (AGENTS "Dates": chart axis labels exempt). Read
 *  straight off the ISO string so no timezone can shift a day. */
function axisLabel(iso: string, p: Period): string {
  if (p === "monthly") return `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(2, 4)}`;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const PRIORITY_CHART_TONE: Record<Priority, DashboardTone> = {
  urgent: "danger",
  high: "warning",
  medium: "info",
  low: "muted",
};
const TYPE_CHART_TONE: Record<TicketType, DashboardTone> = {
  incident: "primary",
  service: "accent",
  change: "info",
};

const TECH_PARTS: { key: "assigned" | "in_progress" | "on_hold"; label: string; tone: DashboardTone }[] = [
  { key: "assigned", label: "Assigned", tone: "primary" },
  { key: "in_progress", label: "In progress", tone: "success" },
  { key: "on_hold", label: "On hold", tone: "warning" },
];

export function DeskDashboard({ data }: { data: DeskDashboardData }) {
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [period, setPeriod] = useState<Period>("daily");

  const breached = data.breached_response + data.breached_resolution;
  const priorities = data.by_priority.filter((p) => p.open > 0);
  const types = data.by_type.filter((t) => t.open > 0);
  const splitMax = Math.max(1, data.open);
  const trend = data.trend[period];
  const escalations = data.escalation_list;
  const techMax = Math.max(1, ...data.by_technician.map((r) => r.assigned + r.in_progress + r.on_hold));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <LiveBadge status={live} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile label="Open" value={data.open} note={`${data.on_hold} on hold · ${data.resolved_today} resolved today`} />
        <KpiTile
          label="Unassigned"
          value={data.unassigned}
          tone={data.unassigned ? "warning" : undefined}
          note={data.unassigned ? "hand them out" : "everyone has an owner"}
          noteTone={data.unassigned ? "warning" : undefined}
        />
        <KpiTile
          label="At risk"
          value={data.at_risk}
          tone={data.at_risk ? "warning" : undefined}
          note="80 % of resolution time used"
        />
        <KpiTile
          label="Breached"
          value={breached}
          tone={breached ? "danger" : undefined}
          note={`${data.breached_response} response · ${data.breached_resolution} resolution`}
          noteTone={breached ? "danger" : undefined}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <InsightCard title="Technicians" aside={<BarLegend items={TECH_PARTS.map((p) => ({ label: p.label, tone: p.tone }))} />}>
          {data.by_technician.length ? (
            <div className="flex flex-col gap-2">
              {data.by_technician.map((r) => (
                <StackBar
                  key={r.profile_id}
                  label={r.name}
                  max={techMax}
                  parts={TECH_PARTS.map((p) => ({ value: r[p.key], tone: p.tone, label: p.label.toLowerCase() }))}
                  end={r.breached ? <StatusPill tone="danger">{r.breached} breached</StatusPill> : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">Nobody has a live request.</p>
          )}
        </InsightCard>

        <InsightCard
          title="Escalations"
          aside={
            <Link href="/resolve/desk" className="text-xs font-medium text-primary hover:underline">
              Desk Queue ▸ Breaching
            </Link>
          }
        >
          <p className="-mt-1 text-xs text-muted-foreground">
            {data.escalations} live {data.escalations === 1 ? "request has" : "requests have"} escalated · latest first
          </p>
          {escalations.length ? (
            <ul className="-mx-3 divide-y divide-border border-t border-border">
              {escalations.map((r) => (
                <li key={r.id}>
                  <Link
                    href={deskTicketHref(r.id)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 hover:bg-surface-muted"
                  >
                    <span className="flex min-w-0 flex-col">
                      <Truncated text={r.title} className="text-sm font-medium" />
                      <Truncated
                        text={`${r.ref_no} · ${ESCALATION_REASON_LABEL[r.reason] ?? r.reason} · ${r.assignee_name ?? "Unassigned"}`}
                        className="text-xs text-muted-foreground"
                      />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="flex flex-col items-end gap-0.5">
                        <StatusPill tone={priorityTone(r.priority)}>{PRIORITY_LABEL[r.priority] ?? r.priority}</StatusPill>
                        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(r.at)}</span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">Nothing has escalated.</p>
          )}
        </InsightCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <InsightCard
          className="lg:col-span-2"
          title={
            <span>
              New vs resolved <span className="text-xs font-normal text-muted-foreground">· {PERIOD_SUBTITLE[period]}</span>
            </span>
          }
          aside={
            <div className="flex flex-wrap items-center justify-end gap-3">
              <BarLegend
                items={[
                  { label: "New", tone: "primary" },
                  { label: "Resolved", tone: "success" },
                ]}
              />
              <ToggleGroup label="Trend period" value={period} onChange={setPeriod} options={PERIODS} />
            </div>
          }
        >
          <BarChartMini
            height="sm"
            bars={trend.map((t) => ({ label: axisLabel(t.d, period), a: t.created, b: t.resolved }))}
            tones={["primary", "success"]}
            format={(b) => `${b.label}: ${b.a} new · ${b.b} resolved`}
          />
        </InsightCard>

        <InsightCard title="Open by priority and type">
          {priorities.length || types.length ? (
            <div className="flex flex-col gap-2">
              {priorities.map((p) => (
                <HBar key={p.priority} label={PRIORITY_LABEL[p.priority]} value={p.open} max={splitMax} tone={PRIORITY_CHART_TONE[p.priority]} />
              ))}
              {priorities.length > 0 && types.length > 0 && <div className="border-t border-border" />}
              {types.map((t) => (
                <HBar key={t.ticket_type} label={TICKET_TYPE_LABEL[t.ticket_type]} value={t.open} max={splitMax} tone={TYPE_CHART_TONE[t.ticket_type]} />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">Nothing open right now.</p>
          )}
        </InsightCard>
      </div>
    </div>
  );
}
