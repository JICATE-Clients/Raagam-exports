"use client";

import { CalendarCheck, CircleStop, ExternalLink, RefreshCw, Users, Video } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { cancelEvent, disconnectGoogle, refreshReplies, saveEvent } from "@/lib/hr/events-actions";
import { REPLY_LABEL, istParts, type HrEvent, type InvitablePerson } from "@/lib/hr/events-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";

/**
 * HR ▸ Events (0823) — real Google Calendar invitations.
 *
 * HR connects their own Google account once, then creates an event and picks
 * the people by Employee ID. Saving creates the event in that Google Calendar
 * and Google emails every person an invitation; an edit or a cancel emails
 * them again. Replies (Yes / No / Maybe) are read back on request.
 */

type Props = {
  rows: HrEvent[];
  people: InvitablePerson[];
  google: { configured: boolean; email: string | null };
  canCreate: boolean;
  canEdit: boolean;
};

type Draft = {
  title: string;
  date: string;
  from: string;
  to: string;
  venue: string;
  add_meet: boolean;
  description: string;
  guests: string[];
};
const BLANK = (): Draft => ({
  title: "",
  date: today(),
  from: "10:00",
  to: "11:00",
  venue: "",
  add_meet: false,
  description: "",
  guests: [],
});

const GOOGLE_RESULT: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar connected" },
  denied: { tone: "error", text: "Google access was not allowed" },
  failed: { tone: "error", text: "Could not connect Google Calendar" },
  forbidden: { tone: "error", text: "You do not have permission to create HR events" },
  "not-configured": { tone: "error", text: "Google Calendar keys are missing from the server settings" },
};

function whenOf(e: HrEvent): string {
  const a = istParts(e.starts_at);
  const b = istParts(e.ends_at);
  return `${fmtDate(a.date)} · ${a.time}–${b.time}`;
}

