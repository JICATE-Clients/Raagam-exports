"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rescheduleInterview, scheduleInterview } from "@/lib/hr/recruitment-actions";
import { INTERVIEW_MODES, MODE_LABELS, ROUND_SUGGESTIONS, type Interview, type InterviewMode } from "@/lib/hr/recruitment-types";
import type { PersonOption } from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Recruitment (0767) — pieces the Candidates and Interviews screens share:
 * the schedule / reschedule sheet and the 1–5 mark display.
 */

/** A `datetime-local` value for "tomorrow 10:00", in the browser's own zone. */
function defaultSlot(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Draft = { round_name: string; at: string; duration: string; mode: InterviewMode; venue: string; panel: string[]; reason: string };

/**
 * Schedule a round for a candidate, or move an interview already scheduled
 * (`reschedule`). Panel members are staff — the people who will enter marks.
 */
export function ScheduleSheet({
  open,
  onClose,
  candidate,
  nextRound,
  reschedule,
  staff,
}: {
  open: boolean;
  onClose: () => void;
  candidate: { id: string; name: string } | null;
  /** The round number this will be (1 for a first interview). */
  nextRound: number;
  reschedule: Interview | null;
  staff: PersonOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [d, setD] = useState<Draft>(() => seed());
  useUnsavedGuard((open && dirty) || isPending);

  function seed(): Draft {
    if (reschedule)
      return {
        round_name: reschedule.round_name,
        at: toLocalInput(reschedule.scheduled_at),
        duration: String(reschedule.duration_min),
        mode: reschedule.mode,
        venue: reschedule.venue ?? "",
        panel: reschedule.panel,
        reason: "",
      };
    return {
      round_name: ROUND_SUGGESTIONS[Math.min(nextRound - 1, ROUND_SUGGESTIONS.length - 1)] ?? "HR ROUND",
      at: defaultSlot(),
      duration: "30",
      mode: "in_person",
      venue: "",
      panel: [],
      reason: "",
    };
  }
  // A new candidate or interview reseeds the form (the sheet is not remounted).
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = open ? `${candidate?.id ?? ""}:${reschedule?.id ?? ""}` : null;
  if (key !== seededFor) {
    setSeededFor(key);
    if (key) {
      setD(seed());
      setDirty(false);
    }
  }
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  const problem = !d.round_name.trim()
    ? "Name the round"
    : !d.at
      ? "Pick the date and time"
      : d.panel.length === 0
        ? "Pick at least one person for the panel"
        : reschedule && !d.reason.trim()
          ? "Say why it is moving"
          : null;

  function save() {
    if (!candidate) return;
    startTransition(async () => {
      const r = reschedule
        ? await rescheduleInterview(reschedule.id, { scheduled_at: d.at, venue: d.venue, panel: d.panel, reason: d.reason })
        : await scheduleInterview({
            candidate_id: candidate.id,
            round_name: d.round_name,
            scheduled_at: d.at,
            duration_min: Number(d.duration) || 30,
            mode: d.mode,
            venue: d.venue,
            panel: d.panel,
          });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      success(reschedule ? "Interview moved" : "Interview scheduled");
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        reschedule
          ? `Reschedule — ${candidate?.name ?? ""}`
          : `Schedule round ${nextRound} — ${candidate?.name ?? ""}`
      }
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{problem ?? (reschedule ? `Was ${fmtDateTime(reschedule.scheduled_at)}` : "")}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={isPending || !!problem} onClick={save}>
              {isPending ? "Saving…" : reschedule ? "Move" : "Schedule"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Round" required hint={reschedule ? undefined : ROUND_SUGGESTIONS.join(" · ")}>
          <Input value={d.round_name} disabled={!!reschedule} onChange={(e) => put({ round_name: e.target.value })} />
        </Field>
        <FieldRow>
          <Field label="Date and time" w="term" required>
            <Input type="datetime-local" value={d.at} onChange={(e) => put({ at: e.target.value })} />
          </Field>
          {!reschedule && (
            <Field label="Minutes" w="num">
              <Input type="number" min="5" max="480" value={d.duration} onChange={(e) => put({ duration: e.target.value })} />
            </Field>
          )}
        </FieldRow>
        {!reschedule && (
          <Field label="Mode" w="code">
            <Select value={d.mode} onChange={(e) => put({ mode: e.target.value as InterviewMode })}>
              {INTERVIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={d.mode === "in_person" ? "Venue" : "Number / link"}>
          <Input
            value={d.venue}
            // caps-input: exempt -- a meeting link is case-sensitive
            uppercase={d.mode !== "video"}
            onChange={(e) => put({ venue: e.target.value })}
          />
        </Field>
        <MultiSelect
          label="Panel"
          required
          options={staff.map((p) => ({ id: p.id, label: p.name }))}
          values={d.panel}
          onChange={(v) => put({ panel: v })}
          emptyLabel="No active staff in this unit"
        />
        {reschedule && (
          <Field label="Why is it moving" required>
            <Input value={d.reason} onChange={(e) => put({ reason: e.target.value })} />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

/** "3.8 / 5" with the colour of the band it falls in. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "text-sm font-medium tabular-nums",
        score >= 4 ? "text-success" : score >= 3 ? "text-foreground" : "text-danger",
      )}
    >
      {score.toFixed(1)} / 5
    </span>
  );
}
