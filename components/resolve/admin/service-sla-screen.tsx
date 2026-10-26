"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { priorityTone, minutesWords } from "@/components/resolve/desk/desk-columns";
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
    (!response && Number(r.resolution) < Number(r.response) ? "Not shorter than response" : null);
  return { response, resolution };
}

/**
 * Resolve Hub ▸ Administration ▸ Service SLA — the current unit's two clocks
 * per priority, in MINUTES (plan §1.4, spec §6.1): first response, and
 * resolution. Wall-clock 24×7; On Hold pauses resolution only.
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

  function minutesCell(field: "response" | "resolution", label: string, r: SlaRow, i: number) {
    const problem = problems[i][field];
    return (
      <div>
        <Input
          type="number"
          min="1"
          aria-label={`${PRIORITY_LABEL[r.key]} ${label}`}
          aria-invalid={!!problem || undefined}
          value={r[field]}
          onChange={(e) => setCell(r.key, { [field]: e.target.value })}
        />
        <FieldError>{problem}</FieldError>
      </div>
    );
  }
  const readsAs = (raw: string) => (minutesProblem(raw) ? "—" : minutesWords(Number(raw)));

  // 144 + 112 + 112 + 200 + 72 chrome = 640px.
  const serviceSlaColumns: ChildGridColumn<SlaRow>[] = [
    {
      header: "Priority",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => <StatusPill tone={priorityTone(r.key)}>{PRIORITY_LABEL[r.key]}</StatusPill>,
    },
    { header: "Response (min)", width: FIELD_WIDTH_CSS.range, required: true, cell: (r, i) => minutesCell("response", "response minutes", r, i) },
    { header: "Resolution (min)", width: FIELD_WIDTH_CSS.range, required: true, cell: (r, i) => minutesCell("resolution", "resolution minutes", r, i) },
    {
      header: "Reads As",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          {readsAs(r.response)} · {readsAs(r.resolution)}
        </span>
      ),
    },
  ];

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
        success("Service SLA saved.");
        setDirty(false);
        router.refresh();
      } else error(res.error);
    });
  }

  // A page-level editor: the marker puts it on the Tab contract.
  return (
    <div className="max-w-[40rem] space-y-3" data-focus-scope>
      {/* default-row: exempt -- four fixed priorities; the grid cannot grow or shrink */}
      <ChildGrid<SlaRow>
        rows={rows}
        columns={serviceSlaColumns}
        tableFrom="5xl"
        hideAdd
        hideRemove
        onAdd={() => false}
        onRemove={() => {}}
      />
      <p className="text-xs text-muted-foreground">
        Urgent is set only by an override, with its reason. On Hold pauses the resolution clock, never the response one.
      </p>
      <div className="flex justify-end gap-2">
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
          {isPending ? "Saving…" : "Save SLA"}
        </Button>
      </div>
    </div>
  );
}