export function EventsScreen({ rows, people, google, canCreate, canEdit }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  // The answer from /api/google/callback arrives as ?google=…; say it once.
  const googleParam = params.get("google");
  const detailParam = params.get("detail");
  useEffect(() => {
    if (!googleParam) return;
    const r = GOOGLE_RESULT[googleParam];
    if (r) {
      const text = detailParam ? `${r.text} — ${detailParam}` : r.text;
      if (r.tone === "success") success(text);
      else toastError(text);
    }
    router.replace("/hr/events");
  }, [googleParam, detailParam, router, success, toastError]);

  const [scope, setScope] = useState<"upcoming" | "past" | "all">("upcoming");
  const [now] = useState(() => new Date().toISOString());
  const visible = useMemo(
    () =>
      scope === "upcoming"
        ? rows.filter((e) => e.status === "scheduled" && e.ends_at >= now).reverse()
        : scope === "past"
          ? rows.filter((e) => e.status === "cancelled" || e.ends_at < now)
          : rows,
    [rows, scope, now],
  );

  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const options = useMemo(
    () =>
      people.map((p) => ({
        id: p.key,
        label: `${p.code ?? "—"} — ${p.name}${p.kind === "worker" ? " · Worker" : ""}${p.email ? "" : " · NO EMAIL"}`,
        person: p.key,
      })),
    [people],
  );

  // ── add / edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(e?: HrEvent) {
    if (!e && !google.email) {
      toastError("Connect your Google Calendar first");
      return;
    }
    setEditId(e?.id ?? null);
    if (e) {
      const a = istParts(e.starts_at);
      const b = istParts(e.ends_at);
      setD({
        title: e.title,
        date: a.date,
        from: a.time,
        to: b.time,
        venue: e.venue ?? "",
        add_meet: e.add_meet,
        description: e.description ?? "",
        guests: e.guests.map((g) => (g.staff_id ? `staff:${g.staff_id}` : `worker:${g.worker_id}`)),
      });
    } else setD(BLANK());
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openEdit());

  const missingEmail = d.guests.map((k) => byKey.get(k)).filter((p): p is InvitablePerson => !!p && !p.email);
  const problem = !d.title.trim()
    ? "Name the event"
    : !d.date || !d.from || !d.to
      ? "Enter the date and times"
      : d.to <= d.from
        ? "It ends before it starts"
        : d.guests.length === 0
          ? "Invite at least one person"
          : missingEmail.length
            ? `No email on file for ${missingEmail.map((p) => p.code ?? p.name).join(", ")}`
            : null;

  function save() {
    startTransition(async () => {
      const r = await saveEvent(editId, {
        title: d.title,
        description: d.description,
        venue: d.venue,
        date: d.date,
        from: d.from,
        to: d.to,
        add_meet: d.add_meet,
        guests: d.guests,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? `Updated — ${r.count} people notified by Google` : `Invitations sent to ${r.count} people`);
      router.refresh();
    });
  }

  // ── cancel / replies ──
  const [cancelFor, setCancelFor] = useState<HrEvent | null>(null);
  function doCancel(e: HrEvent, reason: string) {
    startTransition(async () => {
      const r = await cancelEvent(e.id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Event cancelled — Google has told the guests");
        setCancelFor(null);
        router.refresh();
      }
    });
  }
  const [guestsFor, setGuestsFor] = useState<string | null>(null);
  const liveG = guestsFor ? (rows.find((e) => e.id === guestsFor) ?? null) : null;
  function doRefresh(id: string) {
    startTransition(async () => {
      const r = await refreshReplies(id);
      if (!r.ok) toastError(r.error);
      else {
        success("Replies updated from Google");
        router.refresh();
      }
    });
  }
  function doDisconnect() {
    startTransition(async () => {
      const r = await disconnectGoogle();
      if (!r.ok) toastError(r.error);
      else {
        success("Google Calendar disconnected");
        router.refresh();
      }
    });
  }

  // ── table ──
  const columns: Column<HrEvent>[] = [
    { header: "Code", cell: (e) => <span className="font-mono text-xs font-medium">{e.code ?? "—"}</span> },
    {
      header: "Event",
      cell: (e) => (
        <span className="text-sm">
          <span className="font-medium">{e.title}</span>
          {e.venue && <span className="ml-2 text-xs text-muted-foreground">{e.venue}</span>}
        </span>
      ),
    },
    { header: "When", cell: (e) => <span className="text-sm tabular-nums">{whenOf(e)}</span> },
    {
      header: "Guests",
      cell: (e) => {
        const yes = e.guests.filter((g) => g.response_status === "accepted").length;
        const no = e.guests.filter((g) => g.response_status === "declined").length;
        return (
          <span className="text-sm tabular-nums">
            {e.guests.length}
            {(yes > 0 || no > 0) && (
              <span className="ml-2 text-xs text-muted-foreground">
                · {yes} yes · {no} no
              </span>
            )}
          </span>
        );
      },
    },
  ];
  const statusColumn: Column<HrEvent> = {
    header: "Status",
    cell: (e) => <StatusPill tone={statusTone(e.status)}>{e.status === "scheduled" ? "Scheduled" : "Cancelled"}</StatusPill>,
  };
  const actions = rowActionsColumn<HrEvent>((e) => (
    <RowActions
      label={e.title}
      view={false}
      onEdit={() => openEdit(e)}
      canEdit={canEdit}
      editDisabledReason={e.status === "cancelled" ? "Cancelled — not edited" : null}
      canDelete={false}
      isPending={isPending}
      menu={[
        { label: "Guests & replies", icon: Users, onClick: () => setGuestsFor(e.id) },
        ...(e.google_html_link
          ? [{ label: "Open in Google Calendar", icon: ExternalLink, onClick: () => window.open(e.google_html_link!, "_blank", "noopener") }]
          : []),
        ...(e.google_meet_link && e.status === "scheduled"
          ? [{ label: "Open Google Meet", icon: Video, onClick: () => window.open(e.google_meet_link!, "_blank", "noopener") }]
          : []),
        ...(canEdit && e.status === "scheduled" ? [{ label: "Cancel…", icon: CircleStop, onClick: () => setCancelFor(e) }] : []),
      ]}
    />
  ));

  return (
    <div className="space-y-4">
      {/* ── Google connection ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-sm">
        {!google.configured ? (
          <span className="text-danger">Google Calendar keys are not set on the server (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI).</span>
        ) : google.email ? (
          <>
            <span className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-success" aria-hidden />
              Invitations are sent from <span className="font-medium">{google.email}</span>
            </span>
            <span className="flex gap-2">
              <Button variant="outline" onClick={() => (window.location.href = "/api/google/connect")}>
                Reconnect
              </Button>
              <Button variant="ghost" disabled={isPending} onClick={doDisconnect}>
                Disconnect
              </Button>
            </span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Connect your Google account once — events are created in its calendar and Google emails the invitations.</span>
            {canCreate && <Button onClick={() => (window.location.href = "/api/google/connect")}>Connect Google Calendar</Button>}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "past", label: "Past & cancelled" },
            { value: "all", label: "All" },
          ]}
        />
        {canCreate && (
          <Button disabled={!google.email} onClick={() => openEdit()}>
            + Add Event
          </Button>
        )}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(e) => e.id}
        empty={scope === "upcoming" ? "No upcoming events. Add one to send invitations." : "No events here."}
      />

      {/* ── Add / edit ── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.title}` : "New event"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {problem ?? (editId ? "Saving emails the change to every guest" : "Saving sends a Google Calendar invitation to every guest")}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Sending…" : editId ? "Save & notify" : "Save & send invites"}
              </Button>
            </div>
          </div>
        }
      >
        {/* 288 title + 176 venue + gap ≈ 480px; date row 3 × 112 ≈ 350px → cap 40rem */}
        <div className="max-w-[40rem] space-y-5">
          <FieldRow>
            <Field label="Event" w="name" required>
              <Input value={d.title} onChange={(e) => put({ title: e.target.value })} />
            </Field>
            <Field label="Venue" w="term">
              <Input value={d.venue} onChange={(e) => put({ venue: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Date" w="code" required>
              <Input type="date" value={d.date} onChange={(e) => put({ date: e.target.value })} />
            </Field>
            <Field label="From" w="code" required>
              <Input type="time" value={d.from} onChange={(e) => put({ from: e.target.value })} />
            </Field>
            <Field label="To" w="code" required>
              <Input type="time" value={d.to} onChange={(e) => put({ to: e.target.value })} />
            </Field>
          </FieldRow>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={d.add_meet}
              onChange={(e) => put({ add_meet: e.target.checked })}
            />
            Add a Google Meet video link
          </label>
          <MultiSelect
            label="Invite — search by Employee ID or name"
            required
            options={options}
            values={d.guests}
            onChange={(v) => put({ guests: v })}
            emptyLabel="No staff or workers found"
          />
          {missingEmail.length > 0 && (
            <p className="text-xs text-danger">
              No email on file for {missingEmail.map((p) => `${p.code ?? ""} ${p.name}`.trim()).join(", ")} — add it on their Staff / Worker
              record, or remove them.
            </p>
          )}
          <Field label="Details">
            <Textarea rows={3} value={d.description} onChange={(e) => put({ description: e.target.value })} />
          </Field>
        </div>
      </Sheet>

      {/* ── Guests & replies ── */}
      <Sheet open={!!liveG} onClose={() => setGuestsFor(null)} title={liveG ? `${liveG.code ?? "Event"} — ${liveG.title}` : "Event"} size="md">
        {liveG && (
          <div className="space-y-5 text-sm">
            <dl className="space-y-1">
              <Fact label="When">{whenOf(liveG)}</Fact>
              {liveG.venue && <Fact label="Venue">{liveG.venue}</Fact>}
              {liveG.organizer_email && <Fact label="Sent from">{liveG.organizer_email}</Fact>}
              {liveG.google_meet_link && <Fact label="Google Meet">{liveG.google_meet_link}</Fact>}
              {liveG.cancel_reason && <Fact label="Cancelled">{liveG.cancel_reason}</Fact>}
            </dl>
            {liveG.status === "scheduled" && (
              <div className="flex gap-2">
                <RowIconAction label="Refresh replies from Google" icon={RefreshCw} onClick={() => doRefresh(liveG.id)} />
                <span className="self-center text-xs text-muted-foreground">Refresh replies from Google</span>
              </div>
            )}
            <DataTable
              paginate={false}
              columns={[
                {
                  header: "Person",
                  cell: (g) => (
                    <span>
                      <span className="font-mono text-xs">{g.person_code ?? "—"}</span>
                      <span className="ml-2 font-medium">{g.person_name}</span>
                    </span>
                  ),
                },
                { header: "Email", cell: (g) => <span className="text-xs">{g.email}</span> },
                {
                  header: "Reply",
                  cell: (g) => (
                    <StatusPill
                      tone={g.response_status === "accepted" ? "success" : g.response_status === "declined" ? "danger" : g.response_status === "tentative" ? "warning" : "neutral"}
                    >
                      {REPLY_LABEL[g.response_status]}
                    </StatusPill>
                  ),
                },
              ]}
              rows={liveG.guests}
              getKey={(g) => g.id}
              empty="Nobody was invited."
            />
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!cancelFor}
        busy={isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={(reason) => cancelFor && doCancel(cancelFor, reason)}
        title={`Cancel ${cancelFor?.code ?? ""}`}
        confirmLabel="Cancel event"
        danger
        intro="Google removes it from every guest's calendar and emails them that it is cancelled."
      />
    </div>
  );
}
