"use client";

import { PersonCell, personKeyOf } from "@/components/ui/person-avatar";
import { Ban, CalendarX2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDateTime } from "@/lib/format";
import {
  applyTimeoff,
  closeApprovedTimeoff,
  loadPersonBalances,
  loadTimeoffPanel,
  withdrawTimeoff,
} from "@/lib/hr/timeoff-actions";
import {
  CATEGORY_LABELS,
  REQUEST_STATUSES,
  isOnDuty,
  fmtDays,
  fmtMinutes,
  statusLabel,
  timeoffTone,
  type BalanceRow,
  type DayPart,
  type LeaveType,
  type PersonOption,
  type RequestStatus,
  type TimeoffRequest,
} from "@/lib/hr/timeoff-types";
import {
  ApprovalTrail,
  Fact,
  PersonField,
  PHONE_FIELDS,
  PhoneActionBar,
  PhoneBalanceStrip,
  PhoneCard,
  PhoneCards,
  ReasonSheet,
  TimeSelect,
  TypeDot,
  whenOf,
} from "./shared";

/**
 * HR ▸ Time Off ▸ Leave, Permission and On Duty Requests (0770, MyJKKN
 * §9.2–9.3, §9.7). One screen, three modes: `leave` lists leave and comp-off
 * bookings, `permission` lists short time off in hours, `on_duty` lists the
 * On Duty type alone (user 2026-11-05: "in time off there should be leave
 * request, permission request, on duty request, comp off request") — which
 * `leave` therefore no longer offers. Split by `isOnDuty`.
 *
 * Every refusal the apply sheet shows sooner is also refused by
 * `timeoff_apply` — balance, overlap, notice, caps, blackouts, who may apply
 * for whom.
 */

type Mode = "leave" | "permission" | "on_duty";

const WORDS: Record<Mode, { noun: string; button: string; title: string; typeLabel: string; pick: string; path: string }> = {
  leave: { noun: "leave", button: "+ Apply Leave", title: "Apply for leave", typeLabel: "Leave Type", pick: "Pick the leave type", path: "/hr/time-off/leave" },
  permission: { noun: "permission", button: "+ Apply Permission", title: "Apply for permission", typeLabel: "Permission Type", pick: "Pick the permission type", path: "/hr/time-off/permission" },
  on_duty: { noun: "on duty", button: "+ Apply On Duty", title: "Apply for on duty", typeLabel: "On Duty Type", pick: "Pick the on duty type", path: "/hr/time-off/on-duty" },
};

type Props = {
  mode: Mode;
  rows: TimeoffRequest[];
  types: LeaveType[];
  people: PersonOption[];
  /** A regular staff member applying for themself — no person picker. */
  selfOnly: boolean;
  /** The signed-in person ("staff:<id>"); the form opens with them picked. */
  me?: string | null;
  /** HR may revoke an approved request. */
  canRevoke: boolean;
  /** The signed-in person's balances — the phone's "My balance" rings (Leave only). */
  myBalances?: BalanceRow[];
};

type Draft = {
  person: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  day_part: DayPart;
  start_time: string;
  end_time: string;
  reason: string;
};

type Closing = { row: TimeoffRequest; mode: "withdraw" | "cancel" | "revoke" };
type Panel = Awaited<ReturnType<typeof loadTimeoffPanel>> & { id: string };

