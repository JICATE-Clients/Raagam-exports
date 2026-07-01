"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Grid3x3, X } from "lucide-react";
import { NAV, type NavItem } from "./nav";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function BarTab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="max-w-[68px] truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Mobile bottom nav (PRD: web + mobile equal priority). A 4-tab bar flanks a
 * central floating action button; the FAB opens a bottom sheet listing EVERY
 * permitted module in a grid, so nothing is hidden on small screens.
 */
export function MobileNav() {
  const pathname = usePathname();
  const user = useAppUser();
  const [open, setOpen] = useState(false);

  const allItems = NAV.filter((i) => hasPermission(user, i.module, "view"));
  const primary = allItems.slice(0, 4);

  return (
    <>
      {/* Full-menu bottom sheet */}
      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 pb-24 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                All Modules
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {allItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex flex-col items-center gap-1 rounded-lg p-1.5 text-center text-[10px] font-medium leading-tight"
                  >
                    <span
                      className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                        active
                          ? "bg-primary/15 text-primary"
                          : "bg-surface-muted text-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span
                      className={cn(
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar with central FAB */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-surface md:hidden">
        {primary.slice(0, 2).map((item) => (
          <BarTab
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
          />
        ))}

        {/* Center FAB slot */}
        <div className="relative flex w-16 shrink-0 flex-col items-center justify-end pb-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Open all modules"
            aria-expanded={open}
            className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-surface transition-transform active:scale-95"
          >
            {open ? <X className="h-6 w-6" /> : <Grid3x3 className="h-6 w-6" />}
          </button>
          <span className="text-[10px] font-medium text-muted-foreground">
            Menu
          </span>
        </div>

        {primary.slice(2, 4).map((item) => (
          <BarTab
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
          />
        ))}
      </nav>
    </>
  );
}
