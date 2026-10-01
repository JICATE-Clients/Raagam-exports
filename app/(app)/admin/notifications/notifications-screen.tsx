"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Pencil, Trash2, Undo2, Users, XCircle } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Select } from "@/components/ui/select";
import { DATE_MAX, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { RowIconAction } from "@/components/ui/row-actions";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EVENT_MODULE_LABEL, NOTIFICATION_EVENTS, notificationEvent } from "@/lib/notifications/events";
import { loadDispatchRecipients, recallDispatch, revokeDevice } from "@/lib/notifications/admin-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { EventSettingsSheet } from "./event-settings-sheet";
import { SendTab } from "./send-tab";
import { SettingsTab } from "./settings-tab";
import {
  DISPATCH_STATUS_FILTERS,
  DISPATCH_STATUS_LABEL,
  deviceName,
  type DispatchPage,
  type DispatchRow,
  type DispatchStatus,
  type EventOverview,
  type NotificationDevice,
  type NotificationOverview,
  type ReachablePerson,
  type Retention,
} from "@/lib/notifications/admin-types";

export type NotificationsTab = "overview" | "send" | "log" | "devices" | "settings";

type Perms = { canEdit: boolean; canCreate: boolean; canDelete: boolean };

type LogFilters = { event: string; status: string; from: string; to: string };

const STATUS_TONE: Record<DispatchStatus, StatusTone> = {
  delivered: "success",
  fell_back: "warning",
  no_recipients: "danger",
  disabled: "neutral",
  push_failed: "warning",
  recalled: "neutral",
  error: "danger",
};

/** Only an administrator's own sends can be taken back (0676 enforces it too). */
const RECALLABLE = new Set(["admin.broadcast", "admin.test"]);

const SOURCE_LABEL: Record<DispatchRow["source"], string> = {
  action: "Someone's action",
  cron: "Scheduled job",
  admin: "Administrator",
};

/**
 * Administration ▸ System ▸ Notifications.
 *
 * Overview answers the three questions an admin cannot answer from their own
 * bell — is the plumbing set up, can people be reached, which alerts are going
 * nowhere — and each alert's pencil opens its switches and CC (Phase 2). Send
 * is a Test and an Announcement; the Log is every dispatch (an announcement
 * can be taken back there); Devices is every registered phone or browser.
 */
