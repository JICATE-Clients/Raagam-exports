"use client";

import Link from "next/link";
import { ArrowRight, Gavel, NotebookPen, Undo2, UserRoundPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  addCaseNote,
  addWitness,
  advanceCase,
  loadCaseDetail,
  openCase,
  proposeDecision,
  recallDecision,
  updateCase,
  withdrawCase,
} from "@/lib/hr/conduct-actions";
import {
  CASE_CATEGORIES,
  CASE_STAGES,
  OUTCOMES,
  caseCategoryLabel,
  conductLabel,
  conductTone,
  decisionProblem,
  memoTypeLabel,
  nextStage,
  outcomeLabel,
  stageLabel,
  type CaseCategory,
  type CaseDraft,
  type DecisionDraft,
  type DisciplinaryCase,
  type Memo,
  type Outcome,
} from "@/lib/hr/conduct-types";
import { personKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { Fact } from "@/components/hr/timeoff/shared";
import { PersonCombobox } from "@/components/hr/lifecycle/shared";
import { Diary, NoteSheet, Tick } from "./shared";

/**
 * HR ▸ Conduct & Policies ▸ Disciplinary Cases (0791, MyJKKN §13.6).
 *
 * Initiated → Enquiry → Hearing → Decision, one stage at a time, with a diary
 * and witness statements. At the decision HR proposes the outcome and the
 * approver decides — MyJKKN let one super admin decide alone. An approved
 * termination opens the person's exit on Team Lifecycle ▸ Exits (the approval
 * WAS the decision, so the exit starts already decided). HR only: the person
 * hears of it by memo and letter.
 */

type Props = { rows: DisciplinaryCase[]; memos: Memo[]; people: PersonOption[]; canEdit: boolean };
type Scope = "open" | "closed" | "all";
type Detail = Awaited<ReturnType<typeof loadCaseDetail>> & { id: string };

const LIVE = new Set(["active", "pending_approval"]);

const BLANK = (): CaseDraft => ({
  person: "",
  category: "",
  allegation: "",
  incident_date: "",
  enquiry_officer: "",
  hearing_date: "",
  memo_ids: [],
});
const BLANK_DECISION = (): DecisionDraft => ({ outcome: "", decision_note: "", suspension_from: "", suspension_to: "", last_working_day: "" });

const EVENT_WORDS: Record<string, string> = {
  opened: "Case opened",
  note: "Note",
  stage: "Stage moved",
  witness: "Statement recorded",
  proposed: "Decision sent for approval",
  approved: "Decision approved",
  rejected: "Decision rejected",
  recalled: "Decision recalled",
  withdrawn: "Case withdrawn",
};

const keyOf = (r: { staff_id: string | null; worker_id: string | null }) =>
  r.staff_id ? personKey("staff", r.staff_id) : personKey("worker", r.worker_id as string);

/** The four stages as a strip, the current one lit. */
function StageStrip({ c }: { c: DisciplinaryCase }) {
  const at = CASE_STAGES.findIndex((s) => s.value === c.stage);
  const done = c.status === "closed";
  return (
    <ol className="flex items-center gap-1" aria-label="Stage">
      {CASE_STAGES.map((s, i) => (
        <li key={s.value} className="flex items-center gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              done || i < at ? "bg-success/15 text-success" : i === at ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {s.label}
          </span>
          {i < CASE_STAGES.length - 1 && <span className="h-px w-3 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function CasesScreen({ rows, memos, people, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [scope, setScope] = useState<Scope>("open");
  const visible = scope === "all" ? rows : rows.filter((r) => LIVE.has(r.status) === (scope === "open"));
  const officers = people.filter((p) => p.kind === "staff");

  // ── open / edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<CaseDraft>(BLANK);
  const [dirty, setDirty] = useState(false);
  const put = (patch: Partial<CaseDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openNew() {
    setEditId(null);
    setD(BLANK());
    setDirty(false);
    setOpen(true);
  }
  function openEdit(c: DisciplinaryCase) {
    setEditId(c.id);
    setD({
      person: keyOf(c),
      category: c.category,
      allegation: c.allegation,
      incident_date: c.incident_date ?? "",
      enquiry_officer: c.enquiry_officer ? personKey("staff", c.enquiry_officer) : "",
      hearing_date: c.hearing_date ?? "",
      memo_ids: [],
    });
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => {
    if (canEdit) openNew();
  });
  const personMemos = d.person && !editId ? memos.filter((m) => keyOf(m) === d.person && m.status !== "withdrawn" && !m.case_id) : [];
  const hasOpenCase = !editId && !!d.person && rows.some((r) => LIVE.has(r.status) && keyOf(r) === d.person);
  const problem = !d.person
    ? "Pick the person"
    : hasOpenCase
      ? "This person already has an open case"
      : !d.category
        ? "Pick the kind of case"
        : d.allegation.trim().length < 20
          ? "Describe what happened (at least 20 characters)"
          : d.enquiry_officer && d.enquiry_officer === d.person
            ? "The person cannot hold their own enquiry"
            : null;
  function save() {
    const body = { ...d, enquiry_officer: d.enquiry_officer ? d.enquiry_officer.slice("staff:".length) : "" };
    startTransition(async () => {
      const r = editId ? await updateCase(editId, body) : await openCase(body);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Case saved" : "Case opened");
      router.refresh();
      if (!editId && r.id) setViewId(r.id);
    });
  }

  // ── view ──
  const [viewId, setViewId] = useState<string | null>(null);
  const live = viewId ? (rows.find((r) => r.id === viewId) ?? null) : null;
  const [detail, setDetail] = useState<Detail | null>(null);
  function reload(id: string) {
    loadCaseDetail(id).then((x) => setDetail({ ...x, id }));
  }
  function openView(c: DisciplinaryCase) {
    setViewId(c.id);
    setDetail(null);
    reload(c.id);
  }
  useOpenIntent((id) => {
    const c = rows.find((x) => x.id === id);
    if (c) openView(c);
  });
  const caseMemos = live ? memos.filter((m) => m.case_id === live.id) : [];

  // ── diary steps ──
  type Step = "note" | "advance" | "withdraw" | "recall";
  const [step, setStep] = useState<{ kind: Step; c: DisciplinaryCase } | null>(null);
  function act(note: string) {
    if (!step) return;
    const { kind, c } = step;
    startTransition(async () => {
      const r =
        kind === "note"
          ? await addCaseNote(c.id, note)
          : kind === "advance"
            ? await advanceCase(c.id, note)
            : kind === "withdraw"
              ? await withdrawCase(c.id, note)
              : await recallDecision(c.id, note);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success(kind === "note" ? "Note added" : kind === "advance" ? "Moved on" : kind === "withdraw" ? "Case withdrawn" : "Decision recalled");
      setStep(null);
      reload(c.id);
      router.refresh();
    });
  }

  // ── witness ──
  const [witFor, setWitFor] = useState<DisciplinaryCase | null>(null);
  const [w, setW] = useState({ person: "", outside_name: "", statement: "", given_on: today() });
  const [outsider, setOutsider] = useState(false);
  function openWitness(c: DisciplinaryCase) {
    setW({ person: "", outside_name: "", statement: "", given_on: today() });
    setOutsider(false);
    setWitFor(c);
  }
  const witProblem =
    !outsider && !w.person
      ? "Pick the witness"
      : outsider && !w.outside_name.trim()
        ? "Type the witness's name"
        : witFor && w.person === keyOf(witFor)
          ? "The person cannot witness their own case"
          : !w.statement.trim()
            ? "Write the statement"
            : null;
  function saveWitness() {
    if (!witFor) return;
    const c = witFor;
    startTransition(async () => {
      const r = await addWitness(c.id, outsider ? { ...w, person: "" } : { ...w, outside_name: "" });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success("Statement recorded");
      setWitFor(null);
      reload(c.id);
      router.refresh();
    });
  }

  // ── decision ──
  const [decFor, setDecFor] = useState<DisciplinaryCase | null>(null);
  const [dec, setDec] = useState<DecisionDraft>(BLANK_DECISION);
  const putDec = (patch: Partial<DecisionDraft>) => setDec((x) => ({ ...x, ...patch }));
  const decProblem = decisionProblem(dec);
  useUnsavedGuard((open && dirty) || !!decFor || !!witFor || isPending);
  function openDecision(c: DisciplinaryCase) {
    setDec({
      ...BLANK_DECISION(),
      // A rejected proposal comes back with what was proposed, to be changed.
      outcome: c.outcome ?? "",
      decision_note: c.decision_note ?? "",
      suspension_from: c.suspension_from ?? "",
      suspension_to: c.suspension_to ?? "",
      last_working_day: c.last_working_day ?? "",
    });
    setDecFor(c);
  }
  function sendDecision() {
    if (!decFor) return;
    const c = decFor;
    startTransition(async () => {
      const r = await proposeDecision(c.id, dec);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      success("Sent for approval");
      setDecFor(null);
      reload(c.id);
      router.refresh();
    });
  }

  const columns: Column<DisciplinaryCase>[] = [
    { header: "Case No", cell: (c) => <span className="font-mono text-xs font-medium">{c.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (c) => (
        <span className="text-sm">
          <span className="font-medium">{c.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {c.person_code ?? ""}
            {c.person_kind === "worker" ? " · Worker" : ""}
          </span>
        </span>
      ),
    },
    { header: "Kind", cell: (c) => <span className="text-sm">{caseCategoryLabel(c.category)}</span> },
    { header: "Opened", cell: (c) => <span className="text-sm tabular-nums">{fmtDate(c.opened_on)}</span> },
    {
      header: "Stage",
      cell: (c) => <span className="text-sm">{c.status === "active" || c.status === "pending_approval" ? stageLabel(c.stage) : "—"}</span>,
    },
    {
      header: "Outcome",
      cell: (c) =>
        c.status === "closed" ? (
          <span className="text-sm font-medium">{outcomeLabel(c.outcome)}</span>
        ) : c.status === "pending_approval" ? (
          <span className="text-sm text-muted-foreground">{outcomeLabel(c.outcome)} (proposed)</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  const statusColumn: Column<DisciplinaryCase> = {
    header: "Status",
    cell: (c) => <StatusPill tone={conductTone(c.status)}>{conductLabel(c.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<DisciplinaryCase>((c) => {
    const next = nextStage(c.stage);
    const active = canEdit && c.status === "active";
    return (
      <RowActions
        label={c.code ?? c.person_name}
        onView={() => openView(c)}
        onEdit={() => openEdit(c)}
        canEdit={active}
        editDisabledReason={canEdit && c.status !== "active" ? `The case is ${conductLabel(c.status).toLowerCase()}` : undefined}
        canDelete={false}
        isPending={isPending}
        menu={
          active
            ? next
              ? [{ label: `Move to ${stageLabel(next)}`, icon: ArrowRight, onClick: () => setStep({ kind: "advance", c }) }]
              : [{ label: "Propose decision", icon: Gavel, onClick: () => openDecision(c) }]
            : []
        }
      />
    );
  });

  const stepText: Record<Step, { title: string; intro: string; label: string; min: number; confirm: string; danger?: boolean }> = {
    note: { title: "Add a note", intro: "A line in the case diary — a call made, a paper received.", label: "Note", min: 1, confirm: "Add" },
    advance: {
      title: step ? `Move to ${stageLabel(nextStage(step.c.stage) ?? step.c.stage)}` : "Move on",
      intro: "Move the case one stage on. Add a line for the diary if there is one.",
      label: "Note",
      min: 0,
      confirm: "Move on",
    },
    withdraw: {
      title: "Withdraw the case",
      intro: "The case is not going ahead. It stays on record as withdrawn, and its memos are free to go on another case.",
      label: "Why",
      min: 5,
      confirm: "Withdraw",
      danger: true,
    },
    recall: {
      title: "Recall the decision",
      intro: "Take the decision back from the approver to change it. The case returns to the decision stage.",
      label: "Why",
      min: 1,
      confirm: "Recall",
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
            { value: "open", label: `Open (${rows.filter((r) => LIVE.has(r.status)).length})` },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
        {canEdit && <Button onClick={openNew}>+ Open Case</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(c) => c.id}
        empty={scope === "open" ? "No open cases." : "No cases here."}
      />

      {/* ── open / edit ── */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit the case" : "Open a disciplinary case"}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{problem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!problem} onClick={save}>
                {isPending ? "Saving…" : editId ? "Save" : "Open case"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Person" required>
            <PersonCombobox people={people} value={d.person} disabled={!!editId} onChange={(k) => put({ person: k, memo_ids: [] })} />
          </Field>
          <Field label="Kind of case" required>
            <Select value={d.category} onChange={(e) => put({ category: e.target.value as CaseCategory })}>
              <option value="" />
              {CASE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What happened" required>
            <Textarea rows={4} value={d.allegation} onChange={(e) => put({ allegation: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="Incident on" w="code">
              <Input type="date" value={d.incident_date} max={today()} onChange={(e) => put({ incident_date: e.target.value })} />
            </Field>
            {editId && (
              <Field label="Hearing on" w="code">
                <Input type="date" value={d.hearing_date} onChange={(e) => put({ hearing_date: e.target.value })} />
              </Field>
            )}
          </FieldRow>
          <Field label="Enquiry officer">
            <PersonCombobox people={officers} value={d.enquiry_officer} onChange={(k) => put({ enquiry_officer: k })} />
          </Field>
          {personMemos.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Memos behind it</legend>
              {personMemos.map((m) => (
                <Tick
                  key={m.id}
                  checked={d.memo_ids.includes(m.id)}
                  onChange={(v) => put({ memo_ids: v ? [...d.memo_ids, m.id] : d.memo_ids.filter((x) => x !== m.id) })}
                >
                  <span className="font-mono text-xs">{m.code}</span> {m.subject}
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {memoTypeLabel(m.memo_type)} · {fmtDate(m.issued_on)}
                    {m.counts ? " · counted" : ""}
                  </span>
                </Tick>
              ))}
            </fieldset>
          )}
        </div>
      </Sheet>

      {/* ── view ── */}
      <Sheet
        open={!!live}
        onClose={() => setViewId(null)}
        title={live ? `${live.code ?? "Case"} — ${live.person_name}` : "Case"}
        size="md"
        footer={
          live && canEdit && LIVE.has(live.status) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {live.status === "active" ? (
                <>
                  <Button variant="outline" disabled={isPending} onClick={() => setStep({ kind: "withdraw", c: live })}>
                    Withdraw
                  </Button>
                  <Button variant="outline" disabled={isPending} onClick={() => setStep({ kind: "note", c: live })}>
                    <NotebookPen className="size-4" aria-hidden />
                    Add note
                  </Button>
                  <Button variant="outline" disabled={isPending} onClick={() => openWitness(live)}>
                    <UserRoundPlus className="size-4" aria-hidden />
                    Add statement
                  </Button>
                  {nextStage(live.stage) ? (
                    <Button disabled={isPending} onClick={() => setStep({ kind: "advance", c: live })}>
                      Move to {stageLabel(nextStage(live.stage) as string)}
                    </Button>
                  ) : (
                    <Button disabled={isPending} onClick={() => openDecision(live)}>
                      Propose decision
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="outline" disabled={isPending} onClick={() => setStep({ kind: "recall", c: live })}>
                  <Undo2 className="size-4" aria-hidden />
                  Recall decision
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {live && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={conductTone(live.status)}>{conductLabel(live.status)}</StatusPill>
              {live.status !== "withdrawn" && <StageStrip c={live} />}
            </div>
            <dl className="space-y-1">
              <Fact label="Kind">{caseCategoryLabel(live.category)}</Fact>
              {live.incident_date && <Fact label="Incident on">{fmtDate(live.incident_date)}</Fact>}
              <Fact label="Opened">{fmtDate(live.opened_on)}</Fact>
              <Fact label="Enquiry officer">{live.enquiry_officer_name ?? "—"}</Fact>
              {live.hearing_date && <Fact label="Hearing on">{fmtDate(live.hearing_date)}</Fact>}
              {live.outcome && (
                <Fact label={live.status === "closed" ? "Decision" : "Proposed"}>
                  <span className="font-medium">{outcomeLabel(live.outcome)}</span>
                  {live.outcome === "suspension" && live.suspension_from && (
                    <span>
                      {" "}
                      · {fmtDate(live.suspension_from)} – {fmtDate(live.suspension_to)}
                    </span>
                  )}
                  {live.outcome === "termination" && live.last_working_day && <span> · last day {fmtDate(live.last_working_day)}</span>}
                </Fact>
              )}
              {live.decision_note && (
                <Fact label="Reasons" className="whitespace-pre-wrap">
                  {live.decision_note}
                </Fact>
              )}
              {live.decision_remark && <Fact label="Approver said">{live.decision_remark}</Fact>}
              {live.exit_id && (
                <Fact label="Exit">
                  <Link href={`/hr/team/exits?open=${live.exit_id}`} className="font-medium text-primary hover:underline">
                    {live.exit_code ?? "Open the exit"} →
                  </Link>
                </Fact>
              )}
              {live.withdrawn_reason && <Fact label="Withdrawn">{live.withdrawn_reason}</Fact>}
            </dl>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happened</h3>
              <p className="whitespace-pre-wrap rounded-control border border-border bg-muted/30 p-3">{live.allegation}</p>
            </section>

            {caseMemos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Memos ({caseMemos.length})</h3>
                <ul className="space-y-1">
                  {caseMemos.map((m) => (
                    <li key={m.id}>
                      <Link href={`/hr/conduct/memos?open=${m.id}`} className="hover:underline">
                        <span className="font-mono text-xs">{m.code}</span> {m.subject}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {fmtDate(m.issued_on)} · {conductLabel(m.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Statements</h3>
              {detail?.id !== live.id ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : detail.witnesses.length === 0 ? (
                <p className="text-muted-foreground">None recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.witnesses.map((x) => (
                    <li key={x.id} className="rounded-control border border-border p-3">
                      <p className="font-medium">
                        {x.name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {x.kind === "outside" ? "Not on the rolls" : x.kind === "worker" ? "Worker" : "Staff"} · {fmtDate(x.given_on)}
                        </span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-foreground/80">{x.statement}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diary</h3>
              {detail?.id === live.id ? (
                <Diary rows={detail.events.map((e) => ({ id: e.id, title: EVENT_WORDS[e.kind] ?? e.kind, note: e.note, at: e.at, actor: e.actor }))} />
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
            </section>

            {detail?.id === live.id && detail.panel.run && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={detail.panel.timeline} resolveUserName={(id) => detail.panel.names[id]} />
                {detail.panel.verdict && live.status === "pending_approval" && (
                  <ApprovalActionBar
                    run={detail.panel.run}
                    verdict={detail.panel.verdict}
                    subjectPath="/hr/conduct/cases"
                    onDone={() => setViewId(null)}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </Sheet>

      {/* ── witness ── */}
      <Sheet
        open={!!witFor}
        onClose={() => setWitFor(null)}
        title={`Statement — ${witFor?.code ?? ""}`}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{witProblem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWitFor(null)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!witProblem} onClick={saveWitness}>
                Record
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Tick checked={outsider} onChange={setOutsider}>
            Someone not on the rolls (a visitor, a contractor&apos;s man)
          </Tick>
          {outsider ? (
            <Field label="Name" required>
              <Input value={w.outside_name} onChange={(e) => setW((x) => ({ ...x, outside_name: e.target.value }))} />
            </Field>
          ) : (
            <Field label="Witness" required>
              <PersonCombobox people={people} value={w.person} onChange={(k) => setW((x) => ({ ...x, person: k }))} />
            </Field>
          )}
          <Field label="Given on" w="code" required>
            <Input type="date" value={w.given_on} max={today()} onChange={(e) => setW((x) => ({ ...x, given_on: e.target.value }))} />
          </Field>
          <Field label="Statement" required>
            <Textarea rows={6} value={w.statement} onChange={(e) => setW((x) => ({ ...x, statement: e.target.value }))} />
          </Field>
        </div>
      </Sheet>

      {/* ── decision ── */}
      <Sheet
        open={!!decFor}
        onClose={() => setDecFor(null)}
        title={`Decision — ${decFor?.code ?? ""}`}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{decProblem ?? ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDecFor(null)}>
                Cancel
              </Button>
              <Button disabled={isPending || !!decProblem} onClick={sendDecision}>
                {isPending ? "Sending…" : "Send for approval"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {decFor?.decision_remark && (
            <p className="rounded-control border border-warning/40 bg-warning/10 p-3 text-sm">
              Sent back last time: <span className="font-medium">{decFor.decision_remark}</span>
            </p>
          )}
          <Field label="Decision" required>
            <Select value={dec.outcome} onChange={(e) => putDec({ outcome: e.target.value as Outcome })}>
              <option value="" />
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {dec.outcome === "suspension" && (
            <FieldRow>
              <Field label="Suspended from" w="code" required>
                <Input type="date" value={dec.suspension_from} onChange={(e) => putDec({ suspension_from: e.target.value })} />
              </Field>
              <Field label="To" w="code" required>
                <Input type="date" value={dec.suspension_to} min={dec.suspension_from} onChange={(e) => putDec({ suspension_to: e.target.value })} />
              </Field>
            </FieldRow>
          )}
          {dec.outcome === "termination" && (
            <Field label="Last working day" w="code" required>
              <Input type="date" value={dec.last_working_day} onChange={(e) => putDec({ last_working_day: e.target.value })} />
            </Field>
          )}
          <Field label="Reasons" required>
            <Textarea rows={4} value={dec.decision_note} onChange={(e) => putDec({ decision_note: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            {dec.outcome === "termination"
              ? "Once approved, the person's exit opens on Team Lifecycle ▸ Exits with this case as its grounds — no second approval."
              : dec.outcome === "suspension"
                ? "The suspension is recorded on the case. Mark the days on attendance as usual."
                : "The approver sees the case, the statements and these reasons."}
          </p>
        </div>
      </Sheet>

      <NoteSheet
        open={!!step}
        busy={isPending}
        onClose={() => setStep(null)}
        onConfirm={act}
        title={step ? `${stepText[step.kind].title} — ${step.c.code ?? ""}` : ""}
        intro={step ? stepText[step.kind].intro : ""}
        label={step ? stepText[step.kind].label : "Note"}
        min={step ? stepText[step.kind].min : 1}
        confirmLabel={step ? stepText[step.kind].confirm : "OK"}
        danger={!!step && !!stepText[step.kind].danger}
      />
    </div>
  );
}
