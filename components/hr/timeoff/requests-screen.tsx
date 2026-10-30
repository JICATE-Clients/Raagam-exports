"use client";

import { Ban, CalendarX2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
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
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
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
import { Fact, ReasonSheet, TypeDot, whenOf } from "./shared";

/**
 * HR ▸ Time Off ▸ Leave Requests and ▸ Permissions (0765, MyJKKN §9.2–9.3,
 * §9.7). One screen, two modes: `leave` lists leave and comp-off bookings,
 * `permission` lists short time off in hours.
 *
 * Every refusal the apply sheet shows sooner is also refused by
 * `timeoff_apply` — balance, overlap, notice, caps, blackouts, who may apply
 * for whom.
 */

type Mode = "leave" | "permission";

type Props = {
  mode: Mode;
  rows: TimeoffRequest[];
  types: LeaveType[];
  people: PersonOption[];
  /** A regular staff member applying for themself — no person picker. */
  selfOnly: boolean;
  /** HR may revoke an approved request. */
  canRevoke: boolean;
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

export function RequestsScreen({ mode, rows, types, people, selfOnly, canRevoke }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const usable = useMemo(
    () =>
      types.filter(
        (t) =>
          t.is_active &&
          (mode === "permission" ? t.request_category === "short_time_off" : t.request_category !== "short_time_off"),
      ),
    [types, mode],
  );

  function blank(): Draft {
    return {
      person: selfOnly ? (people[0]?.key ?? "") : "",
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
    if (!open || !draft.person || mode === "permission") return;
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
    if (!draft.leave_type_id) return mode === "permission" ? "Pick the permission type" : "Pick the leave type";
    if (!draft.start_date) return "Pick the From date";
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
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    ...(selfOnly
      ? []
      : [{ header: "Person", cell: (r: TimeoffRequest) => <span className="text-sm">{r.person_name}</span> }]),
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
    cell: (r) => <StatusPill tone={timeoffTone(r.status)}>{statusLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<TimeoffRequest>((r) => (
    <RowActions
      label={r.code}
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
  ));

  const noun = mode === "permission" ? "permission" : "leave";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
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
        {people.length > 0 && <Button onClick={openApply}>+ Apply {noun === "leave" ? "Leave" : "Permission"}</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty={scope === "open" ? `Nothing pending or upcoming — switch to All to see past ${noun}.` : `No ${noun} yet.`}
      />

      {/* ── Apply ──────────────────────────────────────────────────────── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "permission" ? "Apply for permission" : "Apply for leave"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {problem ?? "Goes to the approver set on Admin ▸ Approval Flows (Leave / Permission)."}
            </span>
            <div className="flex gap-2">
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
        <div className="max-w-[60rem] space-y-4">
          <FieldRow>
            {!selfOnly && (
              <Field label="Person" w="name" required>
                <Combobox
                  options={people.map((p) => ({
                    value: p.key,
                    label: p.name,
                    sublabel: p.kind === "worker" ? "Worker" : "Staff",
                    search: p.code,
                  }))}
                  value={draft.person}
                  onChange={(v) => set("person", v)}
                />
              </Field>
            )}
            <Field label={mode === "permission" ? "Permission Type" : "Leave Type"} w="term" required>
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
                <Input type="date" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </Field>
              <Field label="From" w="code" required>
                <Input type="time" value={draft.start_time} onChange={(e) => set("start_time", e.target.value)} />
              </Field>
              <Field label="To" w="code" required>
                <Input type="time" value={draft.end_time} onChange={(e) => set("end_time", e.target.value)} />
              </Field>
            </FieldRow>
          ) : (
            <FieldRow>
              <Field label="From" w="code" required>
                <Input
                  type="date"
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

          {type && mode === "leave" && (
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
              {type.min_advance_notice_days > 0 ? ` Needs ${type.min_advance_notice_days} day(s) notice.` : ""}
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
            <Textarea rows={3} value={draft.reason} onChange={(e) => set("reason", e.target.value)} />
          </Field>
        </div>
      </Sheet>

      {/* ── View ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor ? `${viewFor.code ?? "Request"} — ${viewFor.person_name}` : "Request"}
        size="md"
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
            {panel?.id === viewFor.id && panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath={mode === "permission" ? "/hr/time-off/permission" : "/hr/time-off/leave"}
                    onDone={() => setViewFor(null)}
                  />
                )}
              </section>
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
            ? `Withdraw ${closing.row.code ?? ""}`
            : closing?.mode === "cancel"
              ? `Cancel ${closing.row.code ?? ""}`
              : `Revoke ${closing?.row.code ?? ""}`
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
