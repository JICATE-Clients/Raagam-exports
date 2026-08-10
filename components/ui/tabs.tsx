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
}

export function Tabs({
  items,
  defaultKey,
  value,
  onChange,
}: {
  items: TabItem[];
  defaultKey?: string;
  /** Controlled active tab. Supply with `onChange` when a parent needs to jump
   *  the operator somewhere — "Save is blocked, the problem is on Prices". */
  value?: string;
  onChange?: (key: string) => void;
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
    <div>
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
        className="flex gap-1 overflow-x-auto border-b border-border"
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
                "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                item.disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
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
            </button>
          );
        })}
      </div>
      <div className="pt-4" role="tabpanel">
        {current?.content}
      </div>
    </div>
  );
}
