"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's tab strip — the shape a DOCUMENT wears.
 *
 * The division, decided 2026-08-09 after trying it the other way round on
 * Amendments: a MASTER's sections are facets of one record and belong on a left
 * rail (`MasterFullScreen`); a DOCUMENT's tabs are the document's own pages and
 * belong on a top strip, which is also the legacy RP-Software shape the
 * operators already know. It is a property of the entity, not a per-screen
 * preference — so a screen never picks, and two documents cannot disagree.
 *
 * What the rail had and this did not — arrow keys, a roving tab stop, and above
 * all a per-tab PROBLEM COUNT — has been brought here rather than left behind.
 * The count is the load-bearing one: with ten tabs and one mounted at a time, a
 * blocked Save is otherwise unexplainable. That is the same failure recorded on
 * `customer-master-screen.tsx:1649` and `vendor-master-screen.tsx:2240`, where
 * `canSave` gates on two errors that render in two different sections and the
 * operator is shown neither.
 */
export interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
  /**
   * BLOCKING problems in this tab — a red count on the tab itself.
   *
   * Derive it from `blockingBySection` in `lib/screens/validity.ts` so a red
   * count and a cursor that will not leave a field always mean the same thing.
   * An advisory that reddened a tab would teach the operator to distrust both.
   *
   * A COUNT, not a dot: across ten tabs a dot says "something is wrong in here"
   * and a count says how much is left, which is the difference between one trip
   * and three.
   */
  problems?: number;
  /** Quiet "this tab has data" dot. Drawn only when the tab has no problems —
   *  a tab that is blocking is not "done", and two indicators on one tab is
   *  where a ten-tab strip starts wrapping. */
  done?: boolean;
  /** Greys the tab and refuses activation. The tab is still SHOWN: a tab that
   *  disappears teaches the operator nothing about why. */
  disabled?: boolean;
  /**
   * A second line under the label — "3 lines", "no lines" — drawn ONLY in the
   * side-rail layout (`side` below), where a tab is a row with room for it. The
   * horizontal strip is one line tall and stays that way: a meta line there
   * would grow every strip in the app by a row for the sake of two screens.
   */
  meta?: ReactNode;
}

