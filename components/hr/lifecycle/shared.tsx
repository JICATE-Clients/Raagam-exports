"use client";

import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { PersonOption } from "@/lib/hr/timeoff-types";

/**
 * HR ▸ Team Lifecycle (0766) — small pieces every lifecycle screen uses.
 * The person list is Time Off's (`listTimeoffPeople`): staff and workers in
 * one list, or just "me" for a self-service login.
 */

export function PersonCombobox({
  people,
  value,
  onChange,
  disabled,
}: {
  people: PersonOption[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <Combobox
      options={people.map((p) => ({
        value: p.key,
        label: p.name,
        sublabel: p.kind === "worker" ? "Worker" : "Staff",
        search: p.code ?? undefined,
      }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/** "3 / 7" with a thin bar — a checklist's progress. */
export function Progress({ done, total, overdue = 0 }: { done: number; total: number; overdue?: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {done} / {total}
        {overdue > 0 && <span className="ml-1 text-danger">· {overdue} overdue</span>}
      </span>
    </span>
  );
}

/**
 * One ticked / unticked step. A native checkbox — it is the value being
 * edited, and the keyboard contract already treats a checkbox as a field.
 */
export function StepRow({
  title,
  meta,
  done,
  disabled,
  late,
  onToggle,
}: {
  title: string;
  meta?: string;
  done: boolean;
  disabled?: boolean;
  late?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-control border border-border px-3 py-2">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--primary)]"
        checked={done}
        disabled={disabled}
        aria-label={title}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", done && "text-muted-foreground line-through")}>{title}</span>
        {meta && <span className={cn("block text-xs", late ? "text-danger" : "text-muted-foreground")}>{meta}</span>}
      </span>
    </li>
  );
}
