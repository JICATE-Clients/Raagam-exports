"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useOpenModule } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { activeModule, visibleModules, type NavItem } from "./navigation-config";
import { SIDEBAR_HUE } from "./module-hue";
import { SidebarItem } from "./SidebarItem";
import { setMenuCollapsed } from "./menu-collapse";
import { PanelLeftOpen } from "lucide-react";

/**
 * Captions for the open flyout (client 2026-09-17, sidebar option A). Keyed by
 * module href; the first, uncaptioned band holds the overview screens. A
 * module missing from this table lands in Setup rather than
 * vanishing, so a new NAV entry is still reachable before anyone files it.
 */
/*
 * GARMENT WORDS, NOT OFFICE WORDS (user 2026-10-28: "need more clear … in
 * garment words"). "Commercial", "Operations" and "System" said nothing about
 * where a style is in its life; the captions now follow the trade's own flow —
 * a style is sampled and booked, then goes into BULK (plan, buy, store, make,
 * ship). Same six bands as before on purpose: every extra caption costs 24px
 * and the rail has no scrollbar (see the nav's spacing note below).
 */
const RAIL_BANDS: { label?: string; hrefs: string[] }[] = [
  { hrefs: ["/", "/approvals"] },
  { label: "Sampling & Orders", hrefs: ["/sales", "/orders"] },
  { label: "Bulk Production", hrefs: ["/planning", "/purchase", "/stores", "/production", "/logistics", "/logistics/transport"] },
  { label: "People & Accounts", hrefs: ["/hr", "/finance"] },
  // Out of the overview band into their own, under People & Accounts (user
  // 2026-10-29: "analytics and report also separate … move it under people
  // and account"). Dashboard and Approvals stay on top: those are where the
  // day starts; these two are read after the work is done.
  { label: "Analytics & Reports", hrefs: ["/analytics", "/reports"] },
  // Its own captioned band, not among the overview screens (user 2026-10-26:
  // "message module kku oru name vachi heading … dashboard kulla vendam").
  { label: "Huddle", hrefs: ["/comms"] },
  // Resolve Hub was only here by the fallback below; it is listed now.
  // "Setup" alone since Help & Repairs moved out to Support (user 2026-10-29).
  { label: "Setup", hrefs: ["/masters"] },
  // Its own band (user 2026-10-29: "Integration also separate") — links to
  // outside systems are not master data.
  { label: "Integration", hrefs: ["/integration"] },
  // Its own band (user 2026-10-29: "Help & support also separate under
  // Support") — reporting a breakdown is not setting the system up.
  { label: "Support", hrefs: ["/resolve"] },
  // Its own band, last (user 2026-10-29: "administration separate menu
  // group"). Users, roles, units and the system jobs are not setup the
  // shop floor does; they sit apart at the foot of the rail.
  { label: "Administration", hrefs: ["/admin"] },
];

// The icon colour is SIDEBAR_HUE (./module-hue) — one pastel for every module.
/** The unlit icon: the FULL sidebar colour on a soft tile of the same colour (user
 *  2026-10-28, "still icons look dull … bold"). The first cut pulled the ink
 *  28% toward the text colour for every theme, which is what greyed it out;
 *  only the dark theme needs a lift now (a #334155 stroke on a near-black
 *  panel is invisible), so that is where the mix lives. */
/*
 * GREY, NO TILE (Sarvam sidebar review, user 2026-10-29, fix 1,
 * https://claude.ai/artifact/EgufM8nybBmMcZ3LcvHV4H). This REVERSES the
 * 2026-10-28 tile above on purpose: eighteen blue squares meant the lit one
 * did not stand out. Unlit is now a plain line icon in the muted text colour,
 * so the one solid tile (the module you are in) is what the eye finds. The
 * stroke stays 2.25, which keeps the icons from reading dull.
 */
const HUE_INK = "text-muted-foreground";

/*
 * THE RAIL'S GLOSS (user 2026-10-29, screenshot 094801). Written here as
 * classes rather than in lib/appearance.ts's Pearl/Frost presets, so it shows
 * under every appearance — the presets only reach the screens using them.
 * Light from above, never a coloured glow: a white top highlight and a soft
 * drop shadow. Dark mode swaps the white sheen for a lifted charcoal one.
 */
const GLOSS_TILE =
  "bg-[var(--hue)] bg-[image:linear-gradient(180deg,rgb(255_255_255/.32)_0%,rgb(255_255_255/.08)_50%,rgb(255_255_255/0)_60%)] " +
  "shadow-[inset_0_1px_0_rgb(255_255_255/.45),inset_0_-1px_0_rgb(0_0_0/.12),0_2px_5px_-1px_color-mix(in_oklab,var(--hue)_45%,transparent)]";
const GLOSS_ROW =
  "bg-[image:linear-gradient(180deg,#ffffff,#eef1f5)] shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgb(15_20_30/.07),0_2px_6px_-3px_rgb(15_20_30/.22)] " +
  "dark:bg-[image:linear-gradient(180deg,#2a303a,#1f242c)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/.07),0_0_0_1px_rgb(255_255_255/.04),0_2px_6px_-3px_rgb(0_0_0/.6)]";
const GLOSS_HOVER =
  "hover:bg-[image:linear-gradient(180deg,#ffffff,#f3f5f8)] hover:shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgb(15_20_30/.05),0_2px_5px_-3px_rgb(15_20_30/.15)] " +
  "dark:hover:bg-[image:linear-gradient(180deg,#252a33,#1d2129)] dark:hover:shadow-[inset_0_1px_0_rgb(255_255_255/.05),0_2px_5px_-3px_rgb(0_0_0/.5)]";

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
  // Unlisted modules go to Setup, NOT the last band — that is
  // Administration now, and a new module is not an admin screen.
  (bands.find((b) => b.label === "Setup") ?? bands[bands.length - 1]).rows.push(...rest);
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

