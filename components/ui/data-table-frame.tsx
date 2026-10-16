"use client";

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { PaginationBar } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { usePagination } from "@/lib/use-pagination";

/**
 * The stateful half of `DataTable`: holds the current page and shows only that
 * page's rows, under both layouts, with a `PaginationBar` beneath.
 *
 * WHY THE ROWS ARRIVE ALREADY RENDERED. `DataTable` is called from 58 server
 * pages (finance, planning, purchase, stores, …) with `cell` FUNCTIONS in its
 * `columns`, and a function cannot cross the server→client boundary — so the
 * table itself can never carry `"use client"`. A React ELEMENT can cross it.
 * `DataTable` therefore stays server-safe, renders every `<tr>` and every
 * stacked card exactly as it always did, and hands the finished elements here
 * to be sliced. From a client screen this is just one more component in the
 * tree; from a server page the rows ride the RSC payload and the slice happens
 * after hydration. Either way no call site changes.
 *
 * `rows[i]` and `cards[i]` are the SAME record in two layouts, so one page
 * index slices both — the stacked cards below `md` show the same page as the
 * table above it.
 *
 * A PAGE'S MAIN LISTING ALWAYS WEARS THE PAGER (user 2026-10-16, screenshots
 * 3575 / 3576: "the sample entry table and pagination over all application").
 * Sample Entry, with 12 rows, showed the full-height card and its footer pager;
 * Plan Approval, with 7, showed a short card and no pager — so two listings of
 * the same app looked like two designs, and the Rows picker was unreachable
 * from any list that happened to fit. The main listing now shows both however
 * many rows it has.
 *
 * "Main listing" is decided in the browser, by `useIsListing`: not inside a
 * dialog or an editor (a table in a sheet, a pop-up, or a section of a record
 * being edited), not `bare` (a dashboard card), and the
 * ONLY table in its scrolling pane (two tables on one page cannot both reach
 * the bottom edge). Everything else keeps the old rule — the bar renders only
 * past one page, the same rule `ChildGrid` applies to its own pager ("1–1 of 1"
 * explains that the one visible row is the one visible row, client
 * 2026-08-04). A DOCUMENT table (`paginate={false}`) never pages at all. The
 * page size is the app-wide one (`lib/page-size.ts`); the operator changes it
 * from the bar of any list, or from the topbar "T" menu.
 */
