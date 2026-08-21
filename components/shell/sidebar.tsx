"use client";

import { useEffect, useState } from "react";
import { useEditorOpen } from "@/lib/editor-presence";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { NAV } from "./nav";
import { owningNavHref } from "@/lib/nav/module-groups";
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

  // The Sidebar lives in the persistent app layout, so it never re-mounts on
  // navigation — the useState initializer above only ran for the FIRST page.
  // Without this, moving to a page in another section leaves that section
  // collapsed, hiding its active sub-item. Re-expand the active group whenever
  // the route changes; only ever ADD, so a group the user opened by hand (and
  // manual collapses of inactive groups) are left untouched.
  useEffect(() => {
    const activeHrefs = NAV.filter(
      (i) => i.children?.length && isActive(pathname, i.href),
    ).map((i) => i.href);
    if (activeHrefs.length === 0) return;
    // Legitimately syncing local UI state to an external system (the router);
    // the updater returns `prev` unchanged when nothing's new, so this never
    // cascades renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded((prev) => {
      if (activeHrefs.every((h) => prev.has(h))) return prev; // already open — no re-render
      const next = new Set(prev);
      for (const h of activeHrefs) next.add(h);
      return next;
    });
  }, [pathname]);

  function toggle(href: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  /**
   * A full-page record editor takes the whole width.
   *
   * The editor carries its own section rail, so leaving this up gives the
   * operator two vertical navigations with the form squeezed between them
   * (client 2026-08-10). Returning null rather than adding a `hidden` class so
   * the nav's own scroll position and expanded-group state are rebuilt fresh on
   * the way back — a hidden-but-mounted sidebar would keep a scroll offset from
   * before the editor opened.
   *
   * Mobile is unaffected: this is `md:flex` and `MobileNav` is the nav there.
   */
  const editorOpen = useEditorOpen();
  if (editorOpen) return null;

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      {/* CENTRED, because the logo is the band's only occupant (client
          2026-08-21). While this header held a mark AND the words "Raagam ERP"
          it was a left-aligned pair, lining up with the nav items below it. A
          single lockup left-aligned in a 224px band just reads as pushed
          against the edge — there is nothing after it for the eye to continue
          along, so the whitespace lands on one side. */}
      <div className="flex h-14 items-center justify-center border-b border-border px-4">
        {/* THE FULL WORDMARK, AND NOTHING BESIDE IT (client 2026-08-21: "this
            the logo bar, no more that text Raagam exports, remove it, replace
            this logo").

            This slot has now held three things: an indigo square with a
            hand-set "R" (a placeholder from before there was artwork), then the
            "Re" roundel next to the words "Raagam ERP", and now the client's
            own lockup on its own. The words go with it — the logo already says
            "Raagam exports", so keeping a caption made the brand appear twice
            in a 224px header.

            `alt` now CARRIES the name rather than being empty: with the text
            gone this image is the only thing naming the app, so a decorative
            `alt=""` would leave a screen reader announcing nothing at all here.

            `h-10 w-auto` — the aspect ratio is the file's, so the lockup is
            never squashed; at 431x184 that is ~94px wide, well inside the
            ~192px the header has after its padding, and 40px tall inside a 56px
            (`h-14`) band that has to keep matching the topbar beside it. */}
        <Image
          src="/brand/raagam-wordmark.png"
          alt="Raagam Exports"
          width={431}
          height={184}
          priority
          className="h-10 w-auto max-w-full"
        />
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
          // A grouped module answers from its registry, because its leaf routes
          // are NOT paths beneath the group they belong to (see `owningNavHref`)
          // — a plain prefix scan would highlight nothing on `/planning/fabric-bom`.
          // Ungrouped modules (Sales, Reports) and the live store links, which
          // are not in the registry, still use the prefix scan.
          const activeChildHref = hasChildren
            ? (owningNavHref(item.href, pathname) ?? activeChild(pathname, children))
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
                {/* The label ALWAYS navigates — including for a module that has
                    sub-modules. It used to be a <button> that only toggled when
                    `hasChildren`, so a module with children carried no href at
                    all and its hub page could not be reached from the sidebar.
                    That hit all twelve modules with sub-modules (Masters,
                    Purchase, Sales, Finance, …), every one of which has a real
                    hub page, and the reported symptom was "clicking Masters
                    just lists the sub-modules, the page never opens"
                    (client 2026-07-29).

                    Expanding is the chevron's job — that button already exists
                    below and already carries `aria-expanded`, which is why the
                    two branches were duplicating each other rather than
                    dividing the work. Label navigates, chevron discloses; the
                    same split VS Code and GitHub use.

                    Clicking the label also REVEALS the children, with no code
                    here: the effect above re-expands the active group whenever
                    `pathname` changes, and only ever adds. */}
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    parentStrong
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : moduleActive
                        ? "text-primary hover:bg-primary/10"
                        : "text-muted-foreground hover:bg-border hover:text-foreground",
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
                    className="flex h-8 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
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
                            ? "bg-primary/10 font-medium text-primary hover:bg-primary/20"
                            : "text-muted-foreground hover:bg-border hover:text-foreground",
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
