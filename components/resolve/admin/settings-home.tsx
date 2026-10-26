import Link from "next/link";
import { ChevronRight, Tag, type LucideIcon } from "lucide-react";
import type { HubIconTone } from "@/components/masters/hub-card";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * Resolve ▸ Settings home — grouped cards, one row per settings screen, each
 * with a live one-line summary ("8 trades · 1 switched off"). Server-safe on
 * purpose: the rows carry lucide icon COMPONENTS, which cannot cross into a
 * client component, and nothing here needs state.
 */
export type SettingsCard = {
  href: string;
  label: string;
  summary: string;
  icon?: LucideIcon;
  tone?: HubIconTone;
};
export type SettingsSection = { title: string; cards: SettingsCard[] };

const TONES: Record<HubIconTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function SettingsHome({ sections }: { sections: SettingsSection[] }) {
  return (
    // One column on a phone, two on a wide pane — each section stays one card.
    <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
      {sections.map((s) => (
        <section key={s.title} className="min-w-0 space-y-2">
          <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.title}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {s.cards.map((c) => {
              const Icon = c.icon ?? Tag;
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn("flex size-9 items-center justify-center rounded-lg", TONES[c.tone ?? "primary"])}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{c.label}</span>
                      <Truncated text={c.summary} className="text-xs text-muted-foreground" />
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
