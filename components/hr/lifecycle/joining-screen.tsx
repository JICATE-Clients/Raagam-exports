"use client";

import { Ban } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { fmtDate } from "@/lib/format";
import { cancelOnboarding, loadOnboardingSteps, startOnboarding, tickOnboardingStep } from "@/lib/hr/lifecycle-actions";
import {
  appliesToPerson,
  lifecycleLabel,
  lifecycleTone,
  type ChecklistTemplate,
  type Onboarding,
  type OnboardingStep,
} from "@/lib/hr/lifecycle-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";
import { ReasonSheet } from "@/components/hr/timeoff/shared";
import { PersonCombobox, Progress, StepRow } from "./shared";

/**
 * HR ▸ Team Lifecycle ▸ Joining Checklists (0766, MyJKKN §12.2).
 *
 * MyJKKN kept only the templates; a joiner's progress lived in a JSON copy on
 * the recruitment candidate and no HR screen showed it. Here "Start checklist"
 * copies a template's steps onto the person with due dates counted from their
 * joining date, and HR ticks them off. The last tick completes it.
 */

type Props = {
  rows: Onboarding[];
  templates: ChecklistTemplate[];
  people: PersonOption[];
  canEdit: boolean;
};

export function JoiningScreen({ rows, templates, people, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const [scope, setScope] = useState<"in_progress" | "all">("in_progress");
  const visible = useMemo(() => (scope === "all" ? rows : rows.filter((r) => r.status === "in_progress")), [rows, scope]);

  // ── start ──
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState(t0);
  useUnsavedGuard((open && !!person) || isPending);
  const chosen = people.find((p) => p.key === person);
  const fitting = templates.filter((t) => t.is_active && (!chosen || appliesToPerson(t.applies_to, chosen.kind)));

  function openStart() {
    setPerson("");
    setTemplateId("");
    setStartDate(t0);
    setOpen(true);
  }
  useCreateIntent(() => openStart());

  function start() {
    startTransition(async () => {
      const r = await startOnboarding(person, templateId, startDate);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setOpen(false);
      success("Checklist started");
      router.refresh();
    });
  }

  // ── view / tick ──
  const [viewFor, setViewFor] = useState<Onboarding | null>(null);
  const [steps, setSteps] = useState<{ id: string; rows: OnboardingStep[] } | null>(null);
  function openView(o: Onboarding) {
    setViewFor(o);
    loadOnboardingSteps(o.id).then((s) => setSteps({ id: o.id, rows: s }));
  }
  useOpenIntent((id) => {
    const o = rows.find((x) => x.id === id);
    if (o) openView(o);
  });
  function tick(step: OnboardingStep, done: boolean) {
    if (!viewFor) return;
    const id = viewFor.id;
    // Optimistic: the box moves at once, and comes back if the database refuses.
    setSteps((s) => (s && s.id === id ? { id, rows: s.rows.map((x) => (x.id === step.id ? { ...x, done } : x)) } : s));
    startTransition(async () => {
      const r = await tickOnboardingStep(step.id, done, step.note ?? "");
      if (!r.ok) toastError(r.error);
      setSteps({ id, rows: await loadOnboardingSteps(id) });
      router.refresh();
    });
  }

  const [cancelFor, setCancelFor] = useState<Onboarding | null>(null);
  function doCancel(reason: string) {
    if (!cancelFor) return;
    const id = cancelFor.id;
    startTransition(async () => {
      const r = await cancelOnboarding(id, reason);
      if (!r.ok) toastError(r.error);
      else {
        success("Checklist cancelled");
        setCancelFor(null);
        router.refresh();
      }
    });
  }

  const columns: Column<Onboarding>[] = [
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
    { header: "Checklist", cell: (r) => <span className="text-sm">{r.template_name}</span> },
    { header: "Joined", cell: (r) => <span className="text-sm tabular-nums">{fmtDate(r.start_date)}</span> },
    { header: "Progress", cell: (r) => <Progress done={r.steps_done} total={r.steps_total} overdue={r.steps_overdue} /> },
  ];
  const statusColumn: Column<Onboarding> = {
    header: "Status",
    cell: (r) => <StatusPill tone={lifecycleTone(r.status)}>{lifecycleLabel(r.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Onboarding>((r) => (
    <RowActions
      label={r.code}
      onView={() => openView(r)}
      isPending={isPending}
      menu={
        canEdit && r.status === "in_progress"
          ? [{ label: "Cancel checklist…", icon: Ban, danger: true, onClick: () => setCancelFor(r) }]
          : []
      }
    />
  ));

  const viewSteps = viewFor && steps?.id === viewFor.id ? steps.rows : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "in_progress", label: "In progress" },
            { value: "all", label: "All" },
          ]}
        />
        {canEdit && <Button onClick={openStart}>+ Start Checklist</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(r) => r.id}
        empty={scope === "in_progress" ? "No joining checklist in progress." : "No joining checklists yet."}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Start a joining checklist"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !person || !templateId} onClick={start}>
              {isPending ? "Starting…" : "Start"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Person" required>
            <PersonCombobox
              people={people}
              value={person}
              onChange={(v) => {
                setPerson(v);
                setTemplateId("");
              }}
            />
          </Field>
          <Field label="Checklist" required>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">—</option>
              {fitting.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.steps.length} steps)
                </option>
              ))}
            </Select>
          </Field>
          <FieldRow>
            <Field label="Joining date" w="code" hint="Due dates count from this day">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </FieldRow>
        </div>
      </Sheet>

      <Sheet
        open={!!viewFor}
        onClose={() => setViewFor(null)}
        title={viewFor ? `${viewFor.code ?? "Checklist"} — ${viewFor.person_name}` : "Checklist"}
        size="sm"
      >
        {viewFor && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <StatusPill tone={lifecycleTone(viewFor.status)}>{lifecycleLabel(viewFor.status)}</StatusPill>
              <span className="text-xs text-muted-foreground">
                {viewFor.template_name} · joined {fmtDate(viewFor.start_date)}
              </span>
            </div>
            {viewFor.cancel_reason && <p className="text-xs text-muted-foreground">Cancelled — {viewFor.cancel_reason}</p>}
            {viewSteps ? (
              <ul className="space-y-2">
                {viewSteps.map((s) => (
                  <StepRow
                    key={s.id}
                    title={s.title}
                    done={s.done}
                    disabled={!canEdit || viewFor.status === "cancelled" || isPending}
                    late={!s.done && !!s.due_date && s.due_date < t0}
                    meta={[
                      s.owner,
                      s.done && s.done_at ? `done ${fmtDate(s.done_at.slice(0, 10))}` : s.due_date ? `due ${fmtDate(s.due_date)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onToggle={(v) => tick(s, v)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Loading the steps…</p>
            )}
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!cancelFor}
        busy={isPending}
        onClose={() => setCancelFor(null)}
        onConfirm={doCancel}
        danger
        title={`Cancel ${cancelFor?.code ?? ""}`}
        confirmLabel="Cancel checklist"
        intro="The ticked steps stay on record. Use this when the person did not join after all."
      />
    </div>
  );
}
