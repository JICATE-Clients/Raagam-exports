"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  Search,
  X,
  ArrowUp,
  Upload,
  Download,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { NAV, SECTION_ACTIONS, sectionActions, type SubNavItem } from "./nav";
import { type StoreNavLink } from "./sidebar";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  const base = href.split("?")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

/** Icon for an action label (create / import / export / recalc). */
function actionIcon(label: string): LucideIcon {
  if (/^(import|bulk)/i.test(label)) return Upload;
  if (/^(export|generate)/i.test(label)) return Download;
  if (/^recalc/i.test(label)) return RefreshCw;
  return Plus;
}

/** Route the primary/quick create actions point at (page reads `?new=1`). */
function createHref(ownerHref: string, action: string) {
  return `${ownerHref}?new=1&a=${encodeURIComponent(action)}`;
}

/**
 * Mobile "Peek Sheet" navigation (mobile only; the desktop sidebar handles ≥md).
 * A slim always-on bar shows the current module › section and a context-aware
 * ＋ create button. Tapping the bar raises a searchable launcher containing the
 * full module grid, the sections of the viewed module, and quick actions.
 */
export function MobileNav({ stores = [] }: { stores?: StoreNavLink[] }) {
  const pathname = usePathname();
  const user = useAppUser();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewHref, setViewHref] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modOpen, setModOpen] = useState(false);

  const modules = useMemo(
    () => NAV.filter((i) => hasPermission(user, i.module, "view")),
    [user],
  );

  const storeLinks = useMemo<SubNavItem[]>(
    () => stores.map((s) => ({ href: `/stores/${s.id}`, label: s.name })),
    [stores],
  );

  // Live store records are surfaced as sections under the Stores module.
  const childrenFor = (moduleHref: string, children?: SubNavItem[]) =>
    moduleHref === "/stores"
      ? [...storeLinks, ...(children ?? [])]
      : (children ?? []);

  // Current module + section derived from the URL.
  const activeModule =
    modules.find((i) => isActive(pathname, i.href)) ?? modules[0];
  const activeSections = activeModule
    ? childrenFor(activeModule.href, activeModule.children)
    : [];
  const activeSection =
    activeSections
      .filter((c) => isActive(pathname, c.href))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null;

  const actions = activeModule
    ? sectionActions(activeSection?.href, activeModule.href)
    : [];
  const actionOwner =
    activeSection && SECTION_ACTIONS[activeSection.href]
      ? activeSection.href
      : activeModule && SECTION_ACTIONS[activeModule.href]
        ? activeModule.href
        : null;

  if (!activeModule) return null;

  // Module whose sections are shown inside the launcher (defaults to current).
  const viewModule =
    modules.find((m) => m.href === viewHref) ?? activeModule;
  const viewSections = childrenFor(viewModule.href, viewModule.children);

  function launch() {
    setViewHref(activeModule.href);
    setQuery("");
    setMenuOpen(false);
    setModOpen(false);
    setOpen(true);
  }
  function toggleModules() {
    setOpen(false);
    setMenuOpen(false);
    setModOpen((o) => !o);
  }
  function close() {
    setOpen(false);
    setMenuOpen(false);
    setModOpen(false);
  }

  // ── Search results across modules · sections · actions ─────────────────
  const q = query.trim().toLowerCase();
  const results = q
    ? modules.flatMap((m) => {
        const rows: {
          key: string;
          icon: LucideIcon;
          title: string;
          sub: string;
          href: string;
          isAction?: boolean;
        }[] = [];
        if (m.label.toLowerCase().includes(q))
          rows.push({ key: "m:" + m.href, icon: m.icon, title: m.label, sub: "Module", href: m.href });
        for (const c of childrenFor(m.href, m.children)) {
          if (c.label.toLowerCase().includes(q))
            rows.push({ key: "s:" + c.href, icon: m.icon, title: c.label, sub: m.label + " · section", href: c.href });
          for (const a of SECTION_ACTIONS[c.href] ?? []) {
            if (a.toLowerCase().includes(q))
              rows.push({ key: "a:" + c.href + a, icon: actionIcon(a), title: a, sub: m.label + " · " + c.label, href: createHref(c.href, a), isAction: true });
          }
        }
        for (const a of SECTION_ACTIONS[m.href] ?? []) {
          if (a.toLowerCase().includes(q))
            rows.push({ key: "a:" + m.href + a, icon: actionIcon(a), title: a, sub: m.label, href: createHref(m.href, a), isAction: true });
        }
        return rows;
      })
    : [];

  return (
    <>
      {/* Scrim */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={close}
      />

      {/* Peek bar */}
      <div className="fixed bottom-4 left-1/2 z-40 h-14 max-w-[calc(100%-2rem)] -translate-x-1/2 md:hidden">
        <div className="flex h-full items-center gap-1 rounded-full border border-border bg-surface/90 pl-1.5 pr-1.5 shadow-lg backdrop-blur-xl">
          {/* Module zone → quick module switcher */}
          <button
            type="button"
            onClick={toggleModules}
            aria-expanded={modOpen}
            className="flex h-full min-w-0 items-center gap-1.5 rounded-full pl-1 pr-1.5 active:bg-surface-muted"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <activeModule.icon className="h-5 w-5" />
            </span>
            <span className="max-w-[92px] truncate text-[13px] font-semibold text-foreground">
              {activeModule.label}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                modOpen && "rotate-180",
              )}
            />
          </button>

          <span className="h-6 w-px shrink-0 bg-border" />

          {/* Section zone → full launcher */}
          <button
            type="button"
            onClick={launch}
            className="flex h-full min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-2 active:bg-surface-muted"
          >
            <span className="max-w-[120px] truncate text-[13px] font-semibold text-foreground">
              {activeSection?.label ?? "Overview"}
            </span>
            <ArrowUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Module switcher popover (from the pill's left zone) */}
      {modOpen && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setModOpen(false)} />
          <div className="fixed bottom-[80px] left-1/2 z-50 max-h-[60vh] w-[calc(100%-2rem)] max-w-[340px] -translate-x-1/2 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl md:hidden">
            <div className="px-1 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Switch module
            </div>
            <div className="grid grid-cols-3 gap-2">
              {modules.map((m) => {
                const on = m.href === activeModule.href;
                const Icon = m.icon;
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    onClick={close}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-xl border p-2.5 active:scale-95",
                      on ? "border-primary bg-primary/5" : "border-border bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg",
                        on ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
                      )}
                    >
                      <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <span className="text-[11.5px] font-semibold leading-tight text-foreground">{m.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Floating create button — stacked directly below the bug-reporter button
          (which sits at bottom:5.5rem on phones). Opens the labeled action menu so
          the user always sees exactly what each ＋ action does. */}
      {actions.length > 0 && actionOwner && (
        <button
          type="button"
          onClick={() => {
            setModOpen(false);
            setMenuOpen((o) => !o);
          }}
          aria-expanded={menuOpen}
          aria-label="Create"
          className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 md:hidden"
        >
          <Plus className={cn("h-7 w-7 transition-transform", menuOpen && "rotate-45")} />
        </button>
      )}

      {/* Action menu (for sections with 2+ actions) — labeled so intent is clear */}
      {menuOpen && actionOwner && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)} />
          <div className="fixed bottom-[80px] right-4 z-50 w-60 max-w-[calc(100%-2rem)] rounded-2xl border border-border bg-surface p-1.5 shadow-2xl md:hidden">
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {activeSection?.label ?? activeModule.label}
            </div>
            {actions.map((a) => {
              const Icon = actionIcon(a);
              return (
                <Link
                  key={a}
                  href={createHref(actionOwner, a)}
                  onClick={close}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium text-foreground active:bg-surface-muted"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  {a}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* Launcher */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex h-[82%] flex-col rounded-t-3xl bg-surface shadow-2xl transition-transform duration-300 md:hidden",
          open ? "translate-y-0" : "translate-y-full",
        )}
        style={{ transitionTimingFunction: "cubic-bezier(.2,.84,.24,1)" }}
      >
        <div className="shrink-0 px-5 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
          <div className="flex h-11 items-center gap-2.5 rounded-xl border border-border bg-surface-muted px-3">
            <Search className="h-[17px] w-[17px] text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules, sections, actions…"
              className="flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground active:bg-surface-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {q ? (
            <>
              <SectionLabel>
                {results.length} result{results.length !== 1 ? "s" : ""}
              </SectionLabel>
              <div className="space-y-1.5">
                {results.slice(0, 24).map((r) => {
                  const Icon = r.icon;
                  return (
                    <Link
                      key={r.key}
                      href={r.href}
                      onClick={close}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left active:scale-[.99]"
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          r.isAction ? "bg-primary/10 text-primary" : "bg-surface-muted text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">{r.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.sub}</span>
                      </span>
                      <ChevronRight className="h-[15px] w-[15px] text-muted-foreground" />
                    </Link>
                  );
                })}
                {results.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>
                )}
              </div>
            </>
          ) : (
            <>
              {actions.length > 0 && actionOwner && (
                <>
                  <SectionLabel>Quick actions · {activeSection?.label ?? activeModule.label}</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {actions.map((a) => {
                      const Icon = actionIcon(a);
                      return (
                        <Link
                          key={a}
                          href={createHref(actionOwner, a)}
                          onClick={close}
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-foreground active:scale-95"
                        >
                          <Icon className="h-4 w-4 text-primary" />
                          {a}
                        </Link>
                      );
                    })}
                  </div>
                </>
              )}

              <SectionLabel>
                {viewSections.length > 0 ? `Sections in ${viewModule.label}` : viewModule.label}
              </SectionLabel>
              <div className="space-y-1.5">
                <Link
                  href={viewModule.href}
                  onClick={close}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:scale-[.99]",
                    pathname === viewModule.href ? "border-primary bg-primary/5" : "border-border bg-surface",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                    <viewModule.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-[13px] font-semibold text-foreground">{viewModule.label} overview</span>
                  <ChevronRight className="h-[15px] w-[15px] text-muted-foreground" />
                </Link>

                {viewSections.map((s) => {
                  const on = isActive(pathname, s.href) && viewModule.href === activeModule.href;
                  return (
                    <Link
                      key={s.href}
                      href={s.href}
                      onClick={close}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:scale-[.99]",
                        on ? "border-primary bg-primary/5" : "border-border bg-surface",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          on ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
                        )}
                      >
                        <viewModule.icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-[13px] font-semibold text-foreground">{s.label}</span>
                      <ChevronRight className="h-[15px] w-[15px] text-muted-foreground" />
                    </Link>
                  );
                })}
              </div>

              <SectionLabel>Jump to module</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {modules.map((m) => {
                  const on = m.href === viewModule.href;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.href}
                      type="button"
                      onClick={() => setViewHref(m.href)}
                      className={cn(
                        "flex flex-col items-start gap-2 rounded-xl border p-2.5 text-left active:scale-95",
                        on ? "border-primary bg-primary/5" : "border-border bg-surface",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg",
                          on ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
                        )}
                      >
                        <Icon className="h-[17px] w-[17px]" />
                      </span>
                      <span className="text-[11.5px] font-semibold leading-tight text-foreground">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}
