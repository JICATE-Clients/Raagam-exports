import type React from "react";
import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import { Icon } from "./icon";
import { toneGrad } from "./tone";

/**
 * ONE CARD HEADER FOR THE WHOLE DASHBOARD (user 2026-11-02, approved plan v2
 * https://claude.ai/artifact/Cx7akee4ctg36heq8ySfhG: "more professional"). Every card opens
 * the same way — an icon in a tone well, the title, one muted line under it — and its
 * action sits to the right in the caller's own slot. Before this, ChartFrame, PanelCard,
 * LeaderboardCard and Needs you each drew a title their own way.
 */
export function CardTitle({
  title,
  subtitle,
  icon,
  tone = "primary",
  className,
}: {
  title: string;
  /** A line under the title — usually words; the calendar card passes its ‹ week › navigator. */
  subtitle?: React.ReactNode;
  /** A name from `icon.tsx`; without one the header is the title alone. */
  icon?: string;
  tone?: DashboardTone;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {icon && (
        // THE GRADIENT WELL (option A "Glass", user 2026-11-03): the card's colour lives here,
        // a white glyph on its tone's gradient — never a rail down the card's edge (10-29).
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px] text-white shadow-[0_6px_14px_-8px_var(--well-glow),inset_0_1px_0_rgba(255,255,255,0.35)]"
          style={{ background: toneGrad(tone), ["--well-glow" as string]: tone === "muted" ? "transparent" : `var(--${tone})` }}
          aria-hidden
        >
          <Icon name={icon} className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold leading-tight text-heading">{title}</h3>
        {subtitle && <div className="mt-0.5 text-[11.5px] leading-tight text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}
