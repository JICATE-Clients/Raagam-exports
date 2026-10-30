"use client";

import { CalendarClock, CircleCheck, CircleSlash, ClipboardPen, UserX } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
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
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime } from "@/lib/format";
import { closeInterview, saveScorecard } from "@/lib/hr/recruitment-actions";
import {
  MODE_LABELS,
  RECOMMENDATIONS,
  RECOMMENDATION_LABELS,
  SCORE_FIELDS,
  recruitmentLabel,
  recruitmentTone,
  scoreOf,
  type Candidate,
  type Interview,
  type Recommendation,
  type ScoreKey,
} from "@/lib/hr/recruitment-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";
import { ReasonSheet } from "@/components/hr/timeoff/shared";
import { ScheduleSheet, ScoreBadge } from "./shared";

/**
 * HR ▸ Recruitment ▸ Interviews (0767, MyJKKN §7 interviews + scorecards).
 *
 * Every round across every candidate in the unit. A panel member who signs in
 * for themself sees only the interviews they sit on, and enters their own
 * marks; HR can enter any panel member's marks from the paper sheet. Marks are
 * independent — a panel member sees only their own. Moving an interview keeps
 * the old one on record (as MyJKKN did).
 */

type Props = {
  rows: Interview[];
  /** Candidates an interview can be scheduled for (new / shortlisted / interview, none scheduled). */
  schedulable: Candidate[];
  staff: PersonOption[];
  /** The viewer's own staff id when signed in for themself — the panel member. */
  myStaffId: string | null;
  canEdit: boolean;
  /** Server time when the page was read — "overdue" is measured against it. */
  now: string;
};

type Marks = Record<ScoreKey, number> & { recommendation: Recommendation; comments: string; interviewer: string };

