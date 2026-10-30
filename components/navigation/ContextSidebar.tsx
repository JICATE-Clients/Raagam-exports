"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Hash, PanelLeftClose, Search, type LucideIcon } from "lucide-react";
import { useSearch } from "@/components/search/search-provider";
import { usePathname } from "next/navigation";
import { useOpenWorkspaceTab } from "@/lib/workspace-tabs";
import { useAppUser } from "@/lib/auth/permission-context";
import type { StoreNavLink } from "@/components/shell/sidebar-types";
import { cn } from "@/lib/utils";
import { useRecent } from "@/lib/use-recent";
import { useAccordion } from "@/lib/ui/use-accordion";
import { hasPermission } from "@/lib/auth/types";
import { SidebarChannels } from "@/components/comms/sidebar-channels";
import {
  activeChildHref,
  activeModule,
  isStillNew,
  visibleModules,
  type SubNavItem,
} from "./navigation-config";
import { setMenuCollapsed } from "./menu-collapse";
import { SIDEBAR_HUE } from "./module-hue";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

/** One screen row. `newUntil` is the registry's "New" tag date (GroupChild). */
type SidebarRow = { href: string; label: string; newUntil?: string; icon?: LucideIcon };

/** A run of rows under one caption — a registry group, or the loose rows
 *  between groups (no caption). */
interface SidebarBlock {
  key: string;
  label?: string;
  /** The group's heading icon — every registry group has one. */
  icon?: LucideIcon;
  rows: SidebarRow[];
  /** Live content drawn INSTEAD of `rows` — the comms Channels list (0751),
   *  which is data, not registry. Still one fold of the same accordion. */
  content?: ReactNode;
}

/**
 * Flatten a module's children into captioned blocks: a group becomes its
 * caption plus its screens, and consecutive standalone rows share one
 * uncaptioned block. Every screen is therefore one click away and there is no
 * expand/collapse state to fall out of step with the route.
 */
function toBlocks(children: SubNavItem[]): SidebarBlock[] {
  const blocks: SidebarBlock[] = [];
  for (const c of children) {
    if (c.children?.length) {
      blocks.push({ key: c.href, label: c.label, icon: c.icon, rows: c.children });
    } else {
      const last = blocks[blocks.length - 1];
      const row = { href: c.href, label: c.label, icon: c.icon };
      if (last && !last.label) last.rows.push(row);
      else blocks.push({ key: c.href, rows: [row] });
    }
  }
  return blocks;
}

/** How many recently opened RECORDS to offer — a short list, not a history. */
const RECENT_LIMIT = 3;

/**
 * LEVEL 2 — the contextual sidebar for whichever module the current route is
 * in. Unlike the rail, this one is NOT hover-driven: it is derived straight
 * from `pathname`, so refresh, back/forward and a plain click on the rail all
 * land it on the right module for free (requirements 5, 6, 9, 10 — there is
 * no separate "selected module" state to fall out of sync with the URL).
 *
 * Renders nothing for a module with no sub-navigation (Dashboard, Analytics)
 * so no empty 250px column is reserved for it.
 */
