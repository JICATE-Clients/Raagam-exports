"use client";

import { IndianRupee, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import {
  completeExit,
  loadExitPanel,
  loadExitSteps,
  openExit,
  tickExitStep,
  withdrawExit,
} from "@/lib/hr/lifecycle-actions";
import {
  SEPARATION_LABELS,
  SEPARATION_TYPES,
  lifecycleLabel,
  lifecycleTone,
  type ExitCase,
  type ExitStep,
  type SeparationType,
} from "@/lib/hr/lifecycle-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";
import { Fact, ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox, Progress, StepRow } from "./shared";

/**
 * HR ▸ Team Lifecycle ▸ Exits (0766, MyJKKN §12.5 offboarding + §12.6
 * terminations).
 *
 * MyJKKN could open a case and nothing more — no screen advanced a step,
 * withdrew or completed one. Here every step is ticked on the case itself; the
 * asset step is refused while anything is still issued, and the settlement
 * step until the full & final is approved. A termination goes to its approver
 * first (Admin ▸ Approval Flows ▸ Termination) and its steps open on approval.
 * Completing can mark the person as left on their own record.
 */

type Props = {
  rows: ExitCase[];
  people: PersonOption[];
  noticeDays: { staff: number; workers: number };
  /** A staff member signed in for themself — may hand in their own resignation only. */
  selfOnly: boolean;
  canEdit: boolean;
};

type Draft = {
  person: string;
  separation_type: SeparationType;
  notice_date: string;
  last_working_day: string;
  reason: string;
  grounds: string;
  notice_waived: boolean;
};
type Panel = Awaited<ReturnType<typeof loadExitPanel>> & { id: string };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ExitsScreen({ rows, people, noticeDays, selfOnly, canEdit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const [scope, setScope] = useState<"live" | "all">("live");
  const visible = useMemo(
    () => (scope === "live" ? rows.filter((r) => r.status === "open" || r.status === "pending_approval") : rows),
    [rows, scope],
  );

  // ── open ──
  const noticeFor = (key: string) =>
    people.find((p) => p.key === key)?.kind === "worker" ? noticeDays.workers : noticeDays.staff;
  const blank = (person = selfOnly ? (people[0]?.key ?? "") : ""): Draft => ({
    person,
    separation_type: "resignation",
    notice_date: t0,
    last_working_day: addDays(t0, person ? noticeFor(person) : noticeDays.staff),
    reason: "",
    grounds: "",
    notice_waived: false,
  });
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openNew(seed?: Partial<Draft>) {
    setD({ ...blank(seed?.person), ...seed });
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openNew());

  // Retirements Due hands over ?retire=<person>&lwd=<date>.
  const retire = params.get("retire");
  const retireLwd = params.get("lwd");
  useEffect(() => {
    if (!retire) return;
    const lwd = retireLwd && /^\d{4}-\d{2}-\d{2}$/.test(retireLwd) ? retireLwd : t0;
    const timer = window.setTimeout(() => {
      openNew({
        person: retire,
        separation_type: "retirement",
        notice_date: lwd < t0 ? lwd : t0,
        last_working_day: lwd,
        reason: "SUPERANNUATION",
      });
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per hand-over
  }, [retire, retireLwd]);

  const requiredNotice = d.person ? noticeFor(d.person) : noticeDays.staff;
  const served = d.notice_date && d.last_working_day ? Math.round((Date.parse(d.last_working_day) - Date.parse(d.notice_date)) / 86_400_000) : 0;
  const problem = !d.person
    ? "Pick the person"
    : !d.notice_date || !d.last_working_day
      ? "Enter both dates"
      : d.last_working_day < d.notice_date
        ? "The last working day cannot be before the notice date"
        : !d.reason.trim()
          ? "The reason is mandatory"
          : d.separation_type === "termination" && d.grounds.trim().length < 20
            ? "State the grounds in at least 20 characters"
            : null;

  function save() {
    startTransition(async () => {
      const r = await openExit(d);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(d.separation_type === "termination" ? "Termination sent for approval" : "Exit opened");
      router.refresh();
    });
  }

  // ── view ──
  const [viewFor, setViewFor] = useState<ExitCase | null>(null);
  const [steps, setSteps] = useState<{ id: string; rows: ExitStep[] } | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  function openView(e: ExitCase) {
    setViewFor(e);
    loadExitSteps(e.id).then((s) => setSteps({ id: e.id, rows: s }));
    if (e.separation_type === "termination") loadExitPanel(e.id).then((p) => setPanel({ ...p, id: e.id }));
  }
  useOpenIntent((id) => {
    const e = rows.find((x) => x.id === id);
    if (e) openView(e);
  });
  // Keep the open case in step with a refresh.
  const live = viewFor ? (rows.find((r) => r.id === viewFor.id) ?? viewFor) : null;

  function tick(step: ExitStep, done: boolean) {
    if (!live) return;
    const id = live.id;
    setSteps((s) => (s && s.id === id ? { id, rows: s.rows.map((x) => (x.id === step.id ? { ...x, done } : x)) } : s));
    startTransition(async () => {
      const r = await tickExitStep(step.id, done, step.note ?? "");
      if (!r.ok) toastError(r.error);
      setSteps({ id, rows: await loadExitSteps(id) });
      router.refresh();
    });
  }

  const [completeFor, setCompleteFor] = useState<ExitCase | null>(null);
  const [markLeft, setMarkLeft] = useState(true);
  function doComplete() {
    if (!completeFor) return;
    const id = completeFor.id;
    startTransition(async () => {
      const r = await completeExit(id, markLeft);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(markLeft ? "Exit completed — marked as left" : "Exit completed");
      setCompleteFor(null);
      setViewFor(null);
      router.refresh();
    });
  }

  const [withdrawFor, setWithdrawFor] = useState<ExitCase | null>(null);
  function doWithdraw(reason: string) {
    if (!withdrawFor) return;
    const id = withdrawFor.id;
    startTransition(async () => {
      const r = await withdrawExit(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Exit withdrawn");
        setWithdrawFor(null);
        setViewFor(null);
        router.refresh();
      }
    });
  }

  const columns: Column<ExitCase>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (r) => (
        <span className="text-sm">
          <span className="font-medium">{r.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{r.worker_id ? "Worker" : "Staff"}</span>
        </span>
      ),
    },
    { header: "Type", cell: (r) => <span className="text-sm">{SEPARATION_LABELS[r.separation_type]}</span> },
    { header: "Notice", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.notice_date)}</span> },
    { header: "Last Day", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.last_working_day)}</span> },
    {
      header: "Steps",
      cell: (r) => (r.steps_total ? <Progress done={r.steps_done} total={r.steps_total} /> : <span className="text-sm text-muted-foreground">—</span>),
    },
    {
      header: "F&F",
      cell: (r) =>
        r.settlement_status ? (
          <StatusPill tone={lifecycleTone(r.settlement_status)}>{lifecycleLabel(r.settlement_status)}</StatusPill>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];
  const statusColumn: Column<ExitCase> = {
    header: "Status",
    cell: (r) => <StatusPill tone={lifecycleTone(r.status)}>{lifecycleLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<ExitCase>((r) => (
    <RowActions
      label={r.code}
      onView={() => openView(r)}
      isPending={isPending}
      menu={[
        ...(canEdit && r.status === "open"
          ? [{ label: "Full & final", icon: IndianRupee, onClick: () => router.push(`/hr/team/settlements?exit=${r.id}`) }]
          : []),
        ...((canEdit || selfOnly) && (r.status === "open" || r.status === "pending_approval")
          ? [{ label: "Withdraw…", icon: Undo2, onClick: () => setWithdrawFor(r) }]
          : []),
      ]}
    />
  ));

  const viewSteps = live && steps?.id === live.id ? steps.rows : null;
  const allDone = !!viewSteps && viewSteps.length > 0 && viewSteps.every((s) => s.done);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "live", label: "In progress" },
            { value: "all", label: "All" },
          ]}
        />
        {(canEdit || selfOnly) && people.length > 0 && (
          <Button onClick={() => openNew()}>{selfOnly ? "+ Hand In Resignation" : "+ Open Exit"}</Button>
        )}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty={scope === "live" ? "No exit in progress." : "No exits yet."}
      />

      {/* ── Open ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={selfOnly ? "Hand in my resignation" : "Open an exit"}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {problem ??
                (d.separation_type === "termination"
                  ? "Goes to the approver first; the exit steps open once it is approved."
                  : "The exit steps open straight away.")}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Saving…" : d.separation_type === "termination" ? "Send for approval" : "Open exit"}
              </Button>
            </div>
          </div>
        }
      >
        {/* 288 person + 176 type + 2×144 dates + gaps ≈ 800px → cap 52rem */}
        <div className="max-w-[52rem] space-y-4">
          <FieldRow>
            {!selfOnly && (
              <Field label="Person" w="name" required>
                <PersonCombobox
                  people={people}
                  value={d.person}
                  onChange={(v) => put({ person: v, last_working_day: addDays(d.notice_date || t0, noticeFor(v)) })}
                />
              </Field>
            )}
            <Field label="Separation" w="term">
              <Select
                value={d.separation_type}
                disabled={selfOnly}
                onChange={(e) => put({ separation_type: e.target.value as SeparationType })}
              >
                {SEPARATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SEPARATION_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label={d.separation_type === "resignation" ? "Resignation date" : "Notice / decision date"} w="code" required>
              <Input
                type="date"
                value={d.notice_date}
                onChange={(e) => {
                  const v = e.target.value;
                  put({
                    notice_date: v,
                    last_working_day: d.last_working_day < v ? addDays(v, requiredNotice) : d.last_working_day,
                  });
                }}
              />
            </Field>
            <Field label="Last working day" w="code" required>
              <Input
                type="date"
                min={d.notice_date}
                value={d.last_working_day}
                onChange={(e) => put({ last_working_day: e.target.value })}
              />
            </Field>
          </FieldRow>
          {d.separation_type === "resignation" && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Notice period {requiredNotice} day(s); this serves {served}.
                {served < requiredNotice && !d.notice_waived
                  ? ` ${requiredNotice - served} day(s) short — recovered in the full & final unless waived.`
                  : ""}
              </p>
              {!selfOnly && (
                <Toggle checked={d.notice_waived} onChange={(v) => put({ notice_waived: v })} label="Waive the notice shortfall" />
              )}
            </div>
          )}
          <Field label="Reason" required>
            <Textarea rows={2} value={d.reason} onChange={(e) => put({ reason: e.target.value })} />
          </Field>
          {d.separation_type === "termination" && (
            <Field label="Grounds for termination" required hint="At least 20 characters. The approver reads this.">
              <Textarea rows={3} value={d.grounds} onChange={(e) => put({ grounds: e.target.value })} />
            </Field>
          )}
        </div>
      </Sheet>

      {/* ── View ─────────────────────────────────────────────────────────── */}
      <Sheet
        open={!!live}
        onClose={() => setViewFor(null)}
        title={live ? `${live.code ?? "Exit"} — ${live.person_name}` : "Exit"}
        size="md"
        footer={
          live && canEdit && live.status === "open" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/hr/team/settlements?exit=${live.id}`} className={buttonClasses({ variant: "outline" })}>
                Full & final settlement
              </Link>
              <Button
                disabled={isPending || !allDone}
                onClick={() => {
                  setMarkLeft(true);
                  setCompleteFor(live);
                }}
              >
                Complete exit
              </Button>
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={lifecycleTone(live.status)}>{lifecycleLabel(live.status)}</StatusPill>
            <dl className="space-y-1">
              <Fact label="Separation">{SEPARATION_LABELS[live.separation_type]}</Fact>
              <Fact label="Notice date" className="tabular-nums">
                {fmtDate(live.notice_date)}
              </Fact>
              <Fact label="Last working day" className="tabular-nums">
                {fmtDate(live.last_working_day)}
              </Fact>
              <Fact label="Reason" className="whitespace-pre-wrap">
                {live.reason}
              </Fact>
              {live.grounds && (
                <Fact label="Grounds" className="whitespace-pre-wrap">
                  {live.grounds}
                </Fact>
              )}
              {live.notice_waived && <Fact label="Notice">Shortfall waived</Fact>}
              {live.close_reason && <Fact label="Closed">{live.close_reason}</Fact>}
              {live.status === "completed" && (
                <Fact label="Record">{live.marked_left ? "Marked as left" : "Left active on their record"}</Fact>
              )}
            </dl>

            {live.separation_type === "termination" && panel?.id === live.id && panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={panel.timeline} resolveUserName={(id) => panel.names[id]} />
                {panel.verdict && (
                  <ApprovalActionBar
                    run={panel.run}
                    verdict={panel.verdict}
                    subjectPath="/hr/team/exits"
                    onDone={() => setViewFor(null)}
                  />
                )}
              </section>
            )}

            {live.status !== "pending_approval" && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps</h3>
                {viewSteps ? (
                  viewSteps.length ? (
                    <ul className="space-y-2">
                      {viewSteps.map((s) => (
                        <StepRow
                          key={s.id}
                          title={s.label}
                          done={s.done}
                          disabled={!canEdit || live.status !== "open" || isPending}
                          meta={
                            s.done && s.done_at
                              ? `done ${fmtDate(s.done_at.slice(0, 10))}${s.note ? ` · ${s.note}` : ""}`
                              : s.step_key === "asset_return"
                                ? "Needs every issued asset returned or written off"
                                : s.step_key === "final_settlement"
                                  ? "Needs the full & final approved"
                                  : undefined
                          }
                          onToggle={(v) => tick(s, v)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No steps.</p>
                  )
                ) : (
                  <p className="text-muted-foreground">Loading the steps…</p>
                )}
              </section>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!completeFor}
        onClose={() => setCompleteFor(null)}
        title={`Complete ${completeFor?.code ?? ""}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCompleteFor(null)}>
              Back
            </Button>
            <Button disabled={isPending} onClick={doComplete}>
              {isPending ? "Completing…" : "Complete exit"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p>Every step is done. This closes the exit.</p>
          <Toggle
            checked={markLeft}
            onChange={setMarkLeft}
            label={`Mark ${completeFor?.person_name ?? "them"} as left on ${completeFor ? fmtDate(completeFor.last_working_day) : ""}`}
          />
          <p className="text-xs text-muted-foreground">
            Sets the date of leaving on their staff / worker record and switches it to Inactive, so they drop out of
            attendance and payroll lists. Leave it off to close the exit without touching their record.
          </p>
        </div>
      </Sheet>

      <ReasonSheet
        open={!!withdrawFor}
        busy={isPending}
        onClose={() => setWithdrawFor(null)}
        onConfirm={doWithdraw}
        title={`Withdraw ${withdrawFor?.code ?? ""}`}
        confirmLabel="Withdraw"
        intro="The person stays. The ticked steps stay on record."
      />
    </div>
  );
}