export function NotificationsScreen({
  initialTab,
  overview,
  log,
  logFilters,
  devices,
  showBody,
  meId,
  perms,
  retention,
}: {
  initialTab: NotificationsTab;
  overview: NotificationOverview;
  log: DispatchPage;
  logFilters: LogFilters;
  devices: NotificationDevice[];
  showBody: boolean;
  meId: string;
  perms: Perms;
  retention: Retention;
}) {
  const [tab, setTab] = useState<string>(initialTab);

  /* The tab is kept in the URL so a refresh or a shared link lands on it —
     without a server round trip: the three reads already arrived together. */
  const changeTab = (key: string) => {
    setTab(key);
    try {
      const url = new URL(window.location.href);
      if (key === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", key);
      window.history.replaceState(null, "", url);
    } catch {
      /* the tab still switches */
    }
  };

  const failing = devices.filter((d) => d.failure_count > 0).length;

  return (
    <Tabs
      value={tab}
      onChange={changeTab}
      items={[
        { key: "overview", label: "Overview", content: <OverviewTab overview={overview} perms={perms} /> },
        {
          key: "send",
          label: "Send",
          content: <SendTab people={overview.people} roles={overview.roles} meId={meId} canCreate={perms.canCreate} />,
        },
        {
          key: "log",
          label: "Log",
          content: <LogTab log={log} filters={logFilters} showBody={showBody} canDelete={perms.canDelete} />,
        },
        {
          key: "devices",
          label: `Devices (${devices.length})`,
          problems: failing || undefined,
          content: <DevicesTab devices={devices} canEdit={perms.canEdit} />,
        },
        {
          key: "settings",
          label: "Settings",
          content: <SettingsTab retention={retention} canEdit={perms.canEdit} canDelete={perms.canDelete} />,
        },
      ]}
    />
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ overview, perms }: { overview: NotificationOverview; perms: Perms }) {
  const { plumbing, events, activeLogins, withDevice, people, roles } = overview;
  const [editing, setEditing] = useState<EventOverview | null>(null);
  const sent = events.reduce((n, e) => n + e.sent30, 0);
  const fellBack = events.reduce((n, e) => n + e.fellBack30, 0);
  const nobody = events.reduce((n, e) => n + e.reachedNobody30, 0);
  const gaps = routingGaps(events);
  const noDevice = people.filter((p) => p.is_active && p.device_count === 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Is it set up?</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {plumbing.map((p) => (
            <div key={p.key} className="flex items-start gap-2 text-sm">
              {p.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              )}
              <div>
                <span className="font-medium text-foreground">{p.label}</span>
                <span className="text-muted-foreground"> — {p.ok ? "configured" : "not configured"}</span>
                {!p.ok && <p className="text-xs text-muted-foreground">{p.missing}</p>}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Can get alerts on a device"
          value={`${withDevice} of ${activeLogins}`}
          hint="active logins with alerts turned on"
          tone={withDevice < activeLogins ? "warning" : "success"}
        />
        <Stat label="Alerts sent" value={sent} hint="last 30 days" />
        <Stat
          label="Went to administrators"
          value={fellBack}
          hint="nobody else was set up — last 30 days"
          tone={fellBack ? "warning" : "neutral"}
        />
        <Stat
          label="Reached nobody"
          value={nobody}
          hint="last 30 days"
          tone={nobody ? "danger" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alerts with nobody to go to</CardTitle>
        </CardHeader>
        <CardBody>
          {gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every alert has someone to go to.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {gaps.map((g) => (
                <li key={g.key + g.kind} className="flex items-start gap-2">
                  <span className="mt-0.5">
                    <StatusPill tone={g.tone} className="whitespace-nowrap">
                      {g.kind === "role" ? "Empty role" : g.kind === "nobody" ? "Lost" : "To admins"}
                    </StatusPill>
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{g.label}</span>{" "}
                    <span className="text-muted-foreground">{g.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Every alert · last 30 days</CardTitle>
        </CardHeader>
        <DataTable
          bare
          paginate={false}
          rows={events}
          getKey={(e) => e.key}
          /* A catalog of alert TYPES, not records — no created_at, so this
             adds nothing; it is here so the rule is applied, not argued with.
             The Log and Devices tables carry their own time column ("When",
             "Turned on"): a dispatch is mostly raised by a scheduled job and a
             device by its own owner, so a Created User column would be a
             column of dashes (see the exemptions in admin-service.ts). */
          columns={withCreatedColumns(
            [
              ...eventColumns(people),
              {
                header: "",
                align: "right",
                cell: (e) => (
                  <RowIconAction
                    label="Settings"
                    name={e.label}
                    icon={Pencil}
                    onClick={() => setEditing(e)}
                    disabledReason={perms.canEdit ? null : "Changing alerts needs the Edit permission on Administration"}
                  />
                ),
              },
            ],
            events,
          )}
        />
      </Card>

      {editing && (
        <EventSettingsSheet
          key={editing.key}
          event={editing}
          roles={roles}
          people={people}
          canEdit={perms.canEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {noDevice.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alerts not turned on ({noDevice.length})</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-xs text-muted-foreground">
              These people see alerts only in the bell, while the app is open. They turn alerts on from the bell
              menu, or the &quot;Turn on alerts&quot; card — on a phone, from the installed app.
            </p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {noDevice.map((p) => (
                <li key={p.user_id}>
                  <span className="font-medium text-foreground">{p.full_name || p.email || "—"}</span>
                  {p.roles && <span className="text-xs text-muted-foreground"> · {p.roles}</span>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

type Gap = { key: string; kind: "role" | "fallback" | "nobody"; label: string; text: string; tone: StatusTone };

/**
 * THE PANEL THAT PREVENTS THE 2026-09-30 AUDIT'S FINDING. An alert addressed
 * to a role nobody holds is visible HERE, before it fires, not when the
 * fallback copy lands in an admin's bell. Dynamic audiences (a merchandiser
 * per order) cannot be resolved ahead of time, so their 30-day history speaks
 * for them instead.
 */
function routingGaps(events: EventOverview[]): Gap[] {
  const out: Gap[] = [];
  for (const e of events) {
    if (!e.enabled) continue;
    if (e.staticRole && e.roleHolders === 0) {
      out.push({
        key: e.key,
        kind: "role",
        label: e.label,
        tone: "danger",
        text: `goes to the ${e.staticRole} role, and nobody active holds it. ${
          e.fallbackToAdmins ? "Each one goes to the administrators instead." : "Each one reaches nobody."
        } Give the role to someone in Access Control.`,
      });
    }
    if (e.fellBack30 > 0) {
      out.push({
        key: e.key,
        kind: "fallback",
        label: e.label,
        tone: "warning",
        text: `— ${e.fellBack30} went to the administrators in 30 days because the person it was meant for has no login (an employee with no linked user, or an empty role).`,
      });
    }
    if (e.reachedNobody30 > 0) {
      out.push({
        key: e.key,
        kind: "nobody",
        label: e.label,
        tone: "danger",
        text: `— ${e.reachedNobody30} reached nobody at all in 30 days.`,
      });
    }
  }
  return out;
}

const eventColumns = (people: ReachablePerson[]): Column<EventOverview>[] => [
  {
    header: "Alert",
    cell: (e) => (
      <div>
        <div className="font-medium text-foreground">{e.label}</div>
        <div className="text-xs text-muted-foreground">{EVENT_MODULE_LABEL[e.module]}</div>
      </div>
    ),
  },
  {
    header: "Goes to",
    cell: (e) => {
      const names = e.ccUserIds
        .map((id) => people.find((p) => p.user_id === id))
        .map((p) => p?.full_name || p?.email)
        .filter(Boolean);
      const extra = [
        e.ccRoleIds.length ? `${e.ccRoleIds.length} role${e.ccRoleIds.length === 1 ? "" : "s"}` : "",
        ...names,
      ].filter(Boolean);
      return (
        // Capped and wrapping: unwrapped, the longest audience pushed the
        // Settings pencil past the pane's right edge.
        <div className="max-w-[20rem] whitespace-normal text-xs">
          <span className="text-muted-foreground">{e.audience}</span>
          {extra.length > 0 && <div className="text-foreground">+ {extra.join(", ")}</div>}
        </div>
      );
    },
  },
  {
    header: "State",
    cell: (e) =>
      e.mandatory ? (
        <StatusPill tone="success" className="whitespace-nowrap">Always on</StatusPill>
      ) : e.enabled ? (
        <StatusPill tone="success">On</StatusPill>
      ) : (
        <StatusPill tone="neutral">Off</StatusPill>
      ),
  },
  { header: "Push", cell: (e) => (e.push ? "Yes" : "No") },
  { header: "Sent", align: "right", cell: (e) => <span className="tabular-nums">{e.sent30}</span> },
  {
    header: "To admins",
    align: "right",
    cell: (e) => <span className={e.fellBack30 ? "tabular-nums text-warning" : "tabular-nums"}>{e.fellBack30}</span>,
  },
  { header: "Last sent", cell: (e) => (e.lastSentAt ? fmtDateTime(e.lastSentAt) : "—") },
];

// ─── Log ─────────────────────────────────────────────────────────────────────

function buildLogHref(f: LogFilters, page: number): string {
  const p = new URLSearchParams({ tab: "log" });
  if (f.event) p.set("event", f.event);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (page > 1) p.set("page", String(page));
  return `/admin/notifications?${p.toString()}`;
}

function LogTab({
  log,
  filters,
  showBody,
  canDelete,
}: {
  log: DispatchPage;
  filters: LogFilters;
  showBody: boolean;
  canDelete: boolean;
}) {
  const { success, error } = useToast();
  const [recalling, setRecalling] = useState<DispatchRow | null>(null);
  const [event, setEvent] = useState(filters.event);
  const [status, setStatus] = useState(filters.status);
  const [open, setOpen] = useState<DispatchRow | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const recall = () => {
    const d = recalling;
    if (!d) return;
    start(async () => {
      const res = await recallDispatch(d.id);
      setRecalling(null);
      if (res.ok) success(`Taken back from ${res.removed} bell${res.removed === 1 ? "" : "s"}`);
      else error(res.error);
    });
  };

  const openRecipients = (r: DispatchRow) => {
    setOpen(r);
    setRecipients(null);
    setRecipientsError(null);
    start(async () => {
      const res = await loadDispatchRecipients(r.id);
      if (res.ok) setRecipients(res.rows);
      else setRecipientsError(res.error);
    });
  };

  const columns: Column<DispatchRow>[] = [
    { header: "When", cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.created_at)}</span> },
    { header: "Alert", cell: (r) => notificationEvent(r.event_key)?.label ?? r.event_key },
    {
      header: "Message",
      cell: (r) => (
        <div className="max-w-[28rem]">
          <div className="text-foreground">{r.title}</div>
          {r.body && <div className="whitespace-pre-line text-xs text-muted-foreground">{r.body}</div>}
          {r.error && <div className="text-xs text-danger">{r.error}</div>}
        </div>
      ),
    },
    {
      header: "Result",
      cell: (r) => (
        <StatusPill tone={STATUS_TONE[r.status]} className="whitespace-nowrap">
          {DISPATCH_STATUS_LABEL[r.status]}
        </StatusPill>
      ),
    },
    {
      header: "Reached",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.recipient_count}
          {r.cc_count > 0 && <span className="text-xs text-muted-foreground"> (+{r.cc_count} CC)</span>}
        </span>
      ),
    },
    {
      header: "Push",
      align: "right",
      cell: (r) =>
        r.push_attempted === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={r.push_failed ? "tabular-nums text-warning" : "tabular-nums"}>
            {r.push_sent} of {r.push_attempted}
          </span>
        ),
    },
    { header: "From", cell: (r) => <span className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <RowIconAction
            label="Who got it"
            name={r.title}
            icon={Users}
            onClick={() => openRecipients(r)}
            disabledReason={r.recipient_count === 0 || r.recalled_at ? "Nobody has this one in their bell" : null}
          />
          {RECALLABLE.has(r.event_key) && (
            <RowIconAction
              label="Take back"
              name={r.title}
              icon={Undo2}
              danger
              onClick={() => setRecalling(r)}
              disabledReason={
                r.recalled_at
                  ? "Already taken back"
                  : r.recipient_count === 0
                    ? "Nobody received this one"
                    : canDelete
                      ? null
                      : "Taking an announcement back needs the Delete permission on Administration"
              }
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* GET, so a filtered log is a link — the Audit Log's shape. */}
      <form method="get" action="/admin/notifications" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="log" />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Alert</span>
          <Select name="event" value={event} onChange={(e) => setEvent(e.target.value)} className="w-64">
            <option value="">All alerts</option>
            {Object.entries(NOTIFICATION_EVENTS).map(([k, d]) => (
              <option key={k} value={k}>
                {d.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Result</span>
          <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">Any result</option>
            {DISPATCH_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {DISPATCH_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <Input type="date" max={DATE_MAX} name="from" defaultValue={filters.from} className="w-40" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <Input type="date" max={DATE_MAX} name="to" defaultValue={filters.to} className="w-40" />
        </label>
        <Button type="submit">Filter</Button>
        <Link
          href="/admin/notifications?tab=log"
          className="flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-surface-muted"
        >
          Clear
        </Link>
      </form>

      {!showBody && (
        <p className="text-xs text-muted-foreground">
          Message details are shown to administrators with Edit rights — they can name fines, salaries or margins.
        </p>
      )}

      {/* Paged by the SERVICE (50 a page), so the table's own pager stands down. */}
      <DataTable
        paginate={false}
        rows={log.rows}
        getKey={(r) => r.id}
        columns={columns}
        empty="No alerts match. Alerts are logged from 1 October 2026, when the log was switched on."
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Page {log.page}</span>
        <div className="flex gap-2">
          {log.page > 1 && (
            <Link href={buildLogHref(filters, log.page - 1)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted">
              Previous
            </Link>
          )}
          {log.hasMore && (
            <Link href={buildLogHref(filters, log.page + 1)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-muted">
              Next
            </Link>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!recalling}
        title={`Take back "${recalling?.title ?? ""}"?`}
        body="It is removed from every bell it reached. A phone or browser that already showed it keeps that alert — push cannot be recalled."
        confirmLabel="Take back"
        isPending={isPending}
        onConfirm={recall}
        onCancel={() => setRecalling(null)}
      />

      <RecipientsSheet
        dispatch={open}
        rows={recipients}
        error={recipientsError}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

type Recipient = { user_id: string; full_name: string | null; email: string | null; read_at: string | null };

function RecipientsSheet({
  dispatch,
  rows,
  error,
  onClose,
}: {
  dispatch: DispatchRow | null;
  rows: Recipient[] | null;
  error: string | null;
  onClose: () => void;
}) {
  const read = rows?.filter((r) => r.read_at).length ?? 0;

  return (
    <Sheet open={!!dispatch} onClose={onClose} title="Who got it" size="sm">
      {dispatch && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{dispatch.title}</p>
            <p className="text-xs text-muted-foreground">{fmtDateTime(dispatch.created_at)}</p>
            {dispatch.fallback_used && (
              <p className="mt-1 text-xs text-warning">
                Nobody it was meant for could be reached, so it went to the administrators.
              </p>
            )}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          {!rows && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {rows && (
            <>
              <p className="text-xs text-muted-foreground">
                {read} of {rows.length} read
              </p>
              <ul className="divide-y divide-border text-sm">
                {rows.map((r) => (
                  <li key={r.user_id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-foreground">{r.full_name || r.email || "—"}</span>
                    {r.read_at ? (
                      <span className="text-xs text-muted-foreground">Read {fmtDateTime(r.read_at)}</span>
                    ) : (
                      <StatusPill tone="neutral">Unread</StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ─── Devices ─────────────────────────────────────────────────────────────────

const deviceColumns = (
  canEdit: boolean,
  onRemove: (d: NotificationDevice) => void,
): Column<NotificationDevice>[] => [
  {
    header: "Person",
    cell: (d) => (
      <div>
        <div className="text-foreground">{d.full_name || "—"}</div>
        <div className="text-xs text-muted-foreground">{d.email}</div>
      </div>
    ),
  },
  { header: "Device", cell: (d) => deviceName(d.user_agent) },
  { header: "Turned on", cell: (d) => fmtDate(d.created_at) },
  { header: "Last delivered", cell: (d) => (d.last_success_at ? fmtDateTime(d.last_success_at) : "—") },
  {
    header: "Failures",
    cell: (d) =>
      d.failure_count === 0 ? (
        <span className="tabular-nums">0</span>
      ) : (
        <div>
          <span className="tabular-nums text-danger">{d.failure_count}</span>
          {d.last_failure_at && (
            <span className="text-xs text-muted-foreground"> · last {fmtDateTime(d.last_failure_at)}</span>
          )}
          {d.last_error && <div className="max-w-[20rem] text-xs text-muted-foreground">{d.last_error}</div>}
        </div>
      ),
  },
  {
    header: "State",
    cell: (d) =>
      d.failure_count > 0 ? (
        <StatusPill tone="danger" className="whitespace-nowrap">Failing</StatusPill>
      ) : d.last_success_at ? (
        <StatusPill tone="success" className="whitespace-nowrap">Working</StatusPill>
      ) : (
        <StatusPill tone="neutral" className="whitespace-nowrap">No delivery recorded</StatusPill>
      ),
  },
  {
    header: "",
    align: "right",
    cell: (d) => (
      <RowIconAction
        label="Remove device"
        name={`${d.full_name || d.email || ""} · ${deviceName(d.user_agent)}`}
        icon={Trash2}
        danger
        onClick={() => onRemove(d)}
        disabledReason={canEdit ? null : "Removing a device needs the Edit permission on Administration"}
      />
    ),
  },
];

function DevicesTab({ devices, canEdit }: { devices: NotificationDevice[]; canEdit: boolean }) {
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [removing, setRemoving] = useState<NotificationDevice | null>(null);

  const remove = () => {
    const d = removing;
    if (!d) return;
    start(async () => {
      const res = await revokeDevice(d.id);
      setRemoving(null);
      if (res.ok) success("Device removed");
      else error(res.error);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A device appears here when someone turns alerts on. One that stops accepting alerts (uninstalled, alerts
        blocked) is removed automatically the next time an alert is sent to it. Deliveries are recorded from
        1 October 2026.
      </p>
      <DataTable
        rows={devices}
        getKey={(d) => d.id}
        columns={deviceColumns(canEdit, setRemoving)}
        empty="No device has alerts turned on yet."
      />
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing ? deviceName(removing.user_agent) : ""} for ${removing?.full_name || removing?.email || ""}?`}
        body="Alerts stop going to this device. Use it for a lost or handed-over phone. If the person still uses it, they can turn alerts back on from the bell."
        confirmLabel="Remove"
        isPending={isPending}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