export function ContextSidebar({ stores = [] }: { stores?: StoreNavLink[] }) {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();
  const search = useSearch();
  // ABOVE THE EARLY RETURNS — see "Hooks above every early return" in AGENTS.md.
  // Re-read on every route change so a record opened a moment ago shows up.
  const recent = useRecent(pathname);

  const items = visibleModules(user);
  const mod = activeModule(pathname, items);
  if (!mod) return null;

  // Live store records are listed directly under the Stores group, ahead of
  // its fixed operation sub-modules (Opening Stock, Requisitions, …) — same
  // injection the single-column sidebar did.
  const storeLinks: SubNavItem[] = stores.map((s) => ({
    href: `/stores/${s.id}`,
    label: s.name,
  }));
  const children: SubNavItem[] =
    mod.href === "/stores" ? [...storeLinks, ...(mod.children ?? [])] : (mod.children ?? []);

  if (children.length === 0) return null;

  /*
   * ALL GROUPS OPEN, ONE HIGHLIGHT (client 2026-09-16, option C of the sidebar
   * mock-ups). A group is a caption, never a row, so the solid bar
   * lands on exactly one thing — the screen the operator is on. It used to
   * paint the group AND its screen: two bars for one location.
   */
  const blocks = toBlocks(children);
  const leaves = blocks.flatMap((b) => b.rows);
  // THE CALLER'S CHANNELS (0751) — a fold of the SAME accordion as the hub's
  // registry group, so "one open at a time" (AGENTS.md "Folds are accordions")
  // holds across both. Appended after `leaves` is taken: its rows are records,
  // not screens, and must not compete for the screen highlight.
  if (mod.href === "/comms") {
    blocks.push({
      key: "comms:channels",
      label: "Channels",
      icon: Hash,
      rows: [],
      content: (
        <SidebarChannels
          pathname={pathname}
          canCreate={hasPermission(user, "communication", "create")}
          navigate={(href, title) => (e) => {
            e.preventDefault();
            openTab({ href, title });
          }}
        />
      ),
    });
  }
  const activeHref = activeChildHref(pathname, leaves);
  // The group to open: the one holding the screen in view, else the first
  // captioned group (a module's root page sits in no group).
  const openOnArrival =
    blocks.find((b) => b.label && b.rows.some((r) => r.href === activeHref))?.key ??
    blocks.find((b) => b.label)?.key ??
    null;

  // Records only (an order, a PO) — a screen is already listed above, so
  // repeating it here would be the menu twice.
  const leafHrefs = new Set(leaves.map((l) => l.href));
  const recentHere = recent
    .filter(
      (r) =>
        r.href.startsWith(mod.href + "/") && !leafHrefs.has(r.href) && r.href !== pathname,
    )
    .slice(0, RECENT_LIMIT);

  function navigate(href: string, title: string) {
    return (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      openTab({ href, title });
    };
  }

  return (
    <aside
      // `key` re-mounts on a module switch so the list's `animate-rise`
      // replays: the column visibly changes subject instead of its rows
      // silently swapping. The rise sits on the <nav>, not here, so the
      // column's own border never moves.
      key={mod.href}
      // No border, no fill (frame option A, 2026-10-01): the column sits on the
      // shell's canvas beside the rail, and the work panel's edge is what
      // separates it from the page.
      // `w-46` (184px) — 192 → 208 (user 2026-10-01, "cramped") → 184 the same day
      // ("reduce the width … this also making some issue"); rows truncate.
      // The rail's open flyout is sized to rail + this column (236px) so it
      // covers it exactly; change the two together.
      // `scrollbar-none` (was `scrollbar-reveal`): no bar, same as the rail
      // beside it (user 2026-10-01, sub-module menu suggestion 3). With the
      // groups folded the list rarely needs to scroll; the wheel still does.
      // THE DIVIDER (user 2026-10-01, sidebar-lines option B): a hairline on
      // the column's left edge separates the module icons from this menu.
      // It belongs to this column, so a module with no menu (Dashboard)
      // draws none — the rail then stands alone beside the page.
      // `w-56` (224px) since 2026-10-28 (sidebar plan A, user: "the width of
      // the parent … listing"): at 184px "Approvals & Amendments" and most
      // screen names ellipsised. The rail's flyout is `w-max` now, so nothing
      // else is sized to this column.
      // `--hue` is the sidebar's one icon colour (SIDEBAR_HUE), the same the
      // rail uses; the group headings' icon tiles read it.
      className="scrollbar-none flex h-full w-56 shrink-0 flex-col overflow-y-auto border-l border-panel-edge"
      style={{ "--hue": SIDEBAR_HUE } as CSSProperties}
    >
      {/* THE MODULE'S NAME (user 2026-10-01, sub-module menu suggestion 1):
          the column started straight at its first group caption, so nothing
          named the module the screens belong to. Name ONLY — the "N screens"
          count went the same morning at the user's request ("remove the
          module and screen count label"), and the logo heads the whole
          sidebar (components/shell/sidebar.tsx). The column's "+ New …"
          button is gone too; each screen's page header carries its own. */}
      {/* 16px bold, and NOT `ty-subsection`: the compact type scale sets that
          class to 600 14px, one pixel above the 13px screen names, so the
          module and its screens read as one size (screenshot 3188). */}
      {/* REMOVED FROM SIGHT THE SAME DAY (user 2026-10-01: "the sidebar
          sub-module listing — the module label, no need, remove it"). The
          rail's lit icon already says which module is open. Kept as a
          screen-reader-only heading so the menu still has a name; `pt-1`
          moves to the column so the first group caption doesn't touch the top. */}
      {/* BACK ON SCREEN (Sarvam sidebar review, user 2026-10-29, fix 4,
          https://claude.ai/artifact/EgufM8nybBmMcZ3LcvHV4H). REVERSES the
          2026-10-01 removal above on purpose: with the rail's icons now grey
          the name is the plainest statement of where you are, and it is what
          the fold button sits beside. 15px semibold — a level above the
          13.5px headings, without the 16px bold that read as a page title. */}
      <div className="flex h-10 shrink-0 items-center gap-1 pl-3 pr-1.5 pt-1">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{mod.label}</h2>
        <button
          type="button"
          title="Hide menu"
          aria-label="Hide menu"
          onClick={() => setMenuCollapsed(true)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] hover:text-foreground"
        >
          <PanelLeftClose aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {/* SEARCH ON SCREEN (fix 2). Ctrl+K has opened the app-wide palette
          since search-provider.tsx was written, and nothing said so. This row
          opens that same palette — it is a door, not a second search. A
          button styled as a row, not an <input>: typing happens in the
          palette, and a fake field here would take Tab and the caret. */}
      <div className="shrink-0 px-1.5 pb-2">
        <button
          type="button"
          onClick={search.open}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] hover:text-foreground"
        >
          <Search aria-hidden className="h-[15px] w-[15px] shrink-0" />
          <span className="flex-1">Search</span>
          <kbd className="font-mono text-[11px] text-caption">Ctrl+K</kbd>
        </button>
      </div>

      {/* THE "HOME" ROW IS HIDDEN (operator, 2026-09-15) — it only ever
          reopened the module's own root/hub page, and that page's card grid
          was hidden the same day (`group-hub.tsx`) because it repeated this
          exact sidebar listing back at the operator. The module icon in the
          level-1 rail still reaches the same route. */}
      {/* SLIM COLUMN, SAME TEXT (2026-09-21): `w-48` (was `w-56`), `space-y-2`
          between sections (was `space-y-3.5`), rows at `py-1` with no fixed
          `h-8`, and the side padding cut at every level. THE TEXT IS NOT
          PART OF IT — rows stay `SidebarItem`'s 13px and captions 10.5px. A
          `text-xs` / 9px pass was tried the same morning and withdrawn by the
          user ("text size should be like in this screenshot … remove the
          extra space at the side"): the ask was the SPACE, never the type.
          Row labels `truncate`, so a long screen name ellipsises. */}
      {/* `space-y-2.5` (was `space-y-4`, user 2026-10-01 suggestion 4): with
          captions now fold buttons the groups read apart on their own, and
          16px between them made the column one long loose list. */}
      <nav className="flex-1 animate-rise space-y-2.5 px-1.5 pb-3">
        {/* Keyed by the group holding the current screen, so arriving on a
            screen in another group (a tab, search, a link) re-opens THAT
            group — the accordion re-seeds instead of an effect chasing the
            route. */}
        <FoldingGroups
          key={openOnArrival ?? "none"}
          blocks={blocks}
          initialOpen={openOnArrival}
          activeHref={activeHref}
          renderRow={(row) => (
            /* TEXT ONLY (client 2026-09-16: "it looks much icons") — the
               level-1 rail beside this column is already a column of icons. */
            <SidebarItem
              key={row.href}
              href={row.href}
              label={row.label}
              active={row.href === activeHref}
              // 28px rows (`py-[5px]`; 30px before — suggestion 4). Text
              // size and colour unchanged: the client asked for DARKER menu
              // text on 2026-08-27, so only the spacing tightened.
              // 32px rows at 13.5px under an icon heading (plan A, 2026-10-28);
              // the solid active pill is SidebarItem's, unchanged.
              className={cn(
                "h-8 w-full rounded-lg px-3 py-0 text-[13.5px]",
                row.href !== activeHref && "text-foreground",
                // A LINK WITH AN ICON IS A HEADING (user 2026-10-30:
                // "dashboard also should look same like other headings"):
                // SidebarSection's heading box — 36px, pl-1.5, gap-2,
                // semibold — so its icon and name line up with the groups'.
                row.icon && "h-9 gap-2 pl-1.5 pr-2 font-semibold",
              )}
              icon={
                row.icon ? (
                  <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center">
                    <row.icon
                      className={cn("h-[15px] w-[15px]", row.href !== activeHref && "text-muted-foreground")}
                      strokeWidth={2}
                    />
                  </span>
                ) : undefined
              }
              onClick={navigate(row.href, row.label)}
              // fix 6: the registry's dated "New" tag, gone by itself after it.
              trailing={
                isStillNew(row.newUntil) ? (
                  <span className="shrink-0 rounded-full bg-success-soft px-1.5 text-[10.5px] font-semibold leading-[18px] text-success">
                    New
                  </span>
                ) : undefined
              }
            />
          )}
        />
      </nav>

      {recentHere.length > 0 && (
        <div className="shrink-0 border-t border-border px-1.5 py-2">
          <SidebarSection label="Recently opened">
            {recentHere.map((r) => (
              <SidebarItem
                key={r.href}
                href={r.href}
                label={r.title}
                // A bullet, not an icon — marks these as records, not screens.
                icon={<span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />}
                className="w-full rounded-lg px-2 py-1 text-[12.5px] tabular-nums"
                onClick={navigate(r.href, r.title)}
              />
            ))}
          </SidebarSection>
        </div>
      )}
    </aside>
  );
}

