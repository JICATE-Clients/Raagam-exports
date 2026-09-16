import type { ReactNode } from "react";

/**
 * A small caption above a run of `SidebarItem`s. Never a button, never a
 * background — just a label with breathing room, per the contextual
 * sidebar's nested-navigation spec (module → section → items). The space
 * BETWEEN sections is the parent's `space-y-*`; the old `first:pt-1` matched
 * this label inside its own wrapper on every section, so it never varied.
 */
export function SidebarSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      {label && (
        <div className="ty-sidebar-group px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
