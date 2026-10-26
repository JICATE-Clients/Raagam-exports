"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChartMini, ChartEmpty, ChartFrame, ChartLegend, DonutChart } from "@/components/dashboard/charts";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { ToggleGroup } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
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
  type DeskEscalation,
  type TicketType,
} from "@/lib/resolve/desk-types";
import type { Priority } from "@/lib/resolve/types";
import { deskTicketHref, priorityTone } from "./desk-columns";

/*
 * Service Desk ▸ Desk Dashboard (plan §6, spec §5.1 + §8.1). Every number is
 * the server's (`rh_sd_dashboard`) over the current unit, and the page keeps
 * itself current through Realtime — a dashboard someone has to reload is a
 * report, not a dashboard.
 *
 * Drawn with the house chart kit (components/dashboard/charts.tsx), as
 * Resolve Hub ▸ Analytics is: two series at most, legend always shown, hover
 * text on every bar, theme tokens for colour.
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

type Technician = DeskDashboardData["by_technician"][number];
const num = (v: number, danger = false) => (
  <span className={danger && v ? "tabular-nums text-sm font-semibold text-danger" : "tabular-nums text-sm"}>{v}</span>
);
const technicianColumns: Column<Technician>[] = [
  { header: "Technician", cell: (r) => <span className="text-sm">{r.name}</span> },
  { header: "Assigned", align: "right", cell: (r) => num(r.assigned) },
  { header: "In Progress", align: "right", cell: (r) => num(r.in_progress) },
  { header: "On Hold", align: "right", cell: (r) => num(r.on_hold) },
  { header: "Breached", align: "right", cell: (r) => num(r.breached, true) },
];

/** The ten most recent escalations the sweep stamped (`escalation_list`) —
 *  WHY each went up and when, which the breaching queue cannot say. */
const escalationColumns: Column<DeskEscalation>[] = [
  {
    header: "Ref No",
    cell: (r) => (
      <Link href={deskTicketHref(r.id)} className="whitespace-nowrap font-mono text-xs font-medium text-primary hover:underline">
        {r.ref_no}
      </Link>
    ),
  },
  { header: "Request", cell: (r) => <Truncated text={r.title} className="block max-w-[18rem] text-sm" /> },
  {
    header: "Priority",
    cell: (r) => <StatusPill tone={priorityTone(r.priority)}>{PRIORITY_LABEL[r.priority] ?? r.priority}</StatusPill>,
  },
  {
    header: "Why",
    cell: (r) => <span className="whitespace-nowrap text-sm">{ESCALATION_REASON_LABEL[r.reason] ?? r.reason}</span>,
  },
  { header: "When", cell: (r) => <span className="whitespace-nowrap text-sm tabular-nums">{fmtDateTime(r.at)}</span> },
  {
    header: "Assignee",
    cell: (r) =>
      r.assignee_name ? (
        <Truncated text={r.assignee_name} className="block max-w-[11rem] text-sm" />
      ) : (
        <span className="text-sm text-muted-foreground">Unassigned</span>
      ),
  },
];

export function DeskDashboard({ data }: { data: DeskDashboardData }) {
  const locationId = useCurrentLocationId();
  const live = useLiveRefresh(locationId ? { locationId } : null);
  const [period, setPeriod] = useState<Period>("daily");

  const breached = data.breached_response + data.breached_resolution;
  const priorities = data.by_priority.filter((p) => p.open > 0);
  const priorityTotal = priorities.reduce((n, p) => n + p.open, 0);
  const types = data.by_type.filter((t) => t.open > 0);
  const typeTotal = types.reduce((n, t) => n + t.open, 0);
  const trend = data.trend[period];
  const escalations = data.escalation_list;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LiveBadge status={live} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open" value={data.open} hint="New, assigned, in progress or on hold" />
        <Stat label="Unassigned" value={data.unassigned} tone={data.unassigned ? "warning" : "neutral"} hint="Nobody on it yet" />
        <Stat label="At Risk" value={data.at_risk} tone={data.at_risk ? "warning" : "neutral"} hint="80 % of the resolution time used" />
        <Stat
          label="Breached"
          value={breached}
          tone={breached ? "danger" : "neutral"}
          hint={`${data.breached_response} response · ${data.breached_resolution} resolution`}
        />
        <Stat label="On Hold" value={data.on_hold} hint="Resolution clock paused" />
        <Stat label="Resolved Today" value={data.resolved_today} tone="success" hint="Waiting on, or confirmed by, the requester" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartFrame
          className="lg:col-span-2"
          title="New vs resolved"
          subtitle={PERIOD_SUBTITLE[period]}
          aside={
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ChartLegend
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
            bars={trend.map((t) => ({ label: axisLabel(t.d, period), a: t.created, b: t.resolved }))}
            tones={["primary", "success"]}
            format={(b) => `${b.label}: ${b.a} new · ${b.b} resolved`}
          />
        </ChartFrame>
        <ChartFrame title="Technician allocation" subtitle="Live requests per person">
          <DataTable
            columns={withCreatedColumns(technicianColumns, data.by_technician)}
            rows={data.by_technician}
            getKey={(r) => r.profile_id}
            paginate={false}
            bare
            empty="Nobody has a live request."
          />
        </ChartFrame>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame title="By priority" subtitle="Open requests">
          {priorityTotal ? (
            <DonutChart
              slices={priorities.map((p) => ({ label: PRIORITY_LABEL[p.priority], count: p.open, tone: PRIORITY_CHART_TONE[p.priority] }))}
              total={priorityTotal}
              unit="open"
            />
          ) : (
            <ChartEmpty>Nothing open right now.</ChartEmpty>
          )}
        </ChartFrame>
        <ChartFrame title="By type" subtitle="Open requests">
          {typeTotal ? (
            <DonutChart
              slices={types.map((t) => ({ label: TICKET_TYPE_LABEL[t.ticket_type], count: t.open, tone: TYPE_CHART_TONE[t.ticket_type] }))}
              total={typeTotal}
              unit="open"
            />
          ) : (
            <ChartEmpty>Nothing open right now.</ChartEmpty>
          )}
        </ChartFrame>
      </div>

      <ChartFrame
        title="Escalations"
        subtitle={`${data.escalations} live ${data.escalations === 1 ? "request has" : "requests have"} escalated · the latest ten, newest first`}
        aside={
          <Link href="/resolve/desk" className="text-xs font-medium text-primary hover:underline">
            Breaching tab on the Desk Queue
          </Link>
        }
      >
        <DataTable
          columns={withCreatedColumns(escalationColumns, escalations)}
          rows={escalations}
          getKey={(r) => r.id}
          paginate={false}
          bare
          empty="Nothing has escalated."
        />
      </ChartFrame>
    </div>
  );
}
