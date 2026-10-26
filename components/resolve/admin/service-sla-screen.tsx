"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { priorityTone } from "@/components/resolve/desk/desk-columns";
import { Stepper, minutesDown, minutesUp } from "@/components/resolve/admin/stepper";
import { spanWords } from "@/components/resolve/admin/span-words";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveServiceSla } from "@/lib/resolve/desk-actions";
import { PRIORITY_LABEL, type ServiceSla } from "@/lib/resolve/desk-types";
import type { Priority } from "@/lib/resolve/types";

/** Minutes held as typed text, so a half-typed box is not coerced to 0 under
 *  the operator's cursor; parsed once, per render, for the checks and on Save. */
type SlaRow = { key: Priority; response: string; resolution: string };

const toRows = (sla: ServiceSla[]): SlaRow[] =>
  sla.map((s) => ({ key: s.priority, response: String(s.response_minutes), resolution: String(s.resolution_minutes) }));

const MAX_MINUTES = 43_200; // 30 days — the schema's ceiling

/** One tap for the values people actually set. Stored as minutes. */
const PRESETS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 h" },
  { value: "240", label: "4 h" },
  { value: "1440", label: "1 day" },
];

/** The one problem a box has, or null — the same rules `serviceSlaSchema` applies. */
function minutesProblem(raw: string): string | null {
  const v = Number(raw);
  if (raw.trim() === "") return "Required";
  if (!Number.isInteger(v)) return "Whole minutes";
  if (v < 1) return "At least 1";
  if (v > MAX_MINUTES) return "At most 30 days";
  return null;
}
function rowProblems(r: SlaRow) {
  const response = minutesProblem(r.response);
  const resolution =
    minutesProblem(r.resolution) ??
    (!response && Number(r.resolution) < Number(r.response) ? "Not shorter than first reply" : null);
  return { response, resolution };
}

/**
 * Resolve Hub ▸ Administration ▸ IT Response Times (was "Service SLA") — the
 * current unit's two clocks per priority, in MINUTES (plan §1.4, spec §6.1):
 * first reply, and fixed. Wall-clock 24×7; On Hold pauses the fix clock only.
 *
 * ONE CARD PER PRIORITY (mobile redesign, 2026-10-26): two steppers that read
 * in words ("30 min", "4 h", "1 day"), presets one tap away. The box under each
 * stepper is still the minutes, typed or stepped — Save sends minutes exactly
 * as before.
 *
 * Four fixed rows, saved together (`saveServiceSla` upserts all four). A new
 * matrix applies to requests raised — or re-cut by an override or a priority
 * change — after the save; a request already open keeps the dues it was given.
 */
export function ServiceSlaScreen({ sla }: { sla: ServiceSla[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<SlaRow[]>(() => toRows(sla));
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const setCell = (key: Priority, patch: Partial<SlaRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const problems = rows.map(rowProblems);
  const canSave = dirty && !isPending && problems.every((p) => !p.response && !p.resolution);

  function clock(field: "response" | "resolution", label: string, r: SlaRow, i: number) {
    const problem = problems[i][field];
    const id = `rh-sla-${r.key}-${field}`;
    return (
      <Field label={label} required htmlFor={id} error={problem && problem !== "Required" ? problem : undefined}>
        <div className="space-y-2">
          <Stepper
            id={id}
            value={r[field]}
            onChange={(v) => setCell(r.key, { [field]: v })}
            min={1}
            max={MAX_MINUTES}
            down={minutesDown}
            up={minutesUp}
            ariaLabel={`${PRIORITY_LABEL[r.key]} ${label.toLowerCase()}, minutes`}
            invalid={!!problem}
            words={minutesProblem(r[field]) ? "minutes" : `minutes · ${spanWords(Number(r[field]))}`}
          />
          <ToggleGroup
            label={`${PRIORITY_LABEL[r.key]} ${label.toLowerCase()} presets`}
            value={PRESETS.some((p) => p.value === r[field].trim()) ? r[field].trim() : null}
            onChange={(v) => setCell(r.key, { [field]: v })}
            options={PRESETS}
          />
        </div>
      </Field>
    );
  }

  function save() {
    startTransition(async () => {
      const res = await saveServiceSla(
        rows.map((r) => ({
          priority: r.key,
          response_minutes: Number(r.response),
          resolution_minutes: Number(r.resolution),
        })),
      );
      if (res.ok) {
        success("IT response times saved.");
        setDirty(false);
        router.refresh();
      } else error(res.error);
    });
  }

  // A page-level editor: the marker puts it on the Tab contract.
  return (
    <div className="max-w-[48rem] space-y-3" data-focus-scope>
      {/* default-row: exempt -- four fixed priorities; the list cannot grow or shrink */}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r, i) => (
          <section key={r.key} className="space-y-3 rounded-xl border border-border bg-surface p-3">
            <h2>
              <StatusPill tone={priorityTone(r.key)}>{PRIORITY_LABEL[r.key]}</StatusPill>
            </h2>
            {clock("response", "First reply within", r, i)}
            {clock("resolution", "Fixed within", r, i)}
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Urgent is set only by an override, with its reason. On Hold pauses the fix clock, never the first-reply one.
      </p>
      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
        <span className="mr-auto text-sm text-muted-foreground">{dirty ? "Unsaved changes" : "No changes"}</span>
        <Button
          variant="outline"
          disabled={!dirty || isPending}
          onClick={() => {
            setRows(toRows(sla));
            setDirty(false);
          }}
        >
          Cancel
        </Button>
        <Button disabled={!canSave} onClick={save}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
