"use client";

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ToggleGroup } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import { CardTitle } from "./card-title";
import { GLASS } from "./glass";

export interface CardTab {
  key: string;
  /** The word on the tab, and the card's title while it is open. */
  label: string;
  /** The card's heading while this tab is open — the question it answers. Defaults to `label`. */
  title?: string;
  subtitle?: string;
  /** Right of the title while this tab is open (a legend, a YoY pill). */
  aside?: ReactNode;
  /** Rendered on the server and handed in — this component only chooses which one shows. */
  body: ReactNode;
  /** This tab's footer — `CardFooter` (fix 6, 2026-11-03). */
  footer?: ReactNode;
}

/**
 * MANY CHARTS, ONE CARD (approved plan v2, 2026-11-02). The trend charts used to be seven
 * cards and the Top lists three; each set is now one card whose tabs pick the chart. The
 * bodies are server-rendered elements passed in as props, so the charts stay server
 * components and this island holds nothing but the open tab. A tab whose chart has nothing
 * to draw is left out by the caller, as the cards were.
 */
export function TabbedCard({
  tabs,
  icon,
  tone,
  label,
  className,
}: {
  tabs: CardTab[];
  icon?: string;
  tone?: DashboardTone;
  /** The tab row's name for a screen reader ("Trend", "Top lists"). */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(tabs[0]?.key ?? "");
  const cur = tabs.find((t) => t.key === open) ?? tabs[0];
  if (!cur) return null;
  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--glass-edge)] px-4 py-2">
        <CardTitle title={cur.title ?? cur.label} subtitle={cur.subtitle} icon={icon} tone={tone} className="mr-auto" />
        {cur.aside}
        {tabs.length > 1 && (
          <ToggleGroup
            label={label}
            role="tablist"
            value={cur.key}
            onChange={setOpen}
            options={tabs.map((t) => ({ value: t.key, label: t.label }))}
          />
        )}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden px-4 py-2.5">
        {cur.body}
      </div>
      {cur.footer && <div className="px-4 pb-2.5">{cur.footer}</div>}
    </Card>
  );
}