/**
 * FOLDS ARE ACCORDIONS (AGENTS.md): one captioned group open at a time, held
 * by `useAccordion` — one key or null, so "two open" cannot be written. It
 * starts on the group holding the screen in view (the parent re-keys this on
 * arrival in another group), and a click on any caption opens that group and
 * folds the rest, or folds the open one. Uncaptioned rows — a module's loose
 * screens between groups — are always shown: there is no header to fold them.
 * User 2026-10-01, sub-module menu suggestion 2: 18 rows in Orders became a
 * column that ran off a laptop screen; folded, it is the open group plus one
 * line per other group.
 */
function FoldingGroups({
  blocks,
  initialOpen,
  activeHref,
  renderRow,
}: {
  blocks: SidebarBlock[];
  initialOpen: string | null;
  /** The screen in view — its group's icon tile is drawn filled. */
  activeHref: string | null | undefined;
  renderRow: (row: SidebarRow) => ReactNode;
}) {
  const fold = useAccordion(initialOpen);
  return (
    <>
      {blocks.map((block) => (
        <SidebarSection
          key={block.key}
          label={block.label}
          icon={block.icon}
          current={!!activeHref && block.rows.some((r) => r.href === activeHref)}
          fold={
            block.label
              ? {
                  open: fold.isOpen(block.key),
                  onToggle: () => fold.toggle(block.key),
                }
              : undefined
          }
        >
          {block.content ?? block.rows.map(renderRow)}
        </SidebarSection>
      ))}
    </>
  );
}
