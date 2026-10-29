import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtAgo } from "@/lib/dashboard/format";
import type { ActivityItem } from "@/lib/dashboard/types";
import { toneBg, toneSoft } from "./tone";
import { GLASS } from "./glass";

/**
 * Recent activity, one row per KIND of event (user 2026-10-29: five lines that
 * each said "Sales order booked" read as one fact repeated). A kind that
 * happened once keeps its detail; a kind that happened several times shows the
 * count and its first document numbers, each a link. The time is the newest.
 *
 * No actor name, deliberately: `profiles` is RLS'd to `id = auth.uid() OR
 * system_admin:view`, so a name would be blank for everyone but admins. The
 * originating module is shown instead.
 */
export function ActivityGroups({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>;
  }
  const groups: ActivityItem[][] = [];
  const byTitle = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const g = byTitle.get(it.title);
    if (g) g.push(it);
    else {
      const fresh = [it];
      byTitle.set(it.title, fresh);
      groups.push(fresh);
    }
  }

  return (
    <ul className="px-2 py-1.5">
      {groups.map((g) => {
        const first = g[0];
        const newest = g.reduce((m, x) => (x.at > m ? x.at : m), first.at);
        return (
          <li key={first.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 border-b border-[var(--glass-edge)] px-2 py-2 last:border-0">
            <span className={cn("mt-0.5 grid size-7 place-items-center rounded-lg", toneSoft[first.tone])}>
              <span className={cn("size-2 rounded-full", toneBg[first.tone])} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                {first.title}
                {g.length > 1 && (
                  <span className="rounded-full border border-border bg-surface-muted px-1.5 text-[11px] font-bold tabular-nums">{g.length}</span>
                )}
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
                {g.slice(0, 3).map((x) =>
                  x.ref ? (
                    x.href ? (
                      <Link key={x.key} href={x.href} className="font-mono text-[11px] text-primary hover:underline">
                        {x.ref}
                      </Link>
                    ) : (
                      <span key={x.key} className="font-mono text-[11px]">{x.ref}</span>
                    )
                  ) : null,
                )}
                {g.length > 3 && <span>+{g.length - 3} more</span>}
                {g.length === 1 && first.detail && <span>{first.detail}</span>}
              </span>
            </span>
            <span className="whitespace-nowrap pt-0.5 text-right text-[11px] text-muted-foreground">
              {fmtAgo(newest)}
              <span className="block">{first.source}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Shared card chrome for the dashboard's titled panels. */
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
    <Card className={cn(GLASS, "flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--glass-edge)] px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}