export function Tabs({
  items,
  defaultKey,
  value,
  onChange,
  side = false,
}: {
  items: TabItem[];
  defaultKey?: string;
  /** Controlled active tab. Supply with `onChange` when a parent needs to jump
   *  the operator somewhere — "Save is blocked, the problem is on Prices". */
  value?: string;
  onChange?: (key: string) => void;
  /**
   * THE STRIP STANDS AS A SIDE RAIL BESIDE THE PANEL — the Material BOM's item
   * listing shape, asked for on the Budget's Purchase / Process Rates strips
   * (user 2026-09-21, screenshot 204339: "the header bar single line into rail
   * type … took reference from material bom item listing").
   *
   * ONLY WHEN THE PANE CAN AFFORD IT. The rail takes 11rem + 1rem gap = 192px
   * off the panel, and every Budget grid is width-laid-out against its own
   * container (`tableFrom`): steal 192px from a 1,155px laptop pane and every
   * `5xl` grid drops to cards. So the rail switches in by container query at
   * 76rem (1,216px): the panel beside it is then >= 1,024, which is what a
   * `5xl` grid needs to stay a table. Below that the strip is the horizontal
   * one, byte for byte. A screen never picks the width; the pane does.
   *
   * THE NUMBER WAS 92rem FOR AN HOUR AND THE RAIL NEVER SHOWED (screenshots
   * 2994, 2996). It was chosen so the one `7xl` grid (Yarn Purchases, 1,232px
   * with its chrome) would also stay a table beside the rail — but the
   * operator's and the client's screens are 1920 @ 125%, a ~1,312 CSS px pane,
   * and a rail that needs 1,472 is a rail nobody sees. At 76rem it shows on
   * those screens and Yarn Purchases draws its compact cards beside it (the
   * same cards it draws on a 1,366 laptop today); re-cutting that grid to
   * `5xl` is the way to have both, and is a separate decision.
   *
   * `aria-orientation` stays "horizontal": it cannot follow a CSS breakpoint,
   * and the key handler below already treats ↑/↓ and ←/→ alike, so the arrows
   * walk the rail correctly either way.
   */
  side?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultKey ?? items[0]?.key);
  const active = value ?? uncontrolled;
  const current = items.find((i) => i.key === active) ?? items[0];
  const stripRef = useRef<HTMLDivElement>(null);

  function select(key: string) {
    if (value === undefined) setUncontrolled(key);
    onChange?.(key);
  }

  // Keep the active tab on screen. Ten tabs overflow a narrow window, and a
  // parent jumping to a problem on "Country/Sizewise" would otherwise switch to
  // a tab scrolled out of sight — the operator sees the panel change and no tab
  // highlighted. `inline: "nearest"` so it never scrolls when already visible.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(active ?? "")}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  /**
   * Arrows move FOCUS along the strip; Enter/Space activate (native, on real
   * <button>s). Manual activation, the same choice the section rail makes: auto
   * -activating on arrow would swap the panel under the operator mid-browse and
   * make it impossible to read the strip without changing what they are editing.
   *
   * Every branch preventDefaults, or the global `arrowNavigate` would take over
   * and move spatially, out of the strip.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-tab-key]:not([disabled])"),
    );
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i === -1 || !tabs.length) return;
    const last = tabs.length - 1;
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(i + 1, last);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(i - 1, 0);
    else return;
    e.preventDefault();
    tabs[next].focus();
  }

  return (
    // TWO ELEMENTS, NOT ONE. The outer div DECLARES the container; the inner one
    // and everything below QUERY it. A container query reads the nearest
    // ANCESTOR container, never the element it sits on — with both classes on
    // one div the tint below matched (its buttons are descendants) and the grid
    // never did (the div was asking itself). Screenshot 2994.
    <div className={cn(side && "@container/tabs")}>
    <div
      className={cn(
        side &&
          "@min-[76rem]/tabs:grid @min-[76rem]/tabs:grid-cols-[11rem_1fr] @min-[76rem]/tabs:items-start @min-[76rem]/tabs:gap-4",
      )}
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        // Chrome, not fields. Inside an editor surface this sorts the strip with
        // the header rather than into the middle of data entry; on a plain page
        // there is no scope to sort within and it is inert. Either way it says
        // what this row is.
        data-focus-region="header"
        /**
         * `overflow-y-hidden` IS NOT TIDYING — IT IS WHAT TAKES THE UP/DOWN
         * ARROW BUTTONS OFF THE RIGHT END OF THE STRIP (operator, 2026-09-12,
         * on Fabric BOM ▸ Fabric Lines ▸ [Detail] ▸ Yarn Dyed Details).
         *
         * THERE WAS NEVER ANY JSX TO DELETE FOR THEM, which is the whole reason
         * this is written down here. They are a SCROLLBAR — Chrome's Windows 11
         * scrollbars draw a stepper arrow at each end, and on a 38px-tall strip
         * the two arrows meet with no thumb between them, so a pair of buttons
         * appears beside three tabs that fit the width perfectly well.
         *
         * Two things combine to grow one, and neither is visible on its own:
         *
         * - `overflow-x-auto` sets ONLY `overflow-x`. CSS then computes the
         *   other axis' `visible` to `auto` (Overflow 3 §3), so one declaration
         *   makes this a scroll container on BOTH axes.
         * - The tabs below used to carry `-mb-px`, to pull the active tab's 2px
         *   border over the 1px one on this element. Under `align-items:
         *   stretch` that single negative pixel puts each tab's border box 1px
         *   below this element's content box — 1px of vertical scrollable
         *   overflow, which is all a scrollbar needs.
         *
         * The negative margin is gone (see the tab's own class), so nothing
         * overflows and nothing is clipped. This stays as the guard: it costs
         * nothing, and it is what stops the arrows coming back the next time a
         * tab gains a pixel this row did not budget for. A tab strip has no
         * vertical axis to scroll in the first place.
         */
        className={cn(
          "flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border",
          // The side rail: a column with a right rule, no scrolling — three or
          // four rows never overflow a pane that is 1,472px wide.
          side &&
            "@min-[76rem]/tabs:flex-col @min-[76rem]/tabs:gap-0.5 @min-[76rem]/tabs:overflow-visible @min-[76rem]/tabs:border-b-0 @min-[76rem]/tabs:border-r @min-[76rem]/tabs:pr-3",
        )}
      >
        {items.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              data-tab-key={item.key}
              aria-selected={isActive}
              disabled={item.disabled}
              // Roving tab stop: the whole strip costs ONE Tab stop instead of
              // one per tab. Inactive tabs stay reachable with the arrows above
              // — tabIndex={-1} blocks Tab, not .focus().
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(item.key)}
              className={cn(
                // NO `-mb-px`. It used to sit at the head of this line so the
                // active tab's 2px border landed ON the strip's own 1px one
                // rather than above it — one pixel of polish that cost the
                // scrollbar arrows described on the strip above, because a
                // negative end margin is still vertical overflow to a box that
                // `overflow-x-auto` has already made scrollable on both axes.
                // The accent now sits directly on top of the divider, which
                // runs unbroken under every tab. Do not put it back.
                "ty-tab flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                item.disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                // As a rail row: full width, the accent on the LEFT edge, the
                // label and its badge on one line and `meta` under them. The
                // active row is tinted the way a selected table row is
                // (`bg-primary/5`, data-table.tsx) — a 2px edge alone is
                // too little to mark one row of four.
                side &&
                  "@min-[76rem]/tabs:w-full @min-[76rem]/tabs:flex-col @min-[76rem]/tabs:items-start @min-[76rem]/tabs:gap-0.5 @min-[76rem]/tabs:whitespace-normal @min-[76rem]/tabs:rounded-r-md @min-[76rem]/tabs:border-b-0 @min-[76rem]/tabs:border-l-2 @min-[76rem]/tabs:px-2.5 @min-[76rem]/tabs:py-1.5 @min-[76rem]/tabs:text-left",
                side && isActive && "@min-[76rem]/tabs:bg-primary/5",
              )}
            >
              <span className="flex items-center gap-1.5">
              {item.label}
              {/* `bg-danger-soft text-danger` is the app's existing danger badge
                  idiom (status-pill.tsx) and the theme-safe one — there is no
                  `--danger-foreground` token, and `--danger` inverts to a LIGHT
                  red in dark mode, so a filled pill would need hardcoded white
                  text and would fail one theme or the other.

                  The aria-label sits inside the button, so the tab's accessible
                  name becomes "Prices 2 problems" — announced with the tab
                  rather than as loose chrome beside it. */}
              {item.problems ? (
                <span
                  className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-danger-soft px-1 text-[10px] font-bold leading-none text-danger"
                  aria-label={`${item.problems} problem${item.problems === 1 ? "" : "s"}`}
                >
                  {item.problems}
                </span>
              ) : item.done ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full border border-accent bg-accent"
                  aria-label="has data"
                />
              ) : null}
              </span>
              {side && item.meta != null && (
                <span className="hidden text-[11px] font-normal leading-tight text-muted-foreground @min-[76rem]/tabs:block">
                  {item.meta}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={cn("pt-4", side && "@min-[76rem]/tabs:min-w-0 @min-[76rem]/tabs:pt-0")} role="tabpanel">
        {current?.content}
      </div>
    </div>
    </div>
  );
}
