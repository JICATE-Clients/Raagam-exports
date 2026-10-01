"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { activeModule, visibleModules, type NavItem } from "./navigation-config";
import { SidebarItem } from "./SidebarItem";

/**
 * Captions for the open flyout (client 2026-09-17, sidebar option A). Keyed by
 * module href; the first, uncaptioned band holds the overview screens. A
 * module missing from this table lands in the last band rather than
 * vanishing, so a new NAV entry is still reachable before anyone files it.
 */
const RAIL_BANDS: { label?: string; hrefs: string[] }[] = [
  { hrefs: ["/", "/analytics", "/reports", "/approvals"] },
  { label: "Commercial", hrefs: ["/sales", "/orders"] },
  { label: "Operations", hrefs: ["/planning", "/purchase", "/stores", "/production", "/logistics"] },
  { label: "People & Accounts", hrefs: ["/hr", "/finance"] },
  { label: "System", hrefs: ["/masters", "/integration", "/admin"] },
];

function toBands(items: NavItem[]) {
  const placed = new Set<string>();
  const bands = RAIL_BANDS.map((b) => {
    const rows = b.hrefs
      .map((h) => items.find((i) => i.href === h))
      .filter((i): i is NavItem => !!i);
    rows.forEach((r) => placed.add(r.href));
    return { label: b.label, rows };
  });
  const rest = items.filter((i) => !placed.has(i.href));
  bands[bands.length - 1].rows.push(...rest);
  // A permission-trimmed band with nothing left would draw a lone caption.
  return bands.filter((b) => b.rows.length > 0);
}

/**
 * LEVEL 1 — the icon rail. 56px of icons by default, floats open on hover
 * without moving anything else on screen: the rail's real layout width never
 * changes, only a `fixed` overlay grows on top of it.
 *
 * RESTORED (user 2026-10-01, "restore that open close sidebar again"). A
 * labelled 80px rail replaced it for an hour; the hover flyout is back, with
 * the two things that made it look broken fixed:
 *   - IT COVERS THE WHOLE SIDEBAR. It opened 208px wide over a 248px sidebar,
 *     so slivers of the module menu (half the selected pill, the ends of the
 *     group rules) showed past its edge (screenshot 3173). Open, it is now
 *     exactly rail + module menu wide (`wide`), so nothing peeks out.
 *   - IT IS THE SIDEBAR GROWN WIDER. Closed, the rail starts below the brand
 *     row (components/shell/sidebar.tsx); open, the panel runs full height
 *     and carries the logo in the same spot, so it no longer hangs from the
 *     logo as a separate card (screenshot 3177). It also waits for intent,
 *     opens on keyboard focus and closes on Escape — see OPEN_DELAY_MS.
 *
 * Clicking a module always navigates there — `ContextSidebar` picks up the
 * new active module from the route, so there is no selection state here.
 */
/**
 * HOVER INTENT (user 2026-10-01, module-nav plan option A; NN/g "Timing
 * Guidelines for Exposing Hidden Content"). The panel used to open the instant
 * the pointer touched the 56px rail and shut the instant it left, so a pointer
 * merely passing over the rail threw a 264px panel across the module menu.
 * It now opens only once the pointer RESTS on the rail, and stays a moment
 * after it leaves, so a brief slip off the edge does not snap it shut.
 */
const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 400;

