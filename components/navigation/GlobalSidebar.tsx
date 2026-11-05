"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { useAppUser } from "@/lib/auth/permission-context";
import { useOpenModule } from "@/lib/workspace-tabs";
import { cn } from "@/lib/utils";
import { activeModule, isPlainLeftClick, visibleModules, type NavItem } from "./navigation-config";
import { SIDEBAR_HUE, moduleHue, moduleWellStyle } from "./module-hue";
import { setMenuCollapsed } from "./menu-collapse";

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
  // Favourites under Home (user 2026-11-05): the day starts on one of those two.
  { hrefs: ["/", "/favourites", "/approvals"] },
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
  // Back in the scrolling list (user 2026-11-03: "move the master data and
  // integration into scrolling area") — out of the pinned System zone, each
  // under its own caption as 2026-10-29 chose.
  { label: "Setup", hrefs: ["/masters"] },
  { label: "Integration", hrefs: ["/integration"] },
];

/*
 * THE SYSTEM ZONE, PINNED TO THE FOOT (user 2026-11-03, rail mock-up
 * https://claude.ai/artifact/Y5nYRprnKMgx5fDa6Nifd5, "okay apply it"). Setup,
 * Integration, Support and Administration were four captioned bands of ONE row
 * each (2026-10-29) — nine captions for nineteen rows, ~918px on a ~730px
 * window, so everything from Huddle down sat below the fold with no scrollbar
 * and nothing saying it was there. They stay four separate rows, in the order
 * that day chose, under one "System" caption in a zone that never scrolls away;
 * the work bands above scroll behind a fade instead.
 *
 * ROWS, NOT THE MOCK-UP'S 2×2 TILES: the closed rail is one icon column, and a
 * tile grid would slide its right-hand icons sideways as the panel opens —
 * the "no icon moves under the pointer" rule (client 2026-09-16).
 */
// Support and Administration only since 2026-11-03 (Master Data and Integration
// moved back into the scrolling list, above).
const SYSTEM_HREFS = ["/resolve", "/admin"];

type Band = { label?: string; rows: NavItem[] };

function toBands(items: NavItem[]): { work: Band[]; system: Band | null } {
  const placed = new Set<string>();
  const pick = (hrefs: string[]) => {
    const rows = hrefs.map((h) => items.find((i) => i.href === h)).filter((i): i is NavItem => !!i);
    rows.forEach((r) => placed.add(r.href));
    return rows;
  };
  const work = RAIL_BANDS.map((b) => ({ label: b.label, rows: pick(b.hrefs) }));
  const systemRows = pick(SYSTEM_HREFS);
  // An unlisted module joins the work bands' end, NOT the System zone: a new
  // module is work the shop floor does, and System is fixed at four rows.
  const rest = items.filter((i) => !placed.has(i.href));
  if (rest.length) work[work.length - 1].rows.push(...rest);
  return {
    // A permission-trimmed band with nothing left would draw a lone caption.
    work: work.filter((b) => b.rows.length > 0),
    system: systemRows.length ? { label: "System", rows: systemRows } : null,
  };
}

/*
 * DIRECTION B, THE LABELLED RAIL (user 2026-11-03, "okay apply the B", from
 * https://claude.ai/artifact/UtCj7F2z4v2DV7Qkg6rvz6). A glass-blue rail (RAIL_BG), 78px,
 * every module's NAME printed under its icon, always. No hover flyout.
 *
 * This REVERSES the hover-to-open panel (2026-10-01 "restore that open close
 * sidebar", OPEN_DELAY_MS / CLOSE_DELAY_MS, the `wide` twin logo row) on
 * purpose: the names were only readable after the pointer rested on the rail,
 * the weakness the user kept circling back to. With the names always there
 * the panel has nothing left to reveal, so it is gone, and with it the "no
 * icon moves when the panel opens" constraint that shaped the earlier rail.
 *
 * Kept from the same day's rail fix: the System zone pinned at the foot
 * (Support, Administration), the work list scrolling behind a "more below"
 * fade, the band order. Captions become thin rules between bands: at 78px a
 * caption would not fit, and the grouping still reads from the gaps.
 */

/** Long module names, shortened to fit under an icon (60px of 10.5px text). The full name stays on the link's `title` and `aria-label`. */
const SHORT: Record<string, string> = {
  // The workspace's own first tab already says Home (screenshot 4007).
  Dashboard: "Home",
  "HR & Payroll": "HR",
  "Help & Repairs": "Help",
  "Master Data": "Masters",
  Administration: "Admin",
};

/** GLASS BLUE (user 2026-11-03). B was built navy ("dark colour I don't
 *  like"), then flat blue-grey ("not look good"), rolled back, given a glass
 *  blue finish, and asked for again in that finish ("okay now B design"): a
 *  pale blue gradient, frosted, with a white hairline down its right edge.
 *  One place, so the fade can match it. Dark mode takes a deep blue glass. */
const RAIL_BG =
  "bg-[linear-gradient(180deg,rgb(234_242_252/.96),rgb(218_232_249/.94))] backdrop-blur-md shadow-[inset_-1px_0_0_rgb(255_255_255/.7)] " +
  "dark:bg-[linear-gradient(180deg,rgb(30_44_64/.92),rgb(20_31_47/.92))] dark:shadow-[inset_-1px_0_0_rgb(255_255_255/.06)]";
