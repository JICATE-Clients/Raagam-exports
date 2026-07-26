import type { DashboardTone } from "@/lib/dashboard/types";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * Tone → utility class lookups, in the hand-rolled `Record<Variant, string>`
 * style the rest of the app uses (see components/ui/button.tsx). Not CVA —
 * class-variance-authority isn't a dependency here.
 *
 * Every class is a complete literal string because Tailwind scans source text:
 * a computed `` `text-${tone}` `` would compile to nothing and the colour would
 * silently vanish.
 */

export const toneText: Record<DashboardTone, string> = {
  primary: "text-primary",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  pos: "text-pos",
  muted: "text-muted-foreground",
};

/**
 * Icon wells and chips. Uses the pre-mixed `*-soft` tokens rather than an
 * opacity modifier: `bg-primary/10` emits a solid-colour fallback outside
 * `@supports (color-mix)`, which would render these wells fully saturated and
 * hide the icon sitting inside them.
 */
export const toneSoft: Record<DashboardTone, string> = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  pos: "bg-success-soft text-pos",
  muted: "bg-surface-muted text-muted-foreground",
};

/** Solid fills for bars, dots and gradient stops. */
export const toneBg: Record<DashboardTone, string> = {
  primary: "bg-primary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  pos: "bg-pos",
  muted: "bg-muted-foreground",
};

/**
 * The raw CSS variable, for the places a utility can't reach: conic-gradient
 * stops and SVG stroke/fill attributes, both of which take a value rather than
 * a class.
 */
export function toneVar(tone: DashboardTone): string {
  return tone === "muted" ? "var(--muted-foreground)" : `var(--${tone})`;
}

/** StatusPill has a narrower vocabulary; fold the extra tones into it. */
export function toStatusTone(tone: DashboardTone): StatusTone {
  switch (tone) {
    case "primary":
    case "info":
    case "accent":
      return "info";
    case "pos":
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "danger";
    default:
      return "neutral";
  }
}