export function InterviewsScreen({ rows, schedulable, staff, myStaffId, canEdit, now }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [scope, setScope] = useState<"upcoming" | "marks" | "done" | "all">("upcoming");
  const shown = useMemo(() => rows.filter((r) => r.status !== "rescheduled" || scope === "all"), [rows, scope]);
  const visible = useMemo(() => {
    if (scope === "upcoming") return shown.filter((r) => r.status === "scheduled").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    if (scope === "marks")
      return shown.filter(
        (r) =>
          (r.status === "scheduled" || r.status === "completed") &&
          (myStaffId
            ? r.panel.includes(myStaffId) && !r.scorecards.some((x) => x.interviewer_id === myStaffId)
            : r.scorecards.length < r.panel.length),
      );
    if (scope === "done") return shown.filter((r) => r.status !== "scheduled");
    return shown;
  }, [shown, scope, myStaffId]);

  // ── schedule (pick a candidate first) ──
  const [picking, setPicking] = useState(false);
  const [pickId, setPickId] = useState("");
  const [scheduleFor, setScheduleFor] = useState<Candidate | null>(null);
  const [moveFor, setMoveFor] = useState<Interview | null>(null);
  useCreateIntent(() => {
    if (canEdit) setPicking(true);
  });

  // ── close ──
  const [closing, setClosing] = useState<{ i: Interview; status: "cancelled" | "no_show" } | null>(null);
  function close(i: Interview, status: "completed" | "cancelled" | "no_show", note: string) {
    startTransition(async () => {
      const r = await closeInterview(i.id, status, note);
      if (!r.ok) toastError(r.error);
      else {
        success(status === "completed" ? "Marked completed" : status === "no_show" ? "Marked no-show" : "Interview cancelled");
        setClosing(null);
        router.refresh();
      }
    });
  }

  // ── marks ──
  const [marksFor, setMarksFor] = useState<Interview | null>(null);
  const [m, setM] = useState<Marks>({ skill: 0, communication: 0, attitude: 0, experience: 0, recommendation: "hire", comments: "", interviewer: "" });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((!!marksFor && dirty) || isPending);
  function openMarks(i: Interview) {
    const who = myStaffId && i.panel.includes(myStaffId) ? myStaffId : (i.panel.find((p) => !i.scorecards.some((x) => x.interviewer_id === p)) ?? i.panel[0]);
    loadMarks(i, who);
    setMarksFor(i);
  }
  function loadMarks(i: Interview, who: string) {
    const prev = i.scorecards.find((x) => x.interviewer_id === who);
    setM(
      prev
        ? { skill: prev.skill, communication: prev.communication, attitude: prev.attitude, experience: prev.experience, recommendation: prev.recommendation, comments: prev.comments ?? "", interviewer: who }
        : { skill: 0, communication: 0, attitude: 0, experience: 0, recommendation: "hire", comments: "", interviewer: who },
    );
    setDirty(false);
  }
  const marksDone = SCORE_FIELDS.every((f) => m[f.key] >= 1);
  function saveMarks() {
    if (!marksFor) return;
    const id = marksFor.id;
    startTransition(async () => {
      const r = await saveScorecard({
        interview_id: id,
        interviewer_id: m.interviewer,
        skill: m.skill,
        communication: m.communication,
        attitude: m.attitude,
        experience: m.experience,
        recommendation: m.recommendation,
        comments: m.comments,
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setMarksFor(null);
      success("Marks saved");
      router.refresh();
    });
  }
  const canMarkFor = (i: Interview) => canEdit || (!!myStaffId && i.panel.includes(myStaffId));

  const columns: Column<Interview>[] = [
    {
      header: "When",
      cell: (i) => (
        <span className={i.status === "scheduled" && i.scheduled_at < now ? "text-sm font-medium tabular-nums text-danger" : "text-sm tabular-nums"}>
          {fmtDateTime(i.scheduled_at)}
        </span>
      ),
    },
    {
      header: "Candidate",
      cell: (i) => (
        <span className="text-sm">
          <span className="font-medium">{i.candidate_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{i.job_title}</span>
        </span>
      ),
    },
    {
      header: "Round",
      cell: (i) => (
        <span className="text-sm">
          {i.round_no} · {i.round_name}
        </span>
      ),
    },
    {
      header: "Where",
      cell: (i) => <Truncated text={`${MODE_LABELS[i.mode]}${i.venue ? ` · ${i.venue}` : ""}`} className="max-w-48 text-sm" />,
    },
    { header: "Panel", cell: (i) => <Truncated text={i.panel_names.join(", ")} className="max-w-56 text-sm" /> },
    {
      header: "Marks",
      cell: (i) => (
        <span className="inline-flex items-center gap-2">
          <ScoreBadge score={i.scorecards.length ? i.scorecards.reduce((a, x) => a + scoreOf(x), 0) / i.scorecards.length : null} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {i.scorecards.length} / {i.panel.length}
          </span>
        </span>
      ),
    },
  ];
  const statusColumn: Column<Interview> = {
    header: "Status",
    cell: (i) => <StatusPill tone={recruitmentTone(i.status)}>{recruitmentLabel(i.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Interview>((i) => (
    <RowActions
      label={`${i.candidate_name} round ${i.round_no}`}
      view={false}
      canEdit={false}
      canDelete={false}
      isPending={isPending}
      menu={[
        ...((i.status === "scheduled" || i.status === "completed") && canMarkFor(i)
          ? [{ label: "Marks", icon: ClipboardPen, onClick: () => openMarks(i) }]
          : []),
        ...(canEdit && i.status === "scheduled"
          ? [
              { label: "Completed", icon: CircleCheck, onClick: () => close(i, "completed", "") },
              { label: "Reschedule", icon: CalendarClock, onClick: () => setMoveFor(i) },
              { label: "Did not come", icon: UserX, onClick: () => setClosing({ i, status: "no_show" }) },
              { label: "Cancel…", icon: CircleSlash, onClick: () => setClosing({ i, status: "cancelled" }) },
            ]
          : []),
      ]}
    />
  ));

  const moveCandidate = moveFor ? { id: moveFor.candidate_id, name: moveFor.candidate_name } : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "upcoming", label: "Scheduled" },
            { value: "marks", label: myStaffId ? "My marks due" : "Marks missing" },
            { value: "done", label: "Done" },
            { value: "all", label: "All" },
          ]}
        />
        {canEdit && <Button onClick={() => setPicking(true)}>+ Schedule Interview</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(i) => i.id}
        empty={
          scope === "upcoming"
            ? myStaffId
              ? "You are on no upcoming interview panel."
              : "No interviews scheduled."
            : scope === "marks"
              ? "No marks waiting."
              : "Nothing here."
        }
      />

      {/* ── pick the candidate ──────────────────────────────────────────── */}
      <Sheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Schedule an interview"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button
              disabled={!pickId}
              onClick={() => {
                setScheduleFor(schedulable.find((c) => c.id === pickId) ?? null);
                setPicking(false);
                setPickId("");
              }}
            >
              Next
            </Button>
          </div>
        }
      >
        <Field label="Candidate" required hint="New, shortlisted or in interview, with nothing already scheduled">
          <Select value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="" />
            {schedulable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.job_title}
              </option>
            ))}
          </Select>
        </Field>
      </Sheet>

      <ScheduleSheet
        open={!!scheduleFor || !!moveFor}
        onClose={() => {
          setScheduleFor(null);
          setMoveFor(null);
        }}
        candidate={moveCandidate ?? scheduleFor}
        nextRound={moveFor ? moveFor.round_no : (scheduleFor?.rounds_done ?? 0) + 1}
        reschedule={moveFor}
        staff={staff}
      />

      {/* ── marks ───────────────────────────────────────────────────────── */}
      <Sheet
        open={!!marksFor}
        onClose={() => setMarksFor(null)}
        title={marksFor ? `Marks — ${marksFor.candidate_name}, round ${marksFor.round_no}` : "Marks"}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{marksDone ? "" : "Give every mark from 1 to 5"}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMarksFor(null)}>
                Cancel
              </Button>
              <Button disabled={isPending || !marksDone || !m.interviewer} onClick={saveMarks}>
                Save marks
              </Button>
            </div>
          </div>
        }
      >
        {marksFor && (
          <div className="space-y-4 text-sm">
            {canEdit && !(myStaffId && marksFor.panel.includes(myStaffId)) ? (
              <Field label="Panel member" required hint="Entering marks from their sheet">
                <Select
                  value={m.interviewer}
                  onChange={(e) => {
                    loadMarks(marksFor, e.target.value);
                  }}
                >
                  {marksFor.panel.map((id, n) => (
                    <option key={id} value={id}>
                      {marksFor.panel_names[n]}
                      {marksFor.scorecards.some((x) => x.interviewer_id === id) ? " — entered" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {SCORE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required>
                <Segmented
                  name={`mark-${f.key}`}
                  value={String(m[f.key]) as "1" | "2" | "3" | "4" | "5"}
                  onChange={(v) => {
                    setM((x) => ({ ...x, [f.key]: Number(v) }));
                    setDirty(true);
                  }}
                  options={(["1", "2", "3", "4", "5"] as const).map((n) => ({ value: n, label: n }))}
                />
              </Field>
            ))}
            <Field label="Recommendation" required>
              <Select
                value={m.recommendation}
                onChange={(e) => {
                  setM((x) => ({ ...x, recommendation: e.target.value as Recommendation }));
                  setDirty(true);
                }}
              >
                {RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>
                    {RECOMMENDATION_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Comments">
              <Textarea
                rows={2}
                value={m.comments}
                onChange={(e) => {
                  setM((x) => ({ ...x, comments: e.target.value }));
                  setDirty(true);
                }}
              />
            </Field>
            <p className="text-xs text-muted-foreground">1 = poor · 3 = fair · 5 = excellent</p>
          </div>
        )}
      </Sheet>

      <ReasonSheet
        open={!!closing}
        busy={isPending}
        onClose={() => setClosing(null)}
        onConfirm={(reason) => closing && close(closing.i, closing.status, reason)}
        title={closing?.status === "no_show" ? `${closing.i.candidate_name} did not come` : `Cancel round ${closing?.i.round_no ?? ""}`}
        confirmLabel={closing?.status === "no_show" ? "Mark no-show" : "Cancel interview"}
        danger={closing?.status === "cancelled"}
        intro={
          closing?.status === "no_show"
            ? "The round is closed as a no-show. Schedule another or reject the candidate from Candidates."
            : "The round is called off. The candidate can be scheduled again."
        }
      />
    </div>
  );
}
