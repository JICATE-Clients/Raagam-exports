"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { isPlainLeftClick } from "./navigation-config";

export interface SidebarItemProps {
  href: string;
  label: string;
  /** Rendered before the label — a Lucide icon component, sized by the caller. */
  icon?: ReactNode;
  /** Active state — rounded highlight background. */
  active?: boolean;
  /** Icon-only, no visible label — the collapsed rail. `title` carries the
   *  name for a11y and for the native tooltip while collapsed. */
  collapsed?: boolean;
  /** Left indent step for nested rows (context sidebar's grandchildren). */
  indent?: 0 | 1 | 2;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Rendered after the label, pushed to the row's end (the flyout's
   *  current-module dot). Hidden while collapsed, like the label. */
  trailing?: ReactNode;
  /** Extra classes for one use of the row (the hover flyout's roomier rows). */
  className?: string;
}

/**
 * One clickable nav row, shared by the icon rail, the hover flyout and the
 * contextual sidebar. Only the classes differ between those three uses — the
 * active-state and click-interception rules stay in one place.
 */
export function SidebarItem({
  href,
  label,
  icon,
  active,
  collapsed,
  indent = 0,
  onClick,
  trailing,
  className,
}: SidebarItemProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainLeftClick(e)) return;
    onClick?.(e);
  }

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      onClick={handleClick}
      className={cn(
        // `text-[13px]`, not `text-sm` (14px) — matches the workspace tab
        // bar's own label size (workspace-tabs-bar.tsx) exactly, client
        // 2026-09-08: the sidebar read a size larger side-by-side with it.
        "ty-sidebar flex w-fit items-center gap-2 rounded-[10px] text-[13px] transition-colors",
        collapsed ? "h-10 w-10 justify-center" : "px-3 py-1.5",
        indent === 1 && !collapsed && "ml-3",
        indent === 2 && !collapsed && "ml-6",
        // Tried `bg-brand-green/10` + `text-foreground` (client's `#85c325`
        // and "make it black" asks, 2026-09-08) — both reverted same day
        // ("not good fit"). Then SOLID `bg-primary` (client 2026-09-08,
        // matching the tab bar's solid treatment) — scoped to just the
        // active ROW, not the whole sidebar column: a full-column tint was
        // already tried and rejected once (`raagam-brand-colours`,
        // 2026-08-28, "remove the bg color, white is enpugh fopr me"), so
        // this stays a per-row control colour, never a surface. White text
        // (`text-primary-foreground`) is required at solid strength — the
        // old `text-primary` blue-on-blue-tint pairing doesn't carry over.
        // One component backs the icon rail, the context sidebar and its
        // grandchild rows, so this is the ONE place to change for all three.
        //
        // SIDEBAR REFRESH (client 2026-09-17, option A of the mock-ups): the
        // solid pill stays and gains a soft lift (`shadow-elev`); hover moves
        // from grey to `--cell-active`, the pre-mixed blue tint that stays
        // readable under body text in BOTH themes (`bg-primary/10` does not
        // compile here, and `--primary-soft` is too dark under text in dark
        // mode — see globals.css). A hover is a row state, not a surface, so
        // the "no tinted column" decision above is untouched.
        active
          ? "bg-primary font-semibold text-primary-foreground shadow-elev hover:bg-primary-hover"
          : "text-muted-foreground hover:bg-[var(--cell-active)] hover:text-foreground",
        className,
      )}
    >
      {icon}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && trailing}
    </Link>
  );
}
