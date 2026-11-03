import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import { Icon } from "./icon";
import { toneSoft } from "./tone";

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
  subtitle?: string;
  /** A name from `icon.tsx`; without one the header is the title alone. */
  icon?: string;
  tone?: DashboardTone;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {icon && (
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-[9px]", toneSoft[tone])} aria-hidden>
          <Icon name={icon} className="size-4" />
        </span>
      )}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-tight text-heading">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11.5px] leading-tight text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
