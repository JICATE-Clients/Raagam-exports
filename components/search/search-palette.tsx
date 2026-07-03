"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  ArrowRight,
  Building2,
  Truck,
  Users,
  Package,
  ClipboardList,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { NAV } from "@/components/shell/nav";
import { searchNav } from "@/components/shell/nav-search";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";
import type { SearchEntity, SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/** Client-side group label + icon per record entity. */
const ENTITY_META: Record<SearchEntity, { label: string; icon: LucideIcon }> = {
  order: { label: "Orders", icon: ClipboardList },
  invoice: { label: "Invoices", icon: FileText },
  customer: { label: "Customers", icon: Building2 },
  vendor: { label: "Vendors", icon: Truck },
  product: { label: "Products", icon: Package },
  employee: { label: "Employees", icon: Users },
};

/** Fixed group order (records) — mirrors the ranking priority. */
const ENTITY_ORDER: SearchEntity[] = [
  "order",
  "invoice",
  "customer",
  "vendor",
  "product",
  "employee",
];

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/** A normalized, selectable palette row (nav or record). */
interface FlatItem {
  key: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  href: string;
}

interface Group {
  label: string;
  items: FlatItem[];
}

export function SearchPalette({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const user = useAppUser();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Permission-filtered modules for local nav search.
  const modules = useMemo(
    () => NAV.filter((i) => hasPermission(user, i.module, "view")),
    [user],
  );

  // Reset transient state each time the palette opens; focus the input.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setRecords([]);
      setActiveIndex(0);
      // Focus after the portal paints.
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Debounced record fetch, with stale-response cancellation.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setRecords([]);
          return;
        }
        const data = (await res.json()) as { results: SearchResult[] };
        setRecords(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setRecords([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Build grouped, ordered results: Navigation first, then record entities.
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [];

    const navRows = searchNav(query, modules);
    if (navRows.length)
      out.push({
        label: "Navigation",
        items: navRows.map((r) => ({
          key: r.key,
          icon: r.icon,
          title: r.title,
          sub: r.sub,
          href: r.href,
        })),
      });

    for (const type of ENTITY_ORDER) {
      const items = records.filter((r) => r.type === type);
      if (!items.length) continue;
      const icon = ENTITY_META[type].icon;
      out.push({
        label: ENTITY_META[type].label,
        items: items.map((r) => ({
          key: `${r.type}:${r.id}`,
          icon,
          title: r.title,
          sub: r.subtitle,
          href: r.href,
        })),
      });
    }

    return out;
  }, [query, modules, records]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the highlight in range as the list changes.
  useEffect(() => {
    setActiveIndex((i) => (i >= flat.length ? 0 : i));
  }, [flat.length]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        flat.length ? (i - 1 + flat.length) % flat.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = flat[activeIndex];
      if (target) go(target.href);
    }
  }

  if (!mounted || !isOpen) return null;

  const q = query.trim();
  const showEmpty = q.length >= MIN_QUERY && !loading && flat.length === 0;
  let runningIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everywhere"
        className="relative mt-[10vh] flex max-h-[70vh] w-[92%] max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      >
        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-border px-3">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search customers, orders, invoices, pages…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {q.length < MIN_QUERY && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Type at least {MIN_QUERY} characters to search records and pages.
            </p>
          )}

          {showEmpty && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results for “{q}”.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.label} className="py-1">
              <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                runningIndex += 1;
                const active = runningIndex === activeIndex;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setActiveIndex(runningIndex)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                      active ? "bg-surface-muted" : "hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                        active
                          ? "bg-primary/10 text-primary"
                          : "bg-surface-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.sub}
                      </span>
                    </span>
                    {active && (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
