import Link from "next/link";
import { Tag, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One clickable tile in a Master Data hub grid — used for both the top-level
 * submodule grid and each submodule's child grid. `count` shows a number,
 * `external` shows the ↗ link glyph, `dashed` marks empty / not-yet-built.
 */
export function HubCard({
  href,
  title,
  subtitle,
  count,
  external = false,
  dashed = false,
}: {
  href: string;
  title: string;
  subtitle: string;
  count?: number | null;
  external?: boolean;
  dashed?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-surface p-4 transition-colors hover:border-primary",
        dashed ? "border-dashed border-border" : "border-border",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          dashed ? "bg-surface-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Tag className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {external ? (
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : count != null ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </Link>
  );
}
