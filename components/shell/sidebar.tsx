"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV } from "./nav";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Href of the deepest child whose route matches the current path (longest prefix wins). */
function activeChild(pathname: string, children: { href: string }[]) {
  return children
    .filter((c) => isActive(pathname, c.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** A store record surfaced as a sidebar link under the Stores group. */
export interface StoreNavLink {
  id: string;
  name: string;
}

export function Sidebar({ stores = [] }: { stores?: StoreNavLink[] }) {
  const pathname = usePathname();
  const user = useAppUser();
  const items = NAV.filter((i) => hasPermission(user, i.module, "view"));

  // Live store records are listed directly under the Stores group, ahead of
  // its fixed operation sub-modules (Opening Stock, Requisitions, …).
  const storeLinks = stores.map((s) => ({
    href: `/stores/${s.id}`,
    label: s.name,
  }));

  // Groups collapsed by default; only the group containing the current route
  // starts expanded so the active sub-module stays visible.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        NAV.filter((i) => i.children?.length && isActive(pathname, i.href)).map(
          (i) => i.href,
        ),
      ),
  );

  function toggle(href: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          R
        </div>
        <span className="text-sm font-semibold">Raagam ERP</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const children =
            item.href === "/stores"
              ? [...storeLinks, ...(item.children ?? [])]
              : (item.children ?? []);
          const hasChildren = children.length > 0;
          const moduleActive = isActive(pathname, item.href);
          const activeChildHref = hasChildren
            ? activeChild(pathname, children)
            : undefined;
          // Strong highlight on the parent only when it's a leaf, or the module
          // is active but no specific sub-module matched.
          const parentStrong = hasChildren
            ? moduleActive && !activeChildHref
            : moduleActive;
          const isExpanded = expanded.has(item.href);

          return (
            <div key={item.href}>
              <div className="flex items-center gap-0.5">
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    parentStrong
                      ? "bg-primary/10 text-primary"
                      : moduleActive
                        ? "text-primary hover:bg-surface-muted"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>

                {hasChildren && (
                  <button
                    type="button"
                    onClick={() => toggle(item.href)}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.label}`}
                    aria-expanded={isExpanded}
                    className="flex h-8 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </button>
                )}
              </div>

              {hasChildren && isExpanded && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                  {children.map((child) => {
                    const childActive = child.href === activeChildHref;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "block rounded-md px-3 py-1.5 text-sm transition-colors",
                          childActive
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                        )}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
