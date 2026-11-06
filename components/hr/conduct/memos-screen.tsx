"use client";

import { PersonAvatar, personKeyOf } from "@/components/ui/person-avatar";
import { CircleCheck, MessageSquareWarning, ThumbsUp, Undo2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { acknowledgeMemo, disputeMemo, issueMemo, loadMemoEvents, resolveMemo, withdrawMemo } from "@/lib/hr/conduct-actions";
import { MEMO_TYPES, conductLabel, conductTone, memoTypeLabel, type Memo, type MemoDraft, type MemoEvent, type MemoType } from "@/lib/hr/conduct-types";
import { personKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { Fact } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";
import { Diary, NoteSheet, Tick } from "./shared";

/**
 * HR ▸ Conduct & Policies ▸ Memos (0791, MyJKKN §13.5).
 *
 * HR issues a memo → the person acknowledges it or disputes it → HR resolves
 * it, saying whether it counts toward further action. A worker has no login,
 * so HR records their answer from the signed copy; a staff member with a
 * login answers on this same screen, which then shows only their own memos.
 * MyJKKN's auto-detector is not ported — its own spec calls it broken.
 */

type Props = { rows: Memo[]; people: PersonOption[]; myStaffId: string | null; canEdit: boolean };
type Scope = "open" | "closed" | "all";
type Step = "ack" | "dispute" | "resolve" | "withdraw";

const OPEN = new Set(["issued", "acknowledged", "disputed"]);
const YEAR_MS = 365 * 24 * 3600 * 1000;

const BLANK = (): MemoDraft => ({
  person: "",
  memo_type: "",
  subject: "",
  body: "",
  incident_date: "",
  issued_on: today(),
  reply_by: "",
});

const EVENT_WORDS: Record<string, string> = {
  issued: "Issued",
  acknowledged: "Acknowledged",
  disputed: "Disputed",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
};

const keyOf = (m: Pick<Memo, "staff_id" | "worker_id">) => (m.staff_id ? personKey("staff", m.staff_id) : personKey("worker", m.worker_id as string));

export function MemosScreen({ rows, people, myStaffId, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const isSelf = !!myStaffId;

  const [scope, setScope] = useState<Scope>("open");
  const visible = scope === "all" ? rows : rows.filter((r) => OPEN.has(r.status) === (scope === "open"));

  // ── issue ──
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<MemoDraft>(BLANK);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<MemoDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openIssue(prefill?: Partial<MemoDraft>) {
    setD({ ...BLANK(), ...prefill });
    setDirty(false);
    setOpen(true);
  }
  // The HR dashboard's "Needs attention" opens this with the person and what
  // it is about already chosen: ?new=1&person=staff:<id>&type=late_coming.
  const params = useSearchParams();
  useCreateIntent(() => {
    if (!canEdit) return;
    const person = params.get("person") ?? "";
    const type = params.get("type") ?? "";
    const known = people.some((p) => p.key === person);
    const memoType = MEMO_TYPES.find((t) => t.value === type);
    openIssue({
      person: known ? person : "",
      memo_type: memoType?.value ?? "",
      subject: memoType && known ? memoType.label : "",
    });
  });
  // What this person already has — so HR sees a pattern before adding to it.
  const [now] = useState(() => Date.now());
  const history = d.person ? rows.filter((r) => keyOf(r) === d.person) : [];
  const counted = history.filter((r) => r.counts && now - new Date(r.issued_on).getTime() < YEAR_MS).length;
  const stillOpen = history.filter((r) => OPEN.has(r.status)).length;
  const problem = !d.person
    ? "Pick the person"
    : !d.memo_type
      ? "Pick what it is about"
      : !d.subject.trim()
        ? "Enter the subject"
        : !d.body.trim()
          ? "Write the memo"
          : d.reply_by && d.reply_by < d.issued_on
            ? "The reply date is before the memo date"
            : null;

  function issue() {
    startTransition(async () => {
      const r = await issueMemo(d);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success("Memo issued");
      router.refresh();
    });
  }

  // ── view ──
  const [viewId, setViewId] = useState<string | null>(null);
  const live = viewId ? (rows.find((r) => r.id === viewId) ?? null) : null;
  const [events, setEvents] = useState<{ id: string; rows: MemoEvent[] } | null>(null);
  function openView(m: Memo) {
    setViewId(m.id);
    setEvents(null);
    loadMemoEvents(m.id).then((rows) => setEvents({ id: m.id, rows }));
  }
  useOpenIntent((id) => {
    const m = rows.find((x) => x.id === id);
    if (m) openView(m);
  });

  // ── answer / close ──
  const [step, setStep] = useState<{ kind: Step; memo: Memo } | null>(null);
  const [counts, setCounts] = useState(false);
  function act(note: string) {
    if (!step) return;
    const { kind, memo } = step;
    startTransition(async () => {
      const r =
        kind === "ack"
          ? await acknowledgeMemo(memo.id, note)
          : kind === "dispute"
            ? await disputeMemo(memo.id, note)
            : kind === "resolve"
              ? await resolveMemo(memo.id, note, counts)
              : await withdrawMemo(memo.id, note);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(kind === "ack" ? "Acknowledged" : kind === "dispute" ? "Dispute recorded" : kind === "resolve" ? "Resolved" : "Withdrawn");
      setStep(null);
      if (viewId === memo.id) loadMemoEvents(memo.id).then((rows) => setEvents({ id: memo.id, rows }));
      router.refresh();
    });
  }
  function startStep(kind: Step, memo: Memo) {
    setCounts(memo.memo_type !== "other");
    setStep({ kind, memo });
  }
  const mine = (m: Memo) => isSelf && m.staff_id === myStaffId;
  const canAnswer = (m: Memo) => mine(m) || canEdit;

  const columns: Column<Memo>[] = [
    { header: "Memo No", cell: (m) => <span className="font-mono text-xs font-medium">{m.code ?? "—"}</span> },
    ...(isSelf
      ? []
      : [
          {
            header: "Person",
            cell: (m: Memo) => (
              <span className="flex items-center gap-2 text-sm">
                <PersonAvatar name={m.person_name} person={personKeyOf(m)} className="h-7 w-7 text-[10px]" />
                <span className="font-medium">{m.person_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m.person_code ?? ""}
                  {m.person_kind === "worker" ? " · Worker" : ""}
                </span>
              </span>
            ),
          },
        ]),
    {
      header: "About",
      cell: (m) => (
        <span className="text-sm">
          <span className="font-medium">{m.subject}</span>
          <span className="ml-2 text-xs text-muted-foreground">{memoTypeLabel(m.memo_type)}</span>
        </span>
      ),
    },
    { header: "Issued", cell: (m) => <span className="text-sm tabular-nums">{fmtDate(m.issued_on)}</span> },
    { header: "Reply By", cell: (m) => <span className="text-sm tabular-nums">{m.reply_by ? fmtDate(m.reply_by) : "—"}</span> },
    {
      header: "Counts",
      cell: (m) => (m.status === "resolved" ? <span className="text-sm">{m.counts ? "Yes" : "No"}</span> : <span className="text-muted-foreground">—</span>),
    },
  ];
  const statusColumn: Column<Memo> = {
    header: "Status",
    cell: (m) => <StatusPill tone={conductTone(m.status)}>{conductLabel(m.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Memo>((m) => (
    <RowActions
      label={m.code ?? m.subject}
      onView={() => openView(m)}
      canEdit={false}
      canDelete={false}
      isPending={isPending}
      menu={[
        ...(m.status === "issued" && canAnswer(m)
          ? [{ label: mine(m) ? "Acknowledge" : "Record acknowledgement", icon: ThumbsUp, onClick: () => startStep("ack", m) }]
          : []),
        ...(canEdit && OPEN.has(m.status) ? [{ label: "Resolve", icon: CircleCheck, onClick: () => startStep("resolve", m) }] : []),
        ...(canEdit && m.status === "issued" ? [{ label: "Withdraw", icon: Undo2, onClick: () => startStep("withdraw", m) }] : []),
      ]}
    />
  ));

  const stepText: Record<Step, { title: string; intro: string; label: string; min: number; confirm: string }> = {
    ack: {
      title: "Acknowledge",
      intro: step && mine(step.memo) ? "You confirm you have received and read this memo." : "Record that the person has received and signed the memo.",
      label: "Remark",
      min: 0,
      confirm: "Acknowledge",
    },
    dispute: {
      title: "Dispute",
      intro: step && mine(step.memo) ? "Say why you disagree. HR reads it before closing the memo." : "Record the person's reply — why they disagree.",
      label: "Why",
      min: 10,
      confirm: "Send",
    },
    resolve: {
      title: "Resolve",
      intro: "Close the memo. Say how it was settled, and whether it counts toward further action against the person.",
      label: "How it was resolved",
      min: 5,
      confirm: "Resolve",
    },
    withdraw: {
      title: "Withdraw",
      intro: "Take the memo back — it was issued in error. It stays on record as withdrawn.",
      label: "Reason",
      min: 1,
      confirm: "Withdraw",
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "open", label: `Open (${rows.filter((r) => OPEN.has(r.status)).length})` },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
        {canEdit && <Button onClick={() => openIssue()}>+ Issue Memo</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(m) => m.id}
        empty={scope === "open" ? (isSelf ? "You have no open memos." : "No open memos.") : "No memos here."}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Issue a memo"
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={issue}>
                {isPending ? "Issuing…" : "Issue"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Person" required>
            <PersonCombobox people={people} value={d.person} onChange={(k) => put({ person: k })} />
          </Field>
          {d.person && (history.length > 0 || counted > 0) && (
            <p className={counted >= 3 ? "text-sm text-danger" : "text-sm text-muted-foreground"}>
              {history.length} memo{history.length === 1 ? "" : "s"} before
              {stillOpen ? ` · ${stillOpen} still open` : ""}
              {` · ${counted} counted in the last 12 months`}
              {counted >= 3 ? " — consider a disciplinary case" : ""}
            </p>
          )}
          <Field label="About" required>
            <Select value={d.memo_type} onChange={(e) => put({ memo_type: e.target.value as MemoType })}>
              <option value="" />
              {MEMO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject" required>
            <Input value={d.subject} onChange={(e) => put({ subject: e.target.value })} />
          </Field>
          <Field label="Memo" required>
            <Textarea rows={5} value={d.body} onChange={(e) => put({ body: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="Incident on" w="code">
              <Input type="date" value={d.incident_date} max={d.issued_on} onChange={(e) => put({ incident_date: e.target.value })} />
            </Field>
            <Field label="Memo date" w="code" required>
              <Input type="date" value={d.issued_on} onChange={(e) => put({ issued_on: e.target.value })} />
            </Field>
            <Field label="Reply by" w="code">
              <Input type="date" value={d.reply_by} min={d.issued_on} onChange={(e) => put({ reply_by: e.target.value })} />
            </Field>
          </FieldRow>
        </div>
      </Sheet>

      <Sheet
        open={!!live}
        onClose={() => setViewId(null)}
        title={live ? `${live.code ?? "Memo"} — ${live.person_name}` : "Memo"}
        size="sm"
        footer={
          live && OPEN.has(live.status) && canAnswer(live) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit && live.status === "issued" && (
                <Button variant="outline" disabled={isPending} onClick={() => startStep("withdraw", live)}>
                  Withdraw
                </Button>
              )}
              {live.status !== "disputed" && (
                <Button variant="outline" disabled={isPending} onClick={() => startStep("dispute", live)}>
                  <MessageSquareWarning className="size-4" aria-hidden />
                  {mine(live) ? "Dispute" : "Record dispute"}
                </Button>
              )}
              {live.status === "issued" && (
                <Button variant={canEdit ? "outline" : "primary"} disabled={isPending} onClick={() => startStep("ack", live)}>
                  {mine(live) ? "Acknowledge" : "Record acknowledgement"}
                </Button>
              )}
              {canEdit && (
                <Button disabled={isPending} onClick={() => startStep("resolve", live)}>
                  Resolve
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-5 text-sm">
            <StatusPill tone={conductTone(live.status)}>{conductLabel(live.status)}</StatusPill>
            <dl className="space-y-1">
              <Fact label="About">{memoTypeLabel(live.memo_type)}</Fact>
              <Fact label="Subject">{live.subject}</Fact>
              {live.incident_date && <Fact label="Incident on">{fmtDate(live.incident_date)}</Fact>}
              <Fact label="Memo date">{fmtDate(live.issued_on)}</Fact>
              {live.reply_by && <Fact label="Reply by">{fmtDate(live.reply_by)}</Fact>}
              {live.ack_at && (
                <Fact label="Acknowledged">
                  {fmtDateTime(live.ack_at)}
                  {live.ack_mode === "hr" ? " · recorded by HR" : ""}
                </Fact>
              )}
              {live.ack_note && <Fact label="Remark">{live.ack_note}</Fact>}
              {live.dispute_reason && (
                <Fact label="Disputed" className="whitespace-pre-wrap">
                  {live.dispute_reason}
                </Fact>
              )}
              {live.resolution_note && <Fact label="Resolved">{live.resolution_note}</Fact>}
              {live.status === "resolved" && <Fact label="Counts">{live.counts ? "Yes — toward further action" : "No"}</Fact>}
              {live.withdrawn_reason && <Fact label="Withdrawn">{live.withdrawn_reason}</Fact>}
              {live.case_code && <Fact label="Case">{live.case_code}</Fact>}
            </dl>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Memo</h3>
              <p className="whitespace-pre-wrap rounded-control border border-border bg-muted/30 p-3">{live.body}</p>
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</h3>
              {events?.id === live.id ? (
                <Diary rows={events.rows.map((e) => ({ id: e.id, title: EVENT_WORDS[e.to_status] ?? e.to_status, note: e.note, at: e.at, actor: e.actor }))} />
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
            </section>
          </div>
        )}
      </Sheet>

      <NoteSheet
        open={!!step}
        busy={isPending}
        onClose={() => setStep(null)}
        onConfirm={act}
        title={step ? `${stepText[step.kind].title} ${step.memo.code ?? ""}` : ""}
        intro={step ? stepText[step.kind].intro : ""}
        label={step ? stepText[step.kind].label : "Reason"}
        min={step ? stepText[step.kind].min : 1}
        confirmLabel={step ? stepText[step.kind].confirm : "OK"}
        danger={step?.kind === "withdraw"}
      >
        {step?.kind === "resolve" && (
          <Tick checked={counts} onChange={setCounts}>
            Counts toward further action (three counted in a year suggests a disciplinary case)
          </Tick>
        )}
      </NoteSheet>
    </div>
  );
}
