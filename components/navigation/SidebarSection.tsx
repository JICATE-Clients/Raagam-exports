import type { ReactNode } from "react";

/**
 * A small caption above a run of `SidebarItem`s. Never a button, never a
 * background — just a label with breathing room, per the contextual
 * sidebar's nested-navigation spec (module → section → items).
 */
export function SidebarSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      {label && (
        <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 first:pt-1">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
