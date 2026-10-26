import { cn } from "@/lib/utils";

/** "GANESH S" → "GS"; one word → its first two letters. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Four token hues, cycled — telling neighbours apart, not a colour per person. */
const HUES = [
  "bg-primary text-primary-foreground",
  "bg-success text-white",
  "bg-warning text-white",
  "bg-accent text-white",
];

/**
 * Overlapping initials for a team or committee — Resolve settings cards
 * (mobile redesign 2026-10-26). Shows up to `max`, then "+n". The names are
 * the accessible text; the circles are decoration.
 */
export function AvatarStack({ names, max = 5, className }: { names: string[]; max?: number; className?: string }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return (
    <span className={cn("flex items-center", className)} title={names.join(", ")}>
      <span className="sr-only">{names.join(", ")}</span>
      {shown.map((n, i) => (
        <span
          key={`${n}-${i}`}
          aria-hidden
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-surface text-[10px] font-bold",
            HUES[i % HUES.length],
            i > 0 && "-ml-1.5",
          )}
        >
          {initialsOf(n)}
        </span>
      ))}
      {more > 0 && (
        <span aria-hidden className="-ml-1.5 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-surface-muted text-[10px] font-bold text-muted-foreground">
          +{more}
        </span>
      )}
    </span>
  );
}