export function RequestsScreen({ mode, rows, types, people, selfOnly, me, canRevoke, myBalances = [] }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const usable = useMemo(
    () =>
      types.filter(
        (t) =>
          t.is_active &&
          (mode === "permission"
            ? t.request_category === "short_time_off"
            : t.request_category !== "short_time_off" && (mode === "on_duty") === isOnDuty(t.code, t.name)),
      ),
    [types, mode],
  );

  function blank(): Draft {
    return {
      person: selfOnly ? (people[0]?.key ?? "") : people.some((p) => p.key === me) ? (me as string) : "",
      leave_type_id: usable.length === 1 ? usable[0].id : "",
      start_date: t0,
      end_date: t0,
      day_part: mode === "permission" ? "hourly" : "full",
      start_time: "",
      end_time: "",
      reason: "",
    };
  }

  // ── list filter ──
  const [scope, setScope] = useState<"open" | "all">("open");
  const [status, setStatus] = useState<"" | RequestStatus>("");
  const visible = useMemo(() => {
    let out = rows;
    if (scope === "open") out = out.filter((r) => r.status === "pending" || (r.status === "approved" && r.end_date >= t0));
    if (status) out = out.filter((r) => r.status === status);
    return out;
  }, [rows, scope, status, t0]);

  // ── apply sheet ──
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  function openApply() {
    setDraft(blank());
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openApply());

  // The person's live balance, re-read when the person changes.
  const [balances, setBalances] = useState<{ person: string; rows: BalanceRow[] } | null>(null);
  useEffect(() => {
    if (!open || !draft.person || mode !== "leave") return;
    let live = true;
    loadPersonBalances(draft.person).then((rows) => {
      if (live) setBalances({ person: draft.person, rows });
    });
    return () => {
      live = false;
    };
  }, [open, draft.person, mode]);

  const type = usable.find((t) => t.id === draft.leave_type_id);
  const person = people.find((p) => p.key === draft.person);
  const typesForPerson = usable.filter(
    (t) =>
      !person ||
      ((t.applies_to === "both" || (t.applies_to === "staff") === (person.kind === "staff")) &&
        (t.applicable_gender === "any" || !person.gender || t.applicable_gender === person.gender)),
  );
  const balance =
    balances?.person === draft.person ? balances.rows.find((b) => b.leave_type_id === draft.leave_type_id) : undefined;
  const isHalf = draft.day_part === "first_half" || draft.day_part === "second_half";

  const problem = (() => {
    if (!draft.person) return "Pick the person";
    if (!draft.leave_type_id) return WORDS[mode].pick;
    if (!draft.start_date) return "Pick the From date";
    // Time off is applied in advance (0798; user 2026-11-03: "all the time off
    // things happening in Raagam are beforehand") — the database refuses a
    // past From date too; this says so before Save rather than after.
    if (draft.start_date < t0) return "Time off is applied in advance — the date cannot be before today";
    if (mode === "permission") {
      if (!draft.start_time || !draft.end_time) return "Enter the From and To time";
      if (draft.end_time <= draft.start_time) return "To must be after From";
    } else if (!draft.end_date || draft.end_date < draft.start_date) return "The To date cannot be before the From date";
    if (!draft.reason.trim()) return "The reason is mandatory";
    return null;
  })();

  function apply() {
    startTransition(async () => {
      const r = await applyTimeoff({
        person: draft.person,
        leave_type_id: draft.leave_type_id,
        start_date: draft.start_date,
        end_date: mode === "permission" || isHalf ? draft.start_date : draft.end_date,
        day_part: mode === "permission" ? "hourly" : draft.day_part,
        start_time: mode === "permission" ? draft.start_time : null,
        end_time: mode === "permission" ? draft.end_time : null,
        reason: draft.reason,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Applied — sent for approval");
      router.refresh();
    });
  }

  // ── view ──
  const [viewFor, setViewFor] = useState<TimeoffRequest | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  function openView(r: TimeoffRequest) {
    setViewFor(r);
    loadTimeoffPanel("request", r.id).then((p) => setPanel({ ...p, id: r.id }));
  }
  useOpenIntent((id) => {
    const r = rows.find((x) => x.id === id);
    if (r) openView(r);
  });

  // ── withdraw / cancel / revoke ──
  const [closing, setClosing] = useState<Closing | null>(null);
  function doClose(reason: string) {
    if (!closing) return;
    const { row, mode: m } = closing;
    startTransition(async () => {
      const r =
        m === "withdraw" ? await withdrawTimeoff("request", row.id, reason) : await closeApprovedTimeoff(row.id, m, reason);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(m === "withdraw" ? "Withdrawn" : m === "cancel" ? "Cancelled — the days are back in the balance" : "Revoked");
      setClosing(null);
      router.refresh();
    });
  }

  const columns: Column<TimeoffRequest>[] = [
    ...(selfOnly
      ? []
      : [{ header: "Person", cell: (r: TimeoffRequest) => <PersonCell name={r.person_name} person={personKeyOf(r)} /> }]),
    { header: "Type", cell: (r) => <TypeDot color={r.leave_color}>{r.leave_name}</TypeDot> },
    { header: "When", cell: (r) => <span className="text-sm tabular-nums">{whenOf(r)}</span> },
    {
      header: mode === "permission" ? "Time" : "Days",
      align: "right",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : fmtDays(r.total_days)}
        </span>
      ),
    },
    {
      header: "Reason",
      cell: (r) => <Truncated className="max-w-[16rem] text-sm text-muted-foreground">{r.reason}</Truncated>,
    },
  ];
  const statusColumn: Column<TimeoffRequest> = {
    header: "Status",
    cell: (r) => (
      <span className="inline-flex flex-col items-start gap-0.5">
        <StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>
        {/* Pending until the last of HOD → HR Manager → ED; this says how far it got. */}
        {r.status === "pending" && r.stage && <span className="text-xs text-muted-foreground">{r.stage}</span>}
      </span>
    ),
  };
  const rowActs = (r: TimeoffRequest) => (
    <RowActions
      label={r.person_name}
      onView={() => openView(r)}
      isPending={isPending}
      menu={[
        ...(r.status === "pending"
          ? [{ label: "Withdraw…", icon: Undo2, onClick: () => setClosing({ row: r, mode: "withdraw" }) }]
          : []),
        ...(r.status === "approved" && r.start_date > t0
          ? [{ label: "Cancel leave…", icon: CalendarX2, onClick: () => setClosing({ row: r, mode: "cancel" }) }]
          : []),
        ...(r.status === "approved" && canRevoke
          ? [{ label: "Revoke…", icon: Ban, danger: true, onClick: () => setClosing({ row: r, mode: "revoke" }) }]
          : []),
      ]}
    />
  );
  const actions = rowActionsColumn<TimeoffRequest>(rowActs);
  const colorOf = (id: string) => types.find((t) => t.id === id)?.color ?? "var(--primary)";

  const noun = WORDS[mode].noun;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <ToggleGroup
            label="Show"
            value={scope}
            onChange={setScope}
            options={[
              { value: "open", label: "Pending & upcoming" },
              { value: "all", label: "All" },
            ]}
          />
          <Select
            aria-label="Status"
            className="h-9 w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | RequestStatus)}
          >
            <option value="">All statuses</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        {people.length > 0 && (
          <Button className="hidden md:inline-flex" onClick={openApply}>
            {WORDS[mode].button}
          </Button>
        )}
      </div>

      {mode === "leave" && (
        <PhoneBalanceStrip rows={myBalances.filter((b) => b.entitled + b.accrued + b.carried > 0)} colorOf={colorOf} />
      )}

      {/* Phone: each request as a ticket; the table below is desktop only. */}
      <PhoneCards empty={scope === "open" ? `Nothing pending or upcoming — switch to All to see past ${noun}.` : `No ${noun} yet.`}>
        {visible.map((r) => (
          <PhoneCard
            key={r.id}
            color={r.leave_color}
            title={r.leave_name}
            status={<StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>}
            when={whenOf(r)}
            figure={r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : `${fmtDays(r.total_days)} day(s)`}
            person={selfOnly ? null : { name: r.person_name, key: personKeyOf(r) }}
            note={r.reason}
            stage={r.status === "pending" ? r.stage : null}
            onOpen={() => openView(r)}
            actions={rowActs(r)}
          />
        ))}
      </PhoneCards>

      <div className="hidden md:block">
        <DataTable
          columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
          rows={visible}
          getKey={(r) => r.id}
          empty={scope === "open" ? `Nothing pending or upcoming — switch to All to see past ${noun}.` : `No ${noun} yet.`}
        />
      </div>

      {people.length > 0 && (
        <PhoneActionBar>
          <Button onClick={openApply}>{WORDS[mode].button}</Button>
        </PhoneActionBar>
      )}

      {/* ── Apply ──────────────────────────────────────────────────────── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={WORDS[mode].title}
        asPage
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-xs text-muted-foreground">
              {problem ?? "Goes to the approver set on Admin ▸ Approval Flows (Leave / Permission)."}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={apply}>
                {isPending ? "Applying…" : "Apply"}
              </Button>
            </div>
          </div>
        }
      >
        {/* 288 person + 176 type + 3×144 dates/times + gaps ≈ 940px → cap 60rem */}
        <div className={`max-w-[60rem] space-y-4 ${PHONE_FIELDS}`}>
          <FieldRow>
            {!selfOnly && <PersonField people={people} value={draft.person} onChange={(v) => set("person", v)} me={me} />}
            <Field label={WORDS[mode].typeLabel} w="term" required>
              <Select value={draft.leave_type_id} onChange={(e) => set("leave_type_id", e.target.value)}>
                <option value="">—</option>
                {typesForPerson.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          {mode === "permission" ? (
            <FieldRow>
              <Field label="Date" w="code" required>
                <Input type="date" min={t0} value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </Field>
              {/* From and To share ONE line on a phone (user 2026-11-14: "make from and to
                  in 1 line"); `sm:contents` hands both back to the row from 640px up. */}
              <div className="grid w-full grid-cols-2 gap-3 sm:contents">
                <Field label="From" w="code" required>
                  <TimeSelect value={draft.start_time} onChange={(v) => set("start_time", v)} />
                </Field>
                <Field label="To" w="code" required>
                  <TimeSelect value={draft.end_time} onChange={(v) => set("end_time", v)} min={draft.start_time || undefined} />
                </Field>
              </div>
            </FieldRow>
          ) : (
            <FieldRow>
              {/* From and To share ONE line on a phone (user 2026-11-14: "make from and to
                  in 1 line"); `sm:contents` hands both back to the row from 640px up. */}
              <div className={isHalf ? "contents" : "grid w-full grid-cols-2 gap-3 sm:contents"}>
                <Field label="From" w="code" required>
                  <Input
                    type="date"
                    min={t0}
                    value={draft.start_date}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => ({ ...d, start_date: v, end_date: d.end_date < v ? v : d.end_date }));
                      setDirty(true);
                    }}
                  />
                </Field>
                {!isHalf && (
                  <Field label="To" w="code" required>
                    <Input
                      type="date"
                      min={draft.start_date}
                      value={draft.end_date}
                      onChange={(e) => set("end_date", e.target.value)}
                    />
                  </Field>
                )}
              </div>
              {type?.allow_half_day && (
                <Field label="Day">
                  <Segmented
                    name="timeoff-day-part"
                    value={draft.day_part}
                    onChange={(v) => set("day_part", v)}
                    options={[
                      { value: "full", label: "Full day" },
                      { value: "first_half", label: "1st half" },
                      { value: "second_half", label: "2nd half" },
                    ]}
                  />
                </Field>
              )}
            </FieldRow>
          )}

          {type && mode !== "permission" && (
            <p className="text-xs text-muted-foreground">
              {type.request_category === "compensatory_off"
                ? "Books approved comp-off credits worked before these dates, earliest expiry first."
                : !type.track_balance
                  ? `${type.name} has no balance limit${type.is_paid ? "" : " and is unpaid"}.`
                  : balance
                    ? `Available: ${fmtDays(balance.available)} day(s) (entitled ${fmtDays(balance.accrued)}, used ${fmtDays(balance.used)}, pending ${fmtDays(balance.pending)}).`
                    : "Reading the balance…"}
              {type.skip_weekends || type.skip_holidays
                ? ` ${[type.skip_weekends && "Sundays", type.skip_holidays && "holidays"].filter(Boolean).join(" and ")} inside the range are not counted.`
                : ""}
            </p>
          )}
          {type && mode === "permission" && (
            <p className="text-xs text-muted-foreground">
              {[
                type.sto_min_minutes && `at least ${fmtMinutes(type.sto_min_minutes)}`,
                type.sto_max_minutes && `at most ${fmtMinutes(type.sto_max_minutes)}`,
                type.sto_limit_mode === "count" && `${type.sto_max_requests} a ${type.sto_limit_period}`,
                type.sto_limit_mode === "minutes" &&
                  `${fmtMinutes(type.sto_total_minutes)} in total a ${type.sto_limit_period}`,
              ]
                .filter(Boolean)
                .join(" · ") || "No limits set."}
            </p>
          )}

          <Field label="Reason" required>
            <VoiceTextarea rows={3} value={draft.reason} onValueChange={(v) => set("reason", v)} />
          </Field>
        </div>
      </Sheet>

      {/* ── View ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor ? (selfOnly || viewFor.person_name === "—" ? viewFor.leave_name : `${viewFor.person_name} — ${viewFor.leave_name}`) : "Request"}
        asPage
      >
        {viewFor && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={timeoffTone(viewFor.status)}>{statusLabel(viewFor.status)}</StatusPill>
            <dl className="space-y-1">
              <Fact label="Type">
                <TypeDot color={viewFor.leave_color}>
                  {viewFor.leave_name} · {CATEGORY_LABELS[viewFor.request_category]}
                </TypeDot>
              </Fact>
              <Fact label="When" className="tabular-nums">
                {whenOf(viewFor)}
              </Fact>
              <Fact label={viewFor.day_part === "hourly" ? "Duration" : "Days counted"} className="tabular-nums">
                {viewFor.day_part === "hourly" ? fmtMinutes(viewFor.duration_minutes) : fmtDays(viewFor.total_days)}
              </Fact>
              <Fact label="Reason" className="whitespace-pre-wrap">
                {viewFor.reason}
              </Fact>
              {viewFor.decided_at && (
                <Fact label="Decided">
                  {fmtDateTime(viewFor.decided_at)}
                  {viewFor.decision_remark ? ` — ${viewFor.decision_remark}` : ""}
                </Fact>
              )}
              {viewFor.closed_at && (
                <Fact label={viewFor.status === "revoked" ? "Revoked" : "Cancelled"}>
                  {fmtDateTime(viewFor.closed_at)}
                  {viewFor.close_reason ? ` — ${viewFor.close_reason}` : ""}
                </Fact>
              )}
            </dl>
            {panel?.id === viewFor.id && (
              <ApprovalTrail panel={panel} subjectPath={WORDS[mode].path} onDone={() => setViewFor(null)} />
            )}
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!closing}
        busy={isPending}
        onClose={() => setClosing(null)}
        onConfirm={doClose}
        danger={closing?.mode === "revoke"}
        title={
          closing?.mode === "withdraw"
            ? `Withdraw — ${closing.row.person_name}`
            : closing?.mode === "cancel"
              ? `Cancel — ${closing.row.person_name}`
              : `Revoke — ${closing?.row.person_name ?? ""}`
        }
        confirmLabel={closing?.mode === "withdraw" ? "Withdraw" : closing?.mode === "cancel" ? "Cancel leave" : "Revoke"}
        intro={
          closing?.mode === "withdraw"
            ? "This takes the request out of the approver's queue."
            : closing?.mode === "cancel"
              ? "The leave has not started. Cancelling it returns its days to the balance."
              : "Revoking an approved leave returns its days to the balance. The record stays for the audit."
        }
      />
    </div>
  );
}