const RAIL_FADE = "to-[rgb(218_232_249)] dark:to-[rgb(20_31_47)]";
/** The active module: a white glass pill on the blue. */
const RAIL_ACTIVE =
  "font-semibold text-foreground bg-[linear-gradient(180deg,#ffffff,rgb(255_255_255/.78))] shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgb(47_111_181/.18),0_2px_6px_-3px_rgb(15_40_80/.3)] " +
  "dark:bg-[linear-gradient(180deg,rgb(255_255_255/.14),rgb(255_255_255/.06))] dark:shadow-[inset_0_1px_0_rgb(255_255_255/.12),0_0_0_1px_rgb(110_163_224/.3)]";
/** A thin blue-tinted rule: between bands and above the System zone. */
const RAIL_RULE = "bg-[rgb(47_111_181/.16)] dark:bg-white/10";

function RailItem({ item, active, onOpen }: { item: NavItem; active: boolean; onOpen: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (isPlainLeftClick(e)) onOpen(e);
      }}
      className={cn(
        /* ROOM AROUND THE NAME (user 2026-11-03, screenshot 4007: "the active
           layout look tight and cropped"). A bold "Dashboard" filled the 62px tile
           edge to edge and clipped. Now: an 84px rail, 8px either side of the tile,
           4px inside it (60px for the name), 8px over the icon, 4px icon to name,
           6px under it, and the lit name SEMIBOLD so selecting it does not widen it. */
        // 6px over the icon since the 28px well (2026-11-05, was 8px over a bare 19px glyph):
        // the well adds 9px a row, the padding gives 2 back, and the work list still scrolls.
        "grid justify-items-center gap-1 rounded-[10px] px-1 pb-1.5 pt-1.5 text-center text-[10.5px] leading-[1.2] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? RAIL_ACTIVE : "text-muted-foreground hover:bg-white/55 hover:text-foreground dark:hover:bg-white/10",
      )}
      style={{ "--hue": SIDEBAR_HUE } as CSSProperties}
    >
      {/* EACH MODULE IN ITS OWN COLOUR (user 2026-11-05, option C): a 28px glossy well in the
          module's hue with a white glyph — the same well as its Favourites tiles (module-hue.ts
          says why this reverses 2026-10-28's single colour). The lit module keeps its white
          pill around the well, so "you are here" still reads without a second colour. */}
      <span aria-hidden className="grid size-7 place-items-center rounded-[9px]" style={moduleWellStyle(moduleHue(item.href))}>
        <Icon className="h-4 w-4" strokeWidth={2.1} />
      </span>
      <span className="max-w-full truncate">{SHORT[item.label] ?? item.label}</span>
    </Link>
  );
}

export function GlobalSidebar({
  menuFolded = false,
  footer,
}: {
  /** The operator folded the module menu away (menu-collapse.ts): the rail
   *  then carries the button that brings it back. */
  menuFolded?: boolean;
  /** Under the System zone: the compact account dock on a page with no module
   *  menu (Dashboard), where the rail is the whole sidebar. */
  footer?: ReactNode;
}) {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenModule();

  const items = visibleModules(user);
  const active = activeModule(pathname, items);
  const { work: bands, system } = toBands(items);

  /* "MORE BELOW". The work list keeps its no-scrollbar rule (2026-10-01), so a
     fade at its foot says there is more; it clears at the end. Re-measured on
     scroll and whenever the list or the window resizes. */
  const workRef = useRef<HTMLElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  useEffect(() => {
    const el = workRef.current;
    if (!el) return;
    const check = () => setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, []);

  const renderBand = (band: Band, bi: number) => (
    <div key={band.label ?? bi} role="group" aria-label={band.label}>
      {/* A thin rule between bands: the caption's job at 78px. */}
      {bi > 0 ? <div aria-hidden className={cn("mx-2.5 my-1.5 h-px", RAIL_RULE)} /> : null}
      <div className="grid gap-1">
        {band.rows.map((item) => {
          const isActive = active?.href === item.href;
          return (
            <RailItem
              key={item.href}
              item={item}
              active={isActive}
              onOpen={(e) => {
                e.preventDefault();
                openTab({ href: item.href, title: item.label, inside: isActive });
              }}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <aside aria-label="Modules" className={cn("flex h-full w-[84px] shrink-0 flex-col", RAIL_BG)}>
      {/* The brand: the round mark at the rail's head (the wordmark row that
          spanned rail + menu went with the hover panel). */}
      <div className="flex h-14 shrink-0 items-center justify-center">
        <Image src="/brand/raagam-mark.png" alt="Raagam Exports" width={1024} height={1024} priority className="h-[34px] w-[34px]" />
      </div>

      {/* THE WORK ZONE scrolls; a fade at its foot says "more below". */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <nav ref={workRef} className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-1">
          {menuFolded && (
            <button
              type="button"
              title="Show menu"
              aria-label="Show menu"
              onClick={() => setMenuCollapsed(false)}
              className="mb-1 grid h-8 w-full place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-white/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
            >
              <PanelLeftOpen aria-hidden className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          <div>{bands.map((band, bi) => renderBand(band, bi))}</div>
        </nav>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-b from-transparent transition-opacity duration-200",
            RAIL_FADE,
            atEnd && "opacity-0",
          )}
        />
      </div>

      {/* THE SYSTEM ZONE, pinned: never scrolls away. */}
      {system ? (
        <nav aria-label="System" className="shrink-0 border-t border-[rgb(47_111_181/.16)] px-2 pb-2 pt-1.5 dark:border-white/10">
          {renderBand(system, 0)}
        </nav>
      ) : null}
      {footer}
    </aside>
  );
}
