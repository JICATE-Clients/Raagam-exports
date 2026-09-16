import {
  Check,
  CircleDashed,
  CircleX,
  Clock,
  PencilLine,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { StatusTone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

/**
 * The leading icon a pill wears under NEW LOOK, so a status reads without its
 * colour (greyscale, colour-blind operators, a photocopied printout). Chosen by
 * TONE, because the 800-odd call sites already state one, with the label only
 * refining it where one tone covers two meanings: danger is both "Overdue"
 * (a warning triangle) and "Cancelled" (a cross); info is both "Updated"
 * (a pencil) and "Refund" (a return arrow).
 */
function PillIcon({ tone, label }: { tone: StatusTone; label: string }) {
  // `hidden` in the classic look; globals.css shows it under New look.
  const cls = "ty-badge-icon hidden size-3 shrink-0";
  switch (tone) {
    case "success":
      return <Check className={cls} aria-hidden />;
    case "warning":
      return <Clock className={cls} aria-hidden />;
    case "danger":
      return /cancel|reject|block|inactive|void/i.test(label) ? (
        <CircleX className={cls} aria-hidden />
      ) : (
        <TriangleAlert className={cls} aria-hidden />
      );
    case "info":
      return /refund|return/i.test(label) ? (
        <Undo2 className={cls} aria-hidden />
      ) : (
        <PencilLine className={cls} aria-hidden />
      );
    default:
      return <CircleDashed className={cls} aria-hidden />;
  }
}

/**
 * Declared in `lib/ui/tone.ts` and re-exported here, so the existing importers
 * are untouched — and so a screen descriptor can name a status tone without
 * pulling a `.tsx` into an import graph that plain Node has to load. Reasoning
 * in that file; the class maps below are the half that stays here.
 */
export type { StatusTone };

const tones: Record<StatusTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-muted text-muted-foreground",
};

export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // 600/semibold (client 2026-09-07, Archivo weight spec) — a status
        // pill IDENTIFIES a record's state, which is the system's 600 tier;
        // was font-medium/500, the navigation tier. A genuinely "important"
        // chip (the spec's 700 example) still reaches `className` for that —
        // this default is deliberately one step short of it, since most
        // status pills in this app are routine labels (Active/Inactive,
        // Pending), not alarms, and bolding every one of them everywhere is
        // the "excessive bold" the spec warns against.
        "ty-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      <PillIcon tone={tone} label={typeof children === "string" ? children : ""} />
      {children}
    </span>
  );
}

/** A small filled dot — for compact traffic-light cells. */
export function StatusDot({ tone }: { tone: StatusTone }) {
  const colors: Record<StatusTone, string> = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    neutral: "bg-muted-foreground",
  };
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", colors[tone])}
      aria-hidden
    />
  );
}