export function DataTableFrame({
  paginate,
  bare = false,
  wrapperClassName,
  tableClassName,
  head,
  rows,
  cards,
  emptyRow,
  emptyCard,
  density,
}: {
  /** "compact" for a `dense` / `compact` table — stamped on the `<table>` as
   *  `data-density`, which `RowActions` reads (`in-data-[density=compact]:`)
   *  to shrink its icon buttons. See `COMPACT_ICON` in row-actions.tsx. */
  density?: "compact";
  paginate: boolean;
  /** A frameless table (a dashboard card) — never the page's main listing. */
  bare?: boolean;
  wrapperClassName: string;
  tableClassName: string;
  head: ReactNode;
  rows: ReactNode[];
  cards: ReactNode[];
  emptyRow: ReactNode;
  emptyCard: ReactNode;
}) {
  /* Always called — hooks above every branch. When not paginating the slice
     is simply the whole array. */
  const pg = usePagination(rows);
  const paging = paginate && pg.pageCount > 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const listing = useIsListing(cardRef, paginate && !bare && rows.length > 0);
  // The footer pager shows on every page of a paged list, and on a main listing
  // that fits one page too; slicing still happens only past one page.
  const showBar = paging || listing;
  const start = paging ? (pg.page - 1) * pg.pageSize : 0;
  const end = paging ? start + pg.pageSize : rows.length;
  const visibleRows = paging ? rows.slice(start, end) : rows;
  const visibleCards = paging ? cards.slice(start, end) : cards;

  /* THE PAGER IS THE CARD'S FOOTER, PINNED TO THE BOTTOM OF THE PANE (user
     2026-10-16, screenshots 3560 / 3562: "keep pagination inside the table
     card … a fixed table footer and a flexible table body", then "why it not
     yet fix with bottom"). It used to sit `mt-2` below the bordered frame, so
     it rode up and down with however many rows the page happened to hold.

     The card is a column — scroll region, then footer — and on a paged listing
     it is sized to reach the bottom of the pane it sits in (`fillHeight`). The
     body takes what is left: 10 short rows leave whitespace INSIDE the card
     rather than stretched rows, and 100 rows scroll under a sticky header while
     the pager stays put.

     MEASURED, NOT HARDCODED. The space above the table differs per screen (a
     header with a description, a filter bar, a banner), so no `100dvh − Nrem`
     is right for more than one of them. The frame measures its own top within
     its scrolling pane and takes the rest, re-measured when the pane resizes
     (a window resize, the Filters panel opening above it). A 20rem floor keeps
     a short window from crushing the body to a sliver. Desktop only — on a
     phone the stacked cards scroll with the page, as before.

     Only while there IS a pager. A listing that fits on one page has no footer
     to pin and stays pixel-identical to before, the same rule the bar itself
     follows; and a DOCUMENT table (`paginate={false}` — a PO's lines) is never
     sized, since a nested scrollbar hides lines the way a pager would
     (AGENTS.md "Pagination"). */
  const fill = useFillHeight(cardRef, showBar);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearFit = useNearFit(bodyRef, fill !== null);
  return (
    // `data-table-frame`: the surface-style hook (lib/appearance.ts STYLES).
    <div
      ref={cardRef}
      className={cn(
        wrapperClassName,
        "flex flex-col overflow-hidden",
        // Meeting the window's edge: no bottom rule, no rounded bottom corners.
        fill && fill.bleed > 0 && "rounded-b-none border-b-0",
      )}
      style={fill ? { height: fill.height, marginBottom: -fill.bleed } : undefined}
      data-table-frame=""
    >
      <div
        ref={bodyRef}
        className={cn(
          "min-h-0 flex-1 overflow-x-auto",
          paging && (nearFit ? "md:overflow-y-hidden" : "md:overflow-y-auto"),
          paging &&
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-[var(--table-head-bg)] [&_thead_th]:shadow-[inset_0_-1px_0_var(--table-head-border)]",
        )}
      >
        <table className={tableClassName} data-density={density}>
          {head}
          <tbody>{rows.length === 0 ? emptyRow : visibleRows}</tbody>
        </table>
        <div className="md:hidden">{cards.length === 0 ? emptyCard : visibleCards}</div>
      </div>
      {showBar && (
        <div className="shrink-0 border-t border-border px-3 py-2">
          <PaginationBar
            page={pg.page}
            pageCount={pg.pageCount}
            total={pg.total}
            pageSize={pg.pageSize}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </div>
      )}
    </div>
  );
}

/**
 * True when this table is its page's main listing: not in a dialog, and the
 * only `[data-table-frame]` in its scrolling pane. Measured after mount (the
 * DOM is the only place that knows), so the server render is the old one and
 * the pager arrives in the first browser frame. Re-checked when the pane's
 * content changes — a second table appearing below hands both back to the old
 * rule.
 */
function useIsListing(ref: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [listing, setListing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      setListing(false);
      return;
    }
    const pane = scrollPaneOf(el);
    // Not on an EDITOR either — the same surfaces `isEditorScope` (lib/focus.ts)
    // calls one: a table that is a section of a document being edited must keep
    // its natural height, not stretch to the pane's bottom.
    const check = () =>
      setListing(
        !el.closest('[role="dialog"], [aria-modal="true"], [data-focus-scope], [data-editor-page]') &&
          !pane.querySelector('[data-focus-region="footer"]') &&
          pane.querySelectorAll("[data-table-frame]").length === 1,
      );
    check();
    const mo = new MutationObserver(check);
    mo.observe(pane, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref, on]);
  return listing;
}

/** The nearest ancestor that scrolls vertically — the work panel on a desktop
 *  page — or the document when nothing between does. */
function scrollPaneOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return document.documentElement;
}

const FILL_FLOOR_PX = 320; // 20rem — below this the body is a sliver

/** How the card fills its pane: its height, and how far it runs on through the
 *  pane's bottom padding to meet the window's edge. */
type Fill = { height: number; bleed: number };