export function GlobalSidebar({
  wide = false,
  menuFolded = false,
}: {
  wide?: boolean;
  /** The operator folded the module menu away (menu-collapse.ts) — the rail
   *  then carries the button that brings it back. */
  menuFolded?: boolean;
}) {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenModule();
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
          // top border, SQUARE corners (user 2026-10-01, screenshot 3180) — a straight right edge and the lift.
          // AS WIDE AS ITS LONGEST NAME since 2026-10-26 (user, screenshots
          // 154318 / 160539: "side la white space … remove pannu", then
          // "innum kammi pannu", then "intha extra space aa remove pannu").
          // 236px, then 192px, then 176px each still left empty panel beside
          // the names, so the width is now the content's (`w-max`);
          // `interpolate-size` keeps the open animation where the browser
          // supports animating to a keyword width. The module menu's far edge
          // shows past it.
          expanded
            ? "top-0 w-max border-r border-border bg-surface shadow-elev-hi [interpolate-size:allow-keywords]"
            : "top-14 w-13 bg-canvas",
        )}
      >
        {expanded && (
          // The brand row's twin — same height, same CENTRED position, same
          // image — so nothing moves as the panel opens over it (components/
          // shell/sidebar.tsx draws the original). Open width = that row's
          // width, so centring here lands on exactly the same spot.
          // Centred on the panel's own (content) width: a fixed 236px row here
          // would set the `w-max` panel's width back to 236px.
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
        {/* POLISH (user 2026-10-28, screenshot 161520: "same side bar but
            some ui touch … better spacing"). Three spacing changes, nothing
            moved or restyled:
              - each band after the first starts 6px lower (`pt-1.5`), so a
                caption groups with the rows beneath it rather than sitting
                tight against the row above;
              - rows sit 2px apart (`space-y-0.5`, was 1px);
              - open, the panel pads its RIGHT side only (`pr-3`), so the active
                pill and its dot no longer run into the panel edge. Left padding
                is unchanged in both states, so no icon shifts as it opens.
            Captions now start at the icons' left edge (`px-3`, matching
            SidebarItem's own padding) instead of 4px outside it. */}
        <nav
          className={cn(
            "scrollbar-none flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-1",
            expanded && "pr-3",
          )}
        >
          {/* The way back to a folded module menu, at the top of the rail where
              the menu's own fold button sat beside the module name. */}
          {menuFolded && (
            <button
              type="button"
              title="Show menu"
              aria-label="Show menu"
              onClick={() => setMenuCollapsed(false)}
              className="mb-1.5 flex h-8 w-10 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[var(--cell-active)] hover:text-foreground"
            >
              <PanelLeftOpen aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          {bands.map((band, bi) => (
            <div key={band.label ?? bi} className={cn("space-y-0.5", bi > 0 && "pt-1.5")}>
              {/* One fixed height either way (`h-[18px]`, was `h-5`): open it
                  is the caption, closed it is a short divider. Same height in
                  both states, so no icon moves when the panel opens (09-16). */}
              {band.label && (
                <div className="flex h-[18px] items-center gap-2 px-3" aria-hidden={!expanded}>
                  {expanded ? (
                    // No trailing hairline (2026-10-01): the caption alone
                    // starts the group, same as in the module menu.
                    <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-caption">
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
                  // `--hue` is set once here and inherited by the icon tile,
                  // the row wash and the trailing dot.
                  <div
                    key={item.href}
                    className="relative"
                    style={{ "--hue": SIDEBAR_HUE } as CSSProperties}
                  >
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
                      tone="hue"
                      icon={
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-[background-color,box-shadow,color] duration-150",
                            // GLOSSY (user 2026-10-29, screenshot 094801: "add
                            // some glossy effect for the first menu module
                            // sidebar"). Light from above on the lit tile — a
                            // white band fading out by 60% and a 1px top
                            // highlight — and a short drop in its own colour.
                            isActive ? cn("text-white", GLOSS_TILE) : HUE_INK,
                          )}
                        >
                          <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
                        </span>
                      }
                      collapsed={!expanded}
                      active={isActive}
                      // No glowing end dot (same day): the module menu's
                      // active row has none, and the open rail now matches it.
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
                      // 36px, 10px curve, 14px dark text (user 2026-10-08, from the sidebar
                      // mock-up) — the same row as the context sidebar. This REVERSES the
                      // 28px above on purpose; on a short window the rail scrolls
                      // instead of fitting.
                      // 32px again (user 2026-10-26, "side la compact aa venum"):
                      // the Huddle band pushed Chats below the fold at 36px.
                      // Spacing only — the 14px text and 10px curve stay.
                      // COLOUR ICONS, OPTION C (user 2026-10-28, sidebar icon
                      // mock-up): the 28px tile (18px icon, 2.25 stroke) is centred on the same 26px
                      // line in both states — closed it sits in the 40px
                      // button, open `px-[6px]` puts it there — so no icon
                      // moves as the panel opens. The open active row takes a
                      // faint wash of the sidebar colour instead of the
                      // solid primary pill.
                      className={cn(
                        "h-8 rounded-[10px] text-[14px]",
                        !isActive && "text-foreground",
                        expanded && "w-full gap-3 px-[6px]",
                        // The rail's rows are glossy (screenshot 094801): the
                        // open active row is a raised sheen, an idle row
                        // takes a fainter one on hover. The rail ONLY — the
                        // module menu keeps its flat soft fill.
                        expanded && isActive && GLOSS_ROW,
                        !isActive && GLOSS_HOVER,
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        openTab({ href: item.href, title: item.label, inside: isActive });
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
