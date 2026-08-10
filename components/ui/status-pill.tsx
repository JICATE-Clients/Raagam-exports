import type { StatusTone } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
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