/**
 * The size that makes `ref`'s box end AT the bottom edge of its scrolling pane,
 * or null when it should keep its natural height (`on` false, or a phone).
 *
 * ATTACHED, NOT FLOATING (user 2026-10-16, screenshots 3565 / 3566: "the bottom
 * … not attached with screen", then "still its floating that bottom bar"). The
 * card runs through the pane's bottom padding — `bleed`, applied as a negative
 * bottom margin — so the pager sits on the window's edge instead of 24px above
 * it, and the frame squares off its bottom corners there.
 *
 * SELF-CORRECTING. The geometry (pane height − our top) assumes nothing follows
 * us in the pane; on a real screen something can (a trailing margin, a hidden
 * element), and then the pane gains its own scrollbar — screenshot 3566 had
 * exactly that. So after each pass the pane is asked whether it now overflows,
 * and any overflow is learned as `extra` and taken off the next pass. It only
 * ever grows, so it cannot oscillate.
 *
 * The top is measured in the PANE's content coordinates (`+ scrollTop`), so a
 * scrolled pane gets the same answer as an unscrolled one. Re-measured when the
 * pane or its content resizes; the 1px tolerance stops sub-pixel ping-pong.
 */
function useFillHeight(ref: RefObject<HTMLElement | null>, on: boolean): Fill | null {
  const [fill, setFill] = useState<Fill | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      setFill(null);
      return;
    }
    const pane = scrollPaneOf(el);
    const desk = window.matchMedia("(min-width: 768px)");
    let extra = 0;
    let applied: number | null = null;
    const measure = () => {
      if (!desk.matches) {
        applied = null;
        setFill(null);
        return;
      }
      const isDoc = pane === document.documentElement;
      const paneTop = isDoc ? 0 : pane.getBoundingClientRect().top;
      const top = el.getBoundingClientRect().top - paneTop + pane.scrollTop;
      const bleed = isDoc ? 0 : parseFloat(getComputedStyle(pane).paddingBottom) || 0;
      const visible = isDoc ? window.innerHeight : pane.clientHeight;
      // `ceil(top)`: at a browser zoom (125%) a box's top is fractional, and
      // floor(visible − 300.8) + 300.8 still overshoots by under a pixel —
      // which the pane rounds UP into a 1px overflow and a scrollbar
      // (screenshot 3567).
      const fit = (x: number) => Math.max(FILL_FLOOR_PX, Math.floor(visible - Math.ceil(top) - x));
      // Overflow is learned ONLY while the height on screen is the one this
      // same layout asks for. Right after a shrinking resize the OLD height
      // overflows too, and that is not something trailing us; at the floor,
      // overflow is the floor doing its job.
      const over = pane.scrollHeight - pane.clientHeight;
      if (applied !== null && applied === fit(extra) && applied > FILL_FLOOR_PX && over > 0) extra += over;
      const height = fit(extra);
      applied = height;
      setFill((f) => (f && Math.abs(f.height - height) <= 1 && f.bleed === bleed ? f : { height, bleed }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    // The pane's CONTENT — it grows when something above us does (the Filters
    // panel opening), which moves our top without resizing the pane itself.
    if (pane.firstElementChild) ro.observe(pane.firstElementChild);
    desk.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      desk.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
    };
  }, [ref, on]);
  return fill;
}

/** Overflow at or under this is rounding, not rows — clipped, never scrolled. */
const NEAR_FIT_PX = 8;

/**
 * True while the body's rows overflow it by a sliver only.
 *
 * WHY THE PAGE THAT FITS HAD A SCROLLBAR (user 2026-10-16, screenshot 3567:
 * "10 is fitting to the screen, after why that scroll bar"). Ten rows plus the
 * header's rule came to a pixel or two more than the body the pane left them,
 * and a browser draws a full scrollbar for a single pixel. Every row was on
 * screen; the bar offered to scroll the last row's bottom padding. So a
 * sliver of overflow is clipped instead — the padding under the last row is
 * all it can cost — and a real overflow (50 rows on a page) still scrolls.
 */
function useNearFit(ref: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [near, setNear] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      setNear(false);
      return;
    }
    const measure = () => {
      const over = el.scrollHeight - el.clientHeight;
      setNear(over > 0 && over <= NEAR_FIT_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [ref, on]);
  return near;
}