export function GlobalSidebar({ wide = false }: { wide?: boolean }) {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // Escape shut the panel while the pointer was still on the rail: the
  // movement backstop below must not reopen it until the pointer leaves.
  const dismissed = useRef(false);

  // A pending open or close must not fire after the rail unmounts (a
  // full-page editor removes the whole sidebar).
  // The ref is nulled as well as the timer cleared: a stale id left behind
  // (Fast Refresh and React's dev double-mount both run this cleanup) would
  // read as "something pending" and silence the movement backstop below.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const items = visibleModules(user);
  const active = activeModule(pathname, items);
  const bands = toBands(items);

  function schedule(open: boolean, delay: number) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setExpanded(open);
    }, delay);
  }

  return (
    /* `w-13` (52px, was 56px — user 2026-10-01 "reduce the width"): 34px icon rows inside `p-1.5`. The spacer
        and the collapsed panel below must stay the same width, or the page
        shifts under the rail. */
    <div className="relative h-full w-13 shrink-0">
      <aside
        ref={asideRef}
        aria-label="Modules"
        onMouseEnter={() => schedule(true, expanded ? 0 : OPEN_DELAY_MS)}
        // THE BACKSTOP FOR A MISSED ENTER. React derives enter from the
        // pointer crossing INTO the rail; if the pointer is already resting on
        // it when the page hydrates (a load, a dev reload), no crossing ever
        // happens and the panel would not open until the pointer left and came
        // back — reproduced on localhost 2026-10-01. Any movement over a closed
        // rail with nothing pending starts the same intent timer.
        onMouseMove={() => {
          if (!expanded && timer.current === null && !dismissed.current) {
            schedule(true, OPEN_DELAY_MS);
          }
        }}
        onMouseLeave={() => {
          dismissed.current = false;
          schedule(false, CLOSE_DELAY_MS);
        }}
        // The keyboard opens it too (Carbon's rail: "expands on hover or
        // focus"): Tab into the rail and the names are there at once.
        onFocus={() => schedule(true, 0)}
        onBlur={(e) => {
          if (!asideRef.current?.contains(e.relatedTarget as Node | null)) schedule(false, 0);
        }}
        onKeyDown={(e) => {
          // Escape closes the panel and goes no further: the app's own
          // window-level Escape (keyboard-nav-provider) would otherwise read
          // the same press as "leave this page".
          if (e.key === "Escape" && expanded) {
            e.stopPropagation();
            dismissed.current = true;
            schedule(false, 0);
          }
        }}
        className={cn(
          // FULL HEIGHT, WITH ROOM LEFT FOR THE SIDEBAR DOCK (2026-10-01).
          // The dock (`SidebarDock`, z-40, later in the DOM) sits ON this
          // panel's foot, so open it reads as the sidebar's footer; the
          // panel only pads `--dock-h` (set in `components/shell/sidebar.tsx`)
          // so no row hides beneath it. Ending the panel ABOVE the dock was
          // tried first and left it cut short, page showing under it and its
          // last rows clipped (user, screenshot 3219).
          "fixed bottom-0 left-0 z-40 flex flex-col overflow-hidden pb-[var(--dock-h,0px)]",
          "transition-[width,box-shadow,background-color] duration-[220ms] ease-out",
          // Closed, it sits ON the canvas below the brand row (`top-14`) with
          // no edge of its own. OPEN, IT IS THE SIDEBAR GROWN WIDER, not a card
          // hanging from the logo (screenshot 3177): full height (`top-0`),
          // carrying the logo in exactly the place the brand row shows it, no
          // top border, SQUARE corners (user 2026-10-01, screenshot 3180) — a straight right edge and the lift. As
          // wide as rail + module menu (236px) where the menu is showing, so
          // it covers that menu completely.
          expanded
            ? cn(
                "top-0 border-r border-border bg-surface shadow-elev-hi",
                wide ? "w-[236px]" : "w-48",
              )
            : "top-14 w-13 bg-canvas",
        )}
      >
        {expanded && (
          // The brand row's twin — same height, same CENTRED position, same
          // image — so nothing moves as the panel opens over it (components/
          // shell/sidebar.tsx draws the original). Open width = that row's
          // width, so centring here lands on exactly the same spot.
          <div className={cn("flex h-14 shrink-0 items-center justify-center", !wide && "w-13")}>
            {wide ? (
              <Image
                src="/brand/raagam-wordmark.png"
                alt="Raagam Exports"
                width={431}
                height={184}
                loading="eager"
                className="h-11 w-auto"
              />
            ) : (
              <Image
                src="/brand/raagam-mark.png"
                alt="Raagam Exports"
                width={1024}
                height={1024}
                loading="eager"
                className="h-9 w-9"
              />
            )}
          </div>
        )}
        {/* NO SCROLLBAR (user 2026-10-01, screenshot 3181: "for the module side
            bar no need scroll bar"). The list is sized to fit — 16 rows at
            32px + 4 captions at 18px ≈ 630px, ~40px spare on a 125%-scaled
            1080p window (~728px tall) — and `scrollbar-none` hides the bar
            outright. On a smaller window the wheel still scrolls it; only the
            bar is gone. `py-1` (was `p-1.5`) is part of the same budget. */}
        <nav className="scrollbar-none flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-1.5 py-1">
          {bands.map((band, bi) => (
            <div key={band.label ?? bi} className="space-y-0.5">
              {/* One fixed height either way (`h-[18px]`, was `h-5`): open it
                  is the caption, closed it is a short divider. Same height in
                  both states, so no icon moves when the panel opens (09-16). */}
              {band.label && (
                <div className="flex h-[18px] items-center gap-2 px-2" aria-hidden={!expanded}>
                  {expanded ? (
                    // No trailing hairline (2026-10-01): the caption alone
                    // starts the group, same as in the module menu.
                    <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-caption">
                      {band.label}
                    </span>
                  ) : (
                    <span className="mx-auto h-px w-6 bg-border" />
                  )}
                </div>
              )}
              {band.rows.map((item) => {
                const Icon = item.icon;
                const isActive = active?.href === item.href;

                return (
                  <div key={item.href} className="relative">
                    {/* Closed rail: a brand-green tab on the window edge
                        (the nav's `p-1.5` is what `-left-1.5` reaches past).
                        Brand on a CONTROL mark, never a surface. */}
                    {isActive && !expanded && (
                      <span
                        aria-hidden
                        className="absolute -left-1.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-brand-green"
                      />
                    )}
                    <SidebarItem
                      href={item.href}
                      label={item.label}
                      icon={<Icon className="h-4 w-4 shrink-0" />}
                      collapsed={!expanded}
                      active={isActive}
                      trailing={
                        isActive ? (
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />
                        ) : undefined
                      }
                      // ONE ROW HEIGHT IN BOTH STATES, so the icons stay put
                      // under the pointer as the panel opens (client 2026-09-16).
                      // 32px (2026-10-01): 40px rows needed 834px with the logo
                      // row, so the SYSTEM group fell below the fold (screenshot
                      // 3177); 34px still overflowed a 125%-scaled window by a
                      // few px and drew a scrollbar (3181). 32px is the app's
                      // compact control height (`h-8`). `w-full` makes the
                      // active pill a whole row instead of a tag hugging its
                      // label.
                      // 28px since the sidebar dock (2026-10-01): the dock takes
                      // ~64px off the bottom, and 16 rows × 4px is what gives it
                      // back without bringing the scrollbar (3181) back.
                      className={cn("h-7 rounded-xl", expanded && "w-full gap-3")}
                      onClick={(e) => {
                        e.preventDefault();
                        openTab({ href: item.href, title: item.label });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
