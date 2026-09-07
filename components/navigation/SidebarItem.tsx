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
        "flex w-fit items-center gap-2 rounded-[10px] text-sm transition-colors",
        collapsed ? "h-10 w-10 justify-center" : "px-3 py-1.5",
        indent === 1 && !collapsed && "ml-3",
        indent === 2 && !collapsed && "ml-6",
        active
          ? "bg-primary/10 font-medium text-primary hover:bg-primary/20"
          : "text-muted-foreground hover:bg-border hover:text-foreground",
      )}
    >
      {icon}
      {!collapsed && <span className="min-w-0 truncate">{label}</span>}
    </Link>
  );
}
