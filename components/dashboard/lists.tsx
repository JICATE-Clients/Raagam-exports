import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtAgo } from "@/lib/dashboard/format";
import type { ActivityItem, AlertItem } from "@/lib/dashboard/types";
import { Icon } from "./icon";
import { toneBg, toneSoft } from "./tone";

/**
 * Recent activity, as a connected timeline.
 *
 * The mockup shows an actor name per row ("Divya R"). That is deliberately not
 * reproduced: `profiles` is RLS'd to `id = auth.uid() OR system_admin:view`, so
 * embedding a name would return null for every row except the viewer's own —
 * a column that is blank for everyone but admins is worse than one that says
 * something true. The originating module goes there instead.
 */
export function TimelineList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <ol className="px-4 py-4">
      {items.map((t, i) => (
        <li key={t.key} className="grid grid-cols-[26px_1fr] gap-3.5">
          <div className="flex flex-col items-center gap-1">
            <span
              className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", toneBg[t.tone])}
            />
            {/* The rail stops at the last item rather than trailing into space. */}
            <span
              className={cn(
                "w-px flex-1",
                i === items.length - 1 ? "bg-transparent" : "bg-border",
              )}
            />
          </div>
          <div className="min-w-0 pb-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.ref &&
                (t.href ? (
                  <Link
                    href={t.href}
                    className="font-mono text-[11px] text-primary hover:underline"
                  >
                    {t.ref}
                  </Link>
                ) : (
                  <span className="font-mono text-[11px] text-primary">{t.ref}</span>
                ))}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{t.detail}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t.source} · {fmtAgo(t.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Things needing attention. Every entry is a real query result — the mockup's
 * machine-breakdown and shade-variation rows had no capture behind them and are
 * simply absent rather than invented.
 */
export function AlertList({ items }: { items: AlertItem[] }) {
  if (items.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCheck className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium">Nothing needs attention</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No overdue milestones, late shipments or unpaid invoices.
        </p>
      </div>
    );
  }

  return (
    <ul>
      {items.map((a) => {
        const inner = (
          <>
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                toneSoft[a.tone],
              )}
            >
              <Icon name={a.icon} className="h-[15px] w-[15px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{a.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {a.body}
              </span>
            </span>
          </>
        );
        return (
          <li key={a.key} className="border-b border-border last:border-0">
            {a.href ? (
              <Link
                href={a.href}
                className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted"
              >
                {inner}
              </Link>
            ) : (
              <div className="flex gap-3 px-4 py-3.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Shared card chrome for the two panels above. */
export function PanelCard({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}
