import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A small caption above a run of `SidebarItem`s. Never a button, never a
 * background — just a label with breathing room, per the contextual
 * sidebar's nested-navigation spec (module → section → items). The space
 * BETWEEN sections is the parent's `space-y-*`; the old `first:pt-1` matched
 * this label inside its own wrapper on every section, so it never varied.
 *
 * SIDEBAR REFRESH (client 2026-09-17, option A): the caption trails a hairline
 * to the column's edge, and `guide` hangs the rows off a thin vertical line —
 * structure drawn with LINES, because icons in this column (09-16) and tinted
 * backgrounds (08-28) were both rejected.
 */
export function SidebarSection({
  label,
  guide,
  children,
}: {
  label?: string;
  /** Indent the rows behind a 1px tree line. Only meaningful under a caption. */
  guide?: boolean;
  children: ReactNode;
}) {
  const rows = guide && label;
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center gap-2 px-1 pt-1">
          <span className="ty-sidebar-group shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className={cn("space-y-px", rows && "ml-2.5 border-l border-border pl-1.5")}>
        {children}
      </div>
    </div>
  );
}
