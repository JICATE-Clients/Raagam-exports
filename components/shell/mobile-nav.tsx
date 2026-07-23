"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  Search,
  X,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  Building2,
  Truck,
  Users,
  Package,
  ClipboardList,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { NAV, SECTION_ACTIONS, type SubNavItem } from "./nav";
import {
  actionIcon,
  createHref,
  searchNav,
  type NavSearchRow,
} from "./nav-search";
import { type StoreNavLink } from "./sidebar";
import { mastersFabSections } from "@/lib/masters/masters-nav";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import type { SearchEntity, SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/** Icon per record entity, mirroring the desktop palette. */
const ENTITY_ICON: Record<SearchEntity, LucideIcon> = {
  order: ClipboardList,
  invoice: FileText,
  customer: Building2,
  vendor: Truck,
  product: Package,
  employee: Users,
};

function isActive(pathname: string, href: string) {
  const base = href.split("?")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

/** Rough plural → singular for building a default "New <thing>" action label. */
function singularize(label: string): string {
  if (/ies$/i.test(label)) return label.replace(/ies$/i, "y");
  if (/(ses|xes|zes|ches|shes)$/i.test(label)) return label.replace(/es$/i, "");
  if (/s$/i.test(label) && !/ss$/i.test(label)) return label.replace(/s$/i, "");
  return label;
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
  const [fabSection, setFabSection] = useState<string | null>(null);
  const [records, setRecords] = useState<SearchResult[]>([]);

  // Record hits (customers, orders, invoices…) from the shared search API.
  // Kept above any early return so hook order stays stable.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRecords([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchResult[] };
        setRecords(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setRecords([]);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

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

  if (!activeModule) return null;

  // Create hierarchy: module (pill chip) → sub-module → action. The FAB opens a
  // menu of THIS module's sub-modules; each expands to its create actions, so you
  // can switch sub-module AND pick an action from one place. Uses the static
  // sub-modules (not the injected live store records). Actions come from the
  // registry, falling back to a single "New <singular>".
  const moduleSubs =
    activeModule.href === "/masters"
      ? mastersFabSections(pathname)
      : (activeModule.children ?? []);
  const actionsFor = (href: string, label: string) =>
    SECTION_ACTIONS[href] ?? [`New ${singularize(label)}`];

  // The pill's section zone reflects whichever sub-module is chosen in the FAB
  // (falls back to the URL's active section).
  const shownSection =
    (fabSection ? moduleSubs.find((s) => s.href === fabSection) : undefined) ??
    activeSection;

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
    setFabSection(null);
  }

  // ── Search results across modules · sections · actions + records ───────
  const q = query.trim().toLowerCase();
  const navResults = searchNav(query, modules, childrenFor);
  const recordRows: NavSearchRow[] = records.map((r) => ({
    key: `${r.type}:${r.id}`,
    icon: ENTITY_ICON[r.type],
    title: r.title,
    sub: r.subtitle,
    href: r.href,
  }));
  const results = [...navResults, ...recordRows];

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
      <div className="fixed inset-x-[4.75rem] bottom-4 z-40 flex h-12 justify-center md:hidden">
        <div className="flex h-full max-w-full items-center gap-0.5 rounded-full border border-border bg-surface/90 pl-1.5 pr-1.5 shadow-[0_10px_28px_-10px_rgba(20,23,30,0.35),inset_0_1px_0_rgba(255,255,255,0.75)] ring-1 ring-inset ring-white/50 backdrop-blur-xl">
          {/* Module zone → quick module switcher */}
          <button
            type="button"
            onClick={toggleModules}
            aria-expanded={modOpen}
            className="flex h-full min-w-0 items-center gap-1.5 rounded-full pl-1 pr-1.5 active:bg-surface-muted"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-inset ring-white/40">
              <activeModule.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="max-w-[64px] truncate text-[12px] font-semibold text-foreground">
              {activeModule.label}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                modOpen && "rotate-180",
              )}
            />
          </button>

          <span className="h-5 w-px shrink-0 bg-border" />

          {/* Section zone → full launcher */}
          <button
            type="button"
            onClick={launch}
            className="flex h-full min-w-0 items-center gap-1.5 rounded-full pl-1.5 pr-2 active:bg-surface-muted"
          >
            <span className="max-w-[92px] truncate text-[12px] font-semibold text-foreground">
              {shownSection?.label ?? "Overview"}
            </span>
            <ArrowUp className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Module switcher popover (from the pill's left zone) */}
      {modOpen && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setModOpen(false)} />
          <div className="fixed bottom-[80px] left-1/2 z-50 flex max-h-[64vh] w-[calc(100%-1.5rem)] max-w-[360px] -translate-x-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl md:hidden">
            <div className="px-4 pb-2.5 pt-4">
              <div className="text-[14px] font-semibold text-foreground">Switch module</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">Jump straight to any area of the ERP</div>
            </div>
            <div className="grid grid-cols-3 gap-2.5 overflow-y-auto px-3.5 pb-5 pt-1">
              {modules.map((m) => {
                const on = m.href === activeModule.href;
                const Icon = m.icon;
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    onClick={close}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2.5 rounded-2xl border p-3 text-center transition-colors active:scale-95",
                      on
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border bg-surface hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-xl",
                        on ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-foreground">
                      {m.label}
                    </span>
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
      {moduleSubs.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setModOpen(false);
            setMenuOpen((o) => !o);
          }}
          aria-expanded={menuOpen}
          aria-label="Create"
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_-6px_rgba(20,23,30,0.4),inset_0_1px_0_rgba(255,255,255,0.5)] ring-1 ring-white/25 active:scale-95 md:hidden"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
          <Plus className={cn("relative h-6 w-6 transition-transform", menuOpen && "rotate-45")} />
        </button>
      )}

      {/* Create launcher: sub-module → action drill-down for the current module */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)} />
          <div className="fixed bottom-[76px] right-4 z-50 flex max-h-[68vh] w-72 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl md:hidden">
            {(() => {
              const chosen = fabSection
                ? moduleSubs.find((s) => s.href === fabSection)
                : null;

              // Step 1 — list the module's sub-modules (names only, no actions)
              if (!chosen) {
                return (
                  <>
                    <div className="shrink-0 px-4 pb-2 pt-3">
                      <div className="text-[13px] font-semibold text-foreground">
                        Create in {activeModule.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">Choose a section</div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-2 pb-3">
                      {moduleSubs.map((sub) => {
                        const isCurrent = sub.href === activeSection?.href;
                        return (
                          <button
                            key={sub.href}
                            type="button"
                            onClick={() => {
                              setFabSection(sub.href);
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left active:bg-surface-muted"
                          >
                            <span className="flex-1 truncate text-[13px] font-semibold text-foreground">
                              {sub.label}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                                Here
                              </span>
                            )}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              }

              // Step 2 — the chosen sub-module's actions
              const subActions = actionsFor(chosen.href, chosen.label);
              return (
                <>
                  <div className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setFabSection(null)}
                      aria-label="Back to sections"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground active:bg-surface-muted"
                    >
                      <ChevronRight className="h-4 w-4 rotate-180" />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-foreground">{chosen.label}</div>
                      <div className="text-[10.5px] text-muted-foreground">Choose an action</div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-3">
                    {subActions.map((a) => {
                      const Icon = actionIcon(a);
                      return (
                        <Link
                          key={a}
                          href={createHref(chosen.href, a)}
                          onClick={close}
                          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-[13px] font-medium text-foreground active:bg-surface-muted"
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
              );
            })()}
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
              placeholder="Search records, modules, actions…"
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
              {activeSection && (
                <>
                  <SectionLabel>Quick actions · {activeSection.label}</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {actionsFor(activeSection.href, activeSection.label).map((a) => {
                      const Icon = actionIcon(a);
                      return (
                        <Link
                          key={a}
                          href={createHref(activeSection.href, a)}
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
