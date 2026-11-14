"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { PersonCell } from "@/components/ui/person-avatar";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { useToast } from "@/components/ui/toast";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { forwardTimeoff, timeoffFileLink, type loadTimeoffPanel } from "@/lib/hr/timeoff-actions";
import { fmtDate } from "@/lib/format";
import {
  hhmm,
  TIMEOFF_FILE_ACCEPT,
  TIMEOFF_FILE_MAX_BYTES,
  type PersonOption,
  type TimeoffRequest,
} from "@/lib/hr/timeoff-types";

/** Shared pieces of the HR ▸ Time Off screens (0770). */

/**
 * Every 15 minutes from 6:00 AM to 10:00 PM, as "HH:MM" (the value) and
 * "09:30 AM" (the label) — the working day, so the list does not open on six
 * hours of night. A stored time outside it still shows (TimeSelect).
 */
const TIME_SLOTS = Array.from({ length: 65 }, (_, i) => {
  const h = 6 + Math.floor(i / 4);
  const m = (i % 4) * 15;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const label = `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { value, label };
});

/**
 * A time PICKED from a list, never typed (user 2026-11-14: "wherever it asks
 * for time … I want to select the time from table"). 15-minute steps; on a
 * desktop the list filters as you type ("9:3" → 09:30 AM), on a phone it is
 * the phone's own list. A stored time off the 15-minute grid stays shown.
 * `min` / `max` are inclusive "HH:MM" bounds — Permission's To list is cut
 * to the type's shortest and longest duration after From (`addMinutes`).
 * `everyMinute` with BOTH bounds lists EVERY MINUTE between them (user 2026-11-14:
 * "I set up permission per minutes, so in between every minute counts") —
 * 30 to 60 minutes is 31 choices, not the three 15-minute marks.
 */
export function TimeSelect({
  value,
  onChange,
  min,
  max,
  everyMinute: perMinute,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  everyMinute?: boolean;
}) {
  const v = value ? value.slice(0, 5) : "";
  const slots =
    perMinute && min && max
      ? everyMinute(min.slice(0, 5), max.slice(0, 5))
      : TIME_SLOTS.filter((s) => (!min || s.value >= min.slice(0, 5)) && (!max || s.value <= max.slice(0, 5)));
  const extra = v && !slots.some((s) => s.value === v) ? [{ value: v, label: v }] : [];
  return (
    <Select value={v} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {[...extra, ...slots].map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

/** Every minute from `from` to `to` inclusive, labelled like TIME_SLOTS. */
function everyMinute(from: string, to: string) {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: { value: string; label: string }[] = [];
  for (let t = toMin(from); t <= toMin(to); t++) {
    const h = Math.floor(t / 60);
    const m = String(t % 60).padStart(2, "0");
    out.push({ value: `${String(h).padStart(2, "0")}:${m}`, label: `${String(h % 12 || 12).padStart(2, "0")}:${m} ${h < 12 ? "AM" : "PM"}` });
  }
  return out;
}

/** "09:00" + 30 → "09:30"; capped at 23:59 so a long duration never wraps past midnight. */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * SMALLER FIELDS ON A PHONE (user 2026-11-14: "in mobile view i want all the
 * fields smaller looking and appropriate for mobile view"). Put on a Time Off
 * form's body: below 640px every box is 32px with 14px text, labels are 12px
 * and the gaps tighten; from 640px up nothing changes. Scoped to these forms
 * rather than put in the primitives, so no other screen moves.
 *
 * The trade-off, chosen by the user: iOS Safari zooms the page when a box with
 * text under 16px is tapped (why `Input` uses 16px on phones). Android and
 * desktop do not.
 */
export const PHONE_FIELDS =
  "max-sm:space-y-2.5 max-sm:[&_[data-field]]:gap-1 max-sm:[&_label]:text-xs " +
  "max-sm:[&_input]:h-8 max-sm:[&_input]:px-2 max-sm:[&_input]:text-sm " +
  "max-sm:[&_select]:h-8 max-sm:[&_select]:px-2 max-sm:[&_select]:text-sm " +
  "max-sm:[&_textarea]:px-2 max-sm:[&_textarea]:py-1.5 max-sm:[&_textarea]:text-sm";

/**
 * WHO THE REQUEST IS FOR: the signed-in person, as a plain name — no list of
 * every employee and no way to switch (user 2026-11-14: "there should not be
 * a apply for someone thing, remove it"). Only a login with no staff record of
 * its own (Raagam Admin) has no name to show, and gets the list instead.
 */
export function PersonField({
  people,
  value,
  onChange,
  me,
}: {
  people: PersonOption[];
  value: string;
  onChange: (key: string) => void;
  me: string | null | undefined;
}) {
  const mine = me ? people.find((p) => p.key === me) : undefined;
  if (mine) {
    return (
      <Field label="Person" w="name">
        <div className="flex min-h-9 items-center">
          <PersonCell name={mine.name} person={mine.key} />
        </div>
      </Field>
    );
  }
  return (
    <Field label="Person" w="name" required>
      <Combobox
        options={people.map((p) => ({
          value: p.key,
          label: p.name,
          person: p.key,
          sublabel: p.kind === "worker" ? "Worker" : "Staff",
          search: p.code,
        }))}
        value={value}
        onChange={onChange}
      />
    </Field>
  );
}

/** One label/value line of a record summary. */
export function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  );
}

/**
 * Pick ONE file to go with a request (0843, On Duty) — held in the browser
 * until Apply, which uploads it. PDF, JPEG or PNG up to 5 MB.
 */
export function AttachmentPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const { error: toastError } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  function pick(f: File | undefined) {
    if (!f) return;
    if (!TIMEOFF_FILE_ACCEPT.split(",").includes(f.type)) {
      toastError("Attach a PDF, JPEG or PNG");
      return;
    }
    if (f.size > TIMEOFF_FILE_MAX_BYTES) {
      toastError("The file is over 5 MB");
      return;
    }
    onChange(f);
  }
  return (
    <Field label="Attachment">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          ref={ref}
          type="file"
          accept={TIMEOFF_FILE_ACCEPT}
          className="hidden"
          // autofill: exempt -- a file input has no suggestion list
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button variant="outline" onClick={() => ref.current?.click()}>
          <Paperclip className="size-4" />
          {file ? "Change file" : "Attach file"}
        </Button>
        {file ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-control border border-border bg-muted/40 px-2 py-1 text-sm">
            <span className="min-w-0 break-all">{file.name}</span>
            {/* button-shape: exempt -- a round ✕ chip on the picked file */}
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onChange(null)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Optional · PDF, JPEG or PNG, up to 5 MB</span>
        )}
      </div>
    </Field>
  );
}

/**
 * A request's attached file, opened through a one-minute signed link.
 * `iconOnly` is the 📎 in a list row — a row has no view of its own any more
 * (RowActions, client 2026-10-30), so the file opens straight from the list.
 */
export function AttachmentLink({ path, name, iconOnly }: { path: string; name: string | null; iconOnly?: boolean }) {
  const { error: toastError } = useToast();
  const [busy, startTransition] = useTransition();
  return (
    // button-shape: exempt -- an inline link-styled file name inside a fact list
    <button
      type="button"
      disabled={busy}
      aria-label={iconOnly ? `Open ${name ?? "attached file"}` : undefined}
      title={iconOnly ? (name ?? "Attached file") : undefined}
      className={
        iconOnly
          ? "inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-60"
          : "inline-flex max-w-full items-center gap-1 text-left text-primary underline-offset-2 hover:underline disabled:opacity-60"
      }
      onClick={() =>
        startTransition(async () => {
          const r = await timeoffFileLink(path);
          if (r.ok) window.open(r.url, "_blank", "noopener");
          else toastError(r.error);
        })
      }
    >
      <Paperclip className="size-3.5 shrink-0" />
      {!iconOnly && <span className="min-w-0 break-all">{name ?? "Attached file"}</span>}
    </button>
  );
}

/** The leave type's colour, as a dot before its name. */
export function TypeDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** "12/11/2026", "12/11/2026 (1st half)", "12/11/2026 10:00–11:30", "12/11 → 14/11/2026". */
export function whenOf(r: Pick<TimeoffRequest, "start_date" | "end_date" | "day_part" | "start_time" | "end_time">): string {
  if (r.day_part === "hourly") return `${fmtDate(r.start_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`;
  if (r.start_date === r.end_date) {
    if (r.day_part === "first_half") return `${fmtDate(r.start_date)} (1st half)`;
    if (r.day_part === "second_half") return `${fmtDate(r.start_date)} (2nd half)`;
    return fmtDate(r.start_date);
  }
  return `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
}

/**
 * A small sheet that asks for a reason before a consequential step — withdraw,
 * cancel, revoke, reject. The reason is mandatory everywhere it is used, as in
 * the database.
 */
export function ReasonSheet({
  open,
  title,
  intro,
  confirmLabel,
  danger = false,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onClose={() => {
        setReason("");
        onClose();
      }}
      title={title}
      asPage
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy || !reason.trim()}
            onClick={() => {
              onConfirm(reason);
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className={`space-y-3 text-sm ${PHONE_FIELDS}`}>
        <div>{intro}</div>
        <Field label="Reason" required>
          <VoiceTextarea rows={2} value={reason} onValueChange={setReason} />
        </Field>
      </div>
    </Sheet>
  );
}

export type TimeoffPanel = Awaited<ReturnType<typeof loadTimeoffPanel>>;

/**
 * THE APPROVAL TRAIL OF ONE REQUEST (user 2026-11-05: "if I click a leave it
 * should show all the details and the flow"). Every request walks Department
 * HOD → HR Manager → ED (0817); this says where it is, who signed each stage
 * and when, who it waits for by name, and — when it was rejected or withdrawn
 * part-way — that it stopped there and the later stages were never reached.
 * The approver on the current step gets Approve / Reject under it.
 *
 * One component for the three places a request is opened (its own list, the
 * encashment list, the Approvals queue), so they cannot describe it three ways.
 */
export function ApprovalTrail({
  panel,
  subjectPath,
  onDone,
  decide = true,
}: {
  panel: TimeoffPanel;
  subjectPath: string;
  onDone?: () => void;
  /** false where the screen draws its own Approve / Reject (the Approvals queue). */
  decide?: boolean;
}) {
  const [sending, startSending] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const run = panel.run;
  if (!run) return null;
  /* An ESCALATION, not three signatures (0820, user 2026-11-06): whoever has
     it approves or rejects and that closes it; "Send to …" is the only way it
     climbs to the HR Manager, then the ED. */
  const at = run.steps_snapshot[run.current_step - 1]?.step_label ?? `Step ${run.current_step}`;
  const next = run.status === "in_progress" ? panel.next : null;
  const summary =
    run.status === "in_progress"
      ? `With the ${at} — waiting for ${panel.waiting.length ? panel.waiting.join(", ") : at}`
      : run.status === "completed"
        ? `Approved by the ${at} — closed`
        : run.status === "rejected"
          ? `Rejected by the ${at} — closed`
          : `Withdrawn while with the ${at} — closed`;
  const kind =
    run.subject_table === "timeoff_encashments"
      ? "encashment"
      : run.subject_table === "timeoff_comp_off_credits"
        ? "claim"
        : "request";
  function sendOn() {
    if (!run) return;
    setSendError(null);
    startSending(async () => {
      const r = await forwardTimeoff(kind, run.subject_id, "");
      if (!r.ok) setSendError(r.error);
      else onDone?.();
    });
  }
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval flow</h3>
      <p className="text-sm font-medium">{summary}</p>
      <ApprovalTimeline
        rows={panel.timeline}
        resolveUserName={(id) => panel.names[id]}
        closed={run.status !== "in_progress"}
        waitingOn={panel.waiting}
      />
      {decide && panel.verdict && <ApprovalActionBar run={run} verdict={panel.verdict} subjectPath={subjectPath} onDone={onDone} />}
      {decide && panel.verdict?.can_act && next && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={sending} onClick={sendOn}>
            {sending ? "Sending…" : `Send to ${next}`}
          </Button>
          <span className="text-xs text-muted-foreground">if it needs the {next}&apos;s attention</span>
          {sendError && <span className="text-xs text-danger">{sendError}</span>}
        </div>
      )}
    </section>
  );
}

/* ── Phone pieces (user 2026-11-14: "fix the mobile view for time off more
   creatively"). Each renders below `md` only; the desktop table is unchanged
   and carries the same data, so nothing is reachable on one and not the other. */

const STAGE_STEPS = [
  { label: "Department HOD", short: "HOD" },
  { label: "HR Manager", short: "HR" },
  { label: "ED", short: "ED" },
];

/** HOD → HR → ED as three dots; the one it is waiting on is lit. */
export function StageTrack({ stage }: { stage: string | null | undefined }) {
  const at = STAGE_STEPS.findIndex((s) => s.label === stage);
  if (at < 0) return null;
  return (
    <ol className="flex items-center" aria-label={`Waiting on ${stage}`}>
      {STAGE_STEPS.map((s, i) => (
        <li key={s.short} className="flex flex-1 items-center last:flex-none">
          <span className="flex flex-col items-center gap-0.5">
            <span
              aria-hidden
              className={
                i < at
                  ? "size-2.5 rounded-full bg-success"
                  : i === at
                    ? "size-3 rounded-full bg-primary ring-4 ring-primary/20"
                    : "size-2.5 rounded-full bg-border-strong"
              }
            />
            <span className={i === at ? "text-[11px] font-semibold text-foreground" : "text-[11px] text-muted-foreground"}>
              {s.short}
            </span>
          </span>
          {i < STAGE_STEPS.length - 1 && (
            <span aria-hidden className={i < at ? "mx-1 mb-4 h-0.5 flex-1 bg-success" : "mx-1 mb-4 h-0.5 flex-1 bg-border"} />
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * One request as a ticket: a colour strip for its type, the dates large, the
 * status, where it is on the ladder, and its actions at the foot. Tapping the
 * body opens it.
 */
export function PhoneCard({
  color,
  title,
  status,
  when,
  figure,
  person,
  note,
  stage,
  onOpen,
  actions,
}: {
  color: string;
  title: ReactNode;
  status: ReactNode;
  when: ReactNode;
  figure?: ReactNode;
  person?: { name: string; key: string | null } | null;
  note?: string | null;
  stage?: string | null;
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const body = (
    <>
      <p className="text-sm font-semibold tabular-nums text-foreground">{when}</p>
      {figure && <p className="text-xs text-muted-foreground">{figure}</p>}
      {note && <p className="line-clamp-1 break-words text-xs text-muted-foreground">{note}</p>}
    </>
  );
  return (
    <article className="relative overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <div className="space-y-1.5 py-2 pl-3 pr-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {person && <PersonCell name={person.name} person={person.key} />}
            <TypeDot color={color}>
              <span className="font-medium">{title}</span>
            </TypeDot>
          </div>
          <span className="shrink-0">{status}</span>
        </div>
        {onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full space-y-0.5 text-left">
            {body}
          </button>
        ) : (
          <div className="space-y-0.5">{body}</div>
        )}
        {stage && <StageTrack stage={stage} />}
        {/* `has-[button]` — a request with nothing left to do draws no empty footer. */}
        {actions && <div className="hidden justify-end border-t border-border pt-2 has-[button]:flex">{actions}</div>}
      </div>
    </article>
  );
}

/** A stack of PhoneCards, or the empty line — phones only. */
export function PhoneCards({ empty, children }: { empty: ReactNode; children: ReactNode[] }) {
  return (
    <div className="space-y-2 md:hidden">
      {children.length ? (
        children
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </div>
  );
}

/** The page's one action, pinned above the phone's tab bar. */
export function PhoneActionBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-14 md:hidden" />
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-border bg-surface/95 px-4 py-1.5 backdrop-blur md:hidden [&>*]:flex-1">
        {children}
      </div>
    </>
  );
}

function Ring({ pct, color, children }: { pct: number; color: string; children: ReactNode }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid size-11 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 size-11 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <span className="relative text-sm font-semibold tabular-nums text-foreground">{children}</span>
    </span>
  );
}

/** "My balance": one ring per tracked leave type, days left of the year's total. */
export function PhoneBalanceStrip({
  rows,
  colorOf,
}: {
  rows: { leave_type_id: string; leave_code: string; leave_name: string; entitled: number; accrued: number; carried: number; pending: number; available: number }[];
  colorOf: (leaveTypeId: string) => string;
}) {
  if (!rows.length) return null;
  return (
    <section className="space-y-2 md:hidden">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My balance</h2>
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
        {rows.map((b) => {
          const total = b.entitled + b.accrued + b.carried;
          const pct = total > 0 ? Math.min(1, Math.max(0, b.available / total)) : 0;
          return (
            <div
              key={b.leave_type_id}
              className="flex w-[5.5rem] shrink-0 snap-start flex-col items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-2 text-center"
            >
              <Ring pct={pct} color={colorOf(b.leave_type_id)}>
                {fmtNum(b.available)}
              </Ring>
              <span className="text-xs font-semibold">{b.leave_code}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                left of {fmtNum(total)}
                {b.pending > 0 && <> · {fmtNum(b.pending)} pending</>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
